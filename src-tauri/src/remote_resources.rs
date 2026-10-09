//! Fixed release assets verified before use; no workspace locks or credentials.
use serde::Deserialize;
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs,io::{Read,Write},path::{Path,PathBuf},sync::{Arc,Mutex,LazyLock,Condvar},time::Duration};
use tauri::Manager;
#[derive(Clone,Deserialize)]
struct Check{size:u64,sha256:String,mode:u32}
#[derive(Clone,Deserialize)]
struct Entry{filename:String,id:u64,size:u64,sha256:String,kind:String,#[serde(default)] checks:BTreeMap<String,Check>}
#[derive(Deserialize)]
struct Catalog{#[serde(rename="schemaVersion")]schema_version:u32,repository:String,tag:String,entries:BTreeMap<String,Entry>}
static CATALOG:LazyLock<Catalog>=LazyLock::new(||serde_json::from_str(include_str!("../../src/remote-resources.json")).expect("verified resource catalog"));
static LOCKS:LazyLock<Mutex<BTreeMap<String,Arc<Mutex<()>>>>>=LazyLock::new(||Mutex::new(BTreeMap::new()));
static SLOTS:(Mutex<usize>,Condvar)=(Mutex::new(0),Condvar::new());
struct Slot;
impl Slot{fn enter()->Result<Self,String>{let mut count=SLOTS.0.lock().map_err(|_|"资源队列不可用")?;while *count>=4{count=SLOTS.1.wait(count).map_err(|_|"资源队列不可用")?;}*count+=1;Ok(Self)}}
impl Drop for Slot{fn drop(&mut self){if let Ok(mut count)=SLOTS.0.lock(){*count-=1;SLOTS.1.notify_one();}}}
fn hash(path:&Path)->Result<(u64,String),String>{let mut file=fs::File::open(path).map_err(|e|e.to_string())?;let mut h=Sha256::new();let mut size=0;let mut buf=[0;65536];loop{let n=file.read(&mut buf).map_err(|e|e.to_string())?;if n==0{break;}size+=n as u64;h.update(&buf[..n]);}Ok((size,format!("{:x}",h.finalize())))}
fn valid(key:&str,e:&Entry)->bool{
 let extension=e.filename.strip_prefix(&format!("{}.",e.sha256));
 e.id>0&&e.size>0&&e.sha256.len()==64&&e.sha256.bytes().all(|b|b.is_ascii_hexdigit())
 && if e.kind=="component"{key.starts_with("component:")&&e.size<=512*1024*1024&&extension==Some("tar.gz")&&!e.checks.is_empty()&&e.checks.keys().all(|n|!n.contains('/')&&!n.contains('\\')&&n!=".."&&n!=".ready")}
 else{e.kind=="file"&&key.starts_with("/course/")&&!key.contains("..")&&e.size<=256*1024*1024&&matches!(extension,Some("png"|"webp"|"jpg"|"mp4"|"wav"|"html"|"js"))}
}
fn entry(key:&str)->Result<Entry,String>{if CATALOG.schema_version!=1||CATALOG.repository!="littleweb/workstore"||!CATALOG.tag.starts_with("resources-"){return Err("课程资源索引无效".into());}CATALOG.entries.get(key).filter(|e|valid(key,e)).cloned().ok_or("未知课程资源".into())}
fn verified(path:&Path,e:&Entry)->bool{fs::symlink_metadata(path).is_ok_and(|m|m.is_file()&&m.len()==e.size)&&hash(path).is_ok_and(|(s,h)|s==e.size&&h==e.sha256)}
fn client(app:&tauri::AppHandle)->Result<reqwest::blocking::Client,String>{
 let mut builder=reqwest::blocking::Client::builder().user_agent("WorkStore-Resources/1").connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(600)).redirect(reqwest::redirect::Policy::custom(|attempt|{
  let u=attempt.url();if attempt.previous().len()<5&&u.scheme()=="https"&&u.host_str().is_some_and(|h|h=="github.com"||h=="api.github.com"||h.ends_with(".githubusercontent.com")){attempt.follow()}else{attempt.stop()}
 }));
 let settings=crate::ai::ai_settings(app.clone())?;
 if settings.proxy_url.trim()=="direct"{builder=builder.no_proxy();}
 else if let Some(proxy)=tauri::async_runtime::block_on(crate::ai::resolve_proxy(&settings))?{builder=builder.proxy(reqwest::Proxy::all(proxy).map_err(|_|"代理地址无效")?);}
 builder.build().map_err(|_|"课程资源连接初始化失败".into())
}
fn transfer(root:&Path,e:&Entry,client:&reqwest::blocking::Client,urls:&[String])->Result<PathBuf,String>{
 fs::create_dir_all(root).map_err(|e|e.to_string())?;
 let lock=LOCKS.lock().map_err(|_|"资源缓存不可用")?.entry(e.sha256.clone()).or_insert_with(||Arc::new(Mutex::new(()))).clone();let _same=lock.lock().map_err(|_|"资源缓存不可用")?;
 let target=root.join(&e.filename);if verified(&target,e){return Ok(target);}
 let _slot=Slot::enter()?;let mut error="课程资源暂不可用，请联网后重试".to_string();
 for url in urls{
  let download=(||->Result<_,String>{
   let mut response=client.get(url).header("Accept","application/octet-stream").header("X-GitHub-Api-Version","2022-11-28").send().map_err(|_|"课程资源连接失败，请重试")?;
   if !response.status().is_success(){return Err(format!("课程资源 HTTP {}，请稍后重试",response.status().as_u16()));}
   if response.content_length().is_some_and(|s|s>e.size){return Err("课程资源超出大小限制".into());}
   let mut temporary=tempfile::NamedTempFile::new_in(root).map_err(|e|e.to_string())?;let mut h=Sha256::new();let mut total=0;let mut buf=[0;65536];
   loop{let n=response.read(&mut buf).map_err(|_|"课程资源下载中断，请重试")?;if n==0{break;}total+=n as u64;if total>e.size{return Err("课程资源超出大小限制".into());}h.update(&buf[..n]);temporary.write_all(&buf[..n]).map_err(|e|e.to_string())?;}
   if total!=e.size||format!("{:x}",h.finalize())!=e.sha256{return Err("课程资源完整性校验失败".into());}
   temporary.as_file().sync_all().map_err(|e|e.to_string())?;temporary.persist(&target).map_err(|e|e.to_string())?;Ok(target.clone())
  })();match download{Ok(path)=>return Ok(path),Err(e)=>error=e}
 }
 Err(error)
}
fn file(app:&tauri::AppHandle,key:&str)->Result<PathBuf,String>{let e=entry(key)?;let root=app.path().app_cache_dir().map_err(|e|e.to_string())?.join(if e.kind=="component"{"course-component-downloads"}else{"course-assets"});let target=root.join(&e.filename);if verified(&target,&e){return Ok(target);}
 transfer(&root,&e,&client(app)?,&[format!("https://github.com/{}/releases/download/{}/{}",CATALOG.repository,CATALOG.tag,e.filename),format!("https://api.github.com/repos/{}/releases/assets/{}",CATALOG.repository,e.id)])
}
#[tauri::command]
pub async fn course_asset(app:tauri::AppHandle,key:String)->Result<String,String>{let e=entry(&key)?;if e.kind!="file"{return Err("不是课程参考资源".into());}tauri::async_runtime::spawn_blocking(move||file(&app,&key).map(|p|p.to_string_lossy().into())).await.map_err(|e|e.to_string())?}
#[tauri::command]
pub async fn course_asset_text(app:tauri::AppHandle,key:String)->Result<String,String>{let e=entry(&key)?;if e.kind!="file"||e.size>2*1024*1024||!matches!(e.filename.rsplit('.').next(),Some("html"|"js")){return Err("不是课程文本资源".into());}tauri::async_runtime::spawn_blocking(move||fs::read_to_string(file(&app,&key)?).map_err(|e|e.to_string())).await.map_err(|e|e.to_string())?}
fn ready(dest:&Path,e:&Entry)->bool{fs::read_to_string(dest.join(".ready")).is_ok_and(|s|s==e.sha256)&&e.checks.iter().all(|(n,c)|fs::symlink_metadata(dest.join(n)).is_ok_and(|m|{#[cfg(unix)]{use std::os::unix::fs::PermissionsExt;if m.permissions().mode()&0o777!=c.mode{return false;}}m.is_file()&&m.len()==c.size})&&hash(&dest.join(n)).is_ok_and(|(s,h)|s==c.size&&h==c.sha256))}
fn unpack(archive:&Path,dest:&Path,e:&Entry)->Result<(),String>{
 let mut tar=tar::Archive::new(flate2::read::GzDecoder::new(fs::File::open(archive).map_err(|e|e.to_string())?));
 let mut count=0;
 for item in tar.entries().map_err(|e|e.to_string())?{let mut item=item.map_err(|e|e.to_string())?;let path=item.path().map_err(|e|e.to_string())?.into_owned();let n=path.to_str().ok_or("组件路径无效")?;let c=e.checks.get(n).ok_or("组件包含未声明文件")?;
  if !item.header().entry_type().is_file()||item.size()!=c.size||item.header().mode().map_err(|e|e.to_string())?!=c.mode{return Err("组件文件类型/权限/大小无效".into());}
  item.unpack_in(dest).map_err(|e|e.to_string())?;count+=1;
 }
 if count!=e.checks.len(){return Err("组件缺少文件".into());}
 crate::storage::atomic_write(&dest.join(".ready"),e.sha256.as_bytes())?;
 if !ready(dest,e){return Err("组件文件校验失败".into());}Ok(())
}
pub(crate) fn source(app:&tauri::AppHandle,kind:&str)->Result<PathBuf,String>{
 if !cfg!(all(target_os="macos",target_arch="aarch64")){return Err("当前平台的课程运行组件尚未发布".into());}
 let key=format!("component:{kind}:darwin-aarch64");let e=entry(&key)?;let root=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("course-components");fs::create_dir_all(&root).map_err(|e|e.to_string())?;let dest=root.join(&e.sha256);
 let lockfile=fs::OpenOptions::new().create(true).truncate(false).write(true).open(root.join(format!("{}.lock",e.sha256))).map_err(|e|e.to_string())?;fs2::FileExt::lock_exclusive(&lockfile).map_err(|e|e.to_string())?;
 if ready(&dest,&e){return Ok(dest);}
 let archive=file(app,&key)?;let temp=tempfile::tempdir_in(&root).map_err(|e|e.to_string())?;unpack(&archive,temp.path(),&e)?;
 if dest.exists(){fs::rename(&dest,root.join(format!("{}.previous-{}",e.sha256,uuid::Uuid::new_v4()))).map_err(|e|e.to_string())?;}
 fs::rename(temp.keep(),&dest).map_err(|e|e.to_string())?;Ok(dest)
}

#[cfg(test)]
mod tests{
 use super::*;
 fn fixture(bytes:&[u8])->Entry{let h=format!("{:x}",Sha256::digest(bytes));Entry{filename:format!("{h}.png"),id:1,size:bytes.len() as u64,sha256:h,kind:"file".into(),checks:BTreeMap::new()}}
 fn server(bytes:Vec<u8>)->(String,std::thread::JoinHandle<()>){
  use std::io::{Read,Write};let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let url=format!("http://{}/asset",listener.local_addr().unwrap());
  let thread=std::thread::spawn(move||{let(mut stream,_)=listener.accept().unwrap();let mut request=[0;4096];stream.read(&mut request).unwrap();write!(stream,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",bytes.len()).unwrap();stream.write_all(&bytes).unwrap();});(url,thread)
 }
 #[test]
 fn signed_index_has_only_declared_references_and_bounded_components(){
  assert!(CATALOG.entries.len()>100);for(k,e)in &CATALOG.entries{assert!(valid(k,e),"{k}");}
  for kind in ["node","animation","whiteboard","html-service"]{let e=entry(&format!("component:{kind}:darwin-aarch64")).unwrap();assert!(!e.checks.is_empty());}
  let mut e=fixture(b"fixture");e.filename="../../private.png".into();assert!(!valid("/course/examples/a.png",&e));assert!(entry("/course/../../private.png").is_err());
 }
 #[test]
 fn verified_cache_is_offline_and_corruption_is_never_returned(){
  let dir=tempfile::tempdir().unwrap();let bytes=b"verified fixture";let e=fixture(bytes);let path=dir.path().join(&e.filename);fs::write(&path,bytes).unwrap();let client=reqwest::blocking::Client::builder().no_proxy().build().unwrap();
  assert_eq!(transfer(dir.path(),&e,&client,&[]).unwrap(),path);fs::write(&path,vec![0;bytes.len()]).unwrap();assert!(transfer(dir.path(),&e,&client,&[]).is_err());assert!(path.exists());
 }
 #[test]
 fn duplicate_downloads_share_a_verified_atomic_result(){
  let dir=tempfile::tempdir().unwrap();let bytes=b"parallel fixture".to_vec();let e=fixture(&bytes);let(url,server)=server(bytes.clone());let client=reqwest::blocking::Client::builder().no_proxy().timeout(Duration::from_secs(3)).build().unwrap();
  std::thread::scope(|scope|{let a=scope.spawn(||transfer(dir.path(),&e,&client,&[url.clone()]));let b=scope.spawn(||transfer(dir.path(),&e,&client,&[url.clone()]));assert_eq!(a.join().unwrap().unwrap(),b.join().unwrap().unwrap());});server.join().unwrap();assert_eq!(fs::read(dir.path().join(&e.filename)).unwrap(),bytes);
 }
 #[test]
 fn oversized_or_wrong_hash_download_preserves_existing_bytes(){
  for bytes in [b"tampered fixture".to_vec(),vec![0;128]]{let dir=tempfile::tempdir().unwrap();let e=fixture(b"valid fixture");let path=dir.path().join(&e.filename);fs::write(&path,b"old corrupt cache").unwrap();let(url,server)=server(bytes);let client=reqwest::blocking::Client::builder().no_proxy().build().unwrap();assert!(transfer(dir.path(),&e,&client,&[url]).is_err());server.join().unwrap();assert_eq!(fs::read(path).unwrap(),b"old corrupt cache");assert_eq!(fs::read_dir(dir.path()).unwrap().count(),1);}
 }
 #[test]
 fn component_extraction_verifies_file_content_modes_and_rejects_links(){
  let bytes=b"trusted component";let mut e=fixture(bytes);e.kind="component".into();e.filename=format!("{}.tar.gz",e.sha256);e.checks.insert("node".into(),Check{size:bytes.len() as u64,sha256:format!("{:x}",Sha256::digest(bytes)),mode:0o755});
  let dir=tempfile::tempdir().unwrap();let archive=dir.path().join("runtime.tar.gz");
  let encoder=flate2::write::GzEncoder::new(fs::File::create(&archive).unwrap(),flate2::Compression::fast());let mut tar=tar::Builder::new(encoder);let mut h=tar::Header::new_gnu();h.set_size(bytes.len() as u64);h.set_mode(0o755);h.set_cksum();tar.append_data(&mut h,"node",&bytes[..]).unwrap();tar.into_inner().unwrap().finish().unwrap();let dest=dir.path().join("extracted");fs::create_dir(&dest).unwrap();unpack(&archive,&dest,&e).unwrap();assert!(ready(&dest,&e));fs::write(dest.join("node"),b"tampered").unwrap();assert!(!ready(&dest,&e));
  let encoder=flate2::write::GzEncoder::new(fs::File::create(&archive).unwrap(),flate2::Compression::fast());let mut tar=tar::Builder::new(encoder);let mut h=tar::Header::new_gnu();h.set_entry_type(tar::EntryType::Symlink);h.set_size(0);h.set_mode(0o755);h.set_link_name("../../private").unwrap();h.set_cksum();tar.append_data(&mut h,"node",&b""[..]).unwrap();tar.into_inner().unwrap().finish().unwrap();assert!(unpack(&archive,&dest,&e).is_err());
 }
}
