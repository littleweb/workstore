import {invoke,convertFileSrc,isTauri} from '@tauri-apps/api/core';
const native=()=>typeof window!=='undefined'&&isTauri();
const pending=new Map<string,Promise<string>>(),ready=new Map<string,string>();
export function courseAssetSource(key:string):Promise<string>{
 if(!native())return Promise.resolve(key);
 const cached=ready.get(key);if(cached)return Promise.resolve(cached);
 const current=pending.get(key);if(current)return current;
 const request=invoke<string>('course_asset',{key}).then(path=>{const url=convertFileSrc(path);ready.set(key,url);return url;}).finally(()=>pending.delete(key));pending.set(key,request);return request;
}
export async function courseAssetText(key:string,signal?:AbortSignal):Promise<string>{
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 const text=native()?await invoke<string>('course_asset_text',{key}):await fetch(key,{signal}).then(r=>{if(!r.ok)throw Error('参考读取失败');return r.text();});
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');return text;
}
export function forgetCourseAsset(key:string){ready.delete(key);}
