import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const refs=JSON.parse(await readFile('src/course-animation/examples.json','utf8'));
const runtime=path.resolve('.course-animation-build/runtime'),speech=path.resolve('.course-whiteboard-build/runtime');
function run(stage,job){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[path.join(runtime,'runner.mjs'),stage,job],{env:{...process.env,WORKSTORE_AI_SPEECH:speech,WORKSTORE_CHROME:path.join(runtime,'chrome/chrome-headless-shell')},stdio:['ignore','pipe','pipe']});let error='',last=-1;p.stderr.on('data',b=>error+=b);p.stdout.on('data',b=>{for(const line of String(b).split('\n'))try{const v=JSON.parse(line),n=Math.floor(v.progress*4);if(n!==last){last=n;console.log(path.basename(job),stage,Math.round(v.progress*100)+'%');}}catch{}});p.on('error',reject);p.on('exit',c=>c?reject(Error(error)):resolve());});}
let cursor=0;
await Promise.all(Array.from({length:2},async()=>{while(cursor<refs.length){const r=refs[cursor++],job=path.resolve('public/course/animations',r.id),backup=path.resolve('.course-tts-build/prior-references',r.id);await mkdir(path.dirname(backup),{recursive:true});try{await readFile(path.join(backup,'tutorial.json'));}catch{await cp(job,backup,{recursive:true});}
 const old=JSON.parse(await readFile(path.join(job,'tutorial.json'),'utf8'));
 r.config.voiceId='zf_021';
 if(old.scenes.every(s=>s.audioVoice==='kokoro-zh-zf_021-s0.93-v1')){console.log(r.id,'natural voice already ready');continue;}
 await writeFile(path.join(job,'input.json'),JSON.stringify({tutorial:old,config:r.config}));await run('prepare',job);
 const tutorial=JSON.parse(await readFile(path.join(job,'result.json'),'utf8'));await writeFile(path.join(job,'input.json'),JSON.stringify({tutorial,config:r.config}));await run('render',job);
 await writeFile(path.join(job,'tutorial.json'),JSON.stringify({...tutorial,video:r.video,scenes:tutorial.scenes.map((s,i)=>({...s,audio:`/course/animations/${r.id}/${String(i+1).padStart(2,'0')}.wav`}))},null,2));
 for(let i=0;i<tutorial.scenes.length;i++){await rm(path.join(job,String(i+1).padStart(2,'0')+'-raw.wav'),{force:true});}
 for(const name of ['speech-settings.json','speech-input.json','speech-result.json','result.json'])await rm(path.join(job,name),{force:true});console.log('COMPLETE',r.id);
}}));
await writeFile('src/course-animation/examples.json',JSON.stringify(refs,null,2));
console.log('All ten animation tutorials now use natural neural speech.');
