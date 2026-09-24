//! The pinned upstream application runs unchanged in a bundled loopback service.
use serde::{Deserialize, Serialize};
use std::{fs, net::TcpListener, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex, time::Duration};
use tauri::Manager;
use uuid::Uuid;

#[derive(Default)]
pub struct HtmlRuntime(Mutex<Option<Runtime>>);
struct Runtime { child: Child, port: u16, nonce: String }
impl Drop for Runtime {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe { libc::kill(-(self.child.id() as i32), libc::SIGTERM); }
        #[cfg(windows)]
        { let _ = Command::new("taskkill").args(["/PID", &self.child.id().to_string(), "/T", "/F"]).output(); }
        for _ in 0..30 {
            if self.child.try_wait().ok().flatten().is_some() { return; }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest { build_id: String, node: String, entry: String }
#[derive(Serialize)]
pub struct RuntimeInfo { url: String }

fn bundle_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("html-runtime");
    if bundled.join("manifest.json").is_file() { return Ok(bundled); }
    #[cfg(debug_assertions)] {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("html-runtime");
        if development.join("manifest.json").is_file() { return Ok(development); }
    }
    Err("HTML Anything 运行组件缺失，请重新安装完整 WorkStore 安装包".into())
}
fn start(app: &tauri::AppHandle) -> Result<RuntimeInfo, String> {
    let state = app.state::<HtmlRuntime>();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(runtime) = slot.as_mut() {
        if runtime.child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(RuntimeInfo { url: format!("http://127.0.0.1:{}/", runtime.port) });
        }
        *slot = None;
    }
    let resource = bundle_root(app)?;
    let manifest: Manifest = serde_json::from_slice(&fs::read(resource.join("manifest.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if manifest.build_id.len() != 24 || !manifest.build_id.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("HTML 运行组件标识无效".into()); }
    let cache_root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("html-anything");
    fs::create_dir_all(&cache_root).map_err(|e| e.to_string())?;
    let cache = cache_root.join(&manifest.build_id);
    if !cache.join(".ready").exists() {
        let temp = cache_root.join(Uuid::new_v4().to_string());
        fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
        tar::Archive::new(fs::File::open(resource.join("app.tar")).map_err(|e| e.to_string())?).unpack(&temp).map_err(|e| e.to_string())?;
        fs::write(temp.join(".ready"), &manifest.build_id).map_err(|e| e.to_string())?;
        fs::rename(temp, &cache).map_err(|e| e.to_string())?;
    }
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?.join("html-anything");
    fs::create_dir_all(&config).map_err(|e| e.to_string())?;
    let port_file = config.join("port.json");
    let port = if port_file.exists() {
        serde_json::from_slice::<u16>(&fs::read(&port_file).map_err(|e| e.to_string())?).map_err(|_| "HTML 本地端口配置损坏，未重置作品存储来源")?
    } else {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        crate::storage::atomic_write(&port_file, &serde_json::to_vec(&port).unwrap())?;
        port
    };
    if port < 1024 { return Err("HTML 本地端口配置无效".into()); }
    // Never silently choose a new origin: browser-stored upstream tasks belong to this port.
    drop(TcpListener::bind(("127.0.0.1", port)).map_err(|_| "HTML 本地端口被占用，请关闭占用该端口的程序后重试；未切换端口或清除作品")?);
    let nonce = Uuid::new_v4().to_string();
    let entry = cache.join(manifest.entry.strip_prefix("app/").ok_or("HTML 运行入口无效")?);
    let mut command = Command::new(resource.join(&manifest.node));
    // GUI launches do not inherit the terminal PATH. Reuse WorkStore discovery.
    if let Ok(codex) = crate::ai::codex_path("") { command.env("CODEX_BIN", codex); }
    command.args(["--require"]).arg(resource.join("preload.cjs")).arg(&entry)
        .current_dir(entry.parent().ok_or("HTML 运行目录无效")?)
        .env("PORT", port.to_string()).env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production").env("NEXT_TELEMETRY_DISABLED", "1")
        .env("WORKSTORE_HTML_NONCE", &nonce).env("WORKSTORE_PARENT_PID", std::process::id().to_string())
        .env("HTML_ANYTHING_USER_STATE_DIR", &config).env("HTML_ANYTHING_USER_SKILLS_DIR", config.join("skills"))
        .env_remove("HTML_ANYTHING_ALLOW_ANY_HOST").env_remove("HTML_ANYTHING_ALLOWED_HOSTS")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)] { use std::os::unix::process::CommandExt; command.process_group(0); }
    let child = command.spawn().map_err(|e| format!("HTML 启动失败：{e}"))?;
    *slot = Some(Runtime { child, port, nonce });
    Ok(RuntimeInfo { url: format!("http://127.0.0.1:{port}/") })
}
#[tauri::command]
pub async fn html_original_start(app: tauri::AppHandle) -> Result<RuntimeInfo, String> {
    let cloned = app.clone();
    let info = tauri::async_runtime::spawn_blocking(move || start(&cloned)).await.map_err(|e| e.to_string())??;
    let nonce = app.state::<HtmlRuntime>().0.lock().map_err(|e| e.to_string())?.as_ref().ok_or("HTML 尚未启动")?.nonce.clone();
    let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(1)).build().map_err(|e| e.to_string())?;
    for _ in 0..60 {
        if let Ok(response) = client.get(format!("{}__workstore/health", info.url)).header("x-workstore-runtime", &nonce).send().await {
            if response.status().is_success() { return Ok(info); }
        }
        let state = app.state::<HtmlRuntime>();
        { let mut slot = state.0.lock().map_err(|e| e.to_string())?;
          if slot.as_mut().ok_or("HTML 已停止")?.child.try_wait().map_err(|e| e.to_string())?.is_some() { *slot = None; return Err("HTML Anything 启动失败，请检查完整安装包或重试".into()); }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("HTML Anything 启动超时，请重试".into())
}
#[tauri::command]
pub async fn html_original_cancel(app: tauri::AppHandle) -> Result<(), String> {
    let connection = app.state::<HtmlRuntime>().0.lock().map_err(|e| e.to_string())?.as_ref().map(|r| (r.port, r.nonce.clone()));
    if let Some((port, nonce)) = connection {
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(5)).build().map_err(|e| e.to_string())?;
        client.post(format!("http://127.0.0.1:{port}/__workstore/cancel")).header("x-workstore-runtime", nonce).send().await.map_err(|_| "HTML 生成进程未确认停止，请重试")?.error_for_status().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn html_original_backup(app: tauri::AppHandle, snapshot: serde_json::Value) -> Result<(), String> {
    if snapshot["schemaVersion"] != 1 || !snapshot["local"].is_object() || !snapshot["history"].is_array() { return Err("HTML 备份格式无效".into()); }
    let bytes = serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 * 1024 { return Err("HTML 本地备份超过 64 MB，请导出作品".into()); }
    let target = app.path().app_config_dir().map_err(|e| e.to_string())?.join("html-anything/browser-state.json");
    let _guard = app.state::<HtmlRuntime>();
    let _lock = _guard.0.lock().map_err(|e| e.to_string())?;
    if let Ok(old) = fs::read(&target) {
        if old == bytes { return Ok(()); }
        crate::storage::atomic_write(&target.with_extension("previous.json"), &old)?;
    }
    crate::storage::atomic_write(&target, &bytes)
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Ok(mut runtime) = app.state::<HtmlRuntime>().0.lock() { *runtime = None; }
}

#[tauri::command]
pub async fn html_original_export(path: String, data: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let target = PathBuf::from(path);
    if !target.is_absolute() { return Err("导出路径须为绝对路径".into()); }
    if data.len() > 180_000_000 { return Err("导出文件超过 128 MB".into()); }
    let bytes = STANDARD.decode(data).map_err(|_| "导出数据无效")?;
    crate::storage::atomic_write(&target, &bytes)
}
