import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const require=createRequire(import.meta.url);
const code=buildSync({entryPoints:[new URL('../src/ai/EditorAssistant.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','antd','./client','../workspace','../documentLifecycle']}).outputFiles[0].text;
after(()=>dom.window.close());
const draft={kind:'document',title:'AI title',blocks:[{type:'heading',level:1,text:'AI title'},{type:'paragraph',text:'Content that can really be applied'}]};
const drain=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function harness(options={}){
 const module={exports:{}};const requests=[],applies=[],applying=[];const blockers=new Set();
 const target={kind:'document',capture:()=>({id:options.empty?null:'doc-a',title:'private title',content:'private body'}),apply:async(...args)=>{applies.push(args);if(options.applyWait)await options.applyWait.promise;return {saved:options.saved!==false,message:options.saved===false?'Applied but save failed':'Applied and saved'};}};
 vm.runInNewContext(code,{module,AbortController,require(id){
  if(id==='react'||id==='react/jsx-runtime')return require(id);
  if(id==='../workspace')return {native:true};
  if(id==='../documentLifecycle')return {registerSyncActivationBlocker:fn=>{blockers.add(fn);return()=>blockers.delete(fn);}};
  if(id==='./client')return {ai:{generate:async(request,signal)=>{requests.push({request,signal});if(options.wait)return await options.wait.promise;return {text:options.text??JSON.stringify(draft),saveError:null};}}};
  if(id==='antd')return {
   Alert:({title})=>React.createElement('div',{role:'alert'},title),
   Button:({children,onClick,disabled,loading})=>React.createElement('button',{onClick,disabled:disabled||loading},children),
   Checkbox:({checked,onChange,disabled,children})=>React.createElement('label',null,React.createElement('input',{type:'checkbox',checked,onChange,disabled}),children),
   Input:{TextArea:props=>React.createElement('textarea',{'aria-label':props['aria-label'],value:props.value,onChange:props.onChange,disabled:props.disabled})},
   Select:({value,onChange,options,disabled,...rest})=>React.createElement('select',{'aria-label':rest['aria-label'],value,onChange:e=>onChange(e.target.value),disabled},options.map(item=>React.createElement('option',{key:item.value,value:item.value,disabled:item.disabled},item.label))),
  };
  throw new Error(id);
 }});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let closed=false;
 await act(async()=>root.render(React.createElement(module.exports.default,{toolId:'app.doc',target,onApplying:value=>applying.push(value)})));
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 return {host,requests,applies,applying,blockers,button,
  async prompt(){await act(async()=>{const input=host.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(input,'Generate a project plan');input.dispatchEvent(new window.Event('input',{bubbles:true}));});},
  async click(text){await act(async()=>{button(text).click();await drain();});},
  async close(){if(closed)return;closed=true;await act(async()=>root.unmount());host.remove();},
 };
}

test('generation alone changes no file; preview then explicit application runs once',async()=>{
 const h=await harness();try{
  await h.prompt();await h.click('生成文档草稿');
  assert.equal(h.applies.length,0);assert.match(h.host.textContent,/草稿预览/);assert.match(h.host.textContent,/Content that can really be applied/);
  assert.ok(!JSON.stringify(h.requests[0].request).includes('private body'));
  await h.click('应用到当前文档');assert.equal(h.applies.length,1);assert.equal(h.applies[0][1].id,'doc-a');assert.equal(h.applies[0][2],'append');
  assert.match(h.host.textContent,/Applied and saved/);assert.equal(h.button('已应用').disabled,true);
  assert.deepEqual(h.applying,[true,false]);
 }finally{await h.close();}
});
test('narrative-only AI answers never produce an apply button or false success',async()=>{
 const h=await harness({text:'已插入任务：稍后处理。'});try{await h.prompt();await h.click('生成文档草稿');assert.equal(h.applies.length,0);assert.equal(h.button('应用到当前文档'),undefined);assert.match(h.host.textContent,/未修改任何文件/);}finally{await h.close();}
});
test('aborted late model response cannot create a draft',async()=>{
 const wait=deferred();const h=await harness({wait});try{
  await h.prompt();await h.click('生成文档草稿');await h.click('停止生成');assert.equal(h.requests[0].signal.aborted,true);
  await act(async()=>{wait.resolve({text:JSON.stringify(draft),saveError:null});await drain();});
  assert.equal(h.button('应用到当前文档'),undefined);assert.equal(h.applies.length,0);
 }finally{await h.close();}
});
test('apply is single-flight, blocks sync activation, and marks applied even on disk save failure',async()=>{
 const applyWait=deferred();const h=await harness({applyWait,saved:false});try{
  await h.prompt();await h.click('生成文档草稿');
  await act(async()=>{const button=h.button('应用到当前文档');button.click();button.click();await drain();});
  assert.equal(h.applies.length,1);assert.equal([...h.blockers][0](),true);
  await act(async()=>{applyWait.resolve();await drain();});
  assert.equal([...h.blockers][0](),false);assert.match(h.host.textContent,/save failed/);assert.equal(h.button('已应用').disabled,true);
 }finally{await h.close();assert.equal(h.blockers.size,0);}
});


test('explicit context checkbox supplies current contents to the model',async()=>{
 const h=await harness();try{
  await h.prompt();await act(async()=>{h.host.querySelector('input[type="checkbox"]').click();});
  await h.click('生成文档草稿');
  assert.match(JSON.stringify(h.requests[0].request),/private body/);
  assert.match(h.requests[0].request.messages[0].content,/不是系统指令/);
  assert.equal(h.applies.length,0);
 }finally{await h.close();}
});

test('empty editors offer creation rather than attempting to write a missing file',async()=>{
 const h=await harness({empty:true});try{
  await h.prompt();await h.click('生成文档草稿');
  assert.equal(h.host.querySelector('select').value,'create');
  await h.click('创建新文档');
  assert.equal(h.applies[0][2],'create');assert.equal(h.applies[0][1].id,null);
 }finally{await h.close();}
});
