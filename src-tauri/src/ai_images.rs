//! Content-addressed images travel with the workspace; revisions only store IDs.
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
const MAX: usize = 24 * 1024 * 1024;
fn png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 24 || bytes.len() > MAX || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("图片格式无效或超过 24 MB".into());
    }
    Ok(())
}
pub fn decode(value: &str) -> Result<Vec<u8>, String> {
    let encoded = value
        .strip_prefix("data:image/png;base64,")
        .ok_or("参考图片必须为 PNG")?;
    if encoded.len() > 8_000_000 {
        return Err("参考图片过大".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "参考图片无法读取")?;
    png(&bytes)?;
    Ok(bytes)
}
pub fn read_png(path: &Path) -> Result<Vec<u8>, String> {
    let m = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if m.file_type().is_symlink() || !m.is_file() || m.len() > MAX as u64 {
        return Err("图片文件无效".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    png(&bytes)?;
    Ok(bytes)
}
fn directory(root: &Path) -> Result<PathBuf, String> {
    let mut p = root.to_path_buf();
    for part in ["data", "ai-images"] {
        p.push(part);
        match fs::symlink_metadata(&p) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err("图片目录无效".into()),
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&p).map_err(|e| e.to_string())?
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(p)
}
pub fn save(root: &Path, bytes: &[u8]) -> Result<String, String> {
    png(bytes)?;
    let id = format!("{:x}", Sha256::digest(bytes));
    let p = directory(root)?.join(format!("{id}.png"));
    crate::storage::atomic_write(&p, bytes)?;
    Ok(format!("workstore-image:{id}"))
}
#[tauri::command]
pub fn ai_read_image(
    workspace: tauri::State<crate::Workspace>,
    id: String,
) -> Result<String, String> {
    let digest = id.strip_prefix("workstore-image:").ok_or("图片编号无效")?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err("图片编号无效".into());
    }
    let slot = workspace.0.lock().map_err(|e| e.to_string())?;
    let root = slot.as_ref().ok_or("工作空间尚未打开")?.root_path();
    let bytes = read_png(&directory(root)?.join(format!("{digest}.png")))?;
    if format!("{:x}", Sha256::digest(&bytes)) != digest {
        return Err("图片校验失败".into());
    }
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_arbitrary_reference_files() {
        assert!(decode("file:///etc/passwd").is_err());
        assert!(decode("data:image/png;base64,aGVsbG8=").is_err());
    }
    #[test]
    fn refuses_symlink_output() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("x.png");
        fs::write(&p, b"invalid").unwrap();
        assert!(read_png(&p).is_err());
    }
}
