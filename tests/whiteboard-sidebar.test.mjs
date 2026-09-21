import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');const require=createRequire(import.meta.url);
const style=document.createElement('style');style.textContent=readFileSync(new URL('../src/ai/ai.css',import.meta.url),'utf8');document.head.append(style);
const code=transformSync(readFileSync(new URL('../src/whiteboard/Whiteboard.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
after(()=>dom.window.close());
const drain=()=>new Promise(resolve=>setImmediate(resolve));
test('marquee selection can be attached through the toolbar and the AI panel docks without replacing the canvas',async()=>{
 const module={exports:{}};let change,captured=0,attached,apiReceived=false;
 const doc={id:'board',title:'Test',favorite:false,createdAt:1,lastOpenedAt:1,scene:{elements:[],files:{},appState:{}}};
 const snapshot={boardId:'board',elements:[{id:'selected'}]};
 vm.runInNewContext(code,{module,require(id){
  if(id==='react'||id==='react/jsx-runtime')return require(id);
  if(id==='./SelectionAssistant')return {__esModule:true,default:props=>{attached=props.attachment;return React.createElement('aside',{className:'ai-sidebar','aria-label':'AI 助手侧栏'},React.createElement('button',{onClick:props.onClose},'Close'));}};
  if(id==='./selectionTarget')return {whiteboardSelectionTarget:(getId,getCanvas)=>({capture:()=>{assert.equal(getId(),'board');assert.ok(getCanvas());captured++;return snapshot;}})};
  if(id==='./conversationTarget')return {whiteboardConversationTarget:()=>({capture(){},execute:async()=>({})})};
  if(id==='../workspace')return {native:true};
  if(id==='../documentLifecycle')return {registerSyncActivationBlocker:()=>()=>{}};
  if(id==='./store')return {lastBoardId:'board',boardList:()=>[doc],boardStatus:()=> '已保存到本地',boardWarnings:()=>[],currentBoard:()=>doc,remoteVersion:()=>0,subscribe:()=>()=>{},refreshBoards:async()=>{},openBoard:async()=>doc,flushWhiteboards:async()=>{},stageBoard:()=>{}};
  if(id==='@excalidraw/excalidraw')return {
   Excalidraw:props=>{change=props.onChange;React.useEffect(()=>{props.excalidrawAPI({id:'live-api'});apiReceived=true;},[props.excalidrawAPI]);return React.createElement('div',{'data-canvas':true},props.children);},
   serializeAsJSON:()=>JSON.stringify(doc.scene),MainMenu:Object.assign(({children})=>children,{Item:()=>null,Separator:()=>null,DefaultItems:{Export:()=>null,ClearCanvas:()=>null,ToggleTheme:()=>null,ChangeCanvasBackground:()=>null}}),
  };
  if(id==='antd')return {
   App:{useApp:()=>({message:{error(){},warning(){}}})},
   Button:({children,onClick,onMouseDown,disabled})=>React.createElement('button',{onClick,onMouseDown,disabled},children),
   Dropdown:({children})=>children,Modal:({open,children})=>open?React.createElement('div',{role:'dialog'},children):null,Input:()=>null,
  };
  if(id==='./WhiteboardIcon')return {__esModule:true,default:()=>null};
  if(id==='@ant-design/icons')return new Proxy({},{get:()=>()=>null});
  if(id.endsWith('.css')||id==='./assets')return {};
  throw new Error(id);
 }});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>{root.render(React.createElement(module.exports.default));await drain();});
  assert.equal(apiReceived,true);
  const canvas=host.querySelector('[data-canvas]');
  await act(async()=>{change([],{selectedElementIds:{selected:true},editingTextElement:null},{});});
  const attach=[...host.querySelectorAll('button')].find(button=>button.textContent.startsWith('加入 AI 对话'));
  assert.equal(attach.disabled,false);
  await act(async()=>{attach.click();await drain();});
  assert.equal(captured,1);assert.equal(attached,snapshot);
  const sidebar=host.querySelector('.ai-sidebar');assert.ok(sidebar);
  assert.equal(sidebar.parentElement,host.querySelector('.whiteboard-body'));assert.equal(sidebar.previousElementSibling,host.querySelector('.board-workspace'));
  assert.equal(window.getComputedStyle(sidebar).display,'flex');assert.ok(['','static'].includes(window.getComputedStyle(sidebar).position));
  assert.equal(host.querySelector('[role="dialog"]'),null);assert.equal(host.querySelector('[data-canvas]'),canvas);
  await act(async()=>{sidebar.querySelector('button').click();await drain();});
  assert.equal(host.querySelector('.ai-sidebar'),null);assert.equal(host.querySelector('[data-canvas]'),canvas);
 }finally{await act(async()=>root.unmount());host.remove();}
});
