import {convertFileSrc,invoke,isTauri} from '@tauri-apps/api/core';
const pending=new Map<string,Promise<string>>(),ready=new Map<string,string>();
export function designImageSource(key:string,command="design_asset"):Promise<string> {
 if(!isTauri())return Promise.resolve(key);
 const memoryKey=command+':'+key;
 const cached=ready.get(memoryKey);if(cached)return Promise.resolve(cached);
 const active=pending.get(memoryKey);if(active)return active;
 const request=invoke<string>(command,{key}).then(path=>{const source=convertFileSrc(path);ready.set(memoryKey,source);return source;}).finally(()=>pending.delete(memoryKey));
 pending.set(memoryKey,request);return request;
}
export function forgetDesignImage(key:string,command="design_asset"){ready.delete(command+':'+key);}
