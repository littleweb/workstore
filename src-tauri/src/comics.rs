use crate::storage::{atomic_write, Store};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_BYTES: usize = 64 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicInfo {
    pub id: String,
    pub title: String,
    pub favorite: bool,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_opened_at: u64,
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comic {
    #[serde(rename = "type")]
    pub kind: String,
    pub schema_version: u32,
    #[serde(flatten)]
    pub info: ComicInfo,
    pub content: Value,
}

#[derive(Serialize)]
pub struct LoadedComic {
    pub comic: Comic,
    pub token: String,
}

#[derive(Serialize)]
pub struct ComicList {
    pub comics: Vec<ComicInfo>,
    pub warnings: Vec<String>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn token(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn check_id(id: &str) -> Result<()> {
    if Uuid::parse_str(id).map_err(|_| "漫画 ID 无效")?.to_string() != id {
        return Err("漫画 ID 无效".into());
    }
    Ok(())
}

fn checked_dir(parent: &Path, child: &str) -> Result<PathBuf> {
    let path = parent.join(child);
    match fs::symlink_metadata(&path) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => {
            return Err("漫画目录必须为真实目录".into())
        }
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&path).map_err(|e| e.to_string())?
        }
        Err(e) => return Err(e.to_string()),
    }
    Ok(path)
}

fn validate(doc: &Comic) -> Result<()> {
    check_id(&doc.info.id)?;
    if doc.kind != "workstore.comic" || doc.schema_version != 1 {
        return Err("不支持的漫画类型或版本".into());
    }
    if doc.info.title.trim().is_empty() || doc.info.title.chars().count() > 120 {
        return Err("漫画名称须为 1–120 个字符".into());
    }
    validate_content(&doc.content)?;
    Ok(())
}
fn validate_content(v: &Value) -> Result<()> {
    let settings = v["settings"].as_object().ok_or("作品设定缺失")?;
    let count = settings
        .get("count")
        .and_then(Value::as_u64)
        .filter(|n| [4, 6, 8].contains(n))
        .ok_or("漫画张数无效")?;
    if !matches!(v["settings"]["ratio"].as_str(), Some("3:4" | "1:1" | "4:3" | "9:16")) {
        return Err("漫画比例无效".into());
    }
    let pages = v["pages"].as_array().ok_or("漫画页面缺失")?;
    if pages.len() != count as usize
        || !v["history"].is_array()
        || !v["publishing"].is_object()
        || !v["templateSnapshot"].is_object()
    {
        return Err("漫画内容格式无效".into());
    }
    let mut ids = std::collections::HashSet::new();
    for p in pages {
        let id = p["id"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() < 100)
            .ok_or("分镜编号无效")?;
        if !ids.insert(id)
            || !p["action"].is_string()
            || !p["dialogue"].is_string()
            || !p["entityIds"].is_array()
        {
            return Err("分镜内容无效".into());
        }
    }
    Ok(())
}

