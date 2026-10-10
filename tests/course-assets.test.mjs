import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {courseFiles,validateResources} from '../scripts/resources/catalog.mjs';
import {checkRelease} from '../scripts/release/check.mjs';
const dom=new JSDOM('<body></body>');for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;const {createRoot}=await import('react-dom/client'),require=createRequire(import.meta.url);after(()=>dom.window.close());
const code=buildSync({entryPoints:['src/course/AssetMedia.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','@tauri-apps/api/core']}).outputFiles[0].text;
function harness(){const module={exports:{}},requests=[];vm.runInNewContext(code,{module,window,require:name=>name==='@tauri-apps/api/core'?{isTauri:()=>true,convertFileSrc:path=>'asset:'+path,invoke:(cmd,args)=>new Promise((resolve,reject)=>requests.push({cmd,args,resolve,reject}))}:require(name)});const host=document.createElement('div');document.body.append(host);const root=createRoot(host);return {...module.exports,requests,host,root,close:async()=>{await act(async()=>root.unmount());host.remove();}};}
test('fixed course index includes only current public references and four platform runtimes',()=>{
 const index=validateResources();const files=courseFiles();assert.ok(files.length>100);
 assert.equal(Object.keys(index.entries).length,files.length+4);
 assert.ok(!files.some(f=>f.key.endsWith('/tutorial.json')||f.key.includes('/audio/')||f.key==='/course/whiteboard/soap-oil/cover.png'));
 const rule=checkRelease();assert.ok(rule.tools.includes('app.course'));assert.equal(rule.publicFiles,674);assert.equal(rule.version,JSON.parse(readFileSync('package.json')).version);
 for(const kind of ['node','animation','whiteboard','html-service'])assert.ok(index.entries[`component:${kind}:darwin-aarch64`].checks);
});
test('pre-release rules block bulk native dependencies and budget increases before network',()=>{
 for(const change of [{nativeResources:['html-runtime/node']},{maxFrontendBytes:81*1048576},{maxMacBytes:91*1048576}]){
  const root=mkdtempSync(join(tmpdir(),'workstore-release-policy-'));
  try{mkdirSync(join(root,'src'));writeFileSync(join(root,'src/release-manifest.json'),JSON.stringify({...JSON.parse(readFileSync('src/release-manifest.json')),...change}));assert.throws(()=>checkRelease(root),/发布规则|资源规则/);}finally{rmSync(root,{recursive:true,force:true});}
 }
});
test('cached video stays playable when its poster is offline, retry invalidates a failed file, and stale media cannot replace selection',async()=>{
 const h=harness(),Media=h.default;await act(async()=>h.root.render(React.createElement(Media,{src:'/course/a.mp4',poster:'/course/a.png',controls:true})));
 assert.equal(h.requests.length,2);await act(async()=>{h.requests[0].resolve('/cache/a.mp4');h.requests[1].reject(Error('offline'));});assert.equal(h.host.querySelector('video').src,'asset:/cache/a.mp4');
 await act(async()=>h.host.querySelector('video').dispatchEvent(new window.Event('error')));await act(async()=>h.host.querySelector('button').click());assert.equal(h.requests.length,4);
 await act(async()=>h.root.render(React.createElement(Media,{src:'/course/b.mp4',controls:true})));await act(async()=>{h.requests[2].resolve('/cache/a.mp4');h.requests[3].resolve('/cache/a.png');});assert.equal(h.host.querySelector('video'),null);
 await act(async()=>h.requests[4].resolve('/cache/b.mp4'));assert.equal(h.host.querySelector('video').src,'asset:/cache/b.mp4');await h.close();
});


test('runtime archives reject build-machine and escaping links', async t => {
 const {spawnSync}=await import('node:child_process');
 if(process.platform!=='darwin'||process.arch!=='arm64'||spawnSync('python3',['--version']).status!==0){t.skip('current component packer supports macOS ARM64');return;}
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'course-archive-links-'));
 try{for(const [target,valid] of [['python3.12',true],['/builder/python3.12',false],['../../../private',false]]){
  const archive=join(dir,'runtime.tar.gz');
  const fixture=spawnSync('python3',['-c',"import tarfile,sys; t=tarfile.open(sys.argv[1],'w:gz'); h=tarfile.TarInfo('python/bin/python3'); h.type=tarfile.SYMTYPE; h.linkname=sys.argv[2]; t.addfile(h); t.close()",archive,target]);assert.equal(fixture.status,0);
  const result=spawnSync('python3',['scripts/resources/pack.py','--verify-archive',archive]);assert.equal(result.status===0,valid,target);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
