import {invoke} from '@tauri-apps/api/core';
import {native, scheduleAutosync} from '../workspace';
import {imageSource, referenceImage} from '../comics/images';
export {imageSource};
export async function storeImage(png: string) {if(!native)return png;const id=await invoke<string>('save_design_image',{data:png});scheduleAutosync();return id;}
export async function uploadImage(file: File) {
 if(!['image/jpeg','image/png'].includes(file.type)||file.size>10*1024*1024)throw Error('请选择不超过10MB的JPG或PNG图片');
 const src=URL.createObjectURL(file);try{return await storeImage(await referenceImage({src}));}finally{URL.revokeObjectURL(src);}
}
export async function cropImage(src: string, ratio: string, x: number, y: number) {
 const match=ratio.match(/(\d+):(\d+)/);if(!match)throw Error('请选择裁剪比例');
 const im=new Image();im.src=await imageSource(src);await im.decode();const aspect=Number(match[1])/Number(match[2]);
 const width=Math.min(im.width,im.height*aspect),height=width/aspect;
 const sx=(im.width-width)*x/100,sy=(im.height-height)*y/100;const canvas=document.createElement('canvas');canvas.width=Math.round(width);canvas.height=Math.round(height);canvas.getContext('2d')!.drawImage(im,sx,sy,width,height,0,0,canvas.width,canvas.height);return storeImage(canvas.toDataURL('image/png'));
}
export async function reference(src: string) {return referenceImage({src});}
