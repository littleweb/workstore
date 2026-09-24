//! Shared text and image generation gateway. Credentials belong to this device, never the synced workspace.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub provider: String,
    pub codex_path: String,
    pub detected_codex_path: String,
    pub codex_status: String,
    pub model: String,
    pub base_url: String,
    pub proxy_url: String,
    pub timeout_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    pub has_api_key: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: "codex".into(),
            codex_path: String::new(),
            detected_codex_path: String::new(),
            codex_status: String::new(),
            model: String::new(),
            base_url: "https://api.openai.com/v1".into(),
            proxy_url: String::new(),
            timeout_seconds: 180,
            api_key: None,
            has_api_key: false,
        }
    }
}
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("ai-settings.json"))
}
fn read_settings(path: &std::path::Path) -> Result<Settings, String> {
    match std::fs::read(path) {
        Ok(data) => {
            serde_json::from_slice(&data).map_err(|_| "AI 配置无法读取，请检查配置文件".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn redacted(mut settings: Settings) -> Settings {
    settings.has_api_key = settings.api_key.as_ref().is_some_and(|key| !key.is_empty());
    settings.api_key = None;
    settings
}
#[tauri::command]
pub fn ai_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    Ok(redacted(read_settings(&settings_path(&app)?)?))
}
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
pub fn ai_save_settings(app: tauri::AppHandle, mut settings: Settings) -> Result<Settings, String> {
    validate_settings(&settings)?;
    let _guard = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = settings_path(&app)?;
    let current = read_settings(&path)?;
    settings.detected_codex_path = current.detected_codex_path;
    settings.codex_status = current.codex_status;
    if settings.api_key.is_none() {
        settings.api_key = read_settings(&path)?.api_key;
    }
    write_settings(&path, &settings)?;
    Ok(redacted(settings))
}
fn write_settings(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    let parent = path.parent().ok_or("配置路径无效")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // tempfile creates mode 0600, and atomic replacement retains that mode.
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn validate_settings(s: &Settings) -> Result<(), String> {
    if !["codex", "openai-compatible"].contains(&s.provider.as_str()) {
        return Err("不支持的 AI 服务".into());
    }
    if !(10..=600).contains(&s.timeout_seconds) {
        return Err("超时应为 10–600 秒".into());
    }
    if !s.proxy_url.trim().is_empty() && s.proxy_url.trim() != "direct" {
        validate_proxy(s.proxy_url.trim())?;
    }
    if s.provider == "openai-compatible" {
        endpoint(s)?;
        if s.model.trim().is_empty() {
            return Err("请输入模型名称".into());
        }
    }
    Ok(())
}
fn endpoint(s: &Settings) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(&format!(
        "{}/chat/completions",
        s.base_url.trim().trim_end_matches('/')
    ))
    .map_err(|_| "API 地址无效")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址须为 HTTPS；本机地址支持 HTTP，地址中不能包含凭据或查询参数".into());
    }
    Ok(url)
}
#[tauri::command]
pub async fn ai_capabilities(app: tauri::AppHandle) -> Result<Value, String> {
    let s = read_settings(&settings_path(&app)?)?;
    let mut image = false;
    if s.provider == "codex" {
        if let Ok(path) = configured_codex_path(&s) {
            let mut command = Command::new(path);
            command.args(["features", "list"]).kill_on_drop(true);
            if let Ok(Ok(output)) =
                tokio::time::timeout(Duration::from_secs(8), command.output()).await
            {
                image = output.status.success()
                    && String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                        line.starts_with("image_generation")
                            && line.split_whitespace().last() == Some("true")
                    });
            }
        }
    }
    Ok(
        json!({"provider":s.provider,"text":true,"imageGenerate":image,"referenceImages":image,"maxReferences":8}),
    )
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub id: String,
    pub tool_id: String,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub record: bool,
    #[serde(default)]
    pub image: bool,
    #[serde(default)]
    pub references: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub id: String,
    pub text: String,
    pub provider: String,
    pub model: String,
    pub save_error: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
}
#[derive(Default)]
pub struct Runtime(Mutex<HashMap<String, Arc<AtomicBool>>>);
struct Registration<'a> {
    runtime: &'a Runtime,
    id: String,
}
impl Drop for Registration<'_> {
    fn drop(&mut self) {
        if let Ok(mut calls) = self.runtime.0.lock() {
            calls.remove(&self.id);
        }
    }
}
#[tauri::command]
pub fn ai_cancel(id: String, runtime: tauri::State<Runtime>) -> Result<(), String> {
    if let Some(flag) = runtime.0.lock().map_err(|e| e.to_string())?.get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
fn validate_request(request: &Request) -> Result<(), String> {
    uuid::Uuid::parse_str(&request.id).map_err(|_| "请求编号无效")?;
    if request.tool_id.is_empty()
        || request.tool_id.len() > 80
        || request.messages.is_empty()
        || request.messages.len() > 80
    {
        return Err("AI 请求格式无效".into());
    }
    if request
        .messages
        .iter()
        .any(|m| !["system", "user", "assistant"].contains(&m.role.as_str()))
    {
        return Err("消息角色无效".into());
    }
    if request
        .messages
        .iter()
        .map(|m| m.content.len())
        .sum::<usize>()
        > 128_000
    {
        return Err("对话过长，请开启新对话或缩短上下文".into());
    }
    if request.references.len() > 8
        || (!request.image && !request.references.is_empty())
        || request.references.iter().any(|r| r.len() > 8_000_000)
    {
        return Err("图像参考最多 8 张，每张不超过 6 MB".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn ai_generate(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Runtime>,
    workspace: tauri::State<'_, crate::Workspace>,
    request: Request,
) -> Result<Response, String> {
    validate_request(&request)?;
    let root = if request.record || request.image {
        Some(
            workspace
                .0
                .lock()
                .map_err(|e| e.to_string())?
                .as_ref()
                .ok_or("工作空间尚未打开")?
                .root_path()
                .to_path_buf(),
        )
    } else {
        None
    };
    let settings = read_settings(&settings_path(&app)?)?;
    validate_settings(&settings)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut calls = runtime.0.lock().map_err(|e| e.to_string())?;
        if calls.contains_key(&request.id) || calls.len() >= 2 {
            return Err("已有 AI 请求运行中，请等待或停止后重试".into());
        }
        calls.insert(request.id.clone(), cancelled.clone());
    }
    let _registration = Registration {
        runtime: &runtime,
        id: request.id.clone(),
    };
    let (text, image_bytes) = tokio::select! {
        result = async {
            if request.image {
                if settings.provider != "codex" { return Err::<(String, Vec<Vec<u8>>), String>("当前全局 AI 服务仅提供文本；图像生成请在全局设置选择默认 Codex".into()); }
                let output = codex_run(&settings, &request.messages, Some(&request.references)).await?;
                let images = generated_images(&output)?;
                Ok((parse_codex(&output)?, images))
            } else { Ok((generate(&settings, &request.messages).await?, vec![])) }
        } => result?,
        _ = tokio::time::sleep(Duration::from_secs(settings.timeout_seconds)) => return Err("AI 响应超时，请重试或在设置中延长超时".into()),
        _ = async { while !cancelled.load(Ordering::Relaxed) { tokio::time::sleep(Duration::from_millis(100)).await; } } => return Err("已停止生成".into()),
    };
    let mut images = Vec::new();
    if !image_bytes.is_empty() {
        let slot = workspace.0.lock().map_err(|e| e.to_string())?;
        let store = slot.as_ref().ok_or("工作空间尚未打开")?;
        if Some(store.root_path()) != root.as_deref() {
            return Err("工作目录已切换，图片结果未写入".into());
        }
        for bytes in image_bytes {
            images.push(crate::ai_images::save(store.root_path(), &bytes)?);
        }
    }
    let mut response = Response {
        id: request.id,
        text,
        provider: settings.provider,
        model: settings.model,
        save_error: None,
        images,
    };
    if let Some(root) = root.filter(|_| request.record) {
        let saved = (|| -> Result<(), String> {
            let slot = workspace.0.lock().map_err(|e| e.to_string())?;
            let store = slot.as_ref().ok_or("工作空间尚未打开")?;
            if store.root_path() != root {
                return Err("工作目录已切换，请复制回答保存".into());
            }
            let directory = history_directory(&root)?;
            let record = Record {
                id: response.id.clone(),
                tool_id: request.tool_id,
                prompt: request
                    .messages
                    .iter()
                    .rev()
                    .find(|m| m.role == "user")
                    .map(|m| m.content.clone())
                    .unwrap_or_default(),
                text: response.text.clone(),
                provider: response.provider.clone(),
                created_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_millis() as u64,
            };
            crate::storage::atomic_write(
                &directory.join(format!("{}.ai.json", record.id)),
                &serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?,
            )
        })();
        response.save_error = saved.err();
    }
    Ok(response)
}
async fn generate(settings: &Settings, messages: &[Message]) -> Result<String, String> {
    match settings.provider.as_str() {
        "codex" => codex(settings, messages).await,
        "openai-compatible" => compatible(settings, messages).await,
        _ => Err("不支持的 AI 服务".into()),
    }
}
pub(crate) fn codex_path(explicit: &str) -> Result<PathBuf, String> {
    if !explicit.trim().is_empty() {
        let path = PathBuf::from(explicit.trim());
        return if path.is_absolute() && path.is_file() {
            Ok(path)
        } else {
            Err("Codex 路径须指向本机可执行文件的绝对路径".into())
        };
    }
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .map(|dir| dir.join(name))
                .collect()
        })
        .unwrap_or_default();
    candidates.extend(
        [
            "/Applications/ChatGPT.app/Contents/Resources/codex",
            "/Applications/Codex.app/Contents/Resources/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
        ]
        .iter()
        .map(PathBuf::from),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or("未找到本地 Codex，请安装并登录 Codex，或在 AI 设置中指定路径".into())
}
async fn bounded_read<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("AI 返回内容过大，请缩小请求".into());
    }
    Ok(bytes)
}
async fn codex(settings: &Settings, messages: &[Message]) -> Result<String, String> {
    parse_codex(&codex_run(settings, messages, None).await?)
}
async fn codex_run(
    settings: &Settings,
    messages: &[Message],
    references: Option<&[String]>,
) -> Result<Vec<u8>, String> {
    let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut command = Command::new(configured_codex_path(settings)?);
    if settings.proxy_url.trim() == "direct" {
        for key in [
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "ALL_PROXY",
            "https_proxy",
            "http_proxy",
            "all_proxy",
        ] {
            command.env_remove(key);
        }
    } else if let Some(proxy) = resolve_proxy(settings).await? {
        command
            .env("HTTPS_PROXY", &proxy)
            .env("HTTP_PROXY", &proxy)
            .env("ALL_PROXY", &proxy);
    }
    command.current_dir(directory.path()).args([
        "-a",
        "never",
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--json",
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.unified_exec=false",
        "-c",
        "features.apply_patch_freeform=false",
        "-c",
        "web_search=\"disabled\"",
        "-c",
        "project_doc_max_bytes=0",
        "-c",
        "features.memories=false",
    ]);
    if !settings.model.trim().is_empty() {
        command.args(["--model", settings.model.trim()]);
    }
    if let Some(references) = references {
        for (i, reference) in references.iter().enumerate() {
            let bytes = crate::ai_images::decode(reference)?;
            let path = directory.path().join(format!("reference-{i}.png"));
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
            command.arg("--image").arg(path);
        }
    }
    command
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 Codex：{e}"))?;
    let mut stdin = child.stdin.take().ok_or("无法打开 Codex 输入")?;
    let mode = if references.is_some() {
        "你是 WorkStore 内的通用图像助手。必须使用内置 imagegen 工具生成一张 PNG 图片。参考随附图片并遵守用户的画面要求。不要执行命令，不访问其他文件。完成后简短回复生成图片的路径。"
    } else {
        "你是 WorkStore 内的通用 AI 助手。只提供文本回答，不执行命令、不访问文件。"
    };
    let prompt = format!(
        "{mode} 下面是按角色排列的对话 JSON，请回答最后的用户请求：\n{}",
        serde_json::to_string(messages).map_err(|e| e.to_string())?
    );
    let stdout = child.stdout.take().ok_or("无法读取 Codex 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 Codex 状态")?;
    let (_, out, err, status) = tokio::try_join!(
        async {
            stdin
                .write_all(prompt.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            drop(stdin);
            Ok::<(), String>(())
        },
        bounded_read(stdout, 2_000_000),
        bounded_read(stderr, 128_000),
        async { child.wait().await.map_err(|e| e.to_string()) }
    )?;
    if !status.success() {
        let error = String::from_utf8_lossy(&err);
        if error.contains("401") || error.contains("not logged") || error.contains("login") {
            return Err("Codex 登录已失效，请在本机执行 codex login 后重试".into());
        }
        return Err(format!("Codex 调用失败（退出码 {}）。请检查本机登录、网络及模型设置；需要支持 exec --ignore-user-config 的新版 Codex。", status.code().unwrap_or(-1)));
    }
    parse_codex(&out)?;
    Ok(out)
}
// CLI currently reports image paths as prose. Never trust those paths: only inspect
// the new, UUID-scoped imagegen output directory associated with thread.started.
fn generated_images(output: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let thread = output
        .split(|b| *b == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .find(|v| v["type"] == "thread.started")
        .and_then(|v| v["thread_id"].as_str().map(str::to_owned))
        .ok_or("未收到图像任务编号")?;
    uuid::Uuid::parse_str(&thread).map_err(|_| "图像任务编号无效")?;
    if thread.contains('/') || thread.contains('\\') {
        return Err("图像任务编号无效".into());
    }
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".codex")))
        .ok_or("无法定位 Codex 图像目录")?;
    let directory = home.join("generated_images").join(thread);
    let meta = std::fs::symlink_metadata(&directory).map_err(|_| "AI 未产出图片，请重试")?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("图像输出目录无效".into());
    }
    let mut paths = std::fs::read_dir(&directory)
        .map_err(|e| e.to_string())?
        .filter_map(|p| p.ok().map(|e| e.path()))
        .collect::<Vec<_>>();
    paths.sort();
    let mut result = Vec::new();
    for path in paths {
        if path.extension().and_then(|v| v.to_str()) != Some("png") {
            continue;
        }
        result.push(crate::ai_images::read_png(&path)?);
        if result.len() == 4 {
            break;
        }
    }
    if result.is_empty() {
        return Err("AI 未产出图片，请重试".into());
    }
    Ok(result)
}
fn parse_codex(bytes: &[u8]) -> Result<String, String> {
    let mut text = Vec::new();
    let mut completed = false;
    for line in bytes.split(|c| *c == b'\n').filter(|line| !line.is_empty()) {
        let event: Value = serde_json::from_slice(line).map_err(|_| "Codex 返回格式无效")?;
        if event["type"] == "turn.failed" || event["type"] == "error" {
            return Err("Codex 未完成请求，请检查登录状态、网络或模型设置".into());
        }
        if event["type"] == "turn.completed" {
            completed = true;
        }
        if event["type"] == "item.completed" && event["item"]["type"] == "agent_message" {
            if let Some(value) = event["item"]["text"].as_str() {
                text.push(value.to_string());
            }
        }
    }
    if !completed || text.is_empty() {
        return Err("Codex 未返回完整回答".into());
    }
    Ok(text.join("\n\n"))
}
async fn compatible(settings: &Settings, messages: &[Message]) -> Result<String, String> {
    let url = endpoint(settings)?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if local || settings.proxy_url.trim() == "direct" {
        builder = builder.no_proxy();
    } else if let Some(proxy) = resolve_proxy(settings).await? {
        builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "代理地址无效")?);
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    let mut request = client
        .post(url)
        .json(&json!({"model": settings.model, "messages": messages, "stream": false}));
    if let Some(key) = settings.api_key.as_ref().filter(|key| !key.is_empty()) {
        request = request.bearer_auth(key);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "无法连接 AI 服务，请检查 API 地址和网络")?;
    if !response.status().is_success() {
        return Err(format!(
            "AI 服务返回 HTTP {}，请检查 API Key、模型名称或服务额度",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "AI 响应读取失败")? {
        if bytes.len() + chunk.len() > 2_000_000 {
            return Err("AI 返回内容过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "AI 服务返回格式无效")?;
    value["choices"][0]["message"]["content"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or("AI 服务没有返回文本回答".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_are_redacted() {
        let s = redacted(Settings {
            api_key: Some("secret".into()),
            ..Settings::default()
        });
        assert!(s.has_api_key);
        assert!(!serde_json::to_string(&s).unwrap().contains("secret"));
    }
    #[test]
    fn endpoints_reject_insecure_or_embedded_credentials() {
        for address in [
            "http://example.com/v1",
            "https://key@example.com/v1",
            "https://example.com/v1?key=x",
        ] {
            assert!(endpoint(&Settings {
                base_url: address.into(),
                ..Settings::default()
            })
            .is_err());
        }
        assert!(endpoint(&Settings {
            base_url: "http://127.0.0.1:9000/v1".into(),
            ..Settings::default()
        })
        .is_ok());
    }
    #[test]
    fn codex_requires_completed_turn() {
        assert!(parse_codex(b"{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"partial\"}}").is_err());
        assert_eq!(parse_codex(b"{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"ok\"}}\n{\"type\":\"turn.completed\"}").unwrap(), "ok");
        assert!(parse_codex(b"{\"type\":\"turn.failed\"}").is_err());
    }
    #[tokio::test]
    async fn output_limit_is_enforced() {
        assert!(bounded_read(&b"12345"[..], 4).await.is_err());
    }
    #[test]
    fn invalid_messages_are_rejected() {
        let mut r = Request {
            id: uuid::Uuid::new_v4().to_string(),
            tool_id: "app.doc".into(),
            messages: vec![Message {
                role: "user".into(),
                content: "x".repeat(128_001),
            }],
            record: false,
            image: false,
            references: vec![],
        };
        assert!(validate_request(&r).is_err());
        r.messages[0].content = "ok".into();
        r.messages[0].role = "tool".into();
        assert!(validate_request(&r).is_err());
    }
    #[tokio::test]
    async fn compatible_api_sends_selected_model_messages_and_auth() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 1024];
            loop {
                let count = socket.read(&mut buffer).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let len: usize = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length: "))
                        .unwrap()
                        .parse()
                        .unwrap();
                    if bytes.len() < end + 4 + len {
                        continue;
                    }
                    assert!(headers.starts_with("post /v1/chat/completions "));
                    assert!(headers.contains("authorization: bearer test-only-key"));
                    let body: Value = serde_json::from_slice(&bytes[end + 4..]).unwrap();
                    assert_eq!(body["model"], "test-model");
                    assert_eq!(body["messages"][0]["content"], "hello");
                    let response = r#"{"choices":[{"message":{"content":"hello back"}}]}"#;
                    write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
                    break;
                }
            }
        });
        let settings = Settings {
            provider: "openai-compatible".into(),
            base_url: format!("http://{address}/v1"),
            model: "test-model".into(),
            api_key: Some("test-only-key".into()),
            ..Settings::default()
        };
        assert_eq!(
            compatible(
                &settings,
                &[Message {
                    role: "user".into(),
                    content: "hello".into()
                }]
            )
            .await
            .unwrap(),
            "hello back"
        );
        server.join().unwrap();
    }
    #[tokio::test]
    #[ignore = "Uses default Codex to validate all six template story structures"]
    async fn local_comic_story_smoke() {
        let templates: Value =
            serde_json::from_str(include_str!("../../public/comics/templates.json")).unwrap();
        let input:Vec<Value>=templates.as_array().unwrap().iter().enumerate().map(|(i,t)|{let count=[4,6,8][i%3];json!({"id":t["templateId"],"count":count,"theme":format!("{}：一个雨天里的新故事",t["title"].as_str().unwrap()),"beats":t["narrativeByCount"][count.to_string()],"entities":t["entities"]})}).collect();
        let result=tokio::time::timeout(Duration::from_secs(240),codex(&Settings::default(),&[Message{role:"system".into(),content:"为六个漫画模板分别写一个新主题故事，严格按各自count输出分镜，每张有title/action/dialogue/state字符串、entityIds数组，只用已知资产ID。仅输出JSON {works:[{id,pages:[...]}]}，不要解释。".into()},Message{role:"user".into(),content:serde_json::to_string(&input).unwrap()}])).await.unwrap().unwrap();
        let start = result.find('{').unwrap();
        let end = result.rfind('}').unwrap();
        let output: Value = serde_json::from_str(&result[start..=end]).unwrap();
        let works = output["works"].as_array().unwrap();
        assert_eq!(works.len(), 6);
        for spec in input {
            let work = works.iter().find(|w| w["id"] == spec["id"]).unwrap();
            let pages = work["pages"].as_array().unwrap();
            assert_eq!(pages.len(), spec["count"].as_u64().unwrap() as usize);
            for page in pages {
                for field in ["title", "action", "dialogue", "state"] {
                    assert!(page[field].is_string())
                }
                for id in page["entityIds"].as_array().unwrap() {
                    assert!(spec["entities"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|e| e["id"] == *id))
                }
            }
        }
        eprintln!("Six template story generation passed, including 4/6/8 page mappings");
    }
    #[tokio::test]
    #[ignore = "Uses logged-in Codex reference image generation; run explicitly"]
    async fn local_codex_reference_smoke() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let reference = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(include_bytes!("../../public/comics/cat-workday.png"))
        );
        let output=tokio::time::timeout(Duration::from_secs(240),codex_run(&Settings::default(),&[Message{role:"user".into(),content:"参考所附漫画里的橘猫，保留圆框眼镜、青绿色领带和橘色虎斑外貌。画一张猫在办公室喝茶的独立竖版 3:4 画面，不要多格或文字。".into()}],Some(&[reference]))).await.unwrap().unwrap();
        let images = generated_images(&output).unwrap();
        assert!(!images.is_empty());
        eprintln!(
            "Default Codex reference-image integration passed: {} bytes",
            images[0].len()
        );
    }
    #[tokio::test]
    #[ignore = "Uses default logged-in Codex image generation; run explicitly"]
    async fn local_codex_image_smoke() {
        let output = tokio::time::timeout(
            Duration::from_secs(240),
            codex_run(
                &Settings::default(),
                &[Message {
                    role: "user".into(),
                    content: "画一张橘猫在书桌前工作的简洁水彩漫画，竖版 3:4，无文字。".into(),
                }],
                Some(&[]),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        let images = generated_images(&output).unwrap();
        assert!(!images.is_empty());
        let temp = tempfile::tempdir().unwrap();
        let asset = crate::ai_images::save(temp.path(), &images[0]).unwrap();
        assert!(asset.starts_with("workstore-image:"));
        eprintln!(
            "Default Codex image integration passed: {} bytes saved by content hash",
            images[0].len()
        );
    }
    #[tokio::test]
    #[ignore = "Uses local logged-in Codex; run explicitly"]
    async fn local_codex_smoke() {
        let result = tokio::time::timeout(
            Duration::from_secs(90),
            codex(
                &Settings::default(),
                &[Message {
                    role: "user".into(),
                    content: "只回复 WORKSTORE_AI_OK".into(),
                }],
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.trim(), "WORKSTORE_AI_OK");
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    id: String,
    tool_id: String,
    prompt: String,
    text: String,
    provider: String,
    created_at: u64,
}
fn history_directory(root: &std::path::Path) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for part in ["data", "app.ai"] {
        path.push(part);
        if let Ok(meta) = std::fs::symlink_metadata(&path) {
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err("AI 数据目录不是普通文件夹".into());
            }
        }
    }
    Ok(path)
}
#[tauri::command]
pub fn ai_history(
    workspace: tauri::State<crate::Workspace>,
    tool_id: String,
) -> Result<Vec<Record>, String> {
    let slot = workspace.0.lock().map_err(|e| e.to_string())?;
    let directory = history_directory(slot.as_ref().ok_or("工作空间尚未打开")?.root_path())?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_name().to_string_lossy().ends_with(".ai.json") {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_symlink()
            || !meta.is_file()
            || meta.len() > 2_200_000
        {
            continue;
        }
        if let Ok(record) = serde_json::from_slice::<Record>(
            &std::fs::read(entry.path()).map_err(|e| e.to_string())?,
        ) {
            if record.tool_id == tool_id {
                records.push(record);
            }
        }
    }
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    records.truncate(30);
    Ok(records)
}

#[tauri::command]
pub async fn ai_codex_status(app: tauri::AppHandle) -> Result<String, String> {
    let settings = read_settings(&settings_path(&app)?)?;
    let path = configured_codex_path(&settings)?;
    let mut command = Command::new(path);
    command
        .args(["login", "status"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let status = tokio::time::timeout(Duration::from_secs(10), command.status())
        .await
        .map_err(|_| "Codex 状态检查超时")?
        .map_err(|e| format!("无法启动 Codex：{e}"))?;
    if status.success() {
        Ok("已检测到本地 Codex，已登录。连接模型的状态以实际发送结果为准。".into())
    } else {
        Err("已检测到 Codex，但尚未登录。请先执行 codex login。".into())
    }
}

fn validate_proxy(proxy: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(proxy).map_err(|_| "代理地址无效")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("请输入不含凭据的 HTTP / HTTPS 代理地址".into());
    }
    Ok(())
}
pub(crate) async fn resolve_proxy(settings: &Settings) -> Result<Option<String>, String> {
    let explicit = settings.proxy_url.trim();
    if explicit == "direct" {
        return Ok(None);
    }
    if !explicit.is_empty() {
        validate_proxy(explicit)?;
        return Ok(Some(explicit.to_owned()));
    }
    if ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
        .iter()
        .any(|key| std::env::var(key).is_ok_and(|v| !v.is_empty()))
    {
        return Ok(None);
    }
    #[cfg(target_os = "macos")]
    {
        let output = tokio::time::timeout(
            Duration::from_secs(2),
            Command::new("/usr/sbin/scutil")
                .arg("--proxy")
                .kill_on_drop(true)
                .output(),
        )
        .await;
        if let Ok(Ok(output)) = output {
            let text = String::from_utf8_lossy(&output.stdout);
            let value = |key: &str| {
                text.lines()
                    .find_map(|line| line.trim().strip_prefix(&format!("{key} : ")))
            };
            if value("HTTPSEnable") == Some("1") {
                if let (Some(host), Some(port)) = (value("HTTPSProxy"), value("HTTPSPort")) {
                    let proxy = format!("http://{host}:{port}");
                    if validate_proxy(&proxy).is_ok() {
                        return Ok(Some(proxy));
                    }
                }
            }
        }
    }
    Ok(None)
}

fn configured_codex_path(settings: &Settings) -> Result<PathBuf, String> {
    if settings.codex_path.trim().is_empty() && !settings.detected_codex_path.is_empty() {
        if let Ok(path) = codex_path(&settings.detected_codex_path) {
            return Ok(path);
        }
    }
    codex_path(&settings.codex_path)
}

// Run once at startup, off the window thread. Never change the selected provider or credentials.
pub async fn initialize(app: tauri::AppHandle) -> Result<(), String> {
    let path = settings_path(&app)?;
    let initial = {
        let _guard = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
        let settings = read_settings(&path)?;
        if !path.exists() {
            write_settings(&path, &settings)?;
        }
        settings
    };
    let discovered = codex_path(&initial.codex_path);
    let (detected, status) = match discovered {
        Ok(executable) => {
            let mut command = Command::new(&executable);
            command
                .args(["login", "status"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true);
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            let status = match tokio::time::timeout(Duration::from_secs(10), command.status()).await
            {
                Ok(Ok(result)) if result.success() => "ready",
                Ok(Ok(_)) => "login-required",
                _ => "unavailable",
            };
            (
                executable.to_string_lossy().into_owned(),
                status.to_string(),
            )
        }
        Err(_) => (String::new(), "not-found".into()),
    };
    save_detection(&path, &initial.codex_path, detected, status)
}
fn save_detection(
    path: &std::path::Path,
    original_path: &str,
    detected: String,
    status: String,
) -> Result<(), String> {
    let _guard = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    let mut current = read_settings(path)?;
    // A settings edit during detection wins; never overwrite it with a stale snapshot.
    if current.codex_path != original_path {
        return Ok(());
    }
    current.detected_codex_path = detected;
    current.codex_status = status;
    write_settings(&path, &current)
}

#[cfg(test)]
mod startup_tests {
    use super::*;
    #[test]
    fn detection_preserves_provider_and_credentials_and_respects_edits() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ai-settings.json");
        let mut settings = Settings {
            provider: "openai-compatible".into(),
            model: "custom-model".into(),
            api_key: Some("test-secret".into()),
            ..Settings::default()
        };
        write_settings(&path, &settings).unwrap();
        save_detection(&path, "", "/auto/codex".into(), "ready".into()).unwrap();
        let saved = read_settings(&path).unwrap();
        assert_eq!(saved.provider, "openai-compatible");
        assert_eq!(saved.model, "custom-model");
        assert_eq!(saved.api_key.as_deref(), Some("test-secret"));
        assert_eq!(saved.detected_codex_path, "/auto/codex");
        settings.codex_path = "/user/new-codex".into();
        write_settings(&path, &settings).unwrap();
        save_detection(&path, "", "/stale/codex".into(), "ready".into()).unwrap();
        assert_eq!(read_settings(&path).unwrap().codex_path, "/user/new-codex");
        assert!(read_settings(&path).unwrap().detected_codex_path.is_empty());
    }
    #[test]
    fn default_configuration_can_be_saved_without_codex_installed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ai-settings.json");
        save_detection(&path, "", String::new(), "not-found".into()).unwrap();
        let saved = read_settings(&path).unwrap();
        assert_eq!(saved.provider, "codex");
        assert_eq!(saved.codex_status, "not-found");
    }
}
