import {invoke,convertFileSrc} from '@tauri-apps/api/core';
import {save} from '@tauri-apps/plugin-dialog';
import {native} from '../workspace';
import {download,safeName} from '../course/export';
export function mediaSource(id:string){if(!id.startsWith('workstore-course-media:'))return id;const name=id.slice(23);return native?convertFileSrc(name,'course-media'):id;}
export async function exportMedia(id:string,title:string){if(native&&id.startsWith('workstore-course-media:')){const path=await save({defaultPath:safeName(title)+'.mp4',filters:[{name:'MP4',extensions:['mp4']}]});if(path)await invoke('export_course_media',{id,path});}else{const r=await fetch(mediaSource(id));if(!r.ok)throw Error('视频读取失败');await download(await r.blob(),safeName(title)+'.mp4','mp4');}}
