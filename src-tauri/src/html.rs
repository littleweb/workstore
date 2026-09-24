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
pub struct DocumentInfo {
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
pub struct Document {
    #[serde(rename = "type")]
    pub kind: String,
    pub schema_version: u32,
    #[serde(flatten)]
    pub info: DocumentInfo,
    pub content: Value,
}

#[derive(Serialize)]
pub struct LoadedDocument {
    pub document: Document,
    pub token: String,
}

#[derive(Serialize)]
pub struct DocumentList {
    pub documents: Vec<DocumentInfo>,
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
    if Uuid::parse_str(id).map_err(|_| "文档 ID 无效")?.to_string() != id {
        return Err("文档 ID 无效".into());
    }
    Ok(())
}

fn checked_dir(parent: &Path, child: &str) -> Result<PathBuf> {
    let path = parent.join(child);
    match fs::symlink_metadata(&path) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => {
            return Err("文档目录必须为真实目录".into())
        }
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&path).map_err(|e| e.to_string())?
        }
        Err(e) => return Err(e.to_string()),
    }
    Ok(path)
}

fn validate(doc: &Document) -> Result<()> {
    check_id(&doc.info.id)?;
    if doc.kind != "workstore.html" || doc.schema_version != 1 {
        return Err("不支持的文档类型或版本".into());
    }
    if doc.info.title.trim().is_empty() || doc.info.title.chars().count() > 120 {
        return Err("文档名称须为 1–120 个字符".into());
    }
    Ok(())
}

fn read_file(path: &Path) -> Result<(Document, Vec<u8>)> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_BYTES as u64 {
        return Err("文档文件无效或超过 64 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let doc: Document =
        serde_json::from_slice(&bytes).map_err(|e| format!("文档 JSON 损坏：{e}"))?;
    validate(&doc)?;
    Ok((doc, bytes))
}

impl Store {
    fn html_document_dir(&self) -> Result<PathBuf> {
        checked_dir(&checked_dir(self.root_path(), "data")?, "app.html")
    }

    fn html_document_path(&self, id: &str) -> Result<PathBuf> {
        check_id(id)?;
        Ok(self.html_document_dir()?.join(format!("{id}.html.json")))
    }

    pub fn list_html_documents(&self) -> Result<DocumentList> {
        let mut out = DocumentList {
            documents: vec![],
            warnings: vec![],
        };

        for entry in fs::read_dir(self.html_document_dir()?).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if !name.ends_with(".html.json") {
                continue;
            }
            match read_file(&path) {
                Ok((doc, _)) if name == format!("{}.html.json", doc.info.id) => {
                    out.documents.push(doc.info)
                }
                Ok(_) => out.warnings.push(format!("{name}：文件名与文档 ID 不一致")),
                Err(e) => out.warnings.push(format!("{name}：{e}")),
            }
        }

        out.documents
            .sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
        Ok(out)
    }

    pub fn create_html_document(&self) -> Result<LoadedDocument> {
        let time = now();
        let doc = Document {
            kind: "workstore.html".into(),
            schema_version: 1,
            info: DocumentInfo {
                id: Uuid::new_v4().to_string(),
                title: "未命名 HTML".into(),
                favorite: false,
                created_at: time,
                updated_at: time,
                last_opened_at: time,
                revision: 1,
            },
            content: serde_json::Value::String(String::new()),
        };

        let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
        let path = self.html_document_path(&doc.info.id)?;
        if path.exists() {
            return Err("文档 ID 冲突，请重试".into());
        }

        atomic_write(&path, &bytes)?;
        Ok(LoadedDocument {
            document: doc,
            token: token(&bytes),
        })
    }

    pub fn load_html_document(&self, id: &str) -> Result<LoadedDocument> {
        let (doc, bytes) = read_file(&self.html_document_path(id)?)?;
        if doc.info.id != id {
            return Err("文档 ID 不匹配".into());
        }
        Ok(LoadedDocument {
            document: doc,
            token: token(&bytes),
        })
    }

    pub fn save_html_document(
        &self,
        mut doc: Document,
        expected_token: String,
    ) -> Result<LoadedDocument> {
        validate(&doc)?;
        let path = self.html_document_path(&doc.info.id)?;
        let (old, old_bytes) = read_file(&path)?;
        if token(&old_bytes) != expected_token {
            return Err("文档已被外部修改，未覆盖文件。请先导出当前文档备份，再重新打开。".into());
        }

        doc.info.created_at = old.info.created_at;
        doc.info.updated_at = now();
        doc.info.revision = old.info.revision + 1;

        let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_BYTES {
            return Err("文档超过 64 MB，请减少内容体积".into());
        }

        let backup = checked_dir(
            &checked_dir(self.root_path(), ".workstore")?,
            "html-backups",
        )?
        .join(format!("{}.json", doc.info.id));

        atomic_write(&backup, &old_bytes)?;
        atomic_write(&path, &bytes)?;

        Ok(LoadedDocument {
            document: doc,
            token: token(&bytes),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn html_roundtrip_conflict_and_backup() {
        let root = std::env::temp_dir().join(format!("workstore-html-test-{}", Uuid::new_v4()));
        let store = Store::open(root.join("config"), root.join("workspace")).unwrap();
        let original = store.create_html_document().unwrap();
        let id = original.document.info.id.clone();
        let mut doc = original.document.clone();
        doc.content = Value::String("{\"html\":\"<h1>Hello</h1>\"}".into());
        let saved = store.save_html_document(doc.clone(), original.token.clone()).unwrap();
        assert_eq!(store.load_html_document(&id).unwrap().document.content, doc.content);
        assert_eq!(store.list_html_documents().unwrap().documents.len(), 1);
        assert!(store.list_documents().unwrap().documents.is_empty());
        assert!(store.save_html_document(doc, original.token).is_err());
        assert_eq!(store.load_html_document(&id).unwrap().token, saved.token);
        assert!(store.root_path().join(".workstore/html-backups").join(format!("{id}.json")).is_file());
        assert!(store.load_html_document("../../state").is_err());
        drop(store); fs::remove_dir_all(root).unwrap();
    }
}
