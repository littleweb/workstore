use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub favorite: bool,
    pub rank: u32,
    pub last_opened: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    pub schema_version: u32,
    pub entries: Vec<Entry>,
    pub json: String,
    pub color: String,
    pub stamp: String,
    pub collapsed: bool,
}
impl Default for Data {
    fn default() -> Self {
        Self {
            schema_version: 1,
            entries: ["app.ai", "app.project", "app.doc"]
                .iter()
                .enumerate()
                .map(|(rank, id)| Entry {
                    id: id.to_string(),
                    favorite: true,
                    rank: rank as u32,
                    last_opened: None,
                })
                .collect(),
            json: "{\"hello\":\"WorkStore\",\"local\":true}".into(),
            color: "#28796b".into(),
            stamp: "1789257600".into(),
            collapsed: false,
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    schema_version: u32,
    id: String,
}
#[derive(Serialize, Deserialize)]
struct Bootstrap {
    workspace: PathBuf,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub path: PathBuf,
    pub data: Data,
}
pub struct Store {
    root: PathBuf,
    config: PathBuf,
    _lock: File,
    disk: Vec<u8>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Invalid path")?;
    fs::create_dir_all(parent).map_err(err)?;
    let mut tmp = NamedTempFile::new_in(parent).map_err(err)?;
    tmp.write_all(bytes).map_err(err)?;
    tmp.as_file().sync_all().map_err(err)?;
    tmp.persist(path).map_err(err)?;
    #[cfg(unix)]
    File::open(parent).map_err(err)?.sync_all().map_err(err)?;
    Ok(())
}
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    atomic_write(path, &serde_json::to_vec_pretty(value).map_err(err)?)
}
fn reject_links(root: &Path) -> Result<()> {
    for item in fs::read_dir(root).map_err(err)? {
        let p = item.map_err(err)?.path();
        let m = fs::symlink_metadata(&p).map_err(err)?;
        if m.file_type().is_symlink() {
            return Err(format!("工作目录包含符号链接，暂不支持：{}", p.display()));
        }
        if m.is_dir()
            && !matches!(
                p.file_name().and_then(|s| s.to_str()),
                Some(".git" | ".workstore")
            )
        {
            reject_links(&p)?;
        }
    }
    Ok(())
}
pub(crate) fn validate(data: &Data) -> Result<()> {
    if data.stamp.len() > 128 || data.entries.len() > 100 {
        return Err("数据超过允许长度".into());
    }
    if data.schema_version != 1 {
        return Err("不支持此数据版本".into());
    }
    let mut ids = std::collections::HashSet::new();
    for e in &data.entries {
        if ![
            "app.ai",
            "app.project",
            "app.doc",
            "app.whiteboard",
            "app.comic",
            "tool.json",
            "tool.color",
            "tool.time",
            "web.github",
        ]
        .contains(&e.id.as_str())
            || !ids.insert(&e.id)
        {
            return Err("工具记录无效或重复".into());
        }
    }
    if data.json.len() > 5 * 1024 * 1024 {
        return Err("编辑器内容超过 5 MB".into());
    }
    if data.color.len() != 7
        || !data.color.starts_with('#')
        || !data.color[1..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("色值无效".into());
    }
    Ok(())
}
impl Store {
    // Only migrate the historical default. Never probe Documents on a fresh install
    // or override a custom workspace. The bootstrap switch happens after verification.
    pub fn open_default(config: PathBuf, default: PathBuf, legacy: PathBuf) -> Result<Self> {
        let pointer = config.join("bootstrap.json");
        let migrate = if pointer.exists() {
            serde_json::from_slice::<Bootstrap>(&fs::read(&pointer).map_err(err)?)
                .map_err(err)?
                .workspace
                == legacy
        } else {
            false
        };
        let mut store = Self::open(config, default.clone())?;
        if migrate {
            fs::create_dir_all(&default).map_err(err)?;
            store
                .relocate(default)
                .map_err(|e| format!("迁移默认工作目录失败，原文件保留：{e}"))?;
        }
        Ok(store)
    }
    pub(crate) fn root_path(&self) -> &Path {
        &self.root
    }
    pub fn open(config: PathBuf, default: PathBuf) -> Result<Self> {
        fs::create_dir_all(&config).map_err(err)?;
        let pointer = config.join("bootstrap.json");
        let root = if pointer.exists() {
            serde_json::from_slice::<Bootstrap>(&fs::read(&pointer).map_err(err)?)
                .map_err(err)?
                .workspace
        } else {
            default
        };
        if root.exists()
            && !root.join("workspace.json").exists()
            && fs::read_dir(&root).map_err(err)?.next().is_some()
        {
            return Err(format!("默认目录非空且不是 WorkStore 工作空间：{}。请先保留该目录并在 bootstrap.json 指定独立数据目录。",root.display()));
        }
        fs::create_dir_all(&root).map_err(err)?;
        let root = fs::canonicalize(root).map_err(err)?;
        reject_links(&root)?;
        if root.join("workspace.json").exists() {
            let m: Manifest =
                serde_json::from_slice(&fs::read(root.join("workspace.json")).map_err(err)?)
                    .map_err(err)?;
            if m.schema_version != 1 {
                return Err("工作空间版本不兼容".into());
            }
        }
        let lock = Self::lock(&root)?;
        crate::sync::recover(&root)?;
        if !root.join("workspace.json").exists() {
            write_json(
                &root.join("workspace.json"),
                &Manifest {
                    schema_version: 1,
                    id: Uuid::new_v4().to_string(),
                },
            )?;
            write_json(&root.join("state.json"), &Data::default())?;
            atomic_write(&root.join(".gitignore"), b".workstore/\n")?;
        }
        crate::sync::reconcile_history(&root)?;
        let disk = fs::read(root.join("state.json")).map_err(err)?;
        let store = Self {
            root,
            config,
            _lock: lock,
            disk,
        };
        store.snapshot()?;
        write_json(
            &pointer,
            &Bootstrap {
                workspace: store.root.clone(),
            },
        )?;
        Ok(store)
    }
    fn lock(root: &Path) -> Result<File> {
        fs::create_dir_all(root.join(".workstore")).map_err(err)?;
        let f = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join(".workstore/workspace.lock"))
            .map_err(err)?;
        f.try_lock_exclusive()
            .map_err(|_| "工作空间正在被另一实例使用".to_string())?;
        Ok(f)
    }
    pub fn refresh_disk(&mut self) -> Result<()> {
        self.snapshot()?;
        self.disk = fs::read(self.root.join("state.json")).map_err(err)?;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let data: Data =
            serde_json::from_slice(&fs::read(self.root.join("state.json")).map_err(err)?)
                .map_err(|e| format!("工作空间数据读取失败，未覆盖原文件：{e}"))?;
        validate(&data)?;
        Ok(Snapshot {
            path: self.root.clone(),
            data,
        })
    }
    pub fn save(&mut self, data: Data) -> Result<bool> {
        validate(&data)?;
        reject_links(&self.root)?;
        let old = fs::read(self.root.join("state.json")).map_err(err)?;
        if old != self.disk {
            return Err(
                "文件已被外部修改，请先备份当前输入并重新打开工作空间；未覆盖磁盘内容".into(),
            );
        }
        let bytes = serde_json::to_vec_pretty(&data).map_err(err)?;
        if bytes == old {
            return Ok(false);
        }
        atomic_write(&self.root.join(".workstore/state.backup.json"), &old)?;
        atomic_write(&self.root.join("state.json"), &bytes)?;
        self.disk = bytes;
        Ok(true)
    }
    pub fn relocate(&mut self, target: PathBuf) -> Result<Snapshot> {
        let target = fs::canonicalize(&target).map_err(err)?;
        if target == self.root {
            return self.snapshot();
        }
        if target.starts_with(&self.root) || self.root.starts_with(&target) {
            return Err("新旧目录不能互相包含".into());
        }
        if fs::read_dir(&target).map_err(err)?.next().is_some() {
            return Err("请选择空目录，防止覆盖已有文件".into());
        }
        reject_links(&self.root)?;
        // Exclusive destination lock; old workspace remains untouched on all failures.
        let lock = Self::lock(&target)?;
        fn copy(src: &Path, dst: &Path) -> Result<()> {
            for entry in fs::read_dir(src).map_err(err)? {
                let entry = entry.map_err(err)?;
                if entry.file_name() == ".workstore" {
                    continue;
                }
                let from = entry.path();
                let to = dst.join(entry.file_name());
                if from.is_dir() {
                    fs::create_dir(&to).map_err(err)?;
                    copy(&from, &to)?;
                } else {
                    let bytes = fs::read(&from).map_err(err)?;
                    atomic_write(&to, &bytes)?;
                    if fs::read(&to).map_err(err)? != bytes {
                        return Err("复制校验失败".into());
                    }
                }
            }
            Ok(())
        }
        copy(&self.root, &target)?;
        write_json(
            &self.config.join("bootstrap.json"),
            &Bootstrap {
                workspace: target.clone(),
            },
        )?;
        self.root = target;
        self._lock = lock;
        self.snapshot()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registered_tools_can_be_saved_and_reopened() {
        // Exercise the actual frontend registry so new tools cannot silently miss validation.
        let frontend = include_str!("../../src/main.tsx");
        let registry = frontend
            .split("const tools: Tool[] = [")
            .nth(1)
            .unwrap()
            .split("type Entry =")
            .next()
            .unwrap();
        let mut data = Data::default();
        data.entries = registry
            .split(r#"id: ""#)
            .skip(1)
            .enumerate()
            .map(|(rank, part)| Entry {
                id: part.split('"').next().unwrap().to_string(),
                favorite: true,
                rank: rank as u32,
                last_opened: Some(123),
            })
            .collect();
        assert!(data.entries.iter().any(|e| e.id == "app.comic"));
        let t = tempfile::tempdir().unwrap();
        let config = t.path().join("config");
        let root = t.path().join("workspace");
        let mut store = Store::open(config.clone(), root.clone()).unwrap();
        assert!(store.save(data.clone()).unwrap());
        drop(store);
        let reopened = Store::open(config, root).unwrap();
        assert_eq!(reopened.snapshot().unwrap().data.entries, data.entries);
    }
    #[test]
    fn recent_comic_survives_repeated_restarts() {
        let t = tempfile::tempdir().unwrap();
        let config = t.path().join("config");
        let root = t.path().join("workspace");
        let mut store = Store::open(config.clone(), root.clone()).unwrap();
        let mut data = store.snapshot().unwrap().data;
        data.entries.push(Entry {
            id: "app.comic".into(), favorite: false,
            rank: data.entries.len() as u32, last_opened: Some(123),
        });
        store.save(data).unwrap();
        drop(store);
        for timestamp in [456, 789] {
            let mut store = Store::open(config.clone(), root.clone()).unwrap();
            let mut data = store.snapshot().unwrap().data;
            let recent: Vec<_> = data.entries.iter()
                .filter(|e| !e.favorite && e.last_opened.is_some()).collect();
            assert_eq!(recent.len(), 1);
            assert_eq!(recent[0].id, "app.comic");
            let comic = data.entries.iter_mut().find(|e| e.id == "app.comic").unwrap();
            comic.last_opened = Some(timestamp);
            store.save(data).unwrap();
        }
        let store = Store::open(config, root).unwrap();
        let data = store.snapshot().unwrap().data;
        let comic = data.entries.iter().find(|e| e.id == "app.comic").unwrap();
        assert!(!comic.favorite);
        assert_eq!(comic.last_opened, Some(789));
    }

    #[test]
    fn unknown_and_duplicate_tool_entries_remain_rejected() {
        let mut data = Data::default();
        data.entries.push(data.entries[0].clone());
        assert!(validate(&data).is_err());
        data.entries.last_mut().unwrap().id = "app.unknown".into();
        assert!(validate(&data).is_err());
    }

    #[test]
    fn migrates_legacy_default_once_and_preserves_documents() {
        let t = tempfile::tempdir().unwrap();
        let config = t.path().join("config");
        let legacy = t.path().join("Documents/WorkStore");
        let default = t.path().join("app/workspace");
        drop(Store::open(config.clone(), legacy.clone()).unwrap());
        let legacy = fs::canonicalize(legacy).unwrap();
        fs::create_dir(legacy.join("documents")).unwrap();
        fs::write(
            legacy.join("documents/example.json"),
            b"{\"text\":\"keep\"}",
        )
        .unwrap();
        let s = Store::open_default(config.clone(), default.clone(), legacy.clone()).unwrap();
        assert_eq!(s.root_path(), fs::canonicalize(&default).unwrap());
        assert_eq!(
            fs::read(default.join("documents/example.json")).unwrap(),
            fs::read(legacy.join("documents/example.json")).unwrap()
        );
        drop(s);
        // Reopening must not touch the old Documents folder anymore.
        fs::remove_dir_all(&legacy).unwrap();
        assert!(Store::open_default(config, default, legacy).is_ok());
    }
    #[test]
    fn custom_workspace_is_not_migrated_and_new_install_ignores_legacy() {
        let t = tempfile::tempdir().unwrap();
        let config = t.path().join("config");
        let custom = t.path().join("custom");
        let default = t.path().join("app/workspace");
        let legacy = t.path().join("Documents/WorkStore");
        drop(Store::open(config.clone(), custom.clone()).unwrap());
        let s = Store::open_default(config, default.clone(), legacy.clone()).unwrap();
        assert_eq!(s.root_path(), fs::canonicalize(custom).unwrap());
        assert!(!default.exists());
        drop(s);
        assert!(Store::open_default(t.path().join("new-config"), default, legacy.clone()).is_ok());
        assert!(!legacy.exists());
    }
    #[test]
    fn migration_collision_preserves_bootstrap_and_files() {
        let t = tempfile::tempdir().unwrap();
        let config = t.path().join("config");
        let legacy = t.path().join("legacy");
        let default = t.path().join("new");
        drop(Store::open(config.clone(), legacy.clone()).unwrap());
        let legacy = fs::canonicalize(legacy).unwrap();
        let before = fs::read(config.join("bootstrap.json")).unwrap();
        fs::create_dir(&default).unwrap();
        fs::write(default.join("keep"), "keep").unwrap();
        assert!(Store::open_default(config.clone(), default.clone(), legacy.clone()).is_err());
        assert_eq!(before, fs::read(config.join("bootstrap.json")).unwrap());
        assert!(legacy.join("state.json").exists());
        assert_eq!(fs::read_to_string(default.join("keep")).unwrap(), "keep");
    }
    #[test]
    fn persists_and_reopens() {
        let t = tempfile::tempdir().unwrap();
        let c = t.path().join("config");
        let r = t.path().join("data");
        {
            let mut s = Store::open(c.clone(), r.clone()).unwrap();
            let mut d = Data::default();
            d.collapsed = true;
            s.save(d).unwrap();
            assert!(s.snapshot().unwrap().data.collapsed);
        }
        assert!(
            Store::open(c, r)
                .unwrap()
                .snapshot()
                .unwrap()
                .data
                .collapsed
        );
    }
    #[test]
    fn rejects_duplicate_and_keeps_original() {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path().join("c"), t.path().join("d")).unwrap();
        let mut d = Data::default();
        d.entries.push(d.entries[0].clone());
        assert!(s.save(d).is_err());
        assert_eq!(s.snapshot().unwrap().data.entries.len(), 3);
    }
    #[test]
    fn refuses_nonempty_and_migrates_without_deleting_source() {
        let t = tempfile::tempdir().unwrap();
        let old = t.path().join("old");
        let mut s = Store::open(t.path().join("c"), old.clone()).unwrap();
        let dest = t.path().join("new");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("existing"), "keep").unwrap();
        assert!(s.relocate(dest.clone()).is_err());
        fs::remove_file(dest.join("existing")).unwrap();
        s.relocate(dest.clone()).unwrap();
        assert!(old.join("state.json").exists());
        assert_eq!(s.snapshot().unwrap().path, fs::canonicalize(&dest).unwrap());
        drop(s);
        assert_eq!(
            Store::open(t.path().join("c"), old)
                .unwrap()
                .snapshot()
                .unwrap()
                .path,
            fs::canonicalize(dest).unwrap()
        );
    }
    #[test]
    fn external_edit_is_preserved() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path().join("d");
        let mut s = Store::open(t.path().join("c"), r.clone()).unwrap();
        fs::write(r.join("state.json"), "external change").unwrap();
        assert!(s.save(Data::default()).is_err());
        assert_eq!(
            fs::read_to_string(r.join("state.json")).unwrap(),
            "external change"
        );
    }
    #[test]
    fn workspace_lock_prevents_second_writer() {
        let t = tempfile::tempdir().unwrap();
        let c = t.path().join("c");
        let r = t.path().join("d");
        let _s = Store::open(c.clone(), r.clone()).unwrap();
        assert!(Store::open(c, r).is_err());
    }
    #[test]
    fn corrupted_data_is_not_overwritten() {
        let t = tempfile::tempdir().unwrap();
        let c = t.path().join("c");
        let r = t.path().join("d");
        drop(Store::open(c.clone(), r.clone()).unwrap());
        fs::write(r.join("state.json"), "broken").unwrap();
        assert!(Store::open(c, r.clone()).is_err());
        assert_eq!(fs::read_to_string(r.join("state.json")).unwrap(), "broken");
    }
}
