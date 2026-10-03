import {invoke} from '@tauri-apps/api/core';
import {save} from '@tauri-apps/plugin-dialog';
import JSZip from 'jszip';
import {native} from '../workspace';
import {imageSource} from './images';
import type {Document} from './store';
export async function downloadBlob(blob: Blob,name: string,ext: string) {
 if(native){const path=await save({defaultPath:name,filters:[{name:ext.toUpperCase(),extensions:[ext]}]});if(!path)return;const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('无法读取导出内容'));r.readAsDataURL(blob);});await invoke('save_design_export',{path,data});}
 else {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
export async function downloadImage(src: string,title: string){const data=await imageSource(src);const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));await downloadBlob(new Blob([bytes],{type:'image/png'}),title.replace(/[\\/:*?"<>|]/g,'_')+'.png','png');}
export async function exportBackup(doc: Document){const zip=new JSZip();zip.file('作品.design.json',JSON.stringify(doc,null,2));for(const id of new Set(doc.content.match(/workstore-image:[0-9a-f]{64}/g)||[])){const data=await imageSource(id);zip.file('images/'+id.slice(16)+'.png',data.split(',')[1],{base64:true});}await downloadBlob(await zip.generateAsync({type:'blob'}),doc.title.replace(/[\\/:*?"<>|]/g,'_')+'.zip','zip');}

export async function downloadCanvasImage(src:string,format:'png'|'jpeg'|'webp',title:string){
 if(format==='png')return downloadImage(src,title);
 const im=new Image();im.src=await imageSource(src);await im.decode();const canvas=document.createElement('canvas');canvas.width=im.width;canvas.height=im.height;const ctx=canvas.getContext('2d')!;if(format==='jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.drawImage(im,0,0);
 const mime='image/'+format;const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b&&b.type===mime?resolve(b):reject(Error('当前系统不支持该导出格式')),mime,.95));
 await downloadBlob(blob,title.replace(/[\\/:*?"<>|]/g,'_')+'.'+format,format);
}
