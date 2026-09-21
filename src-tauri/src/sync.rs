//! Git is a transport. Network work only touches a private checkout; activation
//! is a separate, short operation serialized with the normal workspace writer.
use crate::{
    preferences::Preferences,
    storage::{atomic_write, Data},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;
type Result<T> = std::result::Result<T, String>;
pub type Files = BTreeMap<String, Vec<u8>>;

fn git_timeout(operation: &str) -> Duration {
    Duration::from_secs(match operation {
        "fetch" | "push" => 300,
        "ls-remote" => 60,
        _ => 45,
    })
}

fn git(root: &Path, args: &[&str], token: &str) -> Result<String> {
    // Credentials are scoped to the child process, never written into the remote URL.
    let output = tempfile::tempfile().map_err(|e| e.to_string())?;
    let error = tempfile::tempfile().map_err(|e| e.to_string())?;
    let operation = args.first().copied().unwrap_or("");
    let network = matches!(operation, "fetch" | "push" | "ls-remote");
    let mut command = Command::new("git");
    if network {
        // Desktop processes do not automatically inherit macOS system proxies.
        if let Some(proxy) = tauri::async_runtime::block_on(crate::ai::resolve_proxy(&crate::ai::Settings::default()))? {
            command.env("HTTPS_PROXY", &proxy).env("HTTP_PROXY", &proxy).env("ALL_PROXY", &proxy);
        }
        command.args(["-c", "http.lowSpeedLimit=100", "-c", "http.lowSpeedTime=60"]);
    }
    #[cfg(unix)] {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    command
        .current_dir(root)
        .args([
            "-c",
            &format!("core.hooksPath={}", root.join(".git/no-hooks").display()),
            "-c",
            "protocol.file.allow=always",
        ])
        .arg("-c")
        .arg("core.quotepath=false")
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_CONFIG_COUNT", if token.is_empty() { "0" } else { "1" })
        .stdin(Stdio::null())
        .stdout(output.try_clone().map_err(|e| e.to_string())?)
        .stderr(error.try_clone().map_err(|e| e.to_string())?);
    if !token.is_empty() {
        command
            .env("GIT_CONFIG_KEY_0", "http.https://github.com/.extraheader")
            .env(
                "GIT_CONFIG_VALUE_0",
                format!(
                    "Authorization: Basic {}",
                    base64(format!("x-access-token:{token}").as_bytes())
                ),
            );
    }
    let mut child = command.spawn().map_err(|e| format!("无法运行 Git：{e}"))?;
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > git_timeout(operation) {
            // Git spawns remote-https/index-pack helpers. Stop the entire isolated
            // group so timed-out transfers cannot keep locks or write into the cache.
            #[cfg(unix)] unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
            #[cfg(windows)] {
                let _ = Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "{} 超时，请检查此设备访问 GitHub 的网络或系统代理；数据保留在本地，将自动重试",
                args.first().copied().unwrap_or("Git")
            ));
        }
        thread::sleep(Duration::from_millis(30));
    };
    use std::io::{Read, Seek, SeekFrom};
    let mut file = if status.success() { output } else { error };
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut text = String::new();
    file.read_to_string(&mut text).map_err(|e| e.to_string())?;
    if status.success() {
        Ok(text)
    } else {
        Err(if token.is_empty() {
            text
        } else {
            text.replace(token, "[凭证已隐藏]")
        })
    }
}
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = ((chunk[0] as u32) << 16)
            | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8)
            | chunk.get(2).copied().unwrap_or(0) as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
