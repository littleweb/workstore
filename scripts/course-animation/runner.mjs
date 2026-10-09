import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {fitSpeechScenes,maxSpeechTempo} from './speech-timing.mjs';
import {createRequire} from 'node:module';
import {selectComposition,renderMedia,renderStill,RenderInternals} from '@remotion/renderer';
const require=createRequire(import.meta.url),{parsePlan,captionsFor,validateConfig,selectedVoice,voiceProfile}=require('./model.cjs');
if(process.env.WORKSTORE_PARENT_PID){const parent=Number(process.env.WORKSTORE_PARENT_PID);setInterval(()=>{try{process.kill(parent,0);}catch{if(process.platform!=='win32')process.kill(-process.pid,'SIGTERM');else process.exit(1);}},1000).unref();}
const here=path.dirname(fileURLToPath(import.meta.url));
const [stage,job]=process.argv.slice(2);if(stage.startsWith('whiteboard-')){await import('./whiteboard-runner.mjs');process.exit(0);}const input=JSON.parse(await readFile(path.join(job,'input.json'),'utf8'));
validateConfig(input.config);let tutorial=parsePlan(JSON.stringify(input.tutorial),input.config);
const report=(p,label)=>process.stdout.write(JSON.stringify({progress:p,stage:label})+'\n');
const run=(bin,args,options={})=>new Promise((resolve,reject)=>{const child=spawn(bin,args,{stdio:['ignore','ignore','pipe'],...options});let error='';child.stderr.on('data',b=>{if(error.length<2000)error+=b;});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error||'配音失败')));});
const ff=async(bin,args)=>RenderInternals.callFf({bin,args,indent:false,logLevel:'error',binariesDirectory:null,cancelSignal:undefined});
await mkdir(job,{recursive:true});
if(stage==='prepare'){
 let speech=[];
 if(input.config.voice){
  const speechRoot=process.env.WORKSTORE_AI_SPEECH;
  if(!speechRoot)throw Error('自然中文配音组件缺失，请安装完整应用');
  const python=path.join(speechRoot,process.platform==='win32'?'python/python.exe':'python/bin/python3');
  await writeFile(path.join(job,'speech-input.json'),JSON.stringify(tutorial.scenes.map(s=>s.narration)));
  await writeFile(path.join(job,'speech-settings.json'),JSON.stringify({...selectedVoice(input.config),profile:voiceProfile(input.config)}));
  report(0,'正在生成自然柔和讲解…');
  await run(python,[path.join(speechRoot,'speech/speech.py'),job],{env:{...process.env,PYTHONHOME:path.join(speechRoot,'python'),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
  speech=JSON.parse(await readFile(path.join(job,'speech-result.json'),'utf8'));
  if(speech.some(s=>s.profile!==voiceProfile(input.config)))throw Error('自然配音版本无效');
  const times=fitSpeechScenes(tutorial.scenes,speech.map(s=>s.seconds),tutorial.duration);
  tutorial.scenes.forEach((s,i)=>s.seconds=times[i]);
 }
 for(let i=0;i<tutorial.scenes.length;i++){
  const s=tutorial.scenes[i];s.captions=captionsFor(s);
  if(input.config.voice){
   const name=String(i+1).padStart(2,'0'),duration=speech[i].seconds,target=s.seconds-.5,speed=Math.max(1,duration/target);
   if(speed>maxSpeechTempo+.001)throw Error(`“${s.title}”讲解过密，无法保持自然语速`);
   await ff('ffmpeg',['-y','-i',path.join(job,name+'-raw.wav'),'-af',`atempo=${speed},loudnorm=I=-18:TP=-1.5:LRA=9,adelay=120,apad`,'-t',String(s.seconds),'-ar','44100','-ac','1',path.join(job,name+'.wav')]);
   s.audio=name+'.wav';s.audioVoice=voiceProfile(input.config);
   const voiceMs=duration/speed*1000;s.captions=s.captions.map(c=>({...c,startMs:120+Math.round(c.startMs/(s.seconds*1000)*voiceMs),endMs:120+Math.max(1,Math.round(c.endMs/(s.seconds*1000)*voiceMs))}));
  }
  report((i+1)/tutorial.scenes.length,`正在准备自然讲解 ${i+1}/${tutorial.scenes.length}`);
 }
 await writeFile(path.join(job,'result.json'),JSON.stringify(tutorial));
}else if(stage==='render'||stage==='cover'){
 tutorial.scenes.forEach((s,i)=>{s.audio=input.tutorial.scenes[i].audio;s.captions=input.tutorial.scenes[i].captions??s.captions;});
 const server=http.createServer(async(req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Range');res.setHeader('Access-Control-Expose-Headers','Content-Range,Content-Length,Accept-Ranges');if(req.method==='OPTIONS'){res.writeHead(204).end();return;}const m=/^\/(\d{2})\.wav$/.exec(req.url??'');if(!m){res.writeHead(404).end();return;}try{const b=await readFile(path.join(job,m[1]+'.wav'));res.setHeader('Content-Type','audio/wav');res.setHeader('Accept-Ranges','bytes');const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),b.length-1):b.length-1;if(start>end||start>=b.length){res.writeHead(416).end();return;}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${b.length}`,'Content-Length':end-start+1});res.end(b.subarray(start,end+1));}else{res.setHeader('Content-Length',b.length);res.end(b);}}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 tutorial.scenes.forEach((s,i)=>{if(s.audio)s.audio=`http://127.0.0.1:${port}/${String(i+1).padStart(2,'0')}.wav`;});
 const inputProps={tutorial},browserExecutable=process.env.WORKSTORE_CHROME||undefined,serveUrl=path.join(here,'bundle');
 try{const composition=await selectComposition({serveUrl,id:'Tutorial',inputProps,browserExecutable});
  await renderStill({serveUrl,composition,inputProps,browserExecutable,frame:Math.min(60,composition.durationInFrames-1),output:path.join(job,'cover.png'),imageFormat:'png'});
  if(stage==='render')await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',audioCodec:'aac',outputLocation:path.join(job,'tutorial.mp4'),crf:24,x264Preset:'veryfast',concurrency:4,onProgress:p=>report(p.progress,'正在渲染动画'),logLevel:'error'});
  await writeFile(path.join(job,'result.json'),JSON.stringify({video:'tutorial.mp4',cover:'cover.png'}));
 }finally{server.close();}
}else throw Error('未知渲染任务');
