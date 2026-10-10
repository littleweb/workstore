import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
import {mkdtemp,writeFile,copyFile,symlink,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {RenderInternals} from '@remotion/renderer';
const load=file=>{const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:[file],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,{module});return module.exports;};
test('video size validation accepts legacy files, supports five ratios and rejects arbitrary dimensions',()=>{
 for(const file of ['src/course-animation/model.ts','src/course-whiteboard/model.ts']){
 const m=load(file),config=m.defaults();assert.equal(config.ratio,'16:9');delete config.ratio;m.validateConfig(config);
 for(const ratio of ['16:9','9:16','1:1','4:3','3:4'])m.validateConfig({...config,ratio});
 for(const ratio of ['0:0','2:3',null,'../../'])assert.throws(()=>m.validateConfig({...config,ratio}));
 }
 const m=load('src/course-web/model.ts'),config=m.defaults();assert.equal(config.coverRatio,'1:1');delete config.coverRatio;m.validateConfig(config);
 for(const coverRatio of ['1:1','16:9','9:16','4:3','3:4','2:3'])m.validateConfig({...config,coverRatio});assert.throws(()=>m.validateConfig({...config,coverRatio:'0:0'}));
});
test('pinned runtime adapter exports exact canvas sizes with sound and preserves runtime files',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'course-size-'));
 const ff=async(bin,args)=>RenderInternals.callFf({bin,args,indent:false,logLevel:'error',binariesDirectory:null,cancelSignal:undefined});
 try{
 await symlink(path.resolve('node_modules'),path.join(temp,'node_modules'));
 const runner="import {copyFile,writeFile} from 'node:fs/promises';import path from 'node:path';const job=process.argv[3];await copyFile(path.join(process.env.WORKSTORE_RENDER_RUNTIME,'fixture.mp4'),path.join(job,'tutorial.mp4'));await writeFile(path.join(job,'result.json'),'{}');";
 await writeFile(path.join(temp,'runner.mjs'),runner);
 await ff('ffmpeg',['-y','-f','lavfi','-i','nullsrc=size=1280x720:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','0.25','-c:v','libx264','-preset','ultrafast','-c:a','aac',path.join(temp,'fixture.mp4')]);
 const sizes=load('src/course/sizes.ts').videoSizes;
 for(const size of sizes){
 const job=await mkdtemp(path.join(temp,'job-'));await writeFile(path.join(job,'input.json'),JSON.stringify({config:{ratio:size.value}}));
 const run=spawnSync(process.execPath,[path.resolve('scripts/course/video-size-adapter.mjs'),'render',job],{env:{...process.env,WORKSTORE_RENDER_RUNTIME:temp},encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const probe=await ff('ffprobe',['-v','error','-show_entries','stream=codec_type,width,height','-of','json',path.join(job,'tutorial.mp4')]);
 const streams=JSON.parse(probe.stdout).streams,video=streams.find(s=>s.codec_type==='video');assert.equal(video.width,size.width);assert.equal(video.height,size.height);assert.ok(streams.some(s=>s.codec_type==='audio'));
 }
 assert.equal(await readFile(path.join(temp,'runner.mjs'),'utf8'),runner);
 }finally{await rm(temp,{recursive:true,force:true});}
});
