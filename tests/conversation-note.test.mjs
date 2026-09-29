import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const key of ['window','document','navigator','HTMLElement','Element','Node','DOMParser']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
const source = transformSync(readFileSync(new URL('../src/documents/ConversationNote.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
async function setup(initialContent) {
  let version=0, content, fail=false; const editors=[], errors=[];
  const module={exports:{}};
  vm.runInNewContext(source,{module,DOMParser,globalThis,require(id){
    if(['react','react/jsx-runtime'].includes(id)) return require(id);
    if(id==='./store') return {remoteVersion:()=>version,stageDocument:(_,p)=>{content=p.content;},flushDocuments:async()=>{if(fail) throw Error('disk');}};
    if(id==='@ant-design/icons') return {ArrowUpOutlined:()=>null};
    if(id==='antd') return {Tag:({children})=>React.createElement('span',{'data-testid':'time-tag'},children),App:{useApp:()=>({message:{error:e=>errors.push(e)}})},Button:({children,onClick,loading})=>React.createElement('button',{onClick,disabled:loading},children)};
    if(id==='@teabook/teaeditor') return {Editor:props=>{editors.push(props);return React.createElement('div',{'data-readonly':String(!!props.readOnly)},props.htmlContent);}};
    throw Error(id);
  }});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const mount=async value=>{await act(async()=>root.render(React.createElement(module.exports.default,{id:'note',content:value})));};
  await mount(initialContent ?? module.exports.emptyConversation());
  return {host,editors,errors,api:module.exports,get content(){return content;},get input(){return editors.findLast(x=>!x.readOnly);},setVersion(){version++;},fail(){fail=true;},async change(html){await act(async()=>this.input.onHtmlChange(html));},async send(){await act(async()=>host.querySelector('button').click());},async close(){await act(async()=>root.unmount());host.remove();},mount};
}
test('conversation records rich text in read-only cards and persists draft without feeding it back',async()=>{
 const h=await setup();try{
  const first=h.input;await h.change('<p><strong>第一条</strong></p>');assert.equal(h.input.htmlContent,'');
  assert.equal(JSON.parse(h.content).draft,'<p><strong>第一条</strong></p>');
  await h.send();assert.equal(JSON.parse(h.content).entries.length,1);assert.equal(JSON.parse(h.content).draft,'');
  assert.ok(Number.isFinite(JSON.parse(h.content).entries[0].createdAt));
  assert.notEqual(h.host.querySelector('[data-testid="time-tag"]').textContent,'时间未知');
  assert.equal(h.host.querySelectorAll('[data-readonly="true"]').length,1);assert.ok(h.editors.every(x=>x.hideToolbar));
  await act(async()=>first.onHtmlChange('<p>stale</p>'));assert.equal(JSON.parse(h.content).draft,'');
  await h.change('<p>第二条</p>');await h.send();assert.equal(JSON.parse(h.content).entries.length,2);
 }finally{await h.close();}
});
test('empty input and IME composition do not submit; old remote session cannot write',async()=>{
 const h=await setup();try{
  await h.change('<p><br></p>');await h.send();assert.equal(JSON.parse(h.content).entries.length,0);
  await h.change('<p>中文</p>');
  await act(async()=>h.host.querySelector('.conversation-composer').dispatchEvent(new window.CompositionEvent('compositionstart',{bubbles:true})));
  await h.send();assert.equal(JSON.parse(h.content).entries.length,0);
  await act(async()=>h.host.querySelector('.conversation-composer').dispatchEvent(new window.CompositionEvent('compositionend',{bubbles:true})));
  h.setVersion();const before=h.content;await h.change('<p>old</p>');await h.send();assert.equal(h.content,before);
 }finally{await h.close();}
});
test('save failure retains one record and draft reload preserves rich text',async()=>{
 const h=await setup();try{
  h.fail();await h.change('<p>keep</p>');await h.send();await h.send();assert.equal(JSON.parse(h.content).entries.length,1);assert.equal(h.errors.length,1);
  assert.equal(h.api.conversationContent('<p>normal note</p>'),null);
  assert.equal(h.api.conversationContent('{"type":"workstore.conversation","version":1,"draft":"","entries":[null]}'),null);
 }finally{await h.close();}
});

test('Cmd Enter submits once; Enter and composing key events do not submit',async()=>{
 const h=await setup();try{
  await h.change('<p>shortcut</p>');
  const box=h.host.querySelector('.conversation-composer');
  const key=async options=>{const event=new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options});await act(async()=>box.dispatchEvent(event));return event;};
  await key({});assert.equal(JSON.parse(h.content).entries.length,0);
  await key({metaKey:true,isComposing:true});assert.equal(JSON.parse(h.content).entries.length,0);
  await key({metaKey:true,repeat:true});assert.equal(JSON.parse(h.content).entries.length,0);
  const event=await key({metaKey:true});assert.equal(event.defaultPrevented,true);assert.equal(JSON.parse(h.content).entries.length,1);
 }finally{await h.close();}
});

test('legacy records without a timestamp remain visible without an invented time',async()=>{
 const h=await setup(JSON.stringify({type:'workstore.conversation',version:1,draft:'',entries:[{id:'old',html:'<p>old note</p>'}]}));
 try {assert.equal(h.host.querySelector('[data-testid="time-tag"]').textContent,'时间未知');assert.equal(h.host.querySelectorAll('[data-readonly="true"]').length,1);}
 finally{await h.close();}
});

test('remote cards append without replacing the live draft or remounting the input',async()=>{
 const h=await setup();try{
  await h.change('<p>local draft</p>');const input=h.input;
  await h.mount(JSON.stringify({draft:'remote draft',entries:[{id:'remote',html:'<p>remote card</p>',createdAt:100}],version:1,type:'workstore.conversation'}));
  assert.equal(h.host.querySelectorAll('[data-readonly="true"]').length,1);
  assert.equal(h.input.htmlContent,input.htmlContent);
  await h.send();const data=JSON.parse(h.content);assert.equal(data.entries.length,2);assert.equal(data.entries[1].html,'<p>local draft</p>');
 }finally{await h.close();}
});
