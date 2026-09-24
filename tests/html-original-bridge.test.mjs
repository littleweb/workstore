import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<body></body>',{url:'http://127.0.0.1:43187/',referrer:'http://127.0.0.1:1420/'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');const require=createRequire(import.meta.url);
const code=buildSync({entryPoints:[new URL('../scripts/html-anything/WorkStoreBridge.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','@/lib/store','@/lib/use-convert']}).outputFiles[0].text;
after(()=>dom.window.close());
async function harness(alreadyApplied=false){
 if(alreadyApplied)window.localStorage.setItem('workstore:html-codex-default-v1','1');else window.localStorage.removeItem('workstore:html-codex-default-v1');
 const selected=[];const sent=[],cancelled=[];const parent={postMessage:(...args)=>sent.push(args)};Object.defineProperty(window,'parent',{value:parent,configurable:true});
 window.localStorage.setItem('html-everything-store','{"state":{"tasks":[{"id":"test"}]}}');
 window.localStorage.setItem('unrelated-secret','not-to-be-exported');
 const module={exports:{}};
 const cancel=id=>cancelled.push(id);
 vm.runInNewContext(code,{module,window,document,Element:window.Element,HTMLAnchorElement:window.HTMLAnchorElement,URL,URLSearchParams,setTimeout,fetch:async()=>({arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}),localStorage:window.localStorage,indexedDB:{open(){const request={};queueMicrotask(()=>request.onsuccess());request.result={objectStoreNames:{contains:()=>true},close(){},transaction(){const tx={objectStore:()=>({getAll:()=>({result:[{id:'test__1',html:'<h1>saved</h1>'}]})})};queueMicrotask(()=>tx.oncomplete());return tx;}};return request;}},require(id){
 if(id==='react'||id==='react/jsx-runtime')return require(id);
 if(id==='@/lib/store')return {useStore:{persist:{hasHydrated:()=>true,onFinishHydration:()=>()=>{}},getState:()=>({setSelectedAgent:id=>selected.push(id),tasks:[{id:'running',status:'running'},{id:'done',status:'done'}]})}};
 if(id==='@/lib/use-convert')return {useConvert:()=>({cancel})};throw new Error(id);
 }});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(React.createElement(module.exports.default)));
 return {sent,cancelled,selected,parent,async send(data,origin='http://127.0.0.1:1420',source=parent){await act(async()=>{window.dispatchEvent(new window.MessageEvent('message',{data,origin,source}));await new Promise(r=>setTimeout(r,5));});},async close(){await act(async()=>root.unmount());host.remove();}};
}
test('original bridge accepts only its exact parent/origin and flushes upstream state plus history',async()=>{const h=await harness();try{
 assert.equal(h.sent[0][0].type,'workstore:html-ready');
 await h.send({type:'workstore:html-request',requestId:'bad',action:'flush'},'https://evil.example');assert.equal(h.sent.length,1);
 await h.send({type:'workstore:html-request',requestId:'good',action:'flush'});
 const snapshot=h.sent.at(-1)[0].snapshot;assert.equal(snapshot.schemaVersion,1);assert.equal(snapshot.history[0].id,'test__1');assert.equal(snapshot.local['unrelated-secret'],undefined);assert.ok(snapshot.local['html-everything-store']);assert.deepEqual(h.cancelled,[]);
 }finally{await h.close()}});
test('stop lifecycle cancels only active upstream tasks and still returns a durable snapshot',async()=>{const h=await harness();try{await h.send({type:'workstore:html-request',requestId:'stop',action:'stop'});assert.deepEqual(h.cancelled,['running']);assert.ok(h.sent.at(-1)[0].snapshot);}finally{await h.close()}});
test('desktop download bridge forwards original bytes and filename without accepting a destination path',async()=>{const h=await harness();try{
 await h.send({type:'workstore:html-init',desktop:true});
 const a=document.createElement('a');a.href='blob:http://127.0.0.1:43187/test';a.download='original.png';document.body.append(a);
 await act(async()=>{a.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,5));});a.remove();
 const data=h.sent.at(-1)[0];assert.equal(data.type,'workstore:html-download');assert.equal(data.filename,'original.png');assert.equal(data.path,undefined);assert.deepEqual([...new Uint8Array(data.data)],[1,2,3]);
 }finally{await h.close()}});

test('WorkStore defaults the hydrated original store to Codex',async()=>{const h=await harness();try{assert.deepEqual(h.selected,['codex']);assert.equal(window.localStorage.getItem('workstore:html-codex-default-v1'),'1');}finally{await h.close()}});

test('Codex default migration does not override subsequent user selections',async()=>{const h=await harness(true);try{assert.deepEqual(h.selected,[]);}finally{await h.close()}});
