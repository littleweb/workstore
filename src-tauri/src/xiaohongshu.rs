//! Device-local browser publisher. Never writes credentials into the workspace.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::Duration,
};
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Publisher {
    runtime: Mutex<Option<Runtime>>,
    operation: Mutex<()>,
}
struct Runtime {
    child: Child,
    port: u16,
    token: String,
}
impl Drop for Runtime {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGTERM);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn private_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "无法打开本机配置目录")?
        .join("xiaohongshu");
    fs::create_dir_all(&path).map_err(|_| "无法创建小红书本机配置目录")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护登录目录")?;
    }
    crate::storage::atomic_write(
        &path.join("XIAOHONGSHU-MCP-LICENSE.txt"),
        include_bytes!("../../docs/XIAOHONGSHU-MCP-LICENSE.txt"),
    )?;
    Ok(path)
}
fn asset() -> Result<(&'static str, &'static str, u64), String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok((
            "xiaohongshu-mcp-darwin-arm64",
            "fad3633fda4a8060e66e2941bc8fc5460326c7cb4e58a32485a9e2c9408e95a8",
            582035749,
        )),
        ("linux", "x86_64") => Ok((
            "xiaohongshu-mcp-linux-amd64",
            "a4e99322156e7a169466e793045dadc3306c0792db3eade603e030cc0c1c2e3a",
            582035750,
        )),
        ("windows", "x86_64") => Ok((
            "xiaohongshu-mcp-windows-amd64.exe",
            "cb55674f90c1649c875be9c4cde3af193b02fc34ffc860c40c8d711e6ca53e27",
            582035748,
        )),
        _ => Err("当前平台暂不支持小红书发布组件".into()),
    }
}
fn client(seconds: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(seconds))
        .build()
        .map_err(|_| "无法启动本机发布连接".into())
}
async fn connection(app: &tauri::AppHandle) -> Result<(u16, String), String> {
    let state = app.state::<Publisher>();
    let mut slot = state.runtime.lock().await;
    if let Some(runtime) = slot.as_mut() {
        if runtime
            .child
            .try_wait()
            .map_err(|_| "发布组件状态读取失败")?
            .is_none()
        {
            return Ok((runtime.port, runtime.token.clone()));
        }
        *slot = None;
    }
    let config = private_dir(app)?;
    let (name, digest, asset_id) = asset()?;
    let binary = config.join(format!("v2.5.5-{name}"));
    let verified = fs::read(&binary)
        .ok()
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)) == digest)
        .unwrap_or(false);
    if !verified {
        let downloader = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|_| "无法下载发布组件")?;
        let response = downloader
            .get(format!(
                "https://api.github.com/repos/xpzouying/xiaohongshu-mcp/releases/assets/{asset_id}"
            ))
            .header("Accept", "application/octet-stream")
            .header("User-Agent", "WorkStore")
            .send()
            .await
            .map_err(|_| "发布组件下载失败，请检查网络后重试")?
            .error_for_status()
            .map_err(|_| "发布组件下载失败")?;
        let bytes = response.bytes().await.map_err(|_| "发布组件下载不完整")?;
        if bytes.len() > 100 * 1024 * 1024 || format!("{:x}", Sha256::digest(&bytes)) != digest {
            return Err("发布组件校验失败，未运行下载文件".into());
        }
        crate::storage::atomic_write(&binary, &bytes)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法启动发布组件")?;
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "无法分配本机发布端口")?;
    let port = listener
        .local_addr()
        .map_err(|_| "无法读取本机端口")?
        .port();
    drop(listener);
    let token = uuid::Uuid::new_v4().to_string();
    let mut command = Command::new(&binary);
    command
        .args(["-headless=true", "-port", &format!("127.0.0.1:{port}")])
        .env("AUTH_TOKEN", &token)
        .env("COOKIES_PATH", config.join("cookies.json"))
        .current_dir(&config)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = command.spawn().map_err(|_| "小红书发布组件启动失败")?;
    let mut runtime = Runtime {
        child,
        port,
        token: token.clone(),
    };
    let health = client(1)?;
    for _ in 0..600 {
        if runtime
            .child
            .try_wait()
            .map_err(|_| "无法读取发布组件状态")?
            .is_some()
        {
            return Err("发布浏览器初始化失败，请检查网络后重试（首次使用需下载浏览器）".into());
        }
        if let Ok(response) = health
            .get(format!("http://127.0.0.1:{port}/health"))
            .send()
            .await
        {
            if response.status().is_success() {
                *slot = Some(runtime);
                return Ok((port, token));
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err("发布浏览器准备超时，请检查网络后重试".into())
}
async fn get(port: u16, token: &str, path: &str) -> Result<Value, String> {
    let response = client(60)?
        .get(format!("http://127.0.0.1:{port}/api/v1/{path}"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "小红书连接超时，请重试")?;
    if !response.status().is_success() {
        return Err("小红书连接失败，请重新检查登录状态".into());
    }
    let value: Value = response.json().await.map_err(|_| "发布组件响应无效")?;
    if value["success"] != true {
        return Err("小红书连接失败，请重试".into());
    }
    Ok(value["data"].clone())
}
#[tauri::command]
pub async fn xhs_connect(app: tauri::AppHandle, action: String) -> Result<Value, String> {
    let state = app.state::<Publisher>();
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "正在处理小红书操作，请稍后重试")?;
    let path = match action.as_str() {
        "status" => "login/status",
        "qrcode" => "login/qrcode",
        _ => return Err("操作无效".into()),
    };
    let (port, token) = connection(&app).await?;
    get(port, &token, path).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    document_id: String,
    title: String,
    description: String,
    tags: Vec<String>,
    images: Vec<String>,
    account_id: String,
    #[serde(default)]
    retry_unknown: bool,
}
fn validate(request: &PublishRequest) -> Result<(), String> {
    uuid::Uuid::parse_str(&request.document_id).map_err(|_| "请先保存作品")?;
    if request.title.trim().is_empty() || request.title.chars().count() > 20 {
        return Err("发布标题需为 1–20 个字符，请编辑后发布".into());
    }
    if request.description.trim().is_empty() || request.description.chars().count() > 1000 {
        return Err("发布正文需为 1–1000 个字符，请编辑后发布".into());
    }
    if request.images.is_empty() || request.images.len() > 18 {
        return Err("每次发布请选择 1–18 张图片；超出时请分批发布".into());
    }
    if request.account_id.is_empty() {
        return Err("请先确认当前登录账号".into());
    }
    if request.tags.len() > 10 || request.tags.iter().any(|tag| tag.chars().count() > 30) {
        return Err("最多添加 10 个话题，每个话题不超过 30 个字符".into());
    }
    Ok(())
}
fn png(value: &str) -> Result<Vec<u8>, String> {
    let encoded = value
        .strip_prefix("data:image/png;base64,")
        .ok_or("发布图片必须为本地 PNG")?;
    if encoded.len() > 34 * 1024 * 1024 {
        return Err("单张图片超过 24 MB".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "发布图片无法读取")?;
    if bytes.len() < 24
        || bytes.len() > 24 * 1024 * 1024
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    {
        return Err("发布图片无效或超过 24 MB".into());
    }
    Ok(bytes)
}
#[derive(Serialize, Deserialize)]
pub struct PublishResult {
    pub status: String,
    pub message: String,
}
fn previous_result(record: &std::path::Path, retry: bool) -> Result<Option<PublishResult>, String> {
    if !record.exists() {
        return Ok(None);
    }
    let existing: PublishResult =
        serde_json::from_slice(&fs::read(record).map_err(|_| "发布记录无法读取")?)
            .map_err(|_| "发布记录损坏，请先核对小红书创作中心")?;
    if existing.status == "success" {
        return Ok(Some(PublishResult {
            status: "success".into(),
            message: "这份内容已发布，未重复提交".into(),
        }));
    }
    if !retry {
        return Ok(Some(PublishResult {
            status: "unknown".into(),
            message: "上次发布结果未确认，请先在创作中心核对，避免重复发布".into(),
        }));
    }
    Ok(None)
}
#[tauri::command]
pub async fn xhs_publish(
    app: tauri::AppHandle,
    request: PublishRequest,
) -> Result<PublishResult, String> {
    validate(&request)?;
    let state = app.state::<Publisher>();
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "正在发布，请勿重复提交")?;
    let config = private_dir(&app)?;
    let images = request
        .images
        .iter()
        .map(|im| png(im))
        .collect::<Result<Vec<_>, _>>()?;
    let mut hash = Sha256::new();
    hash.update(
        serde_json::to_vec(&json!([
            request.document_id,
            request.title,
            request.description,
            request.tags,
            request.account_id
        ]))
        .unwrap(),
    );
    for bytes in &images {
        hash.update(Sha256::digest(bytes));
    }
    let record = config.join(format!("publish-{:x}.json", hash.finalize()));
    if let Some(previous) = previous_result(&record, request.retry_unknown)? {
        return Ok(previous);
    }
    let (port, token) = connection(&app).await?;
    let account = get(port, &token, "login/status").await?;
    if account["is_logged_in"] != true
        || account["user_id"].as_str() != Some(request.account_id.as_str())
    {
        return Err("登录已失效或账号已切换，请重新确认账号".into());
    }
    let temp = tempfile::tempdir_in(&config).map_err(|_| "无法准备漫画图片")?;
    let mut paths = Vec::new();
    for (index, bytes) in images.iter().enumerate() {
        let path = temp.path().join(format!("{:02}.png", index + 1));
        fs::write(&path, bytes).map_err(|_| "无法准备漫画图片")?;
        paths.push(path.to_string_lossy().into_owned());
    }
    let pending = PublishResult {
        status: "unknown".into(),
        message: "发布结果未确认，请在创作中心核对后再决定是否重试".into(),
    };
    crate::storage::atomic_write(&record, &serde_json::to_vec(&pending).unwrap())?;
    // A request can time out after the site accepted it. Never automatically retry this POST.
    let response=client(600)?.post(format!("http://127.0.0.1:{port}/api/v1/publish")).bearer_auth(&token)
        .json(&json!({"title":request.title,"content":request.description,"tags":request.tags,"images":paths})).send().await;
    let result = match response {
        Ok(response) if response.status().is_success() => match response.json::<Value>().await {
            Ok(value) if value["success"] == true && value["data"]["status"] == "发布完成" => {
                PublishResult {
                    status: "success".into(),
                    message: "小红书已确认发布完成".into(),
                }
            }
            _ => pending,
        },
        _ => pending,
    };
    crate::storage::atomic_write(&record, &serde_json::to_vec(&result).unwrap())?;
    Ok(result)
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Ok(mut slot) = app.state::<Publisher>().runtime.try_lock() {
        *slot = None;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> PublishRequest {
        PublishRequest {
            document_id: uuid::Uuid::new_v4().to_string(),
            title: "漫画".into(),
            description: "故事".into(),
            tags: vec![],
            images: vec!["placeholder".into()],
            account_id: "account".into(),
            retry_unknown: false,
        }
    }
    #[test]
    fn validates_publish_limits_without_truncating() {
        let mut r = request();
        assert!(validate(&r).is_ok());
        r.images = vec!["x".into(); 20];
        assert!(validate(&r).is_err());
        r.images = vec!["x".into()];
        r.title = "字".repeat(21);
        assert!(validate(&r).is_err());
    }
    #[test]
    fn persistent_records_prevent_duplicate_posts_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let record = directory.path().join("record.json");
        assert!(previous_result(&record, false).unwrap().is_none());
        fs::write(&record, br#"{"status":"unknown","message":"pending"}"#).unwrap();
        assert_eq!(
            previous_result(&record, false).unwrap().unwrap().status,
            "unknown"
        );
        assert!(previous_result(&record, true).unwrap().is_none());
        fs::write(&record, br#"{"status":"success","message":"done"}"#).unwrap();
        assert_eq!(
            previous_result(&record, true).unwrap().unwrap().status,
            "success"
        );
        fs::write(&record, b"corrupt").unwrap();
        assert!(previous_result(&record, true).is_err());
    }
    #[test]
    fn rejects_remote_images_and_invalid_data() {
        assert!(png("https://example.com/image.png").is_err());
        assert!(png("data:image/png;base64,aGVsbG8=").is_err());
    }
}
