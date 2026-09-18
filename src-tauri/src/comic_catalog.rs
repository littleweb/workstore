//! Public, read-only template channel. Independent from private workspace sync.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::Manager;
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    template_id: String,
    revision: u64,
    path: String,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    schema_version: u32,
    templates: Vec<Entry>,
}
static UPDATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
fn valid_entry(e: &Entry) -> bool {
    !e.template_id.is_empty()
        && e.template_id.len() <= 80
        && e.template_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && e.revision > 0
        && e.path
            == format!(
                "content/comics/templates/{}/{}.json",
                e.template_id, e.revision
            )
        && e.sha256.len() == 64
        && e.sha256.bytes().all(|b| b.is_ascii_hexdigit())
}
async fn fetch(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "无法连接公共模板仓库，已保留本地模板")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("公共模板目录尚未发布，内置六个模板仍可使用".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "模板仓库返回 HTTP {}，已保留本地模板",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "模板下载中断")? {
        if bytes.len() + chunk.len() > limit {
            return Err("模板包过大".into());
        }
        bytes.extend_from_slice(&chunk)
    }
    Ok(bytes)
}
#[tauri::command]
pub async fn comic_template_catalog(
    app: tauri::AppHandle,
    workspace: tauri::State<'_, crate::Workspace>,
    refresh: bool,
) -> Result<Value, String> {
    let _guard = UPDATE.lock().await;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("comic-templates-v1");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cache = dir.join("catalog.json");
    if !refresh {
        return match std::fs::read(&cache) {
            Ok(bytes) => Ok(
                serde_json::json!({"templates":materialize(&workspace,serde_json::from_slice(&bytes).map_err(|_| "模板缓存无法读取")?)?}),
            ),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Ok(serde_json::json!({"templates":[]}))
            }
            Err(e) => Err(e.to_string()),
        };
    }
    let settings = crate::ai::ai_settings(app)?;
    let mut builder = reqwest::Client::builder()
        .user_agent("WorkStore-Comic-Templates/1")
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45));
    if settings.proxy_url.trim() == "direct" {
        builder = builder.no_proxy()
    } else if let Some(proxy) = crate::ai::resolve_proxy(&settings).await? {
        builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "代理地址无效")?)
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    let commit: Value = serde_json::from_slice(
        &fetch(
            &client,
            "https://api.github.com/repos/littleweb/workstore/commits/main",
            512_000,
        )
        .await?,
    )
    .map_err(|_| "模板版本信息无效")?;
    let sha = commit["sha"]
        .as_str()
        .filter(|s| s.len() == 40 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("模板版本编号无效")?;
    let base = format!("https://raw.githubusercontent.com/littleweb/workstore/{sha}");
    let catalog: Catalog = serde_json::from_slice(
        &fetch(
            &client,
            &format!("{base}/content/comics/catalog.json"),
            512_000,
        )
        .await?,
    )
    .map_err(|_| "模板目录格式无效")?;
    if catalog.schema_version != 1
        || catalog.templates.len() > 1000
        || catalog.templates.iter().any(|e| !valid_entry(e))
    {
        return Err("模板目录版本或路径无效".into());
    }
    let mut values = Vec::new();
    let mut ids = std::collections::HashSet::new();
    let mut total = 0usize;
    for e in catalog.templates {
        if !ids.insert(e.template_id.clone()) {
            return Err("模板编号重复".into());
        }
        let bytes = fetch(&client, &format!("{base}/{}", e.path), 32_000_000).await?;
        total += bytes.len();
        if total > 180_000_000 {
            return Err("模板目录总量过大".into());
        }
        if format!("{:x}", Sha256::digest(&bytes)) != e.sha256 {
            return Err("模板校验失败，未替换缓存".into());
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "模板 JSON 无效")?;
        if value["template"]["type"] != "workstore.comic.template"
            || value["template"]["schemaVersion"] != 1
            || value["template"]["templateId"] != e.template_id
            || value["template"]["revision"] != e.revision
        {
            return Err("模板内容与目录不一致".into());
        }
        values.push(value);
    }
    let bytes = serde_json::to_vec(&values).map_err(|e| e.to_string())?;
    let token = format!("{:x}", Sha256::digest(&bytes));
    let templates = materialize(&workspace, values)?;
    crate::storage::atomic_write(&dir.join("pending.json"), &bytes)?;
    Ok(serde_json::json!({"templates":templates,"token":token}))
}
// The UI validates the complete business schema before activating this candidate.
#[tauri::command]
pub async fn comic_template_activate(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let _guard = UPDATE.lock().await;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("comic-templates-v1");
    let bytes = std::fs::read(dir.join("pending.json")).map_err(|_| "没有待激活的模板")?;
    if format!("{:x}", Sha256::digest(&bytes)) != token {
        return Err("模板候选已变化，请重新更新".into());
    }
    crate::storage::atomic_write(&dir.join("catalog.json"), &bytes)
}
fn materialize(workspace: &crate::Workspace, packages: Vec<Value>) -> Result<Vec<Value>, String> {
    let slot = workspace.0.lock().map_err(|e| e.to_string())?;
    let root = slot.as_ref().ok_or("工作空间尚未打开")?.root_path();
    let mut templates = Vec::new();
    for package in packages {
        let assets = package["assets"].as_object().ok_or("模板资源目录无效")?;
        if assets.len() > 40 {
            return Err("模板资源过多".into());
        }
        let mut resolved = std::collections::HashMap::new();
        for (hash, data) in assets {
            let bytes = crate::ai_images::decode(data.as_str().ok_or("模板图片无效")?)?;
            if format!("{:x}", Sha256::digest(&bytes)) != *hash {
                return Err("模板图片校验失败".into());
            }
            resolved.insert(
                format!("template-asset:{hash}"),
                crate::ai_images::save(root, &bytes)?,
            );
        }
        fn rewrite(
            value: &mut Value,
            assets: &std::collections::HashMap<String, String>,
        ) -> Result<(), String> {
            match value {
                Value::Object(m) => {
                    for (k, v) in m.iter_mut() {
                        if k == "src" {
                            let key = v.as_str().ok_or("图片来源无效")?;
                            *v = Value::String(assets.get(key).ok_or("模板缺少图片")?.clone())
                        } else {
                            rewrite(v, assets)?
                        }
                    }
                }
                Value::Array(a) => {
                    for v in a {
                        rewrite(v, assets)?
                    }
                }
                _ => (),
            }
            Ok(())
        }
        let mut template = package["template"].clone();
        rewrite(&mut template, &resolved)?;
        templates.push(template);
    }
    Ok(templates)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_paths_stay_in_public_catalog() {
        let mut e = Entry {
            template_id: "cat-workday".into(),
            revision: 1,
            path: "content/comics/templates/cat-workday/1.json".into(),
            sha256: "a".repeat(64),
        };
        assert!(valid_entry(&e));
        e.path = "../../secret".into();
        assert!(!valid_entry(&e));
        e.path = "https://elsewhere.test".into();
        assert!(!valid_entry(&e))
    }
}
