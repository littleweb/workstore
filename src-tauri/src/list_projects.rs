use crate::storage::{atomic_write, Store};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};
use uuid::Uuid;
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project { pub name: String, pub created_at: u64, pub deleted: bool }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectData {
    #[serde(rename="type")] pub kind: String,
    pub schema_version: u32,
    pub tool_id: String,
    pub projects: BTreeMap<String, Project>,
    pub memberships: BTreeMap<String, Option<String>>,
}
#[derive(Deserialize)]
#[serde(tag="action", rename_all="camelCase")]
pub enum Operation {
    Create { id: String, name: String },
    Rename { id: String, name: String },
    Remove { id: String },
    #[serde(rename_all="camelCase")]
    Move { document_id: String, project_id: Option<String> },
}
fn check_id(id: &str) -> Result<()> {
    if Uuid::parse_str(id).map_err(|_| "项目或条目 ID 无效")?.to_string() != id { return Err("项目或条目 ID 无效".into()); }
    Ok(())
}
fn check_tool(tool: &str) -> Result<()> {
    if !tool.starts_with("app.") || tool.len() < 5 || tool.len() > 64 || !tool.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-') { return Err("工具标识无效".into()); }
    Ok(())
}
fn check_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name.chars().count() > 80 {return Err("项目名称须为 1–80 个字符".into());} Ok(())
}
pub fn validate(data: &ProjectData, tool: &str) -> Result<()> {
    check_tool(tool)?;
    if data.kind != "workstore.list-projects" || data.schema_version != 1 || data.tool_id != tool || data.projects.len() > 2000 || data.memberships.len() > 100000 { return Err("项目数据类型、版本或数量无效".into()); }
    for (id, project) in &data.projects { check_id(id)?; check_name(&project.name)?; }
    for (id, project) in &data.memberships { check_id(id)?; if let Some(id) = project { check_id(id)?; } }
    // Dangling memberships are retained for out-of-order sync, never hide files.
    Ok(())
}
fn path(root: &Path, tool: &str, create: bool) -> Result<PathBuf> {
    check_tool(tool)?;
    let mut dir = root.to_path_buf();
    for name in ["data", tool] {
        dir.push(name);
        match fs::symlink_metadata(&dir) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => return Err("项目目录必须为真实目录".into()),
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => { if create { fs::create_dir(&dir).map_err(|e| e.to_string())?; } },
            Err(e) => return Err(e.to_string()),
        }
    }
    let file = dir.join("projects.list.json");
    match fs::symlink_metadata(&file) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 16 * 1024 * 1024 => return Err("项目文件无效或过大".into()),
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e.to_string()),
    }
    Ok(file)
}
impl Store {
    pub fn list_projects(&self, tool: &str) -> Result<ProjectData> {
        let file = path(self.root_path(), tool, false)?;
        let data = match fs::read(file) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("项目文件无法读取：{e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => ProjectData { kind:"workstore.list-projects".into(),schema_version:1,tool_id:tool.into(),projects:BTreeMap::new(),memberships:BTreeMap::new() },
            Err(e) => return Err(e.to_string()),
        };
        validate(&data, tool)?; Ok(data)
    }
    pub fn update_list_project(&self, tool: &str, operation: Operation) -> Result<ProjectData> {
        // Caller holds workspace mutex: patch latest disk state, never replace
        // a stale renderer snapshot after another device's activation.
        let mut data = self.list_projects(tool)?;
        match operation {
            Operation::Create {id,name} => {
                check_id(&id)?; check_name(&name)?;
                if data.projects.contains_key(&id) {return Err("项目已存在".into());}
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
                data.projects.insert(id, Project {name:name.trim().into(),created_at:now,deleted:false});
            },
            Operation::Rename {id,name} => {
                check_name(&name)?;
                let project = data.projects.get_mut(&id).filter(|p| !p.deleted).ok_or("项目已移除，请刷新后重试")?;
                project.name = name.trim().into();
            },
            Operation::Remove {id} => { data.projects.get_mut(&id).ok_or("项目不存在")?.deleted = true; },
            Operation::Move {document_id,project_id} => {
                check_id(&document_id)?;
                if let Some(id) = &project_id { if !data.projects.get(id).is_some_and(|p| !p.deleted) {return Err("项目已移除，请刷新后重试".into());} }
                data.memberships.insert(document_id, project_id);
            },
        }
        validate(&data, tool)?;
        atomic_write(&path(self.root_path(), tool, true)?, &serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?)?;
        Ok(data)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projects_preserve_files_and_patch_latest_metadata() {
        let temp = tempfile::tempdir().unwrap();let store=Store::open(temp.path().join("config"),temp.path().join("workspace")).unwrap();
        let first=Uuid::new_v4().to_string();let second=Uuid::new_v4().to_string();let doc=Uuid::new_v4().to_string();
        assert!(store.list_projects("app.doc").unwrap().projects.is_empty());
        store.update_list_project("app.doc",Operation::Create{id:first.clone(),name:"Alpha".into()}).unwrap();
        store.update_list_project("app.doc",Operation::Create{id:second.clone(),name:"Beta".into()}).unwrap();
        store.update_list_project("app.doc",Operation::Move{document_id:doc.clone(),project_id:Some(first.clone())}).unwrap();
        let content=store.root_path().join(format!("data/app.doc/{doc}.doc.json"));fs::write(&content,b"original bytes").unwrap();
        let data=store.update_list_project("app.doc",Operation::Remove{id:first.clone()}).unwrap();
        assert!(data.projects[&first].deleted);assert_eq!(data.projects.len(),2);assert_eq!(fs::read(content).unwrap(),b"original bytes");
        assert!(store.update_list_project("app.doc",Operation::Move{document_id:doc.clone(),project_id:Some(first)}).is_err());
        store.update_list_project("app.doc",Operation::Move{document_id:doc.clone(),project_id:Some(second.clone())}).unwrap();
        assert_eq!(store.list_projects("app.doc").unwrap().memberships[&doc],Some(second));
        assert!(store.list_projects("app.cover").unwrap().projects.is_empty());
        assert!(store.list_projects("../outside").is_err());
    }
    #[test]
    fn malformed_metadata_is_not_overwritten() {
        let temp=tempfile::tempdir().unwrap();let store=Store::open(temp.path().join("config"),temp.path().join("workspace")).unwrap();
        let file=path(store.root_path(),"app.doc",true).unwrap();fs::write(&file,b"broken").unwrap();
        assert!(store.update_list_project("app.doc",Operation::Create{id:Uuid::new_v4().to_string(),name:"Test".into()}).is_err());
        assert_eq!(fs::read(file).unwrap(),b"broken");
    }
}
