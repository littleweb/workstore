import { imageSource } from '../comics/images';
import { stringCache } from '../comics/imageCache';
const cachedPreview=stringCache(12*1024*1024,32);
let active=0;
const waiting:(()=>void)[]=[];
async function limited<T>(work:()=>Promise<T>) {
  if(active>=2) await new Promise<void>(resolve=>waiting.push(resolve));
  active++;
  try{return await work();}finally{active--;waiting.shift()?.();}
}
export function previewImageSource(src:string) {
  return cachedPreview(src,()=>limited(async()=>{
    const source=await imageSource(src);
    const image=new Image();image.src=source;
    try {
      await image.decode();
      const scale=Math.min(1,768/Math.max(image.naturalWidth||image.width,image.naturalHeight||image.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round((image.naturalWidth||image.width)*scale));
      canvas.height=Math.max(1,Math.round((image.naturalHeight||image.height)*scale));
      const context=canvas.getContext('2d');if(!context)throw new Error('无法创建预览');
      context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const result=canvas.toDataURL('image/jpeg',.86);
      canvas.width=canvas.height=1;
      return result;
    } finally {image.src='';}
  }));
}
