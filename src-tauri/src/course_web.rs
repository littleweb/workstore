use std::{collections::VecDeque,sync::Mutex};
use tauri::Manager;
#[derive(Default)]
pub struct Previews(Mutex<VecDeque<(String,String)>>);
const CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; worker-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts";
fn validate_html(html:&str)->Result<(),String>{if html.len()>2*1024*1024||!html.trim_start().to_ascii_lowercase().starts_with("<!doctype html")||!html.to_ascii_lowercase().contains("</html>"){return Err("交互网页预览内容无效".into());}Ok(())}
#[tauri::command]
pub fn preview_course_web(app:tauri::AppHandle,html:String)->Result<String,String>{validate_html(&html)?;let id=uuid::Uuid::new_v4().to_string();let previews=app.state::<Previews>();let mut list=previews.0.lock().map_err(|_|"预览暂时不可用")?;list.push_back((id.clone(),html));while list.len()>24{list.pop_front();}Ok(id)}
#[tauri::command]
pub fn release_course_web_preview(app:tauri::AppHandle,id:String){let previews=app.state::<Previews>();if let Ok(mut list)=previews.0.lock(){list.retain(|(key,_)|key!=&id);};}
pub fn serve(app:&tauri::AppHandle,request:tauri::http::Request<Vec<u8>>)->tauri::http::Response<Vec<u8>>{let id=request.uri().path().trim_start_matches('/');let body=if request.method()==tauri::http::Method::GET&&uuid::Uuid::parse_str(id).is_ok(){app.state::<Previews>().0.lock().ok().and_then(|list|list.iter().find(|(key,_)|key==id).map(|(_,html)|html.clone()))}else{None};tauri::http::Response::builder().status(if body.is_some(){200}else{404}).header("Content-Type","text/html; charset=utf-8").header("Content-Security-Policy",CSP).header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").body(body.unwrap_or_else(||"预览已关闭".into()).into_bytes()).unwrap()}
#[cfg(test)]mod tests{use super::*;#[test]fn bounded_complete_html_and_opaque_policy(){assert!(validate_html("<!DOCTYPE html><html></html>").is_ok());assert!(validate_html("<script>alert(1)</script>").is_err());assert!(validate_html(&"x".repeat(2*1024*1024+1)).is_err());assert!(CSP.contains("connect-src 'none'"));assert!(CSP.contains("sandbox allow-scripts"));assert!(!CSP.contains("allow-same-origin"));}}
