import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');const require=createRequire(import.meta.url);
const code=buildSync({entryPoints:[new URL('../src/whiteboard/SelectionAssistant.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','antd','../ai/client','../ai/AiSidebar','../documentLifecycle','../workspace','@excalidraw/excalidraw']}).outputFiles[0].text;
after(()=>dom.window.close());
const drain=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const region={boardId:'board-a',elements:[{id:'t',type:'text',text:'Private text',originalText:'Private text',x:0,y:0,width:150,height:50,fontSize:20,fontFamily:2,lineHeight:1.2,strokeColor:'#333333',angle:0,opacity:100}]};
const diagram={kind:'whiteboard',title:'Flow',nodes:[{id:'a',label:'开始',shape:'rectangle',x:0,y:0,width:200,height:100}],edges:[]};
const response={text:JSON.stringify({kind:'whiteboard-turn',message:'绘制一个流程',changes:[],diagram}),saveError:null};
async function harness(options={}){
 const module={exports:{}};const calls=[],executions=[],writeStates=[],blockers=new Set(),captures=[];
 let attachment=options.attachment??null,boardId=options.empty?null:'board-a';
 vm.runInNewContext(code,{module,AbortController,structuredClone,require(id){
  if(id==='react'||id==='react/jsx-runtime')return require(id);
  if(id==='@excalidraw/excalidraw')return {getCommonBounds:elements=>{const e=elements[0];return [e.x,e.y,e.x+e.width,e.y+e.height];}};
  if(id==='../workspace')return {native:true};
  if(id==='../ai/AiSidebar')return {AiSidebar:({children})=>children};
  if(id==='../documentLifecycle')return {registerSyncActivationBlocker:fn=>{blockers.add(fn);return()=>blockers.delete(fn);}};
  if(id==='../ai/client')return {trackAiExecution:(_,task)=>task,ai:{generate:async(request,signal)=>{calls.push({request,signal});return options.wait?await options.wait.promise:options.response??response;}}};
  if(id==='antd')return {
   Alert:({title})=>React.createElement('div',{role:'alert'},title),
   Button:({children,onClick,onMouseDown,disabled})=>React.createElement('button',{onClick,onMouseDown,disabled},children),
   Checkbox:({checked,onChange,disabled,children})=>React.createElement('label',null,React.createElement('input',{type:'checkbox',checked,onChange,disabled}),children),
   Input:{TextArea:props=>React.createElement('textarea',{'aria-label':props['aria-label'],value:props.value,onChange:props.onChange,disabled:props.disabled})},
  };
  throw new Error(id);
 }});
 const target={retrySave:async()=>{},capture:(source,include)=>{captures.push({source,include});return {boardId,scoped:!!source,region:source??{...region,elements:include?region.elements:[]}};},execute:async(...args)=>{
  executions.push(args);args[3]({done:1,total:3,label:'正在绘制图形'});
  if(options.executeWait)await options.executeWait.promise;
  if(options.error)throw new Error(options.error);
  return {done:args[2].aborted?1:3,total:3,saved:options.saved!==false,stopped:args[2].aborted,region:attachment};
 }};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let closed=false;
 const onWriteState=value=>writeStates.push(value);
 const render=()=>root.render(React.createElement(module.exports.CanvasConversation,{boardId,attachment,target,onAttach:()=>{},onDetach:()=>{},onWriteState}));
 await act(async()=>render());
 return {host,calls,executions,captures,blockers,writeStates,
  button:text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text),
  async prompt(text='画一个流程图'){await act(async()=>{const input=host.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(input,text);input.dispatchEvent(new window.Event('input',{bubbles:true}));});},
  async click(text){await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===text).click();await drain();});},
  async switchBoard(id){boardId=id;await act(async()=>{render();await drain();});},
  async attach(value){attachment=value;await act(async()=>{render();await drain();});},
  async close(){if(closed)return;closed=true;await act(async()=>root.unmount());host.remove();},
 };
}
test('ordinary chat generates directly without requiring selection, modes or apply buttons',async()=>{
 const h=await harness();try{
  assert.equal(h.button('发送').disabled,true);assert.ok(!h.host.querySelector('[role="tablist"]'));
  await h.prompt();await h.click('发送');assert.equal(h.executions.length,1);assert.equal(h.captures[0].source,null);
  assert.equal(h.executions[0][1].diagram.nodes[0].label,'开始');assert.match(h.host.textContent,/已在白板完成 3 步/);
  assert.equal(h.button('应用'),undefined);assert.match(JSON.stringify(h.calls[0].request),/Private text/);
  await h.prompt('继续补充测试环节');await h.click('发送');assert.match(JSON.stringify(h.calls[1].request),/画一个流程图/);
 }finally{await h.close();}
});
test('canvas context can be disabled while standalone generation still works',async()=>{
 const h=await harness();try{
  await act(async()=>h.host.querySelector('input[type="checkbox"]').click());await h.prompt();await h.click('发送');
  assert.equal(h.captures[0].include,false);assert.ok(!JSON.stringify(h.calls[0].request).includes('Private text'));assert.equal(h.executions.length,1);
 }finally{await h.close();}
});
test('pure conversation answers without writing any scene',async()=>{
 const h=await harness({response:{text:JSON.stringify({kind:'whiteboard-turn',message:'建议先梳理目标。',changes:[],diagram:null})}});try{
  await h.prompt('有什么建议');await h.click('发送');assert.equal(h.executions.length,0);assert.match(h.host.textContent,/建议先梳理目标/);assert.match(h.host.textContent,/未修改白板/);
 }finally{await h.close();}
});
test('out-of-scope edits or invalid model output never execute',async()=>{
 for(const text of ['已经画好了',{kind:'whiteboard-turn',message:'修改',changes:[{id:'outside',text:'bad'}]}]){
  const h=await harness({response:{text:typeof text==='string'?text:JSON.stringify(text)}});try{await h.prompt();await h.click('发送');assert.equal(h.executions.length,0);assert.ok(h.host.querySelector('[role="alert"]'));}finally{await h.close();}
 }
});
test('planning and actual canvas progress are different states; stop during execution keeps completed work',async()=>{
 const wait=deferred(),executeWait=deferred();const h=await harness({wait,executeWait});try{
  await h.prompt();await h.click('发送');assert.match(h.host.textContent,/正在理解需求/);assert.equal(h.executions.length,0);
  await act(async()=>{wait.resolve(response);await drain();});assert.match(h.host.textContent,/正在绘制图形 1\/3/);assert.equal([...h.blockers][0](),true);
  await h.click('停止');assert.equal(h.executions[0][2].aborted,true);
  await act(async()=>{executeWait.resolve();await drain();});assert.match(h.host.textContent,/已停止，完成 1\/3/);assert.equal([...h.blockers][0](),false);
 }finally{await h.close();}
});
test('new board context allows sending without first manually creating a file',async()=>{
 const h=await harness({empty:true});try{await h.prompt();await h.click('发送');assert.equal(h.executions[0][0].boardId,null);}finally{await h.close();}
});
test('closing or switching files cancels a late planning result',async()=>{
 for(const close of [false,true]){
  const wait=deferred();const h=await harness({wait});try{await h.prompt();await h.click('发送');if(close)await h.close();else await h.switchBoard('other');assert.equal(h.calls[0].signal.aborted,true);await act(async()=>{wait.resolve(response);await drain();});assert.equal(h.executions.length,0);}finally{await h.close();}
 }
});
test('save failure does not invite automatic duplicate execution',async()=>{
 const h=await harness({saved:false});try{await h.prompt();await h.click('发送');assert.equal(h.executions.length,1);assert.match(h.host.textContent,/还没有保存成功/);assert.equal(h.button('发送').disabled,true);await h.click('重试保存已执行内容');await h.prompt('新的要求');assert.equal(h.button('发送').disabled,false);}finally{await h.close();}
});


