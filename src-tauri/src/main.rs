#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod comic_catalog;
mod ai_images;
mod ai;
mod documents;
mod html;
mod html_runtime;
mod comics;
use comics::{Comic, ComicList, LoadedComic};
mod preferences;
mod storage;
mod sync;
mod sync_history;
mod whiteboard;
use documents::{Document, DocumentList, LoadedDocument};
use std::{path::PathBuf, sync::Mutex};
use storage::{Data, Snapshot, Store};
use tauri::{Emitter, Manager};
use whiteboard::{Board, BoardList, LoadedBoard};
struct Workspace(Mutex<Option<Store>>);
struct SyncWorker(Mutex<()>);
#[tauri::command]
fn load_workspace(
    app: tauri::AppHandle,
    state: tauri::State<Workspace>,
) -> Result<Snapshot, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_none() {
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let default = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("workspace");
        let legacy = app
            .path()
            .document_dir()
            .or_else(|_| app.path().home_dir())
            .map_err(|e| e.to_string())?
            .join("WorkStore");
        *slot = Some(Store::open_default(config, default, legacy)?);
    }
    slot.as_ref().ok_or("工作空间尚未打开")?.snapshot()
}
#[tauri::command]
fn save_workspace(data: Data, state: tauri::State<Workspace>) -> Result<bool, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_mut()
        .ok_or("工作空间尚未打开")?
        .save(data)
}
#[tauri::command]
fn relocate_workspace(target: PathBuf, state: tauri::State<Workspace>) -> Result<Snapshot, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_mut()
        .ok_or("工作空间尚未打开")?
        .relocate(target)
}
#[tauri::command]
fn list_comics(state: tauri::State<Workspace>) -> Result<ComicList, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .list_comics()
}
#[tauri::command]
fn create_comic(content: serde_json::Value, state: tauri::State<Workspace>) -> Result<LoadedComic, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .create_comic(content)
}
#[tauri::command]
fn load_comic(id: String, state: tauri::State<Workspace>) -> Result<LoadedComic, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .load_comic(&id)
}
#[tauri::command]
fn save_comic(
    comic: Comic,
    expected_token: String,
    state: tauri::State<Workspace>,
) -> Result<LoadedComic, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .save_comic(comic, expected_token)
}
#[tauri::command]
fn list_whiteboards(state: tauri::State<Workspace>) -> Result<BoardList, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .list_boards()
}
#[tauri::command]
fn list_documents(state: tauri::State<Workspace>) -> Result<DocumentList, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .list_documents()
}
#[tauri::command]
fn create_whiteboard(state: tauri::State<Workspace>) -> Result<LoadedBoard, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .create_board()
}
#[tauri::command]
fn load_whiteboard(id: String, state: tauri::State<Workspace>) -> Result<LoadedBoard, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .load_board(&id)
}
#[tauri::command]
fn save_html_export(path: String, content: String) -> Result<(), String> {
    if content.len() > 64 * 1024 * 1024 { return Err("导出超过 64 MB".into()); }
    storage::atomic_write(std::path::Path::new(&path), content.as_bytes())
}
#[tauri::command]
fn list_html_documents(state: tauri::State<Workspace>) -> Result<html::DocumentList, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .list_html_documents()
}
#[tauri::command]
fn create_html_document(state: tauri::State<Workspace>) -> Result<html::LoadedDocument, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .create_html_document()
}
#[tauri::command]
fn load_html_document(id: String, state: tauri::State<Workspace>) -> Result<html::LoadedDocument, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .load_html_document(&id)
}
#[tauri::command]
fn save_html_document(
    document: html::Document,
    expected_token: String,
    state: tauri::State<Workspace>,
) -> Result<html::LoadedDocument, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .save_html_document(document, expected_token)
}
#[tauri::command]
fn create_document(state: tauri::State<Workspace>) -> Result<LoadedDocument, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .create_document()
}
#[tauri::command]
fn load_document(id: String, state: tauri::State<Workspace>) -> Result<LoadedDocument, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .load_document(&id)
}
#[tauri::command]
fn save_document(
    document: Document,
    expected_token: String,
    state: tauri::State<Workspace>,
) -> Result<LoadedDocument, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .save_document(document, expected_token)
}
#[tauri::command]
fn save_whiteboard(
    document: Board,
    expected_token: String,
    state: tauri::State<Workspace>,
) -> Result<LoadedBoard, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("工作空间尚未打开")?
        .save_board(document, expected_token)
}
#[tauri::command]
fn quit_ready(app: tauri::AppHandle) {
    app.exit(0)
}
#[tauri::command]
fn load_preferences(app: tauri::AppHandle) -> Result<preferences::Preferences, String> {
    preferences::load(&app.path().app_config_dir().map_err(|e| e.to_string())?)
}
#[tauri::command]
fn save_preferences(
    app: tauri::AppHandle,
    preferences: preferences::Preferences,
) -> Result<(), String> {
    preferences::save(
        &app.path().app_config_dir().map_err(|e| e.to_string())?,
        &preferences,
    )
}
#[tauri::command]
async fn sync_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let worker = app.state::<SyncWorker>();
        let _guard = worker.0.try_lock().map_err(|_| "同步正在进行")?;
        let preferences =
            preferences::load(&app.path().app_config_dir().map_err(|e| e.to_string())?)?;
        if !preferences.github_sync_enabled {
            return Ok(None);
        }
        let (path, files) = {
            let state = app.state::<Workspace>();
            let slot = state.0.lock().map_err(|e| e.to_string())?;
            let store = slot.as_ref().ok_or("工作空间尚未打开")?;
            (
                store.root_path().to_path_buf(),
                sync::snapshot(store.root_path())?,
            )
        };
        sync::prepare(&path, &preferences, files).map(|prepared| Some(prepared.id))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn finish_sync(app: tauri::AppHandle, id: String) -> Result<sync::Applied, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let worker = app.state::<SyncWorker>();
        let _guard = worker.0.try_lock().map_err(|_| "同步正在进行")?;
        let state = app.state::<Workspace>();
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        let store = slot.as_mut().ok_or("工作空间尚未打开")?;
        let result = sync::apply(store.root_path(), &id)?;
        store.refresh_disk()?;
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn updater_configured(app: tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater").is_some_and(|config| {
        config["pubkey"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty())
            && config["endpoints"]
                .as_array()
                .is_some_and(|v| !v.is_empty())
    })
}

