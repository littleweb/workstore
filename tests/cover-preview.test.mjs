import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectPreviews, validatePublished} from '../scripts/covers/preview-assets.mjs';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>');
for(const key of ['window','document','navigator','HTMLElement','Element','Node']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client'), require=createRequire(import.meta.url);
after(()=>dom.window.close());
const code=buildSync({entryPoints:['src/covers/Preview.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','@tauri-apps/api/core']}).outputFiles[0].text;
function harness(native=true) {
  const module={exports:{}}, requests=[], observers=[];
  vm.runInNewContext(code,{module,window,IntersectionObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},require:name=>name==='@tauri-apps/api/core'?{isTauri:()=>native,convertFileSrc:path=>`asset:${path}`,invoke:(command,args)=>new Promise((resolve,reject)=>requests.push({command,args,resolve,reject}))}:require(name)});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  return {...module.exports,host,root,requests,observers,close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
test('published catalog matches all originals and rejects an unpublished or changed index',()=>{
  const index=JSON.parse(readFileSync('src/covers/remote-previews.json')), entries=collectPreviews();
  validatePublished(index,entries);assert.equal(Object.keys(entries).length,277);
  assert.throws(()=>validatePublished({...index,commit:'main'},entries));
  assert.throws(()=>validatePublished({...index,entries:{}},entries));
});
test('invisible previews make no request; visible duplicate images share a request and retain local references',async()=>{
  const h=harness(), Preview=h.default;
  const render=()=>React.createElement(React.Fragment,null,[1,2].map(key=>React.createElement(Preview,{key,src:'/preview',fallback:'/reference.webp',alt:'风格'})));
  await act(async()=>h.root.render(render()));assert.equal(h.requests.length,0);assert.equal(h.host.querySelector('img').getAttribute('src'),'/reference.webp');
  await act(async()=>{h.observers.forEach(o=>o.callback([{isIntersecting:true}]));});
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].command,'cover_preview');
  await act(async()=>h.requests[0].resolve('/cache/verified.png'));
  assert.ok([...h.host.querySelectorAll('img')].every(img=>img.getAttribute('src')==='asset:/cache/verified.png'));
  await h.close();
});
test('failure falls back, reconnect retries, and a late previous preview cannot replace a new choice',async()=>{
  const h=harness(), Preview=h.default;
  const render=src=>React.createElement(Preview,{src,fallback:`${src}.webp`,alt:'画风',loading:'eager'});
  await act(async()=>h.root.render(render('/a')));
  await act(async()=>h.requests[0].reject(Error('offline')));
  assert.equal(h.host.querySelector('img').dataset.previewState,'unavailable');
  await act(async()=>window.dispatchEvent(new window.Event('online')));assert.equal(h.requests.length,2);
  await act(async()=>h.root.render(render('/b')));assert.equal(h.requests.length,3);
  await act(async()=>h.requests[1].resolve('/cache/a.png'));
  assert.equal(h.host.querySelector('img').getAttribute('src'),'/b.webp');
  await act(async()=>h.requests[2].resolve('/cache/b.png'));assert.equal(h.host.querySelector('img').getAttribute('src'),'asset:/cache/b.png');
  await h.close();
});
test('browser development uses the local gallery without native requests',async()=>{
  const h=harness(false);
  await act(async()=>h.root.render(React.createElement(h.default,{src:'/preview.png',fallback:'/ref.webp',alt:'浏览器'})));
  assert.equal(h.host.querySelector('img').getAttribute('src'),'/preview.png');assert.equal(h.requests.length,0);await h.close();
});
