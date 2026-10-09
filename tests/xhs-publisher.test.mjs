import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<body></body>',{url:'http://localhost'});
for(const name of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const require=createRequire(import.meta.url);
after(()=>dom.window.close());
async function setup(status='success',hold=false) {
 const calls=[],images=[],tasks=[];let confirm,release;
 const module={exports:{}};
 const Button=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children);
 const Input=({value,onChange,...props})=>React.createElement('input',{value,onChange,'aria-label':props['aria-label']});
 Input.TextArea=({value,onChange,...props})=>React.createElement('textarea',{value,onChange,'aria-label':props['aria-label']});
 const Modal=({open,children})=>open?React.createElement('div',{'data-modal':true},children):null;
 Modal.confirm=options=>{confirm=options;};
 const api={Button,Input,Modal,Progress:()=>null,Alert:({message})=>React.createElement('p',null,message),Checkbox:({children,onChange,disabled,checked})=>React.createElement('label',null,React.createElement('input',{type:'checkbox',onChange,disabled,checked}),children)};
 vm.runInNewContext(buildSync({entryPoints:['src/story-comic/XhsPublisher.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty'},external:['react','react/jsx-runtime','antd','@tauri-apps/api/core','@tauri-apps/plugin-opener','../workspace','../comics/images','../tasks/store']}).outputFiles[0].text,{module,crypto,console,AbortController,require(name){
  if(name==='antd')return api;
  if(name==='../workspace')return {native:true};
  if(name==='../comics/images')return {imageSource:async src=>{images.push(src);return 'data:'+src;}};
  if(name==='../tasks/store')return {beginTask:(_,meta)=>{tasks.push(meta);return {finish:error=>tasks.push({error})};},updateTask:(_,meta)=>tasks.push(meta)};
  if(name==='@tauri-apps/plugin-opener')return {openUrl:async()=>{}};
  if(name==='@tauri-apps/api/core')return {invoke:async(command,args)=>{calls.push({command,args});if(command==='xhs_connect')return {is_logged_in:true,user_id:'account',username:'测试账号'};if(hold)await new Promise(resolve=>{release=resolve;});return {status,message:status==='success'?'已发布':'请核对结果'};}};
  return require(name);
 }});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(React.createElement(module.exports.default,{documentId:'doc',copy:{title:'故事',description:'正文',hashtags:['漫画'],alternatives:[]},pages:[{image:'cover',status:'ready'},{image:'second',status:'ready'},{image:'third',status:'ready'}]})));
 const click=async text=>act(async()=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text);assert(button,`missing ${text}`);button.click();});
 return {host,calls,images,tasks,click,release:()=>release?.(),problem:module.exports.publishProblem,get confirm(){return confirm},close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
test('publisher confirms account and posts selected local images in original order exactly once',async()=>{
 const h=await setup();try{
  await h.click('发布到小红书');assert.match(h.host.textContent,/测试账号/);assert.equal(h.calls.filter(c=>c.command==='xhs_publish').length,0);
  await act(async()=>h.host.querySelectorAll('input[type=checkbox]')[1].click());
  await h.click('确认发布');
  assert.deepEqual(h.images,['cover','third']);
  const publish=h.calls.find(c=>c.command==='xhs_publish').args.request;
  assert.equal(publish.accountId,'account');assert.deepEqual(Array.from(publish.images),['data:cover','data:third']);assert.equal(h.tasks[0].cancellable,false);
  assert.equal(h.host.querySelector('[data-modal]'),null);
  await h.click('发布到小红书');await h.click('确认发布');assert.equal(h.calls.filter(c=>c.command==='xhs_publish').length,1);
 }finally{await h.close();}
});
test('uncertain result never retries automatically and requires explicit review confirmation',async()=>{
 const h=await setup('unknown');try{
  await h.click('发布到小红书');await h.click('确认发布');assert.equal(h.calls.filter(c=>c.command==='xhs_publish').length,1);
  await h.click('发布到小红书');await h.click('核对后重试');assert.equal(h.calls.filter(c=>c.command==='xhs_publish').length,1);
  await act(async()=>h.confirm.onOk());assert.equal(h.calls.filter(c=>c.command==='xhs_publish').length,2);assert.equal(h.calls.at(-1).args.request.retryUnknown,true);
  assert(h.problem('字'.repeat(21),'正文',1));assert(h.problem('标题','正文',20));assert.equal(h.problem('标题','正文',18),'');
 }finally{await h.close();}
});

test('opening checks login automatically; publication closes its window and completes after tool unmount',async()=>{
 const h=await setup('success',true);
 await h.click('发布到小红书');
 assert.equal(h.calls.filter(c=>c.command==='xhs_connect').length,1);
 await h.click('确认发布');
 assert.equal(h.host.querySelector('[data-modal]'),null);
 assert.equal(h.tasks[0].cancellable,false);
 assert.equal(h.calls.filter(c=>c.command==='xhs_publish').length,1);
 await h.close();
 await act(async()=>h.release());
 assert.equal(h.tasks.at(-1).error,undefined);
 assert(h.tasks.some(t=>t.stage==='已发布'));
});