test('first automatic board creation does not cancel its own in-progress drawing',async()=>{
 const executeWait=deferred();const h=await harness({empty:true,executeWait});try{
  await h.prompt();await h.click('发送');assert.equal(h.executions.length,1);
  await h.switchBoard('new-board');assert.equal(h.executions[0][2].aborted,false);
  await act(async()=>{executeWait.resolve();await drain();});assert.match(h.host.textContent,/已在白板完成 3 步/);
 }finally{await h.close();}
});
test('attaching another scope cancels the pending plan instead of applying to the new scope',async()=>{
 const wait=deferred();const h=await harness({wait});try{
  await h.prompt();await h.click('发送');await h.attach(region);assert.equal(h.calls[0].signal.aborted,true);
  await act(async()=>{wait.resolve(response);await drain();});assert.equal(h.executions.length,0);
 }finally{await h.close();}
});


test('an empty selected container receives real layout execution rather than a narrative-only answer',async()=>{
 const attachment={boardId:'board-a',containerId:'work-area',elements:[{id:'work-area',type:'rectangle',x:320,y:140,width:1000,height:800,angle:0,strokeColor:'#222',strokeWidth:1,roughness:1.2,opacity:100}]};
 const response={text:JSON.stringify({kind:'whiteboard-turn',message:'在框内补充创建作品表单',changes:[],diagram:null,layout:{containerId:'work-area',style:'hand-drawn',items:[{id:'title',type:'text',x:24,y:20,width:850,height:60,text:'创建作品',fontSize:36},{id:'button',type:'rectangle',x:680,y:620,width:260,height:65,text:'生成作品',fontSize:24}]}})};
 const h=await harness({attachment,response});try{
  assert.match(h.host.textContent,/框内绘制区域/);
  await h.prompt('在选区里面参照手绘风格完善创建作品的产品交互原型');await h.click('发送');
  assert.equal(h.executions.length,1);assert.equal(h.executions[0][1].layout.items.length,2);
  assert.match(h.calls[0].request.messages[0].content,/空矩形/);
  assert.match(h.calls[0].request.messages.at(-1).content,/可绘制区域/);
  assert.match(h.host.textContent,/完成 3 步/);assert.ok(!h.host.textContent.includes('未修改白板'));
 }finally{await h.close();}
});
