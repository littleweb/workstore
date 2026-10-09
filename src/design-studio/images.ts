import {readImage} from '@tauri-apps/plugin-clipboard-manager';
import {invoke} from '@tauri-apps/api/core';
import {native, scheduleAutosync} from '../workspace';
import {imageSource as storedImageSource, referenceImage} from '../comics/images';
import {designImageSource} from './remoteSource';
export function imageSource(src:string):Promise<string>{return src.startsWith('/design-studio/')?designImageSource(src):storedImageSource(src);}
export async function storeImage(png: string) {if(!native)return png;const id=await invoke<string>('save_design_image',{data:png});scheduleAutosync();return id;}
export async function uploadImage(file: File,onProgress?:(stage:string)=>void) {
 if(!file.type.startsWith('image/'))throw Error('请选择图片文件');
 onProgress?.('正在处理图片…');const src=URL.createObjectURL(file);try{const png=await referenceImage({src});onProgress?.('正在保存图片…');return await storeImage(png);}finally{URL.revokeObjectURL(src);}
}
export async function cropImage(src: string, ratio: string, x: number, y: number) {
 const match=ratio.match(/(\d+):(\d+)/);if(!match)throw Error('请选择裁剪比例');
 const im=new Image();im.src=await imageSource(src);await im.decode();const aspect=Number(match[1])/Number(match[2]);
 const width=Math.min(im.width,im.height*aspect),height=width/aspect;
 const sx=(im.width-width)*x/100,sy=(im.height-height)*y/100;const canvas=document.createElement('canvas');canvas.width=Math.round(width);canvas.height=Math.round(height);canvas.getContext('2d')!.drawImage(im,sx,sy,width,height,0,0,canvas.width,canvas.height);return storeImage(canvas.toDataURL('image/png'));
}
export async function reference(src: string) {return referenceImage({src:await imageSource(src)});}

// Read only on an explicit paste action; never fetch clipboard URLs or HTML.
export async function clipboardImageFile(onProgress?:(stage:string)=>void): Promise<File> {
 onProgress?.('正在读取剪贴板…');
 if(!native){
  for(const item of await navigator.clipboard.read()){
   const type=item.types.find(type=>type==='image/png'||type==='image/jpeg');
   if(type)return new File([await item.getType(type)],'clipboard.'+(type==='image/png'?'png':'jpg'),{type});
  }
  throw Error('剪贴板中没有可用图片，请先复制图像');
 }
 const image=await readImage();
 try{
  const {width,height}=await image.size();
  if(!width||!height)throw Error('剪贴板图片尺寸无效');
  const rgba=await image.rgba();
  if(rgba.length!==width*height*4)throw Error('剪贴板图片数据不完整');
  onProgress?.('正在转换图片…');await new Promise(resolve=>setTimeout(resolve,0));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw Error('无法处理剪贴板图片');
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('剪贴板图片转换失败')),'image/png'));
  return new File([blob],'clipboard.png',{type:'image/png'});
 }finally{await image.close();}
}

// Page-entry detection inspects only the image resource, without encoding or saving it.
export async function hasClipboardImage():Promise<boolean>{
 if(!native)return false;
 try{const image=await readImage();try{const size=await image.size();return size.width>0&&size.height>0;}finally{await image.close();}}catch{return false;}
}
