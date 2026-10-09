#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod comic_catalog;
mod cover_previews;
mod ai_images;
mod ai;
mod documents;
mod html;
mod covers;
mod courses;
mod course_animation;
mod ai_speech;
mod design;
mod story_comics;
mod html_runtime;
mod xiaohongshu;
mod comics;
use comics::{Comic, ComicList, LoadedComic};
mod preferences;
mod list_projects;
mod storage;
mod sync;
mod sync_bytes;
mod sync_history;
mod whiteboard;
use documents::{Document, DocumentList, LoadedDocument};
use std::{path::PathBuf, sync::Mutex};
use storage::{Data, Snapshot, Store};
use tauri::{Emitter, Manager};
use whiteboard::{Board, BoardList, LoadedBoard};
struct Workspace(Mutex<Option<Store>>);
struct SyncWorker(Mutex<()>);
// File I/O and mutex waits must never run on the desktop event thread.
async fn file_operation<T: Send + 'static>(operation: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation).await.map_err(|error| error.to_string())?
}
#[tauri::command]
async fn list_projects(tool_id: String, app: tauri::AppHandle) -> Result<list_projects::ProjectData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot.as_ref().ok_or("工作空间尚未打开")?.list_projects(&tool_id)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn update_list_project(tool_id: String, operation: list_projects::Operation, app: tauri::AppHandle) -> Result<list_projects::ProjectData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot.as_ref().ok_or("工作空间尚未打开")?.update_list_project(&tool_id, operation)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn load_workspace(app: tauri::AppHandle) -> Result<Snapshot, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
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
    }).await
}
#[tauri::command]
async fn save_workspace(data: Data, app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_mut()
            .ok_or("工作空间尚未打开")?
            .save(data)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn relocate_workspace(target: PathBuf, app: tauri::AppHandle) -> Result<Snapshot, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_mut()
            .ok_or("工作空间尚未打开")?
            .relocate(target)
    }).await
}
#[tauri::command]
async fn list_comics(app: tauri::AppHandle) -> Result<ComicList, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .list_comics()
    }).await
}
#[tauri::command]
async fn create_comic(content: serde_json::Value, app: tauri::AppHandle) -> Result<LoadedComic, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .create_comic(content)
    }).await
}
#[tauri::command]
async fn load_comic(id: String, app: tauri::AppHandle) -> Result<LoadedComic, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .load_comic(&id)
    }).await
}
#[tauri::command]
async fn save_comic(
    comic: Comic,
    expected_token: String,
    app: tauri::AppHandle,
) -> Result<LoadedComic, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .save_comic(comic, expected_token)
    }).await
}
#[tauri::command]
async fn list_whiteboards(app: tauri::AppHandle) -> Result<BoardList, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .list_boards()
    }).await
}
#[tauri::command]
async fn list_documents(app: tauri::AppHandle) -> Result<DocumentList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .list_documents()
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn create_whiteboard(app: tauri::AppHandle) -> Result<LoadedBoard, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .create_board()
    }).await
}
#[tauri::command]
async fn load_whiteboard(id: String, app: tauri::AppHandle) -> Result<LoadedBoard, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .load_board(&id)
    }).await
}
#[tauri::command]
async fn save_html_export(path: String, content: String) -> Result<(), String> {
    file_operation(move || {
        if content.len() > 64 * 1024 * 1024 { return Err("导出超过 64 MB".into()); }
        storage::atomic_write(std::path::Path::new(&path), content.as_bytes())
    }).await
}
#[tauri::command]
async fn list_html_documents(app: tauri::AppHandle) -> Result<html::DocumentList, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .list_html_documents()
    }).await
}
#[tauri::command]
async fn create_html_document(app: tauri::AppHandle) -> Result<html::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .create_html_document()
    }).await
}
#[tauri::command]
async fn load_html_document(id: String, app: tauri::AppHandle) -> Result<html::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .load_html_document(&id)
    }).await
}
#[tauri::command]
async fn save_html_document(
    document: html::Document,
    expected_token: String,
    app: tauri::AppHandle,
) -> Result<html::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .save_html_document(document, expected_token)
    }).await
}
#[tauri::command]
async fn list_cover_documents(app: tauri::AppHandle) -> Result<covers::DocumentList, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .list_cover_documents()
    }).await
}
#[tauri::command]
async fn create_cover_document(app: tauri::AppHandle) -> Result<covers::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .create_cover_document()
    }).await
}
#[tauri::command]
async fn load_cover_document(id: String, app: tauri::AppHandle) -> Result<covers::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .load_cover_document(&id)
    }).await
}
#[tauri::command]
async fn save_cover_document(
    document: covers::Document,
    expected_token: String,
    app: tauri::AppHandle,
) -> Result<covers::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .save_cover_document(document, expected_token)
    }).await
}
#[tauri::command]
async fn list_design_documents(app: tauri::AppHandle) -> Result<design::DocumentList, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .list_design_documents()
    }).await
}
#[tauri::command]
async fn create_design_document(app: tauri::AppHandle) -> Result<design::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .create_design_document()
    }).await
}
#[tauri::command]
async fn load_design_document(id: String, app: tauri::AppHandle) -> Result<design::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .load_design_document(&id)
    }).await
}
#[tauri::command]
async fn save_design_document(
    document: design::Document,
    expected_token: String,
    app: tauri::AppHandle,
) -> Result<design::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .save_design_document(document, expected_token)
    }).await
}
#[tauri::command]
async fn list_story_comic_documents(app: tauri::AppHandle) -> Result<story_comics::DocumentList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .list_story_comic_documents()
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn create_story_comic_document(app: tauri::AppHandle) -> Result<story_comics::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .create_story_comic_document()
    }).await
}
#[tauri::command]
async fn load_story_comic_document(id: String, app: tauri::AppHandle) -> Result<story_comics::LoadedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .load_story_comic_document(&id)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn delete_story_comic_document(app: tauri::AppHandle, id: String, expected_token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot.as_ref().ok_or("工作空间尚未打开")?.delete_story_comic_document(&id, &expected_token)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_story_comic_document(
    document: story_comics::Document,
    expected_token: String,
    app: tauri::AppHandle,
) -> Result<story_comics::LoadedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .save_story_comic_document(document, expected_token)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn list_course_documents(app: tauri::AppHandle) -> Result<courses::DocumentList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .list_course_documents()
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn create_course_document(app: tauri::AppHandle) -> Result<courses::LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .create_course_document()
    }).await
}
#[tauri::command]
async fn load_course_document(id: String, app: tauri::AppHandle) -> Result<courses::LoadedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .load_course_document(&id)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn delete_course_document(app: tauri::AppHandle, id: String, expected_token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot.as_ref().ok_or("工作空间尚未打开")?.delete_course_document(&id, &expected_token)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_course_document(
    document: courses::Document,
    expected_token: String,
    app: tauri::AppHandle,
) -> Result<courses::LoadedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .save_course_document(document, expected_token)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn create_document(app: tauri::AppHandle) -> Result<LoadedDocument, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .create_document()
    }).await
}
#[tauri::command]
async fn load_document(id: String, app: tauri::AppHandle) -> Result<LoadedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .load_document(&id)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_document(
    document: Document,
    expected_token: String,
    app: tauri::AppHandle,
) -> Result<LoadedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot.as_ref().ok_or("工作空间尚未打开")?
            .save_document(document, expected_token)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn delete_document(id: String, expected_token: String, app: tauri::AppHandle) -> Result<(), String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot.as_ref()
            .ok_or("工作空间尚未打开")?.delete_document(&id, &expected_token)
    }).await
}
#[tauri::command]
async fn save_whiteboard(
    document: Board,
    expected_token: String,
    app: tauri::AppHandle,
) -> Result<LoadedBoard, String> {
    file_operation(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        slot
            .as_ref()
            .ok_or("工作空间尚未打开")?
            .save_board(document, expected_token)
    }).await
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
async fn receive_note_additions(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let worker = app.state::<SyncWorker>();
        let _guard = worker.0.try_lock().map_err(|_| "同步正在进行")?;
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        let store = slot.as_ref().ok_or("工作空间尚未打开")?;
        sync::receive_note_additions(store.root_path(), &id)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn pending_conversation_records(app: tauri::AppHandle, id: String) -> Result<Vec<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspace>();
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        sync::pending_conversation_records(slot.as_ref().ok_or("工作空间尚未打开")?.root_path(), &id)
    }).await.map_err(|e| e.to_string())?
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
        .manage(course_animation::Jobs::default())
        .register_asynchronous_uri_scheme_protocol("course-media",|ctx,request,responder|{let app=ctx.app_handle().clone();std::thread::spawn(move||responder.respond(course_animation::serve(&app,request)));})
        .manage(html_runtime::HtmlRuntime::default())
        .manage(xiaohongshu::Publisher::default())
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
            list_projects,
            update_list_project,
            load_preferences,
            save_preferences,
            save_workspace,
            relocate_workspace,
            quit_ready,
            list_whiteboards,
            list_documents,
            xiaohongshu::xhs_connect,
            xiaohongshu::xhs_publish,
            html_runtime::html_original_start,
            html_runtime::html_original_cancel,
            html_runtime::html_original_backup,
            html_runtime::html_original_export,
            list_course_documents,
            create_course_document,
            load_course_document,
            save_course_document,
            delete_course_document,
            courses::save_course_export,
            course_animation::prepare_course_animation,
            course_animation::render_course_animation,
            course_animation::inspect_course_whiteboard_image,
            course_animation::prepare_course_whiteboard,
            course_animation::render_course_whiteboard,
            course_animation::cancel_course_animation,
            course_animation::export_course_media,
            list_story_comic_documents,
            create_story_comic_document,
            load_story_comic_document,
            save_story_comic_document,
            delete_story_comic_document,
            story_comics::save_story_comic_export,
            story_comics::open_story_comic_print_dialog,
            story_comics::save_story_comic_image,
            list_cover_documents,
            create_cover_document,
            load_cover_document,
            save_cover_document,
            covers::save_cover_export,
            list_design_documents,
            create_design_document,
            load_design_document,
            save_design_document,
            design::save_design_export,
            design::save_design_image,
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
            delete_document,
            load_whiteboard,
            save_whiteboard,
            sync_workspace,
            finish_sync,
            receive_note_additions,
            pending_conversation_records,
            updater_configured,
            ai::ai_settings,
            ai::ai_capabilities,
            ai::ai_save_settings,
            ai::ai_generate,
            ai_images::ai_read_image,
            cover_previews::cover_preview,
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
            if matches!(event, tauri::RunEvent::Exit) { html_runtime::shutdown(app); xiaohongshu::shutdown(app); }
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

#[cfg(test)]
mod file_operation_tests {
    #[test]
    fn waiting_for_a_file_lock_does_not_block_async_dispatch() {
        use std::sync::{Arc, Mutex, mpsc};
        let lock = Arc::new(Mutex::new(()));
        let held = lock.lock().unwrap();
        let worker_lock = lock.clone();
        let (started, received) = mpsc::channel();
        let blocked = tauri::async_runtime::spawn(async move {
            super::file_operation(move || {
                started.send(()).unwrap();
                let _guard = worker_lock.lock().unwrap();
                Ok(())
            }).await
        });
        received.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        let (sent, responsive) = mpsc::channel();
        tauri::async_runtime::spawn(async move { sent.send(()).unwrap(); });
        responsive.recv_timeout(std::time::Duration::from_secs(2)).expect("file lock blocked async dispatch");
        drop(held);
        tauri::async_runtime::block_on(blocked).unwrap().unwrap();
    }
}