fn application_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|arg| arg == "--maintain-sync-history") {
        let result = if args.len() == 3 {
            sync::maintain_history(&PathBuf::from(&args[2]))
        } else { Err("用法：--maintain-sync-history <workspace>".into()) };
        match result {
            Ok(count) => println!("整理完成：{count} 份可见冲突版本已安全转入后台历史"),
            Err(error) => { eprintln!("{error}"); std::process::exit(1); }
        }
        return;
    }
    tauri::Builder::default()
        .manage(html_runtime::HtmlRuntime::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            app.manage(Workspace(Mutex::new(None)));
            app.manage(SyncWorker(Mutex::new(())));
            app.manage(ai::Runtime::default());
            let ai_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = ai::initialize(ai_app).await {
                    eprintln!("AI 自动配置未完成：{error}");
                }
            });
            let config = app.path().app_config_dir()?;
            let preferences = preferences::load(&config).unwrap_or_else(|e| {
                eprintln!("无法读取启动配置：{e}");
                preferences::Preferences::default()
            });
            if let Some(window) = app.get_webview_window("main") {
                if preferences.maximize_on_start {
                    window.maximize()?;
                }
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            load_preferences,
            save_preferences,
            save_workspace,
            relocate_workspace,
            quit_ready,
            list_whiteboards,
            list_documents,
            html_runtime::html_original_start,
            html_runtime::html_original_cancel,
            html_runtime::html_original_backup,
            html_runtime::html_original_export,
            list_html_documents,
            create_html_document,
            load_html_document,
            save_html_document,
            save_html_export,
            list_comics,
            create_comic,
            load_comic,
            save_comic,
            create_whiteboard,
            create_document,
            load_document,
            save_document,
            load_whiteboard,
            save_whiteboard,
            sync_workspace,
            finish_sync,
            updater_configured,
            ai::ai_settings,
            ai::ai_capabilities,
            ai::ai_save_settings,
            ai::ai_generate,
            ai_images::ai_read_image,
            comic_catalog::comic_template_catalog,
            comic_catalog::comic_template_activate,
            comics::save_comic_export,
            ai::ai_cancel,
            ai::ai_history,
            ai::ai_codex_status
        ])
        .build(application_context())
        .expect("WorkStore failed to start; your existing files have not been overwritten")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) { html_runtime::shutdown(app); }
            if let tauri::RunEvent::ExitRequested {
                api, code: None, ..
            } = event
            {
                if app.get_webview_window("main").is_some() {
                    api.prevent_exit();
                    let _ = app.emit("workspace-quit", ());
                }
            }
        });
}

#[cfg(test)]
mod window_config_tests {
    #[test]
    fn main_window_preserves_first_click_and_web_drag_handling() {
        // Exercise Tauri's actual platform merge, not just the base JSON. Arrays
        // in tauri.macos.conf.json replace their base counterparts wholesale.
        let context = super::application_context();
        let main = context
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .expect("main window must be configured");
        assert!(main.accept_first_mouse, "the first click must reach the webview");
        assert!(!main.drag_drop_enabled, "web tools own their drag interactions");
    }
}
