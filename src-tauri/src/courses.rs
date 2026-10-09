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

// Immutable, reproducible prompt groups; JSON remains the synced source of truth.
fn save_prompt_group(root: &Path, doc: &Document) -> Result<()> {
    let Some(raw) = doc.content.as_str() else { return Ok(()) };
    let Ok(content) = serde_json::from_str::<Value>(raw) else { return Ok(()) };
    if !content.get("engine").and_then(Value::as_str).is_some_and(|v| v.starts_with("baoyu-xhs-images@")) { return Ok(()) }
    let mut prompts: Vec<(String, String)> = Vec::new();
    if let Some(source) = content.pointer("/config/topic").and_then(Value::as_str) { prompts.push(("source.md".into(), source.into())); }
    if let Some(analysis) = content.pointer("/plan/analysis").and_then(Value::as_str) { prompts.push(("analysis.md".into(), analysis.into())); }
    if let Some(plan) = content.get("plan") {
        let pages: Vec<Value> = plan.get("pages").and_then(Value::as_array).map(|pages| pages.iter().map(|page| serde_json::json!({"title":page["title"],"text":page["text"],"visual":page["visual"],"layout":page["layout"]})).collect()).unwrap_or_default();
        let outline = serde_json::json!({"title":plan["title"],"summary":plan["summary"],"pages":pages});
        prompts.push(("outline.md".into(), serde_json::to_string_pretty(&outline).map_err(|e| e.to_string())?));
    }
    if let Some(pages) = content.pointer("/plan/pages").and_then(Value::as_array) {
        for (i, page) in pages.iter().enumerate() {
            if let Some(prompt) = page.get("prompt").and_then(Value::as_str) {
                prompts.push((format!("prompts/{:02}-{}.md", i+1, if i == 0 { "cover" } else { "page" }), prompt.into()));
            }
        }
    }
    if prompts.is_empty() { return Ok(()) }
    if prompts.len() > 13 || prompts.iter().any(|(_, p)| p.len() > 128_000) { return Err("知识卡片提示词过长".into()) }
    let digest = token(&serde_json::to_vec(&prompts).map_err(|e| e.to_string())?);
    let dir = checked_dir(&checked_dir(&checked_dir(&checked_dir(root, ".workstore")?, "course-prompts")?, &doc.info.id)?, &digest)?;
    checked_dir(&dir, "prompts")?;
    for (name, prompt) in prompts {
        let path = dir.join(name);
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if !meta.is_file() || meta.file_type().is_symlink() { return Err("知识卡片提示词路径无效".into()) }
            if fs::read(&path).map_err(|e| e.to_string())? == prompt.as_bytes() { continue }
            return Err("已保存的知识卡片提示词被修改，请保留现场并重试".into());
        }
        atomic_write(&path, prompt.as_bytes())?;
    }
    Ok(())
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
    if doc.kind != "workstore.course" || doc.schema_version != 1 {
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
    fn course_document_dir(&self) -> Result<PathBuf> {
        checked_dir(&checked_dir(self.root_path(), "data")?, "app.course")
    }

    fn course_document_path(&self, id: &str) -> Result<PathBuf> {
        check_id(id)?;
        Ok(self.course_document_dir()?.join(format!("{id}.course.json")))
    }

    pub fn list_course_documents(&self) -> Result<DocumentList> {
        let mut out = DocumentList {
            documents: vec![],
            warnings: vec![],
        };

        for entry in fs::read_dir(self.course_document_dir()?).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if !name.ends_with(".course.json") {
                continue;
            }
            match read_file(&path) {
                Ok((doc, _)) if name == format!("{}.course.json", doc.info.id) => {
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

    pub fn create_course_document(&self) -> Result<LoadedDocument> {
        let time = now();
        let doc = Document {
            kind: "workstore.course".into(),
            schema_version: 1,
            info: DocumentInfo {
                id: Uuid::new_v4().to_string(),
                title: "未命名知识卡片".into(),
                favorite: false,
                created_at: time,
                updated_at: time,
                last_opened_at: time,
                revision: 1,
            },
            content: serde_json::Value::String(String::new()),
        };

        let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
        let path = self.course_document_path(&doc.info.id)?;
        if path.exists() {
            return Err("文档 ID 冲突，请重试".into());
        }

        atomic_write(&path, &bytes)?;
        Ok(LoadedDocument {
            document: doc,
            token: token(&bytes),
        })
    }

    pub fn load_course_document(&self, id: &str) -> Result<LoadedDocument> {
        let (doc, bytes) = read_file(&self.course_document_path(id)?)?;
        if doc.info.id != id {
            return Err("文档 ID 不匹配".into());
        }
        Ok(LoadedDocument {
            document: doc,
            token: token(&bytes),
        })
    }

    pub fn delete_course_document(&self, id: &str, expected_token: &str) -> Result<()> {
        let path = self.course_document_path(id)?;
        let (doc, bytes) = read_file(&path)?;
        if doc.info.id != id || token(&bytes) != expected_token {
            return Err("作品已被外部修改，请重新打开后再删除".into());
        }
        let backup = checked_dir(&checked_dir(self.root_path(), ".workstore")?, "deleted-courses")?
            .join(format!("{id}-{}.json", token(&bytes)));
        atomic_write(&backup, &bytes)?;
        fs::remove_file(path).map_err(|e| e.to_string())
    }

    pub fn save_course_document(
        &self,
        mut doc: Document,
        expected_token: String,
    ) -> Result<LoadedDocument> {
        validate(&doc)?;
        let path = self.course_document_path(&doc.info.id)?;
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
            "course-backups",
        )?
        .join(format!("{}.json", doc.info.id));

        save_prompt_group(self.root_path(), &doc)?;
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
    fn deletion_checks_version_and_preserves_original() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("config"), temp.path().join("workspace")).unwrap();
        let loaded = store.create_course_document().unwrap();
        let id = &loaded.document.info.id;
        let path = store.course_document_path(id).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(store.delete_course_document(id, "stale").is_err());
        assert!(path.exists());
        store.delete_course_document(id, &loaded.token).unwrap();
        assert!(!path.exists());
        let backup = store.root_path().join(".workstore/deleted-courses")
            .join(format!("{id}-{}.json", loaded.token));
        assert_eq!(fs::read(backup).unwrap(), bytes);
        assert!(store.list_course_documents().unwrap().documents.is_empty());
        assert!(store.delete_course_document("../invalid", &loaded.token).is_err());
    }
    #[test]
    fn prompt_group_is_durable_and_versions_do_not_overwrite() {
        let root = std::env::temp_dir().join(format!("story-prompts-{}", Uuid::new_v4()));
        let store = Store::open(root.join("config"), root.join("workspace")).unwrap();
        let loaded = store.create_course_document().unwrap();
        let mut doc = loaded.document;
        doc.content = Value::String(serde_json::json!({"engine":"baoyu-xhs-images@test","characterPrompt":"characters","plan":{"pages":[{"prompt":"cover"}]}}).to_string());
        let saved = store.save_course_document(doc.clone(), loaded.token).unwrap();
        let dir = store.root_path().join(".workstore/course-prompts").join(&doc.info.id);
        let first = fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
        assert_eq!(fs::read_to_string(first.join("prompts/01-cover.md")).unwrap(), "cover");
        doc.content = Value::String(doc.content.as_str().unwrap().replace("cover", "revised"));
        store.save_course_document(doc, saved.token).unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        let mut extended = store.load_course_document(&saved.document.info.id).unwrap();
        extended.document.content = Value::String(serde_json::json!({"engine":"baoyu-xhs-images@test","characterPrompt":"characters","plan":{"pages":(0..10).map(|i| serde_json::json!({"prompt":format!("page-{i}")})).collect::<Vec<_>>()}}).to_string());
        store.save_course_document(extended.document, extended.token).unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 3);
        assert_eq!(fs::read_to_string(first.join("prompts/01-cover.md")).unwrap(), "cover");
        drop(store); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn course_roundtrip_conflict_and_backup() {
        let root = std::env::temp_dir().join(format!("workstore-course-test-{}", Uuid::new_v4()));
        let store = Store::open(root.join("config"), root.join("workspace")).unwrap();
        let original = store.create_course_document().unwrap();
        assert_eq!(original.document.info.title, "未命名知识卡片");
        let id = original.document.info.id.clone();
        let mut doc = original.document.clone();
        doc.content = Value::String("{\"course\":\"<h1>Hello</h1>\"}".into());
        let saved = store.save_course_document(doc.clone(), original.token.clone()).unwrap();
        assert_eq!(store.load_course_document(&id).unwrap().document.content, doc.content);
        assert_eq!(store.list_course_documents().unwrap().documents.len(), 1);
        assert!(store.list_documents().unwrap().documents.is_empty());
        assert!(store.save_course_document(doc, original.token).is_err());
        assert_eq!(store.load_course_document(&id).unwrap().token, saved.token);
        assert!(store.root_path().join(".workstore/course-backups").join(format!("{id}.json")).is_file());
        assert!(store.load_course_document("../../state").is_err());
        drop(store); fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command]
pub async fn save_course_export(path: String, data: String) -> Result<()> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let path = PathBuf::from(path);
    if !path.is_absolute() || !matches!(path.extension().and_then(|s| s.to_str()), Some("png" | "zip" | "pdf")) {
        return Err("导出路径或格式无效".into());
    }
    if data.len() > 180_000_000 { return Err("导出文件过大".into()); }
    let bytes = STANDARD.decode(data).map_err(|_| "导出内容无效")?;
    if path.extension().and_then(|s| s.to_str()) == Some("png") && !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("图片格式无效".into());
    }
    atomic_write(&path, &bytes)
}
