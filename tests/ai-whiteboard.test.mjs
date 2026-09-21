import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync, transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

// Exercise the installed Excalidraw converter, not a fake element serializer.
// jsdom lacks canvas measurement: provide deterministic metrics only; binding,
// IDs, element schemas, text containers and scene serialization remain real.
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/',pretendToBeVisual:true});
const require=createRequire(import.meta.url);
const context={console,require, module:{exports:{}},process,crypto:globalThis.crypto,setTimeout,clearTimeout,setInterval,clearInterval};
for(const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in context) && !key.startsWith('_')) {try {context[key]=dom.window[key];}catch{}}
}
context.FontFace=class {constructor(family){this.family=family;this.status='loaded';}load(){return Promise.resolve(this);}};
Object.defineProperty(dom.window.document,'fonts',{value:{check:()=>true,has:()=>true,add(){},load:async()=>[]}});
context.window=dom.window;context.document=dom.window.document;context.self=dom.window;context.top=dom.window;
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
dom.window.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({filter:'none',measureText:text=>({width:String(text).length*8}),canvas:this},{get:(obj,key)=>key in obj?obj[key]:()=>{}});};
const bundle=buildSync({stdin:{contents:'export {convertToExcalidrawElements, serializeAsJSON, restore, restoreElements, newElementWith, CaptureUpdateAction, getCommonBounds, exportToSvg} from "@excalidraw/excalidraw";',resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,platform:'browser',format:'cjs',external:['react','react-dom','react/jsx-runtime'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text;
vm.runInNewContext(bundle,context);
const excalidraw=context.module.exports;
after(()=>dom.window.close());
function load(path,deps){const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module,document:dom.window.document,crypto:globalThis.crypto,structuredClone,require:id=>{if(id in deps)return deps[id];throw new Error(id);}});return module.exports;}
const editing=load('../src/ai/editing.ts',{});
const draft=editing.parseEditorDraft(JSON.stringify({kind:'whiteboard',title:'Test flow',nodes:[{id:'a',label:'Start',shape:'rectangle',x:0,y:0,width:200,height:100},{id:'b',label:'Review',shape:'diamond',x:400,y:0,width:200,height:100}],edges:[{from:'a',to:'b',label:'submit'}]}),'whiteboard');
let active='a',failed=false;
const scene={type:'excalidraw',version:2,source:'WorkStore',elements:[],files:{},appState:{viewBackgroundColor:'#ffffff'}};
const boards=new Map();
const store={currentBoard:id=>boards.get(id),flushWhiteboards:async()=>{},flushBoard:async()=>{if(failed)throw new Error('disk full');},createBoard:async()=>{boards.set('new',{id:'new',title:'Untitled',scene:structuredClone(scene)});return boards.get('new');},stageBoard:(id,patch)=>Object.assign(boards.get(id),patch),applyBoardScene:(id,scene)=>{boards.get(id).scene=scene;}};
const module=load('../src/whiteboard/aiTarget.ts',{'../ai/editing':editing,'./store':store,'@excalidraw/excalidraw':excalidraw});
function reset(){active='a';failed=false;boards.clear();boards.set('a',{id:'a',title:'Existing',scene:structuredClone(scene)});return module.whiteboardAiTarget(()=>active,id=>{active=id;});}

test('real Excalidraw conversion creates editable bound text and connected arrows with safe unique IDs',()=>{
 const elements=module.draftElements(draft);
 assert.equal(elements.filter(e=>e.type==='text').length,3);
 const arrow=elements.find(e=>e.type==='arrow');assert.ok(arrow);
 const ids=new Set(elements.map(e=>e.id));assert.equal(ids.size,elements.length);
 assert.ok(ids.has(arrow.startBinding.elementId));assert.ok(ids.has(arrow.endBinding.elementId));
 for(const text of elements.filter(e=>e.type==='text'))assert.ok(ids.has(text.containerId));
 const other=module.draftElements(draft);assert.ok(other.every(e=>!ids.has(e.id)));
 const json=excalidraw.serializeAsJSON(elements,{viewBackgroundColor:'#ffffff'}, {},'local');
 assert.equal(JSON.parse(json).elements.length,elements.length);
 assert.ok(elements.every(e=>!['image','iframe','embeddable'].includes(e.type)));
});
test('whiteboard append retains existing elements/files and puts the new diagram to the right',async()=>{
 const target=reset();const existing=module.draftElements(draft);boards.get('a').scene.elements=existing;boards.get('a').scene.files={saved:{id:'saved',dataURL:'data:image/png;base64,AAA'}};
 const source=target.capture();await target.apply(draft,source,'append');
 const current=boards.get('a');assert.equal(current.title,'Existing');assert.equal(current.scene.elements.length,existing.length*2);
 assert.equal(JSON.stringify(current.scene.elements.slice(0,existing.length)),JSON.stringify(existing));
 const restored=excalidraw.restore(current.scene,null,null);
 assert.equal(restored.elements.length,current.scene.elements.length);
 assert.equal(new Set(restored.elements.map(e=>e.index)).size,restored.elements.length);
 assert.equal(current.scene.files.saved.id,'saved');assert.equal(current.scene.scrollToContent,true);
 const right=Math.max(...existing.map(e=>e.x+e.width));assert.ok(current.scene.elements.slice(existing.length).every(e=>e.x>=right));
});
test('whiteboard replace rejects a newer scene and new-file application preserves the source',async()=>{
 const target=reset();const source=target.capture();boards.get('a').scene.elements=module.draftElements(draft);
 await assert.rejects(target.apply(draft,source,'replace'),/阻止覆盖/);
 const before=JSON.stringify(boards.get('a'));
 await target.apply(draft,source,'create');assert.equal(JSON.stringify(boards.get('a')),before);assert.equal(active,'new');assert.equal(boards.get('new').title,'Test flow');
});
test('whiteboard save failure is reported as applied-but-unsaved without undoing the local scene',async()=>{
 const target=reset();failed=true;
 const result=await target.apply(draft,target.capture(),'replace');assert.equal(result.saved,false);assert.ok(boards.get('a').scene.elements.length>0);
});


const regionLayout=load('../src/whiteboard/regionLayout.ts',{'@excalidraw/excalidraw':excalidraw});
const scoped=load('../src/whiteboard/selectionEditing.ts',{'@excalidraw/excalidraw':excalidraw,'./regionLayout':regionLayout});
function coloredScene(){
 return excalidraw.convertToExcalidrawElements([
  {id:'node-a',type:'rectangle',x:0,y:0,width:250,height:130,strokeColor:'#c92a2a',backgroundColor:'#fff3bf',fillStyle:'hachure',roughness:2,strokeWidth:3,label:{text:'Start',fontSize:24,fontFamily:2}},
  {id:'node-b',type:'ellipse',x:500,y:0,width:230,height:120,strokeColor:'#1864ab',backgroundColor:'#d0ebff',label:{text:'Outside',fontSize:18,fontFamily:2}},
 ],{regenerateIds:false});
}
const styleKeys=['id','type','strokeColor','backgroundColor','fillStyle','strokeWidth','strokeStyle','roughness','opacity','angle','fontSize','fontFamily','textAlign','verticalAlign','containerId','boundElements','groupIds','frameId'];
test('selection capture expands bound labels but not the rest of the board',()=>{
 const elements=coloredScene(); const selected=scoped.captureSelection('board',elements,{'node-a':true});
 assert.equal(selected.elements.length,2); assert.ok(selected.elements.every(e=>e.id==='node-a'||e.containerId==='node-a'));
 const label=elements.find(e=>e.containerId==='node-a');
 assert.equal(scoped.captureSelection('board',elements,{[label.id]:true}).elements.length,2);
 assert.throws(()=>scoped.captureSelection('board',elements,{}),/先在白板/);
 assert.throws(()=>scoped.captureSelection('board',elements.map(e=>({...e,locked:true})),{'node-a':true}),/锁定/);
});
test('selected text replacement preserves exact style, IDs and all outside elements',()=>{
 const elements=coloredScene();const source=scoped.captureSelection('board',elements,{'node-a':true});
 const label=source.elements.find(e=>e.type==='text');
 const patch=scoped.parseSelectionPatch(JSON.stringify({kind:'whiteboard-selection',summary:'Translate',changes:[{id:label.id,text:'开始'}]}),source);
 const before=JSON.stringify(elements); const result=scoped.mergeSelectionPatch(elements,source,patch);
 assert.equal(JSON.stringify(elements),before,'never mutate the original scene'); assert.equal(result.changed,true);
 const updated=result.elements.find(e=>e.id===label.id);assert.equal(updated.originalText,'开始');assert.equal(updated.text,'开始');
 for(const old of elements){const next=result.elements.find(e=>e.id===old.id);
  for(const key of styleKeys)assert.equal(JSON.stringify(next[key]),JSON.stringify(old[key]),key);
  if(!source.elements.some(e=>e.id===old.id)) assert.equal(next,old,'outside object identity must be retained');
 }
 assert.equal(result.elements.length,elements.length);
});
test('selection edits reject stale selected content but allow unrelated edits and a different current selection',()=>{
 const elements=coloredScene();const source=scoped.captureSelection('board',elements,{'node-a':true});const label=source.elements.find(e=>e.type==='text');
 const patch={summary:'Edit',changes:[{id:label.id,text:'Updated'}]};
 const changedOutside=elements.map(e=>e.id==='node-b'?{...e,x:e.x+80}:e);
 const result=scoped.mergeSelectionPatch(changedOutside,source,patch);
 assert.equal(result.elements.find(e=>e.id==='node-b').x,580);
 const changedInside=elements.map(e=>e.id===label.id?{...e,text:'new user edit',originalText:'new user edit'}:e);
 assert.throws(()=>scoped.mergeSelectionPatch(changedInside,source,patch),/已有新修改/);
 assert.throws(()=>scoped.mergeSelectionPatch(elements.filter(e=>e.id!==label.id),source,patch),/删除/);
});
test('selection patch rejects style changes, outside IDs and arbitrary element insertion',()=>{
 const elements=coloredScene();const source=scoped.captureSelection('board',elements,{'node-a':true});
 for(const changes of [[{id:'node-b',x:2}],[{id:'node-a',strokeColor:'red'}],[{id:'node-a',link:'https://evil.invalid'}],[{id:'node-a',text:'wrong type'}],[{id:'node-a',width:-2}],[{id:'node-a',isDeleted:true}]]){
  assert.throws(()=>scoped.parseSelectionPatch(JSON.stringify({kind:'whiteboard-selection',summary:'x',changes}),source));
 }
 const messages=scoped.selectionMessages('Translate',source,[]);
 const raw=JSON.stringify(messages);assert.ok(!raw.includes('Outside'));assert.ok(!raw.includes('node-b'));assert.ok(raw.includes('#c92a2a'));
});
test('safe unconnected shape resize keeps style and binding while connected geometry is rejected',()=>{
 const elements=coloredScene();const source=scoped.captureSelection('board',elements,{'node-a':true});
 const result=scoped.mergeSelectionPatch(elements,source,{summary:'resize',changes:[{id:'node-a',x:40,width:300}]});
 assert.equal(result.elements.find(e=>e.id==='node-a').x,40);assert.equal(result.elements.find(e=>e.id==='node-a').width,300);
 const arrow=excalidraw.convertToExcalidrawElements([{type:'arrow',x:250,y:65,points:[[0,0],[250,0]]}])[0];
 const withExternal=[...elements,{...arrow,startBinding:{elementId:'node-a',focus:0,gap:0}}];
 assert.throws(()=>scoped.mergeSelectionPatch(withExternal,source,{summary:'move',changes:[{id:'node-a',x:40}]}),/连接着箭头/);
});

test('selection target applies via undoable updateScene, preserves latest outside edits and saves',async()=>{
 let elements=coloredScene(), id='board', saves=0, writes=0;let currentScene={...scene,elements};
 const updates=[];
 const api={getSceneElements:()=>elements.filter(e=>!e.isDeleted),getSceneElementsIncludingDeleted:()=>elements,
  getAppState:()=>({viewBackgroundColor:'#ffffff',selectedElementIds:{'node-b':true}}),getFiles:()=>({}),
  updateScene:update=>{updates.push(update);elements=update.elements;}};
 const bridge=load('../src/whiteboard/selectionTarget.ts',{'@excalidraw/excalidraw':excalidraw,'./regionLayout':regionLayout,'./selectionEditing':scoped,'./store':{
  currentBoard:()=>({id,scene:currentScene}),flushBoard:async()=>{saves++;},stageBoard:(_,patch)=>{currentScene=patch.scene;writes++;},
 }}).whiteboardSelectionTarget(()=>id,()=>api);
 const source=scoped.captureSelection(id,elements,{'node-a':true});const label=source.elements.find(e=>e.type==='text');
 elements=elements.map(e=>e.id==='node-b'?{...e,x:600}:e);
 const result=await bridge.apply(source,{summary:'Translate',changes:[{id:label.id,text:'开始'}]},new AbortController().signal);
 assert.equal(result.saved,true);assert.equal(result.changed,true);assert.equal(writes,1);assert.equal(saves,2);
 assert.equal(updates[0].captureUpdate,excalidraw.CaptureUpdateAction.IMMEDIATELY);
 assert.equal(elements.find(e=>e.id==='node-b').x,600);assert.ok(result.selection.elements.some(e=>e.text==='开始'));
 const abort=new AbortController();abort.abort();await assert.rejects(bridge.apply(result.selection,{summary:'x',changes:[]},abort.signal),/已停止/);
 id='other';await assert.rejects(bridge.apply(result.selection,{summary:'x',changes:[]},new AbortController().signal),/白板已切换/);
});


test('cancellation during pre-save prevents any selected-scene writes',async()=>{
 let resolve;const wait=new Promise(r=>{resolve=r;});let writes=0;
 const elements=coloredScene();const source=scoped.captureSelection('board',elements,{'node-a':true});
 const label=source.elements.find(e=>e.type==='text');
 const api={getSceneElements:()=>elements,getSceneElementsIncludingDeleted:()=>elements,getAppState:()=>({}),getFiles:()=>({}),updateScene:()=>{writes++;}};
 const bridge=load('../src/whiteboard/selectionTarget.ts',{'@excalidraw/excalidraw':excalidraw,'./regionLayout':regionLayout,'./selectionEditing':scoped,'./store':{
  currentBoard:()=>({id:'board',scene:{...scene,elements}}),flushBoard:async()=>wait,stageBoard:()=>{writes++;},
 }}).whiteboardSelectionTarget(()=> 'board',()=>api);
 const abort=new AbortController();const task=bridge.apply(source,{summary:'edit',changes:[{id:label.id,text:'Changed'}]},abort.signal);
 abort.abort();resolve();await assert.rejects(task,/已停止/);assert.equal(writes,0);
});
test('selected-scene persistence failure reports unsaved application and never touches other elements',async()=>{
 let elements=coloredScene(), saves=0;let currentScene={...scene,elements};
 const source=scoped.captureSelection('board',elements,{'node-a':true});const label=source.elements.find(e=>e.type==='text');
 const other=elements.find(e=>e.id==='node-b');
 const api={getSceneElements:()=>elements,getSceneElementsIncludingDeleted:()=>elements,getAppState:()=>({viewBackgroundColor:'#ffffff'}),getFiles:()=>({}),updateScene:value=>{elements=value.elements;}};
 const bridge=load('../src/whiteboard/selectionTarget.ts',{'@excalidraw/excalidraw':excalidraw,'./regionLayout':regionLayout,'./selectionEditing':scoped,'./store':{
  currentBoard:()=>({id:'board',scene:currentScene}),flushBoard:async()=>{if(++saves===2)throw new Error('disk full');},stageBoard:(_,patch)=>{currentScene=patch.scene;},
 }}).whiteboardSelectionTarget(()=> 'board',()=>api);
 const result=await bridge.apply(source,{summary:'edit',changes:[{id:label.id,text:'Changed'}]},new AbortController().signal);
 assert.equal(result.changed,true);assert.equal(result.saved,false);assert.equal(elements.find(e=>e.id==='node-b'),other);
 assert.equal(elements.find(e=>e.id===label.id).originalText,'Changed');
});

test('changing a connected node label keeps the unselected arrow and its bindings byte-for-byte',()=>{
 const elements=module.draftElements(draft);
 const node=elements.find(e=>e.type==='rectangle');
 const source=scoped.captureSelection('board',elements,{[node.id]:true});
 const label=source.elements.find(e=>e.type==='text');const arrow=elements.find(e=>e.type==='arrow');
 const result=scoped.mergeSelectionPatch(elements,source,{summary:'Translate',changes:[{id:label.id,text:'开始'}]});
 assert.equal(result.elements.find(e=>e.id===arrow.id),arrow);
 assert.equal(result.elements.find(e=>e.id===label.id).fontFamily,label.fontFamily);
 assert.equal(result.elements.find(e=>e.id===node.id).width,node.width);
 assert.equal(result.elements.find(e=>e.id===node.id).height,node.height);
});

const protocol=load('../src/whiteboard/conversationPlan.ts',{'../ai/editing':editing,'./regionLayout':regionLayout,'./selectionEditing':scoped});
function conversationFixture(options={}){
 let elements=options.elements??[],id=options.empty?null:'board', saves=0, writes=0;
 const scenes=new Map(id?[['board',{...scene,elements}]]:[]),updates=[],progress=[];
 const api={getSceneElements:()=>elements.filter(e=>!e.isDeleted),getSceneElementsIncludingDeleted:()=>elements,
  getAppState:()=>({viewBackgroundColor:'#ffffff'}),getFiles:()=>({}),scrollToContent(){},
  updateScene:value=>{updates.push(value);elements=value.elements;writes++;}};
 const bridge=load('../src/whiteboard/conversationTarget.ts',{
  '@excalidraw/excalidraw':excalidraw,'./aiTarget':module,'./conversationPlan':protocol,'./regionLayout':regionLayout,'./selectionEditing':scoped,
  './store':{currentBoard:boardId=>scenes.has(boardId)?{id:boardId,scene:scenes.get(boardId)}:undefined,
   flushBoard:async()=>{saves++;if(options.saveFail&&writes)throw new Error('disk full');},
   createBoard:async()=>{scenes.set('new',structuredClone(scene));return {id:'new'};},
   stageBoard:(boardId,patch)=>{if(patch.scene)scenes.set(boardId,patch.scene);}},
 }).whiteboardConversationTarget(()=>id,()=>id?api:null,newId=>{id=newId;},async(signal)=>{
  options.afterStep?.({get elements(){return elements;},set elements(value){elements=value;},get id(){return id;},set id(value){id=value;},signal,writes});
 });
 return {bridge,updates,progress,scenes,get elements(){return elements;},get writes(){return writes;},get saves(){return saves;},
  async execute(plan,abort=new AbortController(),source){return bridge.execute(source??bridge.capture(null,true),plan,abort.signal,value=>progress.push(value));}};
}
const generationPlan={message:'Draw flow',changes:{summary:'',changes:[]},diagram:draft};
test('unified protocol supports generation, editing and answers without mode selection',()=>{
 const elements=coloredScene();const context=protocol.captureCanvasContext('board',elements,null,true);
 const result=protocol.parseCanvasPlan(JSON.stringify({kind:'whiteboard-turn',message:'Draw',diagram:draft}),context);
 assert.equal(result.diagram.nodes.length,2);assert.equal(result.changes.changes.length,0);
 const text=elements.find(e=>e.type==='text');
 const edit=protocol.parseCanvasPlan(JSON.stringify({kind:'whiteboard-turn',message:'Edit',changes:[{id:text.id,text:'你好'}]}),context);
 assert.equal(edit.changes.changes[0].id,text.id);
 assert.throws(()=>protocol.parseCanvasPlan(JSON.stringify({kind:'whiteboard-turn',message:'bad',changes:[{id:'outside',text:'bad'}]}),context));
 const hidden=protocol.captureCanvasContext('board',elements,null,false);assert.equal(hidden.region.elements.length,0);
 assert.ok(!JSON.stringify(protocol.canvasConversationMessages('draw',hidden,[])).includes('Outside'));
});
test('drawing progresses as actual scene updates with no dangling bindings between steps',async()=>{
 const h=conversationFixture();const result=await h.execute(generationPlan);
 assert.equal(result.stopped,false);assert.equal(result.done,3);assert.equal(h.updates.length,3);assert.equal(h.progress.length,3);
 assert.ok(h.updates[0].elements.length<h.updates[2].elements.length);
 for(const update of h.updates){
  assert.equal(update.captureUpdate,excalidraw.CaptureUpdateAction.IMMEDIATELY);
  const ids=new Set(update.elements.map(e=>e.id));
  for(const e of update.elements){for(const bound of e.boundElements??[])assert.ok(ids.has(bound.id));if(e.containerId)assert.ok(ids.has(e.containerId));}
 }
 assert.equal(h.elements.filter(e=>e.type==='arrow').length,1);
 assert.ok(h.scenes.get('board').elements.length>0);
});
test('stop during execution preserves and saves only completed steps',async()=>{
 const abort=new AbortController();const h=conversationFixture({afterStep:()=>abort.abort()});
 const result=await h.execute(generationPlan,abort);assert.equal(result.done,1);assert.equal(result.stopped,true);assert.equal(result.saved,true);
 assert.equal(h.writes,1);assert.equal(h.elements.filter(e=>e.type==='arrow').length,0);assert.ok(h.saves>=2);
});
test('manual edits to AI-created content stop further playback instead of overwriting',async()=>{
 const h=conversationFixture({afterStep:state=>{state.elements=state.elements.map((e,i)=>i===0?{...e,x:e.x+20}:e);}});
 const result=await h.execute(generationPlan);assert.equal(result.done,1);assert.equal(result.stopped,true);assert.match(result.reason,/已有新修改/);assert.equal(h.writes,1);
});
test('edits to unrelated old shapes during generation are retained and do not stop drawing',async()=>{
 const old=coloredScene();const h=conversationFixture({elements:old,afterStep:state=>{state.elements=state.elements.map(e=>e.id==='node-b'?{...e,x:850}:e);}});
 const result=await h.execute(generationPlan);assert.equal(result.done,3);assert.equal(result.stopped,false);assert.equal(h.elements.find(e=>e.id==='node-b').x,850);
 assert.equal(h.elements.find(e=>e.id==='node-a'),old.find(e=>e.id==='node-a'));
});
test('automatic editing without attachment changes only referenced labels and preserves styles',async()=>{
 const old=coloredScene();const h=conversationFixture({elements:old});const label=old.find(e=>e.type==='text');
 const result=await h.execute({message:'Translate',changes:{summary:'Translate',changes:[{id:label.id,text:'开始'}]},diagram:null});
 assert.equal(result.done,1);assert.equal(h.elements.find(e=>e.id===label.id).originalText,'开始');
 assert.equal(h.elements.find(e=>e.id===label.id).strokeColor,label.strokeColor);assert.equal(h.elements.find(e=>e.id==='node-b'),old.find(e=>e.id==='node-b'));
});
test('opening another board or hitting a save failure is reported honestly',async()=>{
 const switched=conversationFixture({afterStep:state=>{state.id='other';}});
 const partial=await switched.execute(generationPlan);assert.equal(partial.done,1);assert.equal(partial.stopped,true);assert.match(partial.reason,/会话已变化/);
 const h=conversationFixture({saveFail:true});const result=await h.execute(generationPlan);assert.equal(result.done,3);assert.equal(result.saved,false);
});
test('empty workspace generation creates a board and performs real progressive writes',async()=>{
 const h=conversationFixture({empty:true});const result=await h.execute(generationPlan);assert.equal(result.done,3);assert.ok(h.scenes.get('new').elements.length>0);
});
test('full plan validation rejects a bad edit before any requested additions are drawn',async()=>{
 const elements=module.draftElements(draft);const node=elements.find(e=>e.type==='rectangle');const h=conversationFixture({elements});
 await assert.rejects(h.execute({message:'bad layout',changes:{summary:'x',changes:[{id:node.id,x:123}]},diagram:draft}),/连接着箭头/);
 assert.equal(h.writes,0);
});

function prototypeScene({frame=false,inside=false}={}) {
 const shell=excalidraw.convertToExcalidrawElements([
  {id:'work-area',type:'rectangle',x:320,y:140,width:1000,height:800,strokeColor:'#222222',strokeWidth:1.5,roughness:1.4,fillStyle:'hachure',backgroundColor:'transparent'},
  {id:'navigation',type:'rectangle',x:30,y:140,width:270,height:800,strokeColor:'#444444',backgroundColor:'transparent'},
  {id:'nav-label',type:'text',x:48,y:172,text:'小漫画制作\n创建作品\n作品列表',fontSize:22,fontFamily:5},
  ...(inside?[{id:'existing-note',type:'text',x:370,y:820,text:'必须保留的原说明',fontSize:20,fontFamily:5}]:[]),
 ],{regenerateIds:false});
 if(frame){const index=shell.findIndex(e=>e.id==='work-area');shell[index]={...shell[index],type:'frame',name:'Create work',frameId:null};}
 else shell.forEach(e=>{e.frameId='outer-frame';});
 const outer={...shell[0],id:'outer-frame',type:'frame',x:0,y:90,width:1370,height:900,name:'Frame',frameId:null};
 return [...shell,outer];
}
const prototypeItems=[
 {id:'title',type:'text',x:35,y:18,width:760,height:52,text:'创建作品',fontSize:36},
 {id:'back',type:'text',x:795,y:23,width:155,height:38,text:'返回作品列表',fontSize:20},
 {id:'subtitle',type:'text',x:35,y:80,width:890,height:34,text:'把灵感变成一部属于你的漫画',fontSize:20},
 {id:'story-label',type:'text',x:35,y:136,width:420,height:34,text:'故事内容  *',fontSize:23},
 {id:'story-input',type:'rectangle',x:35,y:180,width:915,height:155,text:'输入你的故事，或写下一句话灵感…',fontSize:22},
 {id:'help',type:'text',x:35,y:349,width:910,height:36,text:'故事为空时提示填写；支持继续编辑和保存草稿。',fontSize:18},
 {id:'character-label',type:'text',x:35,y:413,width:420,height:34,text:'角色设定',fontSize:23},
 {id:'character',type:'rectangle',x:35,y:459,width:435,height:90,text:'主角名称、外观与性格',fontSize:21},
 {id:'style',type:'rectangle',x:510,y:459,width:440,height:90,text:'画风选择：手绘 / 清新 / 漫画',fontSize:21},
 {id:'divider',type:'line',x:35,y:594,width:915,height:0},
 {id:'save',type:'rectangle',x:35,y:628,width:300,height:62,text:'保存草稿',fontSize:24},
 {id:'generate',type:'rectangle',x:650,y:628,width:300,height:62,text:'生成作品 →',fontSize:24},
 {id:'states',type:'text',x:35,y:713,width:915,height:48,text:'生成中显示进度；失败保留输入并提供重试。',fontSize:18},
];
function prototypePlan(source,items=prototypeItems){return protocol.parseCanvasPlan(JSON.stringify({kind:'whiteboard-turn',message:'在选中区域内补充创建作品原型',changes:[],diagram:null,layout:{containerId:source.containerId,style:'hand-drawn',items}}),{boardId:'board',region:source,scoped:true});}

test('empty selected rectangle advertises actual frame-internal creation instead of refusing new controls',()=>{
 const elements=prototypeScene();const source=scoped.captureSelection('board',elements,{'work-area':true});
 assert.equal(source.containerId,'work-area');assert.equal(source.elements.length,1);
 const context=protocol.captureCanvasContext('board',elements,source,true);
 const messages=protocol.canvasConversationMessages('在选区里面参照手绘风格完善创建作品原型',context,[]);
 assert.match(messages[0].content,/哪怕选区目前只有空矩形/);assert.match(messages[0].content,/hand-drawn/);
 assert.match(messages.at(-1).content,/designWidth/);assert.ok(!messages.at(-1).content.includes('nav-label'));
 const plan=prototypePlan(source);assert.equal(plan.layout.containerId,'work-area');assert.equal(plan.layout.items.length,13);
 assert.throws(()=>protocol.parseCanvasPlan(JSON.stringify({kind:'whiteboard-turn',message:'wrong',diagram:draft}),context),/框内布局/);
});
test('hand-drawn prototype controls are actual editable elements contained inside the selected rectangle',async()=>{
 const elements=prototypeScene();const originals=new Map(elements.map(e=>[e.id,JSON.stringify(e)]));
 const source=scoped.captureSelection('board',elements,{'work-area':true});
 const plan=prototypePlan(source);const h=conversationFixture({elements});
 const result=await h.execute(plan,new AbortController(),{boardId:'board',region:source,scoped:true});
 assert.equal(result.stopped,false);assert.equal(result.saved,true);assert.equal(result.done,13);
 const added=h.elements.filter(e=>!originals.has(e.id));assert.ok(added.length>13);
 const area=regionLayout.regionInsertionArea(source);
 for(const e of added){
  const b=regionLayout.elementBox(e);
  assert.ok(b.x>=area.inner.x-.1&&b.y>=area.inner.y-.1&&b.x+b.width<=area.inner.x+area.inner.width+.1&&b.y+b.height<=area.inner.y+area.inner.height+.1);
  assert.equal(e.strokeColor,'#222222');assert.equal(e.frameId,'outer-frame');
  if(e.type==='text')assert.equal(e.fontFamily,5);
  else {assert.ok(e.roughness>=1);assert.equal(e.strokeWidth,1.5);}
 }
 for(const [id,before] of originals)assert.equal(JSON.stringify(h.elements.find(e=>e.id===id)),before,id);
 assert.ok(added.some(e=>e.type==='text'&&e.originalText==='创建作品'));
 assert.ok(added.some(e=>e.type==='text'&&e.originalText==='生成作品 →'));
 assert.equal(result.region.containerId,'work-area');assert.equal(result.region.elements.length,source.elements.length+added.length);
 for(const update of h.updates){const ids=new Set(update.elements.map(e=>e.id));for(const e of update.elements){if(e.containerId)assert.ok(ids.has(e.containerId));}}
});
test('Frame selection includes its child content, assigns frame membership, and preserves the original frame',async()=>{
 const elements=prototypeScene({frame:true});
 const source=scoped.captureSelection('board',elements,{'work-area':true});assert.equal(source.containerId,'work-area');
 const h=conversationFixture({elements});const plan=prototypePlan(source,[prototypeItems[0]]);
 const result=await h.execute(plan,new AbortController(),{boardId:'board',region:source,scoped:true});
 assert.equal(result.stopped,false);
 const added=h.elements.filter(e=>!elements.some(old=>old.id===e.id));assert.ok(added.length);
 assert.ok(added.every(e=>e.frameId==='work-area'));
 const frameIndex=h.elements.findIndex(e=>e.id==='work-area');assert.ok(added.every(e=>h.elements.indexOf(e)<frameIndex));
 assert.equal(h.elements.find(e=>e.id==='work-area'),elements.find(e=>e.id==='work-area'));
});
test('existing children are added as references and new controls cannot cover them',async()=>{
 const elements=prototypeScene({inside:true});const source=scoped.captureSelection('board',elements,{'work-area':true});
 assert.ok(source.elements.some(e=>e.id==='existing-note'));assert.ok(!source.elements.some(e=>e.id==='navigation'));
 const area=regionLayout.regionInsertionArea(source);const box=regionLayout.elementBox(elements.find(e=>e.id==='existing-note'));
 const occupied={id:'overwrite',type:'rectangle',x:(box.x-area.inner.x)/area.scale,y:(box.y-area.inner.y)/area.scale,width:250,height:35};
 const h=conversationFixture({elements});await assert.rejects(h.execute(prototypePlan(source,[occupied]),new AbortController(),{boardId:'board',region:source,scoped:true}),/重叠/);
 assert.equal(h.writes,0);
});
test('layout protocol refuses outside IDs, out-of-bounds items, unsafe attributes and mixed instructions',()=>{
 const elements=prototypeScene();const source=scoped.captureSelection('board',elements,{'work-area':true});const ctx={boardId:'board',region:source,scoped:true};
 for(const layout of [
  {containerId:'navigation',style:'hand-drawn',items:[prototypeItems[0]]},
  {containerId:'work-area',style:'hand-drawn',items:[{...prototypeItems[0],x:-1}]},
  {containerId:'work-area',style:'hand-drawn',items:[{...prototypeItems[0],x:950}]},
  {containerId:'work-area',style:'hand-drawn',items:[{...prototypeItems[0],link:'javascript:bad()'}]},
  {containerId:'work-area',style:'hand-drawn',items:[{...prototypeItems[0],type:'iframe'}]},
  {containerId:'work-area',style:'hand-drawn',items:[prototypeItems[0],prototypeItems[0]]},
 ])assert.throws(()=>protocol.parseCanvasPlan(JSON.stringify({kind:'whiteboard-turn',message:'x',layout}),ctx));
 const plan=prototypePlan(source);assert.throws(()=>protocol.parseCanvasPlan(JSON.stringify({kind:'whiteboard-turn',message:'x',layout:plan.layout,diagram:draft}),ctx),/同时/);
 assert.throws(()=>protocol.parseCanvasPlan(JSON.stringify({kind:'whiteboard-turn',message:'x',layout:plan.layout,changes:[{id:'work-area',x:20}]}),ctx),/分次/);
});
test('new user content placed in the next target box stops subsequent prototype steps',async()=>{
 const elements=prototypeScene();const source=scoped.captureSelection('board',elements,{'work-area':true});let added=false;
 const h=conversationFixture({elements,afterStep:state=>{
  if(added)return;added=true;
  const area=regionLayout.regionInsertionArea(source),item=prototypeItems[1];
  state.elements=[...state.elements,...excalidraw.convertToExcalidrawElements([{id:'user-added',type:'rectangle',x:area.inner.x+item.x*area.scale,y:area.inner.y+item.y*area.scale,width:100,height:30}],{regenerateIds:false})];
 }});
 const result=await h.execute(prototypePlan(source),new AbortController(),{boardId:'board',region:source,scoped:true});
 assert.equal(result.stopped,true);assert.equal(result.done,1);assert.match(result.reason,/重叠/);assert.ok(h.elements.some(e=>e.id==='user-added'));
});
test('moving the container or cancelling a prototype preserves partial work without touching the shell',async()=>{
 const elements=prototypeScene();const source=scoped.captureSelection('board',elements,{'work-area':true});
 const h=conversationFixture({elements,afterStep:state=>{state.elements=state.elements.map(e=>e.id==='work-area'?{...e,x:e.x+10}:e);}});
 const result=await h.execute(prototypePlan(source),new AbortController(),{boardId:'board',region:source,scoped:true});assert.equal(result.done,1);assert.match(result.reason,/已有新修改/);
 const abort=new AbortController();const stopped=conversationFixture({elements:prototypeScene(),afterStep:()=>abort.abort()});
 const stoppedSource=scoped.captureSelection('board',stopped.elements,{'work-area':true});
 const partial=await stopped.execute(prototypePlan(stoppedSource),abort,{boardId:'board',region:stoppedSource,scoped:true});
 assert.equal(partial.done,1);assert.equal(partial.stopped,true);assert.equal(partial.saved,true);
});

test('locked children remain reference obstacles, cannot be edited, and do not block safe empty-space insertion',async()=>{
 const elements=prototypeScene({inside:true});elements.find(e=>e.id==='existing-note').locked=true;
 const source=scoped.captureSelection('board',elements,{'work-area':true});assert.equal(source.elements.length,2);
 assert.throws(()=>scoped.parseSelectionPatch(JSON.stringify({kind:'whiteboard-selection',summary:'x',changes:[{id:'existing-note',text:'overwrite'}]}),source));
 const h=conversationFixture({elements});const result=await h.execute(prototypePlan(source,[prototypeItems[0]]),new AbortController(),{boardId:'board',region:source,scoped:true});
 assert.equal(result.stopped,false);assert.equal(result.region.containerId,'work-area');assert.ok(result.region.elements.some(e=>e.id==='existing-note'&&e.locked));
 assert.equal(h.elements.find(e=>e.id==='existing-note'),elements.find(e=>e.id==='existing-note'));
});
test('region conversion validates actual text bounds and invalid rotated containers',()=>{
 const elements=prototypeScene();const source=scoped.captureSelection('board',elements,{'work-area':true});
 const oversized=prototypePlan(source,[{id:'too-much',type:'text',x:35,y:10,width:100,height:10,text:'Long text '.repeat(120),fontSize:80}]);
 assert.throws(()=>regionLayout.regionLayoutElements(oversized.layout,source),/框内布局无效/);
 const rotated=structuredClone(source);rotated.elements[0].angle=.6;
 assert.equal(regionLayout.regionInsertionArea(rotated),null);
 assert.throws(()=>regionLayout.parseRegionLayout(oversized.layout,rotated));
});
test('inherit style keeps original stroke/color/roughness and valid frame membership after restore',async()=>{
 const elements=prototypeScene();elements.find(e=>e.id==='work-area').roughness=0;
 const source=scoped.captureSelection('board',elements,{'work-area':true});
 const plan=prototypePlan(source,[prototypeItems[4]]);plan.layout.style='inherit';
 const h=conversationFixture({elements});await h.execute(plan,new AbortController(),{boardId:'board',region:source,scoped:true});
 const added=h.elements.filter(e=>!elements.some(old=>old.id===e.id));
 assert.ok(added.some(e=>e.type==='rectangle'&&e.roughness===0));
 const restored=excalidraw.restore({elements:h.elements,appState:{},files:{}},null,null,{repairBindings:true});
 for(const e of restored.elements.filter(e=>added.some(a=>a.id===e.id)))assert.equal(e.frameId,'outer-frame');
});
