import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectDesignAssets,validateDesignPublished} from '../scripts/design-studio/assets.mjs';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><body></body>');
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client'),require=createRequire(import.meta.url);
after(()=>dom.window.close());
const code=buildSync({entryPoints:['src/design-studio/RemoteImage.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','@tauri-apps/api/core']}).outputFiles[0].text;
function harness(native=true){
 const module={exports:{}},requests=[],observers=[];
 vm.runInNewContext(code,{module,window,IntersectionObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}},require:name=>name==='@tauri-apps/api/core'?{isTauri:()=>native,convertFileSrc:path=>`asset:${path}`,invoke:(command,args)=>new Promise((resolve,reject)=>requests.push({command,args,resolve,reject}))}:require(name)});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 return {...module.exports,host,root,requests,observers,close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
test('immutable design index covers every catalog reference; altered or mutable revisions fail',()=>{
 const entries=collectDesignAssets(),index=JSON.parse(readFileSync('src/design-studio/remote-assets.json'));
 validateDesignPublished(index,entries);assert.equal(Object.keys(entries).length,1018);
 assert.equal(Object.values(entries).reduce((n,e)=>n+e.size,0),179235346);
 assert.throws(()=>validateDesignPublished({...index,commit:'main'},entries));
 assert.throws(()=>validateDesignPublished({...index,entries:{}},entries));
});
test('publishing rejects private/path traversal and non-WebP content before upload',()=>{
 const root=mkdtempSync(join(tmpdir(),'workstore-design-assets-'));
 try{
  mkdirSync(join(root,'src/design-studio'),{recursive:true});mkdirSync(join(root,'public/design-studio/covers'),{recursive:true});
  const catalog=join(root,'src/design-studio/catalog.json');writeFileSync(catalog,JSON.stringify([{cover:'/design-studio/../../secret.webp'}]));assert.throws(()=>collectDesignAssets(root),/路径/);
  writeFileSync(catalog,JSON.stringify([{cover:'/design-studio/covers/a.webp'}]));writeFileSync(join(root,'public/design-studio/covers/a.webp'),'not an image');assert.throws(()=>collectDesignAssets(root),/无效/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('offscreen cards make no request; visible duplicates share one verified cached source',async()=>{
 const h=harness(),Image=h.default;
 await act(async()=>h.root.render(React.createElement(React.Fragment,null,[1,2].map(key=>React.createElement(Image,{key,src:'/design-studio/covers/a.webp',alt:'图片'})))));
 assert.equal(h.requests.length,0);assert.equal(h.host.querySelectorAll('img').length,0);
 await act(async()=>h.observers.forEach(o=>o.callback([{isIntersecting:true}])));assert.equal(h.requests.length,1);assert.equal(h.requests[0].command,'design_asset');
 await act(async()=>h.requests[0].resolve('/cache/a.webp'));assert.ok([...h.host.querySelectorAll('img')].every(img=>img.src==='asset:/cache/a.webp'));await h.close();
});
test('offline placeholders support manual retry, reconnect and ignore late previous results',async()=>{
 const h=harness(),Image=h.default,render=src=>React.createElement(Image,{src,alt:'示例',loading:'eager'});
 await act(async()=>h.root.render(render('/a')));await act(async()=>h.requests[0].reject(Error('offline')));
 assert.equal(h.host.querySelector('.ds-remote-image').dataset.assetState,'unavailable');
 await act(async()=>h.host.querySelector('[role=button]').click());assert.equal(h.requests.length,2);
 await act(async()=>h.root.render(render('/b')));assert.equal(h.requests.length,3);
 await act(async()=>h.requests[1].resolve('/cache/a.webp'));assert.equal(h.host.querySelector('img'),null);
 await act(async()=>h.requests[2].reject(Error('offline')));await act(async()=>window.dispatchEvent(new window.Event('online')));assert.equal(h.requests.length,4);
 await act(async()=>h.requests[3].resolve('/cache/b.webp'));assert.equal(h.host.querySelector('img').src,'asset:/cache/b.webp');await h.close();
});
test('image decode errors invalidate memory cache and retry; unmount never applies late responses',async()=>{
 const h=harness(),Image=h.default;
 await act(async()=>h.root.render(React.createElement(Image,{src:'/x',alt:'示例',loading:'eager'})));
 await act(async()=>h.requests[0].resolve('/cache/x.webp'));await act(async()=>h.host.querySelector('img').dispatchEvent(new window.Event('error')));
 await act(async()=>h.host.querySelector('[role=button]').click());assert.equal(h.requests.length,2);
 await h.close();await act(async()=>h.requests[1].resolve('/cache/x.webp'));assert.equal(h.host.childNodes.length,0);
});
test('browser development keeps original local images without download requests',async()=>{
 const h=harness(false);await act(async()=>h.root.render(React.createElement(h.default,{src:'/design-studio/covers/a.webp',alt:'封面'})));
 assert.equal(h.host.querySelector('img').getAttribute('src'),'/design-studio/covers/a.webp');assert.equal(h.requests.length,0);await h.close();
});

test('course thumbnails use their own command and ignore late results when switching catalogs',async()=>{
 const h=harness(),Image=h.default;
 await act(async()=>h.root.render(React.createElement(Image,{src:'/same',alt:'课程',command:'course_asset',loading:'eager'})));
 assert.equal(h.requests[0].command,'course_asset');
 await act(async()=>h.root.render(React.createElement(Image,{src:'/same',alt:'设计',loading:'eager'})));
 assert.equal(h.requests[1].command,'design_asset');
 await act(async()=>h.requests[0].resolve('/cache/course.png'));assert.equal(h.host.querySelector('img'),null);
 await act(async()=>h.requests[1].resolve('/cache/design.webp'));assert.equal(h.host.querySelector('img').src,'asset:/cache/design.webp');await h.close();
});