fn excluded(name: &str) -> bool {
    matches!(
        name,
        ".git" | ".workstore" | ".DS_Store" | "sync-metadata.json"
    )
}
pub fn snapshot(root: &Path) -> Result<Files> {
    fn walk(root: &Path, here: &Path, files: &mut Files) -> Result<()> {
        for entry in fs::read_dir(here).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if excluded(&entry.file_name().to_string_lossy()) {
                continue;
            }
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() {
                return Err("同步目录不能包含符号链接".into());
            }
            if meta.is_dir() {
                walk(root, &path, files)?;
            } else if meta.is_file() {
                let key = path
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_str()
                    .ok_or("文件名不是 UTF-8")?
                    .replace('\\', "/");
                files.insert(key, fs::read(path).map_err(|e| e.to_string())?);
            }
        }
        Ok(())
    }
    let mut files = Files::new();
    walk(root, root, &mut files)?;
    Ok(files)
}
fn validate(files: &Files) -> Result<()> {
    for name in files.keys() {
        if name.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.contains('\\')
                || part.contains(':')
                || excluded(part)
        }) {
            return Err("仓库包含不支持的路径".into());
        }
    }
    let state: Data = serde_json::from_slice(files.get("state.json").ok_or("仓库缺少工作区状态")?)
        .map_err(|e| e.to_string())?;
    crate::storage::validate(&state)?;
    let manifest: Value =
        serde_json::from_slice(files.get("workspace.json").ok_or("仓库缺少工作区标识")?)
            .map_err(|e| e.to_string())?;
    if manifest["schema_version"] != 1 || manifest["id"].as_str().is_none() {
        return Err("工作区版本不兼容".into());
    }
    for (name, bytes) in files {
        if name.starts_with(crate::sync_history::PREFIX) && !crate::sync_history::valid(name, bytes) {
            return Err("同步历史校验失败，未修改工作区".into());
        }
        if name.ends_with(".doc.json") || name.ends_with(".whiteboard.json") || name.ends_with(".comic.json") {
            let v: Value =
                serde_json::from_slice(bytes).map_err(|e| format!("{name} 无法解析：{e}"))?;
            let board = name.ends_with(".whiteboard.json");
            let id = v["id"].as_str().ok_or("文档缺少 ID")?;
            Uuid::parse_str(id).map_err(|_| "文档 ID 无效")?;
            let suffix = if name.ends_with(".comic.json") { ".comic.json" } else if board {
                ".whiteboard.json"
            } else {
                ".doc.json"
            };
            if v["schemaVersion"] != 1
                || v["type"]
                    != if name.ends_with(".comic.json") { "workstore.comic" } else if board {
                        "workstore.whiteboard"
                    } else {
                        "workstore.document"
                    }
                || !name.ends_with(&format!("/{id}{suffix}"))
            {
                return Err(format!("{name} 类型或版本不兼容"));
            }
        }
    }
    Ok(())
}
fn default_state(bytes: &[u8]) -> bool {
    serde_json::from_slice::<Value>(bytes).ok() == serde_json::to_value(Data::default()).ok()
}
// Objects merge per field; arrays (editor scenes/content) stay indivisible. A
// conflicting field uses the remote value; merge() archives exact inputs outside tool lists.
fn merge_value(base: Option<&Value>, local: &Value, remote: &Value, conflict: &mut bool) -> Value {
    if local == remote || Some(local) == base {
        return remote.clone();
    }
    if Some(remote) == base {
        return local.clone();
    }
    if let (Some(l), Some(r)) = (local.as_object(), remote.as_object()) {
        let b = base.and_then(Value::as_object);
        let keys: BTreeSet<_> = l
            .keys()
            .chain(r.keys())
            .chain(b.into_iter().flat_map(|x| x.keys()))
            .collect();
        let mut result = serde_json::Map::new();
        for key in keys {
            let bv = b.and_then(|b| b.get(key));
            let lv = l.get(key);
            let rv = r.get(key);
            let value = if lv == rv || lv == bv {
                rv.cloned()
            } else if rv == bv {
                lv.cloned()
            } else if matches!(
                key.as_str(),
                "updatedAt" | "lastOpenedAt" | "revision" | "lastOpened"
            ) && lv.and_then(Value::as_u64).is_some()
                && rv.and_then(Value::as_u64).is_some()
            {
                Some(Value::from(
                    lv.unwrap()
                        .as_u64()
                        .unwrap()
                        .max(rv.unwrap().as_u64().unwrap()),
                ))
            } else if let (Some(lv), Some(rv)) = (lv, rv) {
                Some(merge_value(bv, lv, rv, conflict))
            } else {
                *conflict = true;
                rv.cloned()
            };
            if let Some(value) = value {
                result.insert(key.clone(), value);
            }
        }
        return Value::Object(result);
    }
    // Navigation membership is keyed by stable tool ID, preserving independent changes.
    if let (Some(l), Some(r)) = (local.as_array(), remote.as_array()) {
        if l.iter()
            .chain(r)
            .all(|v| v.get("id").and_then(Value::as_str).is_some())
            && l.iter().chain(r).any(|v| v.get("rank").is_some())
        {
            let to_map = |v: &Value| -> Value {
                Value::Object(
                    v.as_array()
                        .into_iter()
                        .flatten()
                        .map(|x| (x["id"].as_str().unwrap().to_string(), x.clone()))
                        .collect(),
                )
            };
            let b = base.map(to_map);
            let merged = merge_value(b.as_ref(), &to_map(local), &to_map(remote), conflict);
            let mut items: Vec<_> = merged.as_object().unwrap().values().cloned().collect();
            items.sort_by_key(|v| {
                (
                    v["rank"].as_u64().unwrap_or(0),
                    v["id"].as_str().unwrap().to_string(),
                )
            });
            return Value::Array(items);
        }
    }
    *conflict = true;
    remote.clone()
}
#[cfg(test)]
fn legacy_conflict_copy(name: &str, bytes: &[u8]) -> (String, Vec<u8>) {
    let digest = Sha256::digest([name.as_bytes(), bytes].concat());
    if name.ends_with(".doc.json") || name.ends_with(".whiteboard.json") || name.ends_with(".comic.json") {
        if let Ok(mut value) = serde_json::from_slice::<Value>(bytes) {
            let mut raw = [0; 16];
            raw.copy_from_slice(&digest[..16]);
            raw[6] = (raw[6] & 15) | 64;
            raw[8] = (raw[8] & 63) | 128;
            let id = Uuid::from_bytes(raw).to_string();
            let title = value["title"]
                .as_str()
                .unwrap_or("未命名")
                .chars()
                .take(100)
                .collect::<String>();
            value["id"] = Value::from(id.clone());
            value["title"] = Value::from(format!("{title}（冲突副本）"));
            let suffix = if name.ends_with(".comic.json") { ".comic.json" } else if name.ends_with(".doc.json") {
                ".doc.json"
            } else {
                ".whiteboard.json"
            };
            return (
                format!("{}/{id}{suffix}", name.rsplit_once('/').unwrap().0),
                serde_json::to_vec_pretty(&value).unwrap(),
            );
        }
    }
    (format!("conflicts/{:x}.json", digest), bytes.to_vec())
}
fn merge(base: &Files, local: &Files, remote: &Files, initial: bool) -> (Files, usize) {
    let mut result = Files::new();
    let mut history = Files::new();
    let mut conflicts = 0;
    for name in base
        .keys()
        .chain(local.keys())
        .chain(remote.keys())
        .collect::<BTreeSet<_>>()
    {
        // History is append-only across devices, including delete/modify races.
        if name.starts_with(crate::sync_history::PREFIX) {
            if let Some(bytes) = remote.get(name).or(local.get(name)).or(base.get(name)) {
                result.insert(name.clone(), bytes.clone());
            }
            continue;
        }
        let b = base.get(name);
        let l = local.get(name);
        let r = remote.get(name);
        let mut conflict = false;
        let merged = if l == r || l == b {
            r.cloned()
        } else if r == b {
            l.cloned()
        } else if initial
            && (name == "workspace.json"
                || (name == "state.json" && l.is_some_and(|v| default_state(v))))
        {
            r.cloned()
        } else if let (Some(l), Some(r)) = (l, r) {
            match (
                serde_json::from_slice::<Value>(l),
                serde_json::from_slice::<Value>(r),
            ) {
                (Ok(l), Ok(r)) => {
                    let b = b.and_then(|x| serde_json::from_slice(x).ok());
                    Some(
                        serde_json::to_vec_pretty(&merge_value(b.as_ref(), &l, &r, &mut conflict))
                            .unwrap(),
                    )
                }
                _ => {
                    conflict = true;
                    Some(r.clone())
                }
            }
        } else {
            conflict = true;
            r.cloned()
        };
        if conflict {
            conflicts += 1;
            for bytes in [b, l, r].into_iter().flatten() {
                crate::sync_history::archive(&mut history, name, bytes, "concurrent-edit", None);
            }
        }
        if let Some(bytes) = merged {
            result.insert(name.clone(), bytes);
        }
    }
    result.extend(history);
    crate::sync_history::normalize(&mut result);
    (result, conflicts)
}
#[derive(Serialize, Deserialize)]
pub struct Prepared {
    pub id: String,
    pub root: String,
    pub captured: Files,
    pub merged: Files,
    pub conflicts: usize,
    pub identity: String,
}
#[derive(Default, Serialize, Deserialize)]
struct Baseline {
    identity: String,
    files: Files,
}
fn json_write(path: &Path, value: &impl Serialize) -> Result<()> {
    atomic_write(path, &serde_json::to_vec(value).map_err(|e| e.to_string())?)
}
fn replace_checkout(root: &Path, files: &Files) -> Result<()> {
    let before = snapshot(root)?;
    for (name, bytes) in files {
        if before.get(name) != Some(bytes) { atomic_write(&root.join(name), bytes)?; }
    }
    for name in before.keys() {
        if !files.contains_key(name) {
            fs::remove_file(root.join(name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
// A previous fetch may have installed the commit before its process timed out.
// Never require another network transfer before activating an already complete tree.
fn cached_commit(repo: &Path, sha: &str) -> bool {
    git(repo, &["cat-file", "-e", &format!("{sha}^{{commit}}")], "").is_ok()
        && git(
            repo,
            &["fsck", "--connectivity-only", "--no-reflogs", sha],
            "",
        )
        .is_ok()
}
fn ensure_remote_commit(repo: &Path, branch: &str, sha: &str, token: &str) -> Result<()> {
    if !cached_commit(repo, sha) {
        let result = git(
            repo,
            &[
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-recurse-submodules",
                "--no-auto-maintenance",
                "--depth",
                "1",
                "origin",
                &format!("+refs/heads/{branch}:refs/remotes/origin/{branch}"),
            ],
            token,
        );
        if let Err(error) = result {
            if !cached_commit(repo, sha) {
                return Err(format!("拉取其他设备更新失败：{error}"));
            }
        }
    }
    // Pin the exact version advertised by ls-remote. A newer remote commit will
    // be picked up by the next cycle; branch races cannot select an old checkout.
    git(
        repo,
        &["update-ref", &format!("refs/remotes/origin/{branch}"), sha],
        "",
    )?;
    Ok(())
}
// A checkout is disposable transport state. Never remove a lock that might still
// belong to a live Git process; select a fresh checkout and leave the old one intact.
fn checkout_has_lock(repo: &Path) -> Result<bool> {
    fn scan(directory: &Path, recurse: bool) -> Result<bool> {
        match fs::symlink_metadata(directory) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e.to_string()),
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => return Ok(true),
            _ => (),
        }
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            if name.to_string_lossy().ends_with(".lock") { return Ok(true); }
            if (recurse || name == "refs") && entry.file_type().map_err(|e| e.to_string())?.is_dir() && scan(&entry.path(), true)? { return Ok(true); }
        }
        Ok(false)
    }
    if fs::symlink_metadata(repo).is_ok_and(|meta| meta.file_type().is_symlink()) { return Ok(true); }
    scan(&repo.join(".git"), false)
}
fn select_checkout(area: &Path, identity: &str) -> Result<std::path::PathBuf> {
    let prefix = format!("sync-repository-{:x}", Sha256::digest(identity.as_bytes()));
    let pointer = area.join(format!("{prefix}-generation.json"));
    let generation = match fs::read(&pointer) {
        Ok(bytes) => Some(serde_json::from_slice::<String>(&bytes).ok().and_then(|value| Uuid::parse_str(&value).ok())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    let repo = area.join(match generation {
        Some(Some(id)) => format!("{prefix}-{id}"),
        _ => prefix.clone(),
    });
    if generation == Some(None) || checkout_has_lock(&repo)? {
        let id = Uuid::new_v4();
        let fresh = area.join(format!("{prefix}-{id}"));
        fs::create_dir(&fresh).map_err(|e| e.to_string())?;
        json_write(&pointer, &id.to_string())?;
        return Ok(fresh);
    }
    fs::create_dir_all(&repo).map_err(|e| e.to_string())?;
    Ok(repo)
}
pub fn prepare(root: &Path, preferences: &Preferences, captured: Files) -> Result<Prepared> {
    let url = preferences.github_repo_url.trim();
    if url.is_empty() {
        return Err("未配置仓库地址".into());
    }
    if url.starts_with('-') || url.contains('@') {
        return Err("请使用不含凭证的仓库地址，Token 单独填写".into());
    }
    let branch = preferences.github_sync_branch.trim();
    let branch = if branch.is_empty() { "main" } else { branch };
    let token = preferences.github_token.trim();
    let identity = format!("{url}\n{branch}");
    let area = root.join(".workstore");
    fs::create_dir_all(&area).map_err(|e| e.to_string())?;
    let base_path = area.join("sync-base.json");
    let baseline: Baseline = if base_path.exists() {
        serde_json::from_slice(&fs::read(base_path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("同步基线损坏：{e}"))?
    } else {
        Baseline::default()
    };
    if !baseline.identity.is_empty() && baseline.identity != identity {
        return Err("仓库或分支已变更，请使用独立工作目录连接另一个仓库，以保留原同步历史".into());
    }
    let repo_path = select_checkout(&area, &identity)?;
    let repo = repo_path.as_path();
    git(repo, &["init", "--quiet"], token)?;
    git(repo, &["check-ref-format", "--branch", branch], token)?;
    git(repo, &["config", "user.name", "WorkStore"], token)?;
    git(
        repo,
        &["config", "user.email", "workstore.local@localhost"],
        token,
    )?;
    if git(repo, &["remote", "get-url", "origin"], token).is_ok() {
        git(repo, &["remote", "set-url", "origin", url], token)?;
    } else {
        git(repo, &["remote", "add", "origin", url], token)?;
    }
    let mut prepared = None;
    // A rejected push means another peer won the race. Fetch its commit and merge again.
    for attempt in 0..3 {
        let heads = git(repo, &["ls-remote", "--heads", "origin"], token)?;
        let target = format!("refs/heads/{branch}");
        let exists = heads
            .lines()
            .any(|line| line.split_whitespace().nth(1) == Some(target.as_str()));
        if !exists && !heads.trim().is_empty() {
            return Err("仓库已有其他分支，但指定分支不存在，请检查分支配置".into());
        }
        let remote = if exists {
            let advertised = heads
                .lines()
                .find_map(|line| {
                    let mut fields = line.split_whitespace();
                    let sha = fields.next()?;
                    (fields.next()? == target).then_some(sha)
                })
                .ok_or("无法读取远端版本")?;
            ensure_remote_commit(repo, branch, advertised, token)?;
            let tree = git(
                repo,
                &["ls-tree", "-r", &format!("refs/remotes/origin/{branch}")],
                token,
            )?;
            for line in tree.lines() {
                let (meta, name) = line.split_once('\t').ok_or("仓库目录格式无效")?;
                if !(meta.starts_with("100644 ") || meta.starts_with("100755 "))
                    || name.starts_with('"')
                    || name.split('/').any(|part| {
                        part == ".workstore"
                            || part == ".git"
                            || part == ".."
                            || part.contains('\\')
                    })
                {
                    return Err("仓库包含不支持的链接或内部目录".into());
                }
            }
            // Private disposable checkout only. Never reset a user's workspace.
            git(
                repo,
                &[
                    "checkout",
                    "--force",
                    "-B",
                    "workstore-sync",
                    &format!("refs/remotes/origin/{branch}"),
                ],
                token,
            )?;
            git(repo, &["clean", "-fd"], token)?;
            let remote = snapshot(repo)?;
            validate(&remote)?;
            remote
        } else {
            Files::new()
        };
        let (mut merged, conflicts) = if remote.is_empty() {
            (captured.clone(), 0)
        } else {
            merge(
                &baseline.files,
                &captured,
                &remote,
                baseline.identity.is_empty(),
            )
        };
        crate::sync_history::normalize(&mut merged);
        validate(&merged)?;
        replace_checkout(repo, &merged)?;
        git(repo, &["add", "-A", "--force"], token)?;
        if !git(repo, &["status", "--porcelain"], token)?
            .trim()
            .is_empty()
        {
            git(
                repo,
                &[
                    "commit",
                    "--quiet",
                    "-m",
                    "WorkStore: synchronize workspace",
                ],
                token,
            )?;
        }
        let push = if merged == remote {
            Ok(String::new())
        } else {
            git(
                repo,
                &["push", "origin", &format!("HEAD:refs/heads/{branch}")],
                token,
            )
        };
        match push {
            Ok(_) => {
                prepared = Some(Prepared {
                    id: Uuid::new_v4().to_string(),
                    root: root.to_string_lossy().into(),
                    captured: captured.clone(),
                    merged,
                    conflicts,
                    identity: identity.clone(),
                });
                break;
            }
            Err(error) if attempt == 2 => return Err(error),
            Err(_) => continue,
        }
    }
    let mut prepared = prepared.ok_or("同步暂未完成，将自动重试")?;
    if prepared.merged == captured && baseline.files == captured && baseline.identity == identity {
        prepared.id = "unchanged".into();
        return Ok(prepared);
    }
    json_write(&area.join("sync-prepared.json"), &prepared)?;
    Ok(prepared)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub changed: Vec<String>,
    pub message: String,
}
pub fn apply(root: &Path, id: &str) -> Result<Applied> {
    let area = root.join(".workstore");
    let path = area.join("sync-prepared.json");
    let prepared: Prepared = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if prepared.id != id || Path::new(&prepared.root) != root {
        return Err("工作区已变化，将在下一次同步时重试".into());
    }
    if prepared.merged == prepared.captured {
        json_write(
            &area.join("sync-base.json"),
            &Baseline {
                identity: prepared.identity,
                files: prepared.merged,
            },
        )?;
        fs::remove_file(path).map_err(|e| e.to_string())?;
        return Ok(Applied {
            changed: vec![],
            message: "同步完成".into(),
        });
    }
    let current = snapshot(root)?;
    let mut next = current.clone();
    let mut base = prepared.merged.clone();
    for name in prepared
        .captured
        .keys()
        .chain(prepared.merged.keys())
        .collect::<BTreeSet<_>>()
    {
        if current.get(name) == prepared.captured.get(name) {
            if let Some(bytes) = prepared.merged.get(name) {
                next.insert(name.clone(), bytes.clone());
            } else {
                next.remove(name);
            }
        } else {
            // An edit saved while the network was busy stays local. Its previous
            // version remains the common ancestor for the next merge.
            if let Some(bytes) = prepared.captured.get(name) {
                base.insert(name.clone(), bytes.clone());
            } else {
                base.remove(name);
            }
        }
    }
    crate::sync_history::normalize(&mut next);
    validate(&next)?;
    let changed: Vec<_> = current
        .keys()
        .chain(next.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|k| current.get(*k) != next.get(*k))
        .cloned()
        .collect();
    // Durable recovery journal precedes every multi-file activation.
    json_write(
        &area.join("sync-recovery.json"),
        &Recovery {
            files: next,
            baseline: Baseline {
                identity: prepared.identity,
                files: base,
            },
        },
    )?;
    recover(root)?;
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(Applied {
        changed,
        message: "同步完成".into(),
    })
}
/// Called only before editors mount, or under the explicit maintenance lock.
/// Preserve the common baseline so the next Git sync still sees the retirement.
pub fn reconcile_history(root: &Path) -> Result<usize> {
    let current = snapshot(root)?;
    let mut files = current.clone();
    let count = crate::sync_history::normalize(&mut files);
    if files == current { return Ok(0); }
    validate(&files)?;
    let baseline_path = root.join(".workstore/sync-base.json");
    let baseline = if baseline_path.exists() {
        serde_json::from_slice(&fs::read(&baseline_path).map_err(|e| e.to_string())?)
            .map_err(|_| "同步基线无法读取，未整理用户文件".to_string())?
    } else { Baseline::default() };
    json_write(&root.join(".workstore/sync-recovery.json"), &Recovery { files, baseline })?;
    recover(root)?;
    Ok(count)
}

/// Offline repair uses the same workspace lock as the GUI. No network and no
/// deletion without a durable exact-byte history plus recovery journal.
pub fn maintain_history(root: &Path) -> Result<usize> {
    use fs2::FileExt;
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let area = root.join(".workstore");
    let meta = fs::symlink_metadata(&area).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() { return Err("工作区缓存目录无效".into()); }
    let lock = fs::OpenOptions::new().read(true).write(true).open(area.join("workspace.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock_exclusive().map_err(|_| "请先正常退出 WorkStore，当前未修改任何用户文件".to_string())?;
    validate(&snapshot(&root)?)?;
    recover(&root)?;
    reconcile_history(&root)
}

#[derive(Serialize, Deserialize)]
struct Recovery {
    files: Files,
    baseline: Baseline,
}
pub fn recover(root: &Path) -> Result<()> {
    let journal = root.join(".workstore/sync-recovery.json");
    if journal.exists() {
        let transaction: Recovery =
            serde_json::from_slice(&fs::read(&journal).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        validate(&transaction.files)?;
        replace_checkout(root, &transaction.files)?;
        json_write(
            &root.join(".workstore/sync-base.json"),
            &transaction.baseline,
        )?;
        fs::remove_file(journal).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Store;
    fn sync(root: &Path, p: &Preferences) -> Applied {
        let prepared = prepare(root, p, snapshot(root).unwrap()).unwrap();
        if prepared.id == "unchanged" {
            Applied {
                changed: vec![],
                message: "同步完成".into(),
            }
        } else {
            apply(root, &prepared.id).unwrap()
        }
    }
    #[test]
    fn recent_tools_and_comic_lists_arrive_on_new_and_existing_peers() {
        let temp = tempfile::tempdir().unwrap();
        let remote = temp.path().join("remote.git");
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet"], "").unwrap();
        let p = Preferences { github_sync_enabled: true, github_repo_url: remote.to_string_lossy().into_owned(), ..Preferences::default() };
        let a = temp.path().join("a"); let b = temp.path().join("b");
        let mut first = Store::open(temp.path().join("ca"), a.clone()).unwrap();
        let mut second = Store::open(temp.path().join("cb"), b.clone()).unwrap();
        let content = serde_json::json!({"settings":{"ratio":"3:4","count":4},"pages":(0..4).map(|n|serde_json::json!({"id":n.to_string(),"action":"story","dialogue":"hello","entityIds":[]})).collect::<Vec<_>>(),"history":[],"publishing":{},"templateSnapshot":{}});
        let comic = first.create_comic(content.clone()).unwrap();
        let mut data = first.snapshot().unwrap().data;
        data.entries.push(crate::storage::Entry { id: "app.comic".into(), favorite: false, rank: 3, last_opened: Some(123) });
        first.save(data).unwrap(); sync(&a, &p); sync(&b, &p);
        assert!(second.snapshot().unwrap().data.entries.iter().any(|e| e.id == "app.comic" && e.last_opened == Some(123)));
        assert_eq!(second.list_comics().unwrap().comics[0].id, comic.comic.info.id);
        second.refresh_disk().unwrap();
        let mut data = second.snapshot().unwrap().data;
        data.entries.push(crate::storage::Entry { id: "tool.time".into(), favorite: false, rank: 4, last_opened: Some(456) });
        second.save(data).unwrap();
        second.create_comic(content).unwrap(); sync(&b, &p); sync(&a, &p);
        assert_eq!(first.list_comics().unwrap().comics.len(), 2);
        assert!(first.snapshot().unwrap().data.entries.iter().any(|e| e.id == "tool.time" && e.last_opened == Some(456)));
        assert_eq!(snapshot(&a).unwrap(), snapshot(&b).unwrap());
    }
    #[test]
    fn locked_checkout_recovers_without_deleting_lock_or_local_data() {
        let temp = tempfile::tempdir().unwrap();
        let remote = temp.path().join("remote.git"); fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet"], "").unwrap();
        let p = Preferences { github_sync_enabled: true, github_repo_url: remote.to_string_lossy().into_owned(), ..Preferences::default() };
        let a = temp.path().join("a"); let b = temp.path().join("b");
        let _first = Store::open(temp.path().join("ca"), a.clone()).unwrap();
        let _second = Store::open(temp.path().join("cb"), b.clone()).unwrap();
        sync(&a, &p); sync(&b, &p);
        let area = b.join(".workstore"); let identity = format!("{}\nmain", p.github_repo_url);
        let old = select_checkout(&area, &identity).unwrap();
        let lock = old.join(".git/shallow.lock"); fs::write(&lock, "owned by another process").unwrap();
        atomic_write(&a.join("remote-new.json"), b"true").unwrap(); sync(&a, &p);
        atomic_write(&b.join("local-unsent.json"), b"true").unwrap(); sync(&b, &p);
        assert!(b.join("remote-new.json").exists()); assert!(b.join("local-unsent.json").exists());
        assert_eq!(fs::read_to_string(lock).unwrap(), "owned by another process");
        let fresh = select_checkout(&area, &identity).unwrap(); assert_ne!(fresh, old);
        assert_eq!(fresh, select_checkout(&area, &identity).unwrap());
        sync(&a, &p); assert!(a.join("local-unsent.json").exists());
    }
    #[test]
    fn transfer_timeout_allows_initial_downloads() {
        assert_eq!(git_timeout("fetch"), Duration::from_secs(300));
        assert_eq!(git_timeout("push"), Duration::from_secs(300));
        assert_eq!(git_timeout("ls-remote"), Duration::from_secs(60));
        assert_eq!(git_timeout("status"), Duration::from_secs(45));
    }
    #[test]
    #[ignore = "Reads the public release repository through the current system network"]
    fn github_fetch_uses_system_network() {
        let temp = tempfile::tempdir().unwrap();
        git(temp.path(), &["init", "--quiet"], "").unwrap();
        git(temp.path(), &["fetch", "--quiet", "--depth", "1", "https://github.com/littleweb/workstore.git", "main"], "").unwrap();
        assert!(git(temp.path(), &["rev-parse", "FETCH_HEAD"], "").unwrap().trim().len() == 40);
    }
    #[test]
    fn peers_initialize_pull_merge_delete_and_preserve_inflight_edits() {
        let temp = tempfile::tempdir().unwrap();
        let remote = temp.path().join("remote.git");
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet"], "").unwrap();
        let p = Preferences {
            github_sync_enabled: true,
            github_repo_url: remote.to_str().unwrap().into(),
            ..Preferences::default()
        };
        let a = temp.path().join("a");
        let b = temp.path().join("b");
        let _a = Store::open(temp.path().join("ca"), a.clone()).unwrap();
        let _b = Store::open(temp.path().join("cb"), b.clone()).unwrap();
        atomic_write(&a.join("notes/one.json"), br#"{"text":"hello"}"#).unwrap();
        atomic_write(&b.join("notes/二号设备.txt"), b"existing local data").unwrap();
        sync(&a, &p);
        sync(&b, &p);
        sync(&a, &p);
        assert_eq!(snapshot(&a).unwrap(), snapshot(&b).unwrap());
        // Two peers can publish together; a rejected push is retried against
        // the winning commit, preserving both independently created files.
        atomic_write(&a.join("notes/from-a.txt"), b"A").unwrap();
        atomic_write(&b.join("notes/from-b.txt"), b"B").unwrap();
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                barrier.wait();
                sync(&a, &p);
            });
            scope.spawn(|| {
                barrier.wait();
                sync(&b, &p);
            });
        });
        sync(&a, &p);
        sync(&b, &p);
        assert_eq!(snapshot(&a).unwrap(), snapshot(&b).unwrap());
        assert!(a.join("notes/from-b.txt").exists());
        assert!(b.join("notes/from-a.txt").exists());
        // A peer with no local edits still pulls remote additions.
        atomic_write(&a.join("notes/two.json"), b"2").unwrap();
        sync(&a, &p);
        sync(&b, &p);
        assert_eq!(fs::read(b.join("notes/two.json")).unwrap(), b"2");
        // Independent fields merge against the last common version.
        let mut sa: Value =
            serde_json::from_slice(&fs::read(a.join("state.json")).unwrap()).unwrap();
        let mut sb = sa.clone();
        sa["color"] = Value::from("#111111");
        sb["collapsed"] = Value::from(true);
        json_write(&a.join("state.json"), &sa).unwrap();
        json_write(&b.join("state.json"), &sb).unwrap();
        sync(&a, &p);
        sync(&b, &p);
        sync(&a, &p);
        assert_eq!(snapshot(&a).unwrap(), snapshot(&b).unwrap());
        let merged: Value =
            serde_json::from_slice(&fs::read(a.join("state.json")).unwrap()).unwrap();
        assert_eq!(merged["color"], "#111111");
        assert_eq!(merged["collapsed"], true);
        fs::remove_file(a.join("notes/two.json")).unwrap();
        sync(&a, &p);
        sync(&b, &p);
        assert!(!b.join("notes/two.json").exists());
        // Save while networking: activation must not overwrite the later input.
        atomic_write(&a.join("notes/one.json"), br#"{"text":"remote"}"#).unwrap();
        sync(&a, &p);
        let prepared = prepare(&b, &p, snapshot(&b).unwrap()).unwrap();
        atomic_write(&b.join("notes/one.json"), br#"{"text":"new local input"}"#).unwrap();
        apply(&b, &prepared.id).unwrap();
        assert_eq!(
            fs::read(b.join("notes/one.json")).unwrap(),
            br#"{"text":"new local input"}"#
        );
        sync(&b, &p);
        sync(&a, &p);
        assert_eq!(snapshot(&a).unwrap(), snapshot(&b).unwrap());
        assert!(snapshot(&a)
            .unwrap()
            .keys()
            .any(|s| s.starts_with(crate::sync_history::PREFIX)));
        // Idle checks do not generate new commits.
        let head = git(&remote, &["rev-parse", "refs/heads/main"], "").unwrap();
        sync(&a, &p);
        sync(&b, &p);
        assert_eq!(
            head,
            git(&remote, &["rev-parse", "refs/heads/main"], "").unwrap()
        );
    }
    #[test]
    fn downloaded_commit_is_reused_when_previous_activation_was_interrupted() {
        let temp = tempfile::tempdir().unwrap();
        let remote = temp.path().join("remote.git");
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet"], "").unwrap();
        let p = Preferences {
            github_sync_enabled: true,
            github_repo_url: remote.to_str().unwrap().into(),
            ..Preferences::default()
        };
        let a = temp.path().join("a");
        let b = temp.path().join("b");
        let _a = Store::open(temp.path().join("ca"), a.clone()).unwrap();
        let _b = Store::open(temp.path().join("cb"), b.clone()).unwrap();
        sync(&a, &p);
        sync(&b, &p);
        atomic_write(&a.join("new-device.txt"), b"new data").unwrap();
        sync(&a, &p);
        let pending = prepare(&b, &p, snapshot(&b).unwrap()).unwrap();
        assert!(!b.join("new-device.txt").exists());
        let repo = fs::read_dir(b.join(".workstore"))
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("sync-repository-")
            })
            .unwrap();
        let sha = git(&repo, &["rev-parse", "refs/remotes/origin/main"], "").unwrap();
        // Simulate another transfer being unavailable after objects arrived.
        git(
            &repo,
            &[
                "remote",
                "set-url",
                "origin",
                temp.path().join("offline.git").to_str().unwrap(),
            ],
            "",
        )
        .unwrap();
        ensure_remote_commit(&repo, "main", sha.trim(), "").unwrap();
        apply(&b, &pending.id).unwrap();
        assert_eq!(fs::read(b.join("new-device.txt")).unwrap(), b"new data");
    }
    #[test]
    fn failed_connection_and_invalid_remote_leave_local_files_unchanged() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("local");
        let _store = Store::open(temp.path().join("config"), root.clone()).unwrap();
        atomic_write(&root.join("custom/keep.txt"), b"keep me").unwrap();
        let before = snapshot(&root).unwrap();
        let mut p = Preferences {
            github_sync_enabled: true,
            github_repo_url: temp.path().join("missing.git").to_str().unwrap().into(),
            ..Preferences::default()
        };
        assert!(prepare(&root, &p, before.clone()).is_err());
        assert_eq!(before, snapshot(&root).unwrap());
        let remote = temp.path().join("bad");
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "-b", "main"], "").unwrap();
        git(&remote, &["config", "user.name", "test"], "").unwrap();
        git(&remote, &["config", "user.email", "test@localhost"], "").unwrap();
        fs::write(remote.join("README"), "not a workspace").unwrap();
        git(&remote, &["add", "."], "").unwrap();
        git(&remote, &["commit", "-m", "init"], "").unwrap();
        p.github_repo_url = remote.to_str().unwrap().into();
        assert!(prepare(&root, &p, before.clone()).is_err());
        assert_eq!(before, snapshot(&root).unwrap());
    }
    #[test]
    fn conflicting_document_content_keeps_one_visible_document_and_exact_history() {
        use base64::Engine;
        let id = Uuid::new_v4().to_string();
        let name = format!("data/app.doc/{id}.doc.json");
        let base = serde_json::json!({"id":id,"type":"workstore.document","schemaVersion":1,"title":"Title","content":"original"});
        let mut local = base.clone(); local["content"] = Value::from("local");
        let mut remote = base.clone(); remote["content"] = Value::from("remote");
        let wrap = |v: &Value| BTreeMap::from([(name.clone(), serde_json::to_vec(v).unwrap())]);
        let (merged, count) = merge(&wrap(&base), &wrap(&local), &wrap(&remote), false);
        assert_eq!(count, 1);
        assert_eq!(merged.keys().filter(|p|p.starts_with("data/")).count(), 1);
        assert_eq!(serde_json::from_slice::<Value>(&merged[&name]).unwrap()["content"],"remote");
        assert_eq!(merged, merge(&wrap(&base), &wrap(&local), &wrap(&remote), false).0);
        let versions: Vec<Value> = merged.iter().filter(|(p,_)|p.starts_with(crate::sync_history::PREFIX))
            .map(|(_,bytes)| {
                let v: Value = serde_json::from_slice(bytes).unwrap();
                let raw = base64::engine::general_purpose::STANDARD.decode(v["contentBase64"].as_str().unwrap()).unwrap();
                serde_json::from_slice(&raw).unwrap()
            }).collect();
        assert!(versions.contains(&base)); assert!(versions.contains(&local)); assert!(versions.contains(&remote));
    }
    #[test]
    fn independent_document_fields_merge_without_extra_document_or_history() {
        let id = Uuid::new_v4().to_string();
        let path = format!("data/app.doc/{id}.doc.json");
        let base = serde_json::json!({"id":id,"type":"workstore.document","schemaVersion":1,"title":"Title","content":"original","favorite":false});
        let mut local = base.clone(); local["content"] = "changed".into();
        let mut remote = base.clone(); remote["favorite"] = true.into();
        let wrap = |v: &Value| Files::from([(path.clone(),serde_json::to_vec(v).unwrap())]);
        let (files,count) = merge(&wrap(&base),&wrap(&local),&wrap(&remote),false);
        assert_eq!(count,0); assert_eq!(files.len(),1);
        let value: Value=serde_json::from_slice(&files[&path]).unwrap();
        assert_eq!(value["content"],"changed"); assert_eq!(value["favorite"],true);
    }
    #[test]
    fn local_conflict_migration_preserves_baseline_and_is_idempotent() {
        let dir=tempfile::tempdir().unwrap(); let root=dir.path().join("data");
        let store=Store::open(dir.path().join("config"),root.clone()).unwrap();
        let doc=store.create_document().unwrap();
        let primary=format!("data/app.doc/{}.doc.json",doc.document.info.id);
        let bytes=fs::read(root.join(&primary)).unwrap();
        let (copy,copy_bytes)=legacy_conflict_copy(&primary,&bytes);
        atomic_write(&root.join(&copy),&copy_bytes).unwrap();
        let before=snapshot(&root).unwrap();
        json_write(&root.join(".workstore/sync-base.json"),&Baseline{identity:"fixture".into(),files:before.clone()}).unwrap();
        assert_eq!(reconcile_history(&root).unwrap(),1);
        assert!(!root.join(copy).exists()); assert_eq!(fs::read(root.join(&primary)).unwrap(),bytes);
        assert_eq!(store.list_documents().unwrap().documents.len(),1);
        let baseline:Baseline=serde_json::from_slice(&fs::read(root.join(".workstore/sync-base.json")).unwrap()).unwrap();
        assert_eq!(baseline.files,before);
        assert_eq!(reconcile_history(&root).unwrap(),0);
        assert!(maintain_history(&root).is_err(),"maintenance must not touch an open workspace");
    }
    #[test]
    fn all_tool_conflicts_archive_content_without_new_visible_ids() {
        for (tool,suffix,kind,key,old,l,r) in [
            ("app.whiteboard","whiteboard","workstore.whiteboard","scene",serde_json::json!({"elements":[]}),serde_json::json!({"elements":[{"id":"a","text":"local"}]}),serde_json::json!({"elements":[{"id":"a","text":"remote"}]})),
            ("app.comic","comic","workstore.comic","pages",serde_json::json!([]),serde_json::json!([{"id":"page","text":"local"}]),serde_json::json!([{"id":"page","text":"remote"}]))
        ] {
            let id=Uuid::new_v4().to_string(); let path=format!("data/{tool}/{id}.{suffix}.json");
            let base=serde_json::json!({"id":id,"type":kind,"schemaVersion":1,"title":"Title",key:old});
            let mut local=base.clone(); local[key]=l;
            let mut remote=base.clone(); remote[key]=r;
            let wrap=|v:&Value|Files::from([(path.clone(),serde_json::to_vec(v).unwrap())]);
            let (files,count)=merge(&wrap(&base),&wrap(&local),&wrap(&remote),false);
            assert_eq!(count,1);
            assert_eq!(files.keys().filter(|p|p.starts_with("data/")).count(),1);
            assert_eq!(serde_json::from_slice::<Value>(&files[&path]).unwrap()[key],remote[key]);
            assert!(files.keys().any(|p|p.starts_with(crate::sync_history::PREFIX)));
        }
    }
    #[test]
    fn deletion_conflict_preserves_exact_local_content_and_history_is_append_only() {
        let base=Files::from([("notes/test.txt".into(),b"base".to_vec())]);
        let local=Files::from([("notes/test.txt".into(),b"important unsynced edit".to_vec())]);
        let (files,count)=merge(&base,&local,&Files::new(),false);
        assert_eq!(count,1); assert!(!files.contains_key("notes/test.txt"));
        assert_eq!(merge(&files,&files,&Files::new(),false).0,files);
    }
    #[test]
    fn legacy_retirement_and_new_conflicts_converge_over_git_without_visible_copies() {
        let dir=tempfile::tempdir().unwrap(); let remote=dir.path().join("remote.git");
        fs::create_dir_all(&remote).unwrap(); git(&remote,&["init","--bare","--quiet"],"").unwrap();
        let a=dir.path().join("a"); let b=dir.path().join("b");
        let sa=Store::open(dir.path().join("ca"),a.clone()).unwrap();
        let sb=Store::open(dir.path().join("cb"),b.clone()).unwrap();
        let doc=sa.create_document().unwrap(); let id=doc.document.info.id;
        let path=format!("data/app.doc/{id}.doc.json");
        let mut p=Preferences::default(); p.github_repo_url=remote.to_str().unwrap().into(); p.github_sync_enabled=true;
        sync(&a,&p); sync(&b,&p);
        let mut local:Value=serde_json::from_slice(&fs::read(a.join(&path)).unwrap()).unwrap();
        let mut other=local.clone(); local["content"]="version A".into(); other["content"]="version B".into();
        json_write(&a.join(&path),&local).unwrap(); json_write(&b.join(&path),&other).unwrap();
        sync(&a,&p); sync(&b,&p); sync(&a,&p);
        assert_eq!(sa.list_documents().unwrap().documents.len(),1);
        assert_eq!(sb.list_documents().unwrap().documents.len(),1);
        assert_eq!(snapshot(&a).unwrap(),snapshot(&b).unwrap());
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(a.join(&path)).unwrap()).unwrap()["content"],"version A");
        let (copy,bytes)=legacy_conflict_copy(&path,&serde_json::to_vec(&other).unwrap());
        atomic_write(&a.join(&copy),&bytes).unwrap(); sync(&a,&p); sync(&b,&p);
        assert!(!a.join(&copy).exists()); assert!(!b.join(&copy).exists());
        assert_eq!(snapshot(&a).unwrap(),snapshot(&b).unwrap());
        // An old peer can resend an edited former copy: retire it again but
        // preserve those new bytes in the Git-tracked history.
        let mut edited:Value=serde_json::from_slice(&bytes).unwrap(); edited["content"]="late old-device edit".into();
        json_write(&b.join(&copy),&edited).unwrap(); sync(&b,&p); sync(&a,&p);
        assert!(!b.join(&copy).exists()); assert_eq!(snapshot(&a).unwrap(),snapshot(&b).unwrap());
        assert_eq!(sa.list_documents().unwrap().documents.len(),1);
        let before=snapshot(&a).unwrap(); sync(&a,&p); assert_eq!(before,snapshot(&a).unwrap());
    }

    #[test]
    fn interrupted_retirement_recovers_archives_before_removing_visible_copy() {
        let dir=tempfile::tempdir().unwrap(); let root=dir.path().join("data");
        let store=Store::open(dir.path().join("config"),root.clone()).unwrap();
        let doc=store.create_document().unwrap();
        let primary=format!("data/app.doc/{}.doc.json",doc.document.info.id);
        let (copy,bytes)=legacy_conflict_copy(&primary,&fs::read(root.join(&primary)).unwrap());
        atomic_write(&root.join(&copy),&bytes).unwrap();
        let mut next=snapshot(&root).unwrap(); crate::sync_history::normalize(&mut next);
        json_write(&root.join(".workstore/sync-recovery.json"),&Recovery{files:next.clone(),baseline:Baseline::default()}).unwrap();
        recover(&root).unwrap();
        assert_eq!(snapshot(&root).unwrap(),next); assert!(!root.join(&copy).exists());
        recover(&root).unwrap(); assert_eq!(snapshot(&root).unwrap(),next);
        // Do not delete a user's copy if a would-be archive write is invalid.
        atomic_write(&root.join(&copy),&bytes).unwrap();
        let path=next.keys().find(|p|p.starts_with(crate::sync_history::PREFIX)).unwrap().clone();
        next.insert(path,b"corrupt".to_vec());
        json_write(&root.join(".workstore/sync-recovery.json"),&Recovery{files:next,baseline:Baseline::default()}).unwrap();
        assert!(recover(&root).is_err()); assert_eq!(fs::read(root.join(copy)).unwrap(),bytes);
    }
    #[test]
    fn edits_saved_during_network_are_preserved_when_retiring_an_old_copy() {
        use base64::Engine;
        let dir=tempfile::tempdir().unwrap(); let root=dir.path().join("data");
        let store=Store::open(dir.path().join("config"),root.clone()).unwrap();
        let doc=store.create_document().unwrap(); let primary=format!("data/app.doc/{}.doc.json",doc.document.info.id);
        let (copy,bytes)=legacy_conflict_copy(&primary,&fs::read(root.join(&primary)).unwrap());
        atomic_write(&root.join(&copy),&bytes).unwrap();
        let captured=snapshot(&root).unwrap(); let mut merged=captured.clone(); crate::sync_history::normalize(&mut merged);
        json_write(&root.join(".workstore/sync-prepared.json"),&Prepared{id:"retirement".into(),root:root.to_str().unwrap().into(),captured,merged,conflicts:0,identity:"fixture".into()}).unwrap();
        let mut edited:Value=serde_json::from_slice(&bytes).unwrap(); edited["content"]="typed during network".into();
        let latest=serde_json::to_vec_pretty(&edited).unwrap(); atomic_write(&root.join(&copy),&latest).unwrap();
        let applied=apply(&root,"retirement").unwrap(); assert!(applied.changed.contains(&copy));
        let files=snapshot(&root).unwrap(); assert!(!files.contains_key(&copy));
        assert!(files.iter().filter(|(p,_)|p.starts_with(crate::sync_history::PREFIX)).any(|(_,bytes)| {
            let v:Value=serde_json::from_slice(bytes).unwrap();
            base64::engine::general_purpose::STANDARD.decode(v["contentBase64"].as_str().unwrap()).unwrap()==latest
        }));
    }
    #[test]
    fn recovery_completes_files_and_baseline_as_one_transaction() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("data");
        let _s = Store::open(t.path().join("config"), root.clone()).unwrap();
        let mut files = snapshot(&root).unwrap();
        files.insert("keep.json".into(), b"true".to_vec());
        let tx = Recovery {
            files: files.clone(),
            baseline: Baseline {
                identity: "test".into(),
                files: files.clone(),
            },
        };
        json_write(&root.join(".workstore/sync-recovery.json"), &tx).unwrap();
        recover(&root).unwrap();
        assert_eq!(snapshot(&root).unwrap(), files);
        assert!(!root.join(".workstore/sync-recovery.json").exists());
        let baseline: Baseline =
            serde_json::from_slice(&fs::read(root.join(".workstore/sync-base.json")).unwrap())
                .unwrap();
        assert_eq!(baseline.files, files);
    }
}
