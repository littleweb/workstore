use crate::storage::{atomic_write, Store};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
pub struct BoardInfo {
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
pub struct Board {
    #[serde(rename = "type")]
    pub kind: String,
    pub schema_version: u32,
    #[serde(flatten)]
    pub info: BoardInfo,
    pub scene: Value,
}
#[derive(Serialize)]
pub struct LoadedBoard {
    pub document: Board,
    pub token: String,
}
#[derive(Serialize)]
pub struct BoardList {
    pub documents: Vec<BoardInfo>,
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
    if Uuid::parse_str(id).map_err(|_| "白板 ID 无效")?.to_string() != id {
        return Err("白板 ID 无效".into());
    }
    Ok(())
}
fn checked_dir(parent: &Path, child: &str) -> Result<PathBuf> {
    let p = parent.join(child);
    match fs::symlink_metadata(&p) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => {
            return Err("白板目录必须为真实目录".into())
        }
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&p).map_err(|e| e.to_string())?
        }
        Err(e) => return Err(e.to_string()),
    }
    Ok(p)
}
fn validate(board: &Board) -> Result<()> {
    check_id(&board.info.id)?;
    if board.kind != "workstore.whiteboard" || board.schema_version != 1 {
        return Err("不支持的白板文档类型或版本".into());
    }
    if board.info.title.trim().is_empty() || board.info.title.chars().count() > 120 {
        return Err("白板名称须为 1–120 个字符".into());
    }
    if board.scene.get("type").and_then(Value::as_str) != Some("excalidraw")
        || board.scene.get("version").and_then(Value::as_u64) != Some(2)
        || !board.scene.get("elements").is_some_and(Value::is_array)
        || !board.scene.get("appState").is_some_and(Value::is_object)
        || !board.scene.get("files").is_some_and(Value::is_object)
    {
        return Err("Excalidraw 场景格式无效".into());
    }
    Ok(())
}
fn read_file(path: &Path) -> Result<(Board, Vec<u8>)> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_BYTES as u64 {
        return Err("白板文件无效或超过 64 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let doc: Board = serde_json::from_slice(&bytes).map_err(|e| format!("白板 JSON 损坏：{e}"))?;
    validate(&doc)?;
    Ok((doc, bytes))
}
impl Store {
    fn board_dir(&self) -> Result<PathBuf> {
        checked_dir(&checked_dir(self.root_path(), "data")?, "app.whiteboard")
    }
    fn board_path(&self, id: &str) -> Result<PathBuf> {
        check_id(id)?;
        Ok(self.board_dir()?.join(format!("{id}.whiteboard.json")))
    }
    pub fn list_boards(&self) -> Result<BoardList> {
        let mut out = BoardList {
            documents: vec![],
            warnings: vec![],
        };
        for entry in fs::read_dir(self.board_dir()?).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if !name.ends_with(".whiteboard.json") {
                continue;
            }
            match read_file(&path) {
                Ok((board, _)) if name == format!("{}.whiteboard.json", board.info.id) => {
                    out.documents.push(board.info)
                }
                Ok(_) => out.warnings.push(format!("{name}：文件名与文档 ID 不一致")),
                Err(e) => out.warnings.push(format!("{name}：{e}")),
            }
        }
        out.documents
            .sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
        Ok(out)
    }
    pub fn create_board(&self) -> Result<LoadedBoard> {
        let time = now();
        let doc = Board {
            kind: "workstore.whiteboard".into(),
            schema_version: 1,
            info: BoardInfo {
                id: Uuid::new_v4().to_string(),
                title: "未命名白板".into(),
                favorite: false,
                created_at: time,
                updated_at: time,
                last_opened_at: time,
                revision: 1,
            },
            scene: json!({"type":"excalidraw","version":2,"source":"WorkStore","elements":[],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}),
        };
        let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
        let path = self.board_path(&doc.info.id)?;
        if path.exists() {
            return Err("文档 ID 冲突，请重试".into());
        }
        atomic_write(&path, &bytes)?;
        Ok(LoadedBoard {
            document: doc,
            token: token(&bytes),
        })
    }
    pub fn load_board(&self, id: &str) -> Result<LoadedBoard> {
        let (doc, bytes) = read_file(&self.board_path(id)?)?;
        if doc.info.id != id {
            return Err("文档 ID 不匹配".into());
        }
        Ok(LoadedBoard {
            document: doc,
            token: token(&bytes),
        })
    }
    pub fn save_board(&self, mut doc: Board, expected_token: String) -> Result<LoadedBoard> {
        validate(&doc)?;
        let path = self.board_path(&doc.info.id)?;
        let (old, old_bytes) = read_file(&path)?;
        if token(&old_bytes) != expected_token {
            return Err("白板已被外部修改，未覆盖文件。请先导出当前白板备份，再重新打开。".into());
        }
        doc.info.created_at = old.info.created_at;
        doc.info.updated_at = now();
        doc.info.revision = old.info.revision + 1;
        let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_BYTES {
            return Err("白板超过 64 MB，请减少图片或拆分文档".into());
        }
        let backup = checked_dir(
            &checked_dir(self.root_path(), ".workstore")?,
            "whiteboard-backups",
        )?
        .join(format!("{}.json", doc.info.id));
        atomic_write(&backup, &old_bytes)?;
        atomic_write(&path, &bytes)?;
        Ok(LoadedBoard {
            document: doc,
            token: token(&bytes),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn create_scene_and_reopen_after_migration() {
        let t = tempfile::tempdir().unwrap();
        let config = t.path().join("config");
        let root = t.path().join("data");
        let mut s = Store::open(config.clone(), root.clone()).unwrap();
        let mut b = s.create_board().unwrap();
        b.document.info.title = "架构图".into();
        b.document.info.favorite = true;
        b.document.scene["elements"] = json!([{"id":"shape-1","type":"rectangle"}]);
        b.document.scene["files"] = json!({"image-1":{"dataURL":"data:image/png;base64,YQ=="}});
        let b = s.save_board(b.document, b.token).unwrap();
        let id = b.document.info.id.clone();
        let target = t.path().join("moved");
        fs::create_dir(&target).unwrap();
        s.relocate(target).unwrap();
        drop(s);
        let s = Store::open(config, root).unwrap();
        let d = s.load_board(&id).unwrap().document;
        assert_eq!(d.info.title, "架构图");
        assert!(d.info.favorite);
        assert_eq!(d.scene["elements"][0]["id"], "shape-1");
        assert!(d.scene["files"]["image-1"].is_object());
        assert_eq!(s.list_boards().unwrap().documents.len(), 1);
    }
    #[test]
    fn prevents_stale_and_external_overwrites() {
        let t = tempfile::tempdir().unwrap();
        let s = Store::open(t.path().join("c"), t.path().join("d")).unwrap();
        let b = s.create_board().unwrap();
        let stale = b.token.clone();
        let fresh = s.save_board(b.document, stale.clone()).unwrap();
        assert!(s.save_board(fresh.document.clone(), stale).is_err());
        let path = s.board_path(&fresh.document.info.id).unwrap();
        fs::write(&path, "broken external file").unwrap();
        assert!(s.save_board(fresh.document, fresh.token).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "broken external file");
    }
    #[test]
    fn rejects_paths_and_skips_corrupt_documents() {
        let t = tempfile::tempdir().unwrap();
        let s = Store::open(t.path().join("c"), t.path().join("d")).unwrap();
        assert!(s.load_board("../../state").is_err());
        s.create_board().unwrap();
        fs::write(s.board_dir().unwrap().join("bad.whiteboard.json"), "bad").unwrap();
        let l = s.list_boards().unwrap();
        assert_eq!(l.documents.len(), 1);
        assert_eq!(l.warnings.len(), 1);
    }
}
