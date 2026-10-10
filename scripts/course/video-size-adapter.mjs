// Product-owned adapter for both current and pinned on-demand renderers.
// Keep every teaching diagram and subtitle visible when fitting a new canvas.
import {spawn} from 'node:child_process';
import {readFile,rename} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {once} from 'node:events';
import {inflateSync,deflateSync} from 'node:zlib';
const [stage,job]=process.argv.slice(2),runtime=process.env.WORKSTORE_RENDER_RUNTIME;
if(!runtime)throw Error('教程渲染组件缺失');
const sizes={'16:9':[1280,720],'9:16':[720,1280],'1:1':[960,960],'4:3':[1280,960],'3:4':[960,1280]};
const input=JSON.parse(await readFile(path.join(job,'input.json'),'utf8'));
if(input.config.ratio!==undefined&&!Object.hasOwn(sizes,input.config.ratio))throw Error('教程尺寸无效');
await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(runtime,'runner.mjs'),stage,job],{stdio:'inherit'});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('教程制作失败')));
});
if((stage==='render'||stage==='whiteboard-render')&&input.config.ratio&&input.config.ratio!=='16:9'){
 const [width,height]=sizes[input.config.ratio];
 const {RenderInternals}=createRequire(path.join(runtime,'runner.mjs'))('@remotion/renderer');
 const source=path.join(job,'tutorial.mp4'),target=path.join(job,'sized.mp4');
 process.stdout.write(JSON.stringify({progress:.98,stage:'正在适配视频尺寸…'})+'\n');
 // The pinned FFmpeg only includes a small filter set. Build a padded RGB
 // canvas in a bounded stream, using the source paper color as the background.
 const options={indent:false,logLevel:'error',binariesDirectory:null,cancelSignal:undefined};
 const metadata=JSON.parse((await RenderInternals.callFf({...options,bin:'ffprobe',args:['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','json',source]})).stdout).streams[0];
 const scale=Math.min(width/metadata.width,height/metadata.height);
 const w=Math.floor(metadata.width*scale/2)*2,h=Math.floor(metadata.height*scale/2)*2;
 const decoder=RenderInternals.callFf({...options,bin:'ffmpeg',options:{buffer:false},args:['-v','error','-i',source,'-map','0:v:0','-an','-vf',`scale=${w}:${h}`,'-pix_fmt','rgb24','-c:v','png','-pred','none','-f','image2pipe','pipe:1']});
 const encoder=RenderInternals.callFf({...options,bin:'ffmpeg',options:{buffer:false},args:['-y','-v','error','-f','image2pipe','-vcodec','png','-framerate',metadata.r_frame_rate,'-i','pipe:0','-i',source,'-map','0:v:0','-map','1:a?','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',target]});
 decoder.stderr.pipe(process.stderr);encoder.stderr.pipe(process.stderr);decoder.catch(()=>{});encoder.catch(()=>{});
 const left=Math.floor((width-w)/2),top=Math.floor((height-h)/2);
 const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const pngChunk=(kind,data)=>{const type=Buffer.from(kind),payload=Buffer.concat([type,data]),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);payload.copy(out,4);let crc=0xffffffff;for(const byte of payload)crc=crcTable[(crc^byte)&255]^(crc>>>8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const start=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header)]),end=pngChunk('IEND',Buffer.alloc(0));
 let pending=Buffer.alloc(0);
 try{
  for await(const chunk of decoder.stdout){
   pending=pending.length?Buffer.concat([pending,chunk]):chunk;
   while(pending.length>=8){
    let pos=8,complete=0;const imageData=[];
    while(pos+12<=pending.length){const length=pending.readUInt32BE(pos);if(pos+12+length>pending.length)break;const type=pending.toString('ascii',pos+4,pos+8);if(type==='IDAT')imageData.push(pending.subarray(pos+8,pos+8+length));pos+=12+length;if(type==='IEND'){complete=pos;break;}}
    if(!complete)break;
    const scan=inflateSync(Buffer.concat(imageData)),stride=w*3+1;
    if(scan.length!==stride*h)throw Error('视频像素格式无效');
    // PNG encoder is explicitly configured with prediction disabled.
    for(let y=0;y<h;y++)if(scan[y*stride]!==0)throw Error('视频像素编码不兼容');
    const canvas=Buffer.alloc((width*3+1)*height),paper=scan.subarray(1,4);
    for(let y=0;y<height;y++){const row=y*(width*3+1);canvas.fill(paper,row+1,row+width*3+1);}
    for(let y=0;y<h;y++)scan.copy(canvas,(top+y)*(width*3+1)+1+left*3,y*stride+1,(y+1)*stride);
    const png=Buffer.concat([start,pngChunk('IDAT',deflateSync(canvas,{level:1})),end]);
    if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
    pending=pending.subarray(complete);
   }
  }
  if(pending.length)throw Error('视频画面不完整');
  encoder.stdin.end();await decoder;await encoder;
 }finally{decoder.kill();encoder.kill();}
 await rename(target,source);
}
