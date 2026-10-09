import {coverVersion} from './cover';
import {invoke,convertFileSrc} from '@tauri-apps/api/core';
import {save} from '@tauri-apps/plugin-dialog';
import JSZip from 'jszip';
import {native} from '../workspace';
import {imageSource} from '../comics/images';
import {pdfBlob} from '../story-comic/export';
import {pageFilename,publicationCopy,copyText,type Content} from './model';
export const safeName=(s:string)=>s.replace(/[\\/:*?"<>|]/g,'_');
export async function pngData(src:string){const resolved=await imageSource(src);if(resolved.startsWith('data:image/png;base64,'))return resolved;const im=new Image();im.src=resolved;await im.decode();const canvas=document.createElement('canvas');canvas.width=im.naturalWidth;canvas.height=im.naturalHeight;canvas.getContext('2d')!.drawImage(im,0,0);return canvas.toDataURL('image/png');}
const bytes=(s:string)=>Uint8Array.from(atob(s.split(',')[1]),c=>c.charCodeAt(0));
export async function download(blob:Blob,name:string,ext:string){
 if(native){const path=await save({defaultPath:name,filters:[{name:ext.toUpperCase(),extensions:[ext]}]});if(!path)return;
 const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('导出读取失败'));r.readAsDataURL(blob);});await invoke('save_course_export',{path,data});}
 else {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
export async function exportCover(c:Content){const cover=coverVersion(c);if(!cover){await exportPage(c,0);return;}await download(new Blob([bytes(await pngData(cover.image))],{type:'image/png'}),safeName(cover.config.title)+'-封面.png','png');}
export async function exportPage(c:Content,i:number){const src=c.plan?.pages[i]?.image;if(!src)throw Error('本张尚未生成');await download(new Blob([bytes(await pngData(src))],{type:'image/png'}),pageFilename(i),'png');}
export async function exportZip(c:Content,title:string,backup?:string){const zip=new JSZip();if(backup){zip.file('知识卡片.course.json',backup);for(const src of new Set(backup.match(/workstore-image:[a-f0-9]{64}/g)??[]))zip.file(`images/${src.slice(16)}.png`,bytes(await pngData(src)));for(const src of new Set(backup.match(/workstore-course-media:[a-f0-9]{64}\.(?:mp4|wav)/g)??[])){const response=await fetch(native?convertFileSrc(src.slice(23),'course-media'):src);if(!response.ok)throw Error('教程素材读取失败');zip.file(`media/${src.slice(23)}`,await response.arrayBuffer());}}
 else {if(!c.plan?.pages.every(p=>p.image&&p.status==='ready'))throw Error('请先完成所有卡片');for(let i=0;i<c.plan.pages.length;i++){zip.file(pageFilename(i),bytes(await pngData(c.plan.pages[i].image!)));zip.file(`prompts/${pageFilename(i).replace('.png','.md')}`,c.plan.pages[i].prompt??'');}zip.file('发布文案.txt',copyText(publicationCopy(c)));zip.file('analysis.md',c.plan.analysis);zip.file('outline.md',c.plan.pages.map((p,i)=>`## ${i+1}. ${p.title}\n${p.text.join('\n')}\n\n${p.visual}`).join('\n\n'));zip.file('作品.course.json',JSON.stringify(c,null,2));}
 const cover=coverVersion(c);if(cover){zip.file('作品封面.png',bytes(await pngData(cover.image)));zip.file('prompts/封面.md',cover.prompt);}
 await download(await zip.generateAsync({type:'blob'}),safeName(title)+(backup?'-备份':'')+'.zip','zip');}
export async function exportPdf(c:Content,title:string){if(!c.plan?.pages.every(p=>p.image&&p.status==='ready'))throw Error('请先完成所有卡片');await download(await pdfBlob([...(coverVersion(c)?[coverVersion(c)!.image]:[]),...c.plan.pages.map(p=>p.image!)]),safeName(title)+'.pdf','pdf');}
