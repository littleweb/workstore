//! Immutable public images, cached outside the user's workspace and sync repository.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::{Path, PathBuf}, sync::{Arc, LazyLock, atomic::{AtomicU64, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tokio::sync::{Mutex, Semaphore};

#[derive(Clone, Deserialize)]
struct Entry { path: String, size: usize, sha256: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog { schema_version: u32, repository: String, commit: String, entries: BTreeMap<String, Entry> }
static CATALOG: LazyLock<Catalog> = LazyLock::new(|| serde_json::from_str(include_str!("../../src/covers/remote-previews.json")).expect("validated preview index"));
static DESIGN_CATALOG: LazyLock<Catalog> = LazyLock::new(|| serde_json::from_str(include_str!("../../src/design-studio/remote-assets.json")).expect("validated design index"));
static DOWNLOADS: Semaphore = Semaphore::const_new(4);
static LOCKS: LazyLock<Mutex<BTreeMap<String, Arc<Mutex<()>>>>> = LazyLock::new(|| Mutex::new(BTreeMap::new()));
// A network failure on the raw CDN uses GitHub's official API for ten minutes.
static RAW_RETRY_AT: AtomicU64 = AtomicU64::new(0);
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn valid(catalog: &Catalog, key: &str, entry: &Entry) -> bool {
    catalog.schema_version == 1 && catalog.repository == "littleweb/workstore"
        && catalog.commit.len() == 40 && catalog.commit.bytes().all(|c| c.is_ascii_hexdigit())
        && entry.sha256.len() == 64 && entry.sha256.bytes().all(|c| c.is_ascii_hexdigit())
        && entry.size > 8 && entry.size <= 8 * 1024 * 1024
        && ((key == format!("/handraw-style/{}", entry.path) && entry.path.starts_with("covers/") && entry.path.ends_with(".png"))
            || (key == format!("/{}", entry.path) && (entry.path.starts_with("design-studio/covers/") || entry.path.starts_with("design-studio/examples/")) && entry.path.ends_with(".webp")))
        && !entry.path.contains("..") && entry.path.bytes().all(|c| c.is_ascii_alphanumeric() || b"/.-".contains(&c))
}
fn verified(bytes: &[u8], entry: &Entry) -> bool {
    bytes.len() == entry.size
        && (if entry.path.ends_with(".webp") { bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") } else { bytes.starts_with(b"\x89PNG\r\n\x1a\n") })
        && format!("{:x}", Sha256::digest(bytes)) == entry.sha256
}
fn cache_path(root: &Path, entry: &Entry) -> PathBuf {
    root.join(format!("{}.{}", entry.sha256, if entry.path.ends_with(".webp") { "webp" } else { "png" }))
}
fn cache_hit(path: &Path, entry: &Entry) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file() && m.len() == entry.size as u64)
        && std::fs::read(path).is_ok_and(|bytes| verified(&bytes, entry))
}
async fn fetch(client: &reqwest::Client, url: &str, entry: &Entry) -> Result<Vec<u8>, String> {
    let mut response = client.get(url).header("Accept", "application/vnd.github.raw+json").send().await.map_err(|_| "图片素材连接失败")?;
    if !response.status().is_success() { return Err(format!("图片素材 HTTP {}", response.status().as_u16())); }
    if response.content_length().is_some_and(|size| size > entry.size as u64) { return Err("图片素材超出大小限制".into()); }
    let mut bytes = Vec::with_capacity(entry.size);
    while let Some(chunk) = response.chunk().await.map_err(|_| "图片素材下载中断")? {
        if bytes.len() + chunk.len() > entry.size { return Err("图片素材超出大小限制".into()); }
        bytes.extend_from_slice(&chunk);
    }
    if !verified(&bytes, entry) { return Err("图片素材完整性校验失败".into()); }
    Ok(bytes)
}
async fn cached(root: PathBuf, entry: Entry, client: &reqwest::Client, urls: &[String]) -> Result<String, String> {
    let lock = LOCKS.lock().await.entry(entry.sha256.clone()).or_insert_with(|| Arc::new(Mutex::new(()))).clone();
    let _same_image = lock.lock().await;
    let path = cache_path(&root, &entry);
    let check_path = path.clone(); let check_entry = entry.clone();
    if tauri::async_runtime::spawn_blocking(move || cache_hit(&check_path, &check_entry)).await.map_err(|e| e.to_string())? { return Ok(path.to_string_lossy().into()); }
    let _slot = DOWNLOADS.acquire().await.map_err(|e| e.to_string())?;
    let mut last_error = "图片素材暂不可用".to_string();
    for url in urls {
        let raw = url.starts_with("https://raw.githubusercontent.com/");
        if raw && now() < RAW_RETRY_AT.load(Ordering::Relaxed) { continue; }
        match fetch(client, url, &entry).await {
            Ok(bytes) => {
                let write_path = path.clone();
                tauri::async_runtime::spawn_blocking(move || crate::storage::atomic_write(&write_path, &bytes)).await.map_err(|e| e.to_string())??;
                return Ok(path.to_string_lossy().into());
            }
            Err(error) => { if raw { RAW_RETRY_AT.store(now() + 600, Ordering::Relaxed); } last_error = error; }
        }
    }
    Err(last_error)
}
#[tauri::command]
pub async fn cover_preview(key: String, app: tauri::AppHandle) -> Result<String, String> {
    load_asset(key, app, &CATALOG, "cover-previews").await
}
#[tauri::command]
pub async fn design_asset(key: String, app: tauri::AppHandle) -> Result<String, String> {
    load_asset(key, app, &DESIGN_CATALOG, "design-assets").await
}
async fn load_asset(key: String, app: tauri::AppHandle, catalog: &Catalog, directory: &str) -> Result<String, String> {
    let entry = catalog.entries.get(&key).filter(|entry| valid(catalog, &key, entry)).ok_or("未知图片素材")?.clone();
    let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join(directory);
    let check_path = cache_path(&root, &entry); let check_entry = entry.clone();
    if tauri::async_runtime::spawn_blocking(move || cache_hit(&check_path, &check_entry)).await.map_err(|e| e.to_string())? {
        return Ok(cache_path(&root, &entry).to_string_lossy().into());
    }
    let app_for_settings = app.clone();
    let settings = tauri::async_runtime::spawn_blocking(move || crate::ai::ai_settings(app_for_settings)).await.map_err(|e| e.to_string())??;
    let mut builder = reqwest::Client::builder().user_agent("WorkStore-Public-Images/1")
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(25)).redirect(reqwest::redirect::Policy::none());
    if settings.proxy_url.trim() == "direct" { builder = builder.no_proxy(); }
    else if let Some(proxy) = crate::ai::resolve_proxy(&settings).await? { builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "代理地址无效")?); }
    let client = builder.build().map_err(|e| e.to_string())?;
    let urls = [format!("https://raw.githubusercontent.com/{}/{}/{}", catalog.repository, catalog.commit, entry.path),
        format!("https://api.github.com/repos/{}/contents/{}?ref={}", catalog.repository, entry.path, catalog.commit)];
    cached(root, entry, &client, &urls).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Entry, Vec<u8>) {
        let bytes = b"\x89PNG\r\n\x1a\nverified fixture".to_vec();
        (Entry { path: "covers/editorial/001.png".into(), size: bytes.len(), sha256: format!("{:x}", Sha256::digest(&bytes)) }, bytes)
    }
    #[test]
    fn bundled_index_is_complete_and_safe() {
        assert_eq!(CATALOG.entries.len(), 277);
        for (key, entry) in &CATALOG.entries { assert!(valid(&CATALOG, key, entry)); }
        let (mut entry, _) = fixture(); entry.path = "covers/../../private.png".into();
        assert!(!valid(&CATALOG, "/handraw-style/covers/../../private.png", &entry));
    }
    #[test]
    fn design_index_is_complete_safe_and_has_only_webp_assets() {
        assert_eq!(DESIGN_CATALOG.entries.len(), 1018);
        for (key, entry) in &DESIGN_CATALOG.entries {
            assert!(valid(&DESIGN_CATALOG, key, entry));
            assert!(entry.path.ends_with(".webp"));
        }
        let (_, bytes) = webp_fixture();
        let mut entry = DESIGN_CATALOG.entries.values().next().unwrap().clone();
        entry.path = "design-studio/covers/../../private.webp".into();
        assert!(!valid(&DESIGN_CATALOG, &format!("/{}", entry.path), &entry));
        let (entry, _) = webp_fixture();
        assert!(verified(&bytes, &entry));
        assert!(!verified(b"RIFFxxxxWRONG", &entry));
    }
    fn webp_fixture() -> (Entry, Vec<u8>) {
        let bytes = b"RIFFxxxxWEBPverified fixture".to_vec();
        (Entry { path: "design-studio/examples/example.webp".into(), size: bytes.len(), sha256: format!("{:x}", Sha256::digest(&bytes)) }, bytes)
    }
    #[tokio::test]
    async fn webp_cache_repairs_and_is_reused_offline_without_settings_or_network() {
        let dir = tempfile::tempdir().unwrap(); let (entry, bytes) = webp_fixture();
        let path = cache_path(dir.path(), &entry); std::fs::write(&path, b"broken").unwrap();
        let (url, server) = server(bytes.clone());
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(3)).build().unwrap();
        let urls = [url];
        let (a, b) = tokio::join!(cached(dir.path().into(), entry.clone(), &client, &urls), cached(dir.path().into(), entry.clone(), &client, &urls));
        assert_eq!(a.unwrap(), b.unwrap()); server.join().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(cached(dir.path().into(), entry.clone(), &client, &[]).await.unwrap(), path.to_string_lossy());
        std::fs::write(&path, vec![0; bytes.len()]).unwrap();
        assert!(cached(dir.path().into(), entry, &client, &[]).await.is_err());
        assert!(path.exists());
    }
    #[tokio::test]
    async fn invalid_webp_is_never_exposed_as_a_cached_asset() {
        let dir = tempfile::tempdir().unwrap(); let (entry, bytes) = webp_fixture();
        let (url, server) = server(vec![0; bytes.len()]);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert!(cached(dir.path().into(), entry, &client, &[url]).await.unwrap_err().contains("校验失败"));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0); server.join().unwrap();
    }
    #[tokio::test]
    async fn offline_cache_needs_no_connection_and_corruption_is_not_returned() {
        let dir = tempfile::tempdir().unwrap(); let (entry, bytes) = fixture();
        let path = dir.path().join(format!("{}.png", entry.sha256)); std::fs::write(&path, &bytes).unwrap();
        let client = reqwest::Client::new();
        assert_eq!(cached(dir.path().into(), entry.clone(), &client, &[]).await.unwrap(), path.to_string_lossy());
        std::fs::write(&path, vec![0; bytes.len()]).unwrap();
        assert!(cached(dir.path().into(), entry, &client, &[]).await.is_err());
        assert!(path.exists()); // Never delete a failed cache or user document.
    }
    fn server(bytes: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let url = format!("http://{}/image", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || { let (mut stream, _) = listener.accept().unwrap(); let mut request = [0; 4096]; stream.read(&mut request).unwrap();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()).unwrap(); stream.write_all(&bytes).unwrap(); });
        (url, thread)
    }
    #[tokio::test]
    async fn duplicate_requests_download_once_and_repair_corrupt_cache() {
        let dir = tempfile::tempdir().unwrap(); let (entry, bytes) = fixture();
        let path = dir.path().join(format!("{}.png", entry.sha256)); std::fs::write(&path, b"corrupt").unwrap();
        let (url, server) = server(bytes.clone()); let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(3)).build().unwrap(); let urls = [url];
        let (a, b) = tokio::join!(cached(dir.path().into(), entry.clone(), &client, &urls), cached(dir.path().into(), entry, &client, &urls));
        assert_eq!(a.unwrap(), b.unwrap()); assert_eq!(std::fs::read(path).unwrap(), bytes); server.join().unwrap();
    }
    #[tokio::test]
    async fn untrusted_download_is_never_cached() {
        let dir = tempfile::tempdir().unwrap(); let (entry, bytes) = fixture();
        let (url, server) = server(vec![0; bytes.len()]); let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert!(cached(dir.path().into(), entry, &client, &[url]).await.unwrap_err().contains("校验失败"));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0); server.join().unwrap();
    }
}