fn read_file(path: &Path) -> Result<(Comic, Vec<u8>)> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_BYTES as u64 {
        return Err("漫画文件无效或超过 64 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let doc: Comic = serde_json::from_slice(&bytes).map_err(|e| format!("漫画 JSON 损坏：{e}"))?;
    validate(&doc)?;
    Ok((doc, bytes))
}

impl Store {
    fn comic_dir(&self) -> Result<PathBuf> {
        checked_dir(&checked_dir(self.root_path(), "data")?, "app.comic")
    }

    fn comic_path(&self, id: &str) -> Result<PathBuf> {
        check_id(id)?;
        Ok(self.comic_dir()?.join(format!("{id}.comic.json")))
    }

    pub fn list_comics(&self) -> Result<ComicList> {
        let mut out = ComicList {
            comics: vec![],
            warnings: vec![],
        };

        for entry in fs::read_dir(self.comic_dir()?).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if !name.ends_with(".comic.json") {
                continue;
            }
            match read_file(&path) {
                Ok((doc, _)) if name == format!("{}.comic.json", doc.info.id) => {
                    out.comics.push(doc.info)
                }
                Ok(_) => out.warnings.push(format!("{name}：文件名与漫画 ID 不一致")),
                Err(e) => out.warnings.push(format!("{name}：{e}")),
            }
        }

        out.comics
            .sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id)));
        Ok(out)
    }

    pub fn create_comic(&self, content: Value) -> Result<LoadedComic> {
        let time = now();
        let doc = Comic {
            kind: "workstore.comic".into(),
            schema_version: 1,
            info: ComicInfo {
                id: Uuid::new_v4().to_string(),
                title: "未命名漫画".into(),
                favorite: false,
                created_at: time,
                updated_at: time,
                last_opened_at: time,
                revision: 1,
            },
            content,
        };

        validate(&doc)?;
        let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
        let path = self.comic_path(&doc.info.id)?;
        if path.exists() {
            return Err("漫画 ID 冲突，请重试".into());
        }

        atomic_write(&path, &bytes)?;
        Ok(LoadedComic {
            comic: doc,
            token: token(&bytes),
        })
    }

    pub fn load_comic(&self, id: &str) -> Result<LoadedComic> {
        let (doc, bytes) = read_file(&self.comic_path(id)?)?;
        if doc.info.id != id {
            return Err("漫画 ID 不匹配".into());
        }
        Ok(LoadedComic {
            comic: doc,
            token: token(&bytes),
        })
    }

    pub fn save_comic(&self, mut doc: Comic, expected_token: String) -> Result<LoadedComic> {
        validate(&doc)?;
        let path = self.comic_path(&doc.info.id)?;
        let (old, old_bytes) = read_file(&path)?;
        if token(&old_bytes) != expected_token {
            return Err("漫画已被外部修改，未覆盖文件。请先导出当前漫画备份，再重新打开。".into());
        }

        doc.info.created_at = old.info.created_at;
        doc.info.updated_at = now();
        doc.info.revision = old.info.revision + 1;

        let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_BYTES {
            return Err("漫画超过 64 MB，请减少内容体积".into());
        }

        let backup = checked_dir(
            &checked_dir(self.root_path(), ".workstore")?,
            "comic-backups",
        )?
        .join(format!("{}.json", doc.info.id));

        atomic_write(&backup, &old_bytes)?;
        atomic_write(&path, &bytes)?;

        Ok(LoadedComic {
            comic: doc,
            token: token(&bytes),
        })
    }
}

#[tauri::command]
pub async fn save_comic_export(path: String, data: String) -> Result<()> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let path = PathBuf::from(path);
    if !path.is_absolute()
        || !matches!(
            path.extension().and_then(|s| s.to_str()),
            Some("zip" | "json")
        )
    {
        return Err("导出路径或格式无效".into());
    }
    if data.len() > 180_000_000 {
        return Err("导出文件过大".into());
    }
    let bytes = STANDARD.decode(data).map_err(|_| "导出内容无效")?;
    atomic_write(&path, &bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn content() -> Value {
        serde_json::json!({"settings":{"ratio":"3:4","count":4},"pages":(0..4).map(|n|serde_json::json!({"id":n.to_string(),"action":"story","dialogue":"hello","entityIds":[]})).collect::<Vec<_>>(),"history":[],"publishing":{},"templateSnapshot":{}})
    }
    #[test]
    fn persists_complete_creation_and_refuses_stale_overwrite() {
        let t = tempfile::tempdir().unwrap();
        let store = Store::open(t.path().join("config"), t.path().join("data")).unwrap();
        let created = store.create_comic(content()).unwrap();
        let id = created.comic.info.id.clone();
        assert_eq!(
            store.load_comic(&id).unwrap().comic.content["pages"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
        let mut doc = created.comic;
        doc.info.title = "A".into();
        let saved = store
            .save_comic(doc.clone(), created.token.clone())
            .unwrap();
        doc.info.title = "B".into();
        assert!(store.save_comic(doc, created.token).is_err());
        assert_eq!(
            store.load_comic(&id).unwrap().comic.info.title,
            saved.comic.info.title
        );
    }
    #[test]
    fn portrait_ratio_survives_save_and_reload() {
        let t = tempfile::tempdir().unwrap();
        let store = Store::open(t.path().join("config"), t.path().join("data")).unwrap();
        let mut data = content();
        data["settings"]["ratio"] = "9:16".into();
        let created = store.create_comic(data).unwrap();
        let reloaded = store.load_comic(&created.comic.info.id).unwrap();
        assert_eq!(reloaded.comic.content["settings"]["ratio"], "9:16");
    }
    #[test]
    fn refuses_corrupt_content_and_path_traversal() {
        let t = tempfile::tempdir().unwrap();
        let store = Store::open(t.path().join("config"), t.path().join("data")).unwrap();
        assert!(store.create_comic(serde_json::json!({})).is_err());
        assert!(store.load_comic("../../secret").is_err());
        let mut c = content();
        c["pages"][1]["id"] = c["pages"][0]["id"].clone();
        assert!(validate_content(&c).is_err());
    }
}
