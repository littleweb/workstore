//! Shared local neural speech environment. Text and image providers stay unchanged.
use tauri::AppHandle;
use std::process::Command;

pub fn configure(app: &AppHandle, command: &mut Command) -> Result<(), String> {
    let runtime = crate::course_animation::whiteboard_runtime(app)?;
    if !runtime.join("speech/speech.py").is_file() {
        return Err("自然中文配音组件缺失，请安装完整应用".into());
    }
    command.env("WORKSTORE_AI_SPEECH", runtime);
    Ok(())
}
