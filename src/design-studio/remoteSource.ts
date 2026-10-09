import {convertFileSrc,invoke,isTauri} from '@tauri-apps/api/core';
const pending=new Map<string,Promise<string>>(),ready=new Map<string,string>();
export function designImageSource(key:string):Promise<string> {
 if(!isTauri())return Promise.resolve(key);
 const cached=ready.get(key);if(cached)return Promise.resolve(cached);
 const active=pending.get(key);if(active)return active;
 const request=invoke<string>('design_asset',{key}).then(path=>{const source=convertFileSrc(path);ready.set(key,source);return source;}).finally(()=>pending.delete(key));
 pending.set(key,request);return request;
}
export function forgetDesignImage(key:string){ready.delete(key);}
