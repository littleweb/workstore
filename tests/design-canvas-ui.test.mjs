import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;const {createRoot}=await import('react-dom/client');after(()=>dom.window.close());
const require=createRequire(import.meta.url),tick=()=>new Promise(resolve=>setImmediate(resolve));
const external=['react','react/jsx-runtime','@xyflow/react','antd','@ant-design/icons','../store','../images','../export','../../ai/client','../../documentLifecycle','./execution'];
const code=buildSync({entryPoints:['src/design-studio/canvas/DesignCanvas.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},external}).outputFiles[0].text;
const modelCode=buildSync({entryPoints:['src/design-studio/canvas/model.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const image=n=>'workstore-image:'+String(n).repeat(64);
async function harness(seed,settingsFailure=false,realFlow=false){
 const records=new Map(),listeners=new Set(),dialogs=[],generated=[];let serial=0;
 if(seed)records.set('seed',{id:'seed',title:'已有画布',content:JSON.stringify(seed),updatedAt:1,lastOpenedAt:1});
 const notify=()=>listeners.forEach(fn=>fn());
 const store={documentList:()=>[...records.values()],currentDocument:id=>records.get(id),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},refreshDocuments:async()=>{},ensureDocument:async id=>records.get(id),loadDocument:async id=>records.get(id),remoteVersion:()=>0,activateDocument:()=>{},documentStatus:()=> '已保存到本地',createDocument:async()=>{const d={id:String(++serial),title:'未命名设计作品',content:'',updatedAt:1,lastOpenedAt:1};records.set(d.id,d);notify();return d;},stageDocument:(id,patch)=>{Object.assign(records.get(id),patch);notify();},flushDocument:async()=>{}};
 const noIcon=()=>React.createElement('i'),icons=new Proxy({},{get:()=>noIcon});
 const Modal=Object.assign(({open,children,footer})=>open?React.createElement('div',{'data-modal':true},children,footer):null,{confirm:props=>dialogs.push(props)});
 const antd={App:{useApp:()=>({message:{success(){}}})},Modal,Input:props=>React.createElement('input',props),Spin:()=>React.createElement('span',null,'loading'),Tooltip:({children})=>children,Select:props=>React.createElement('select',{'aria-label':props['aria-label']},props.options.map(o=>React.createElement('option',{key:o.value},o.label)))};
 function Flow(props){const renders=React.useRef(0);React.useEffect(()=>{assert(++renders.current<30,'selection notification must settle without an update loop');props.onInit?.({getNodes:()=>props.nodes,screenToFlowPosition:p=>p});const sizes=props.nodes.filter(n=>!n.measured).map(n=>({id:n.id,type:'dimensions',dimensions:{width:350,height:240}}));if(sizes.length)props.onNodesChange?.(sizes);props.onSelectionChange?.({nodes:props.nodes.filter(n=>n.selected)});},[props]);return React.createElement('div',{'data-flow':true},props.children,props.nodes.map(n=>React.createElement(props.nodeTypes[n.type],{key:n.id,id:n.id,data:n.data,selected:n.selected})));}
 const flow=realFlow?require('@xyflow/react'):{ReactFlow:Flow,ReactFlowProvider:({children})=>children,Background:()=>null,Controls:()=>null,MiniMap:()=>null,Handle:()=>null,Position:{Left:'left',Right:'right'},Panel:({children})=>React.createElement('div',null,children),SelectionMode:{Partial:'partial'},applyNodeChanges:require('@xyflow/react').applyNodeChanges,applyEdgeChanges:(_,edges)=>edges};
 const mocks={'../store':store,'../images':{imageSource:async()=> 'data:image/png;base64,iVBORw0KGgo=',uploadImage:async()=>image(3)},'../export':{exportBackup:async()=>{},downloadCanvasImage:async()=>{}},'../../ai/client':{ai:{settings:()=>{if(settingsFailure)throw Error('桌面服务不可用');return Promise.resolve({model:'测试模型'});}}},'../../documentLifecycle':{registerSyncActivationBlocker:()=>()=>{}},'./execution':{subscribeExecution:()=>()=>{},runningNode:()=>false,stopNode(){},stopCanvas(){},generateNode:async(...args)=>generated.push(args)},'@xyflow/react':flow,'antd':antd,'@ant-design/icons':icons};
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:id=>id.endsWith('.css')?{}:mocks[id]??require(id),crypto:webcrypto,structuredClone,AbortController,setTimeout,clearTimeout,window:dom.window,console});
 const mm={exports:{}};vm.runInNewContext(modelCode,{module:mm,exports:mm.exports,require,crypto:webcrypto,structuredClone});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>{root.render(React.createElement(module.exports.DesignCanvas,{visible:true}));await tick();});
 const click=async(label)=>{const button=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent.trim()===label);assert(button,'button '+label);await act(async()=>{button.click();await tick();});};
 const input=async(selector,value)=>{const field=host.querySelector(selector);assert(field,selector);await act(async()=>{const prototype=field.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(field,value);field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await tick();});};
 return{host,records,dialogs,generated,click,input,model:mm.exports,read:()=>JSON.parse([...records.values()][0].content),close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
test('new canvas creates one independent record; editing and return/reopen preserve nodes and title',async()=>{const h=await harness();assert.equal(h.records.size,0);await h.click('新建画布');assert.equal(h.records.size,1);assert.equal(h.read().kind,'design-canvas');assert.equal(h.read().nodes.length,1);assert.equal(h.read().nodes[0].measured.width,350);await h.input('textarea[aria-label="提示词"]','场景设计');await h.input('input[aria-label="画布标题"]','产品画布');await h.click('返回画布列表');assert(h.host.querySelector('.dc-canvas-card'));await h.click('打开画布 产品画布');assert.equal(h.host.querySelector('textarea').value,'场景设计');assert.equal(h.records.size,1);await h.click('新建提示词');assert.equal(h.read().nodes.length,2);await h.click('撤销');assert.equal(h.read().nodes.length,1);await h.click('重做');assert.equal(h.read().nodes.length,2);await h.close();});
test('canvas generation submits current node and parameter edits without clearing other nodes',async()=>{const h=await harness();await h.click('新建画布');await h.input('textarea','茶饮海报');await h.click('参数');await h.click('高');await h.click('WebP');assert.equal(h.read().nodes[0].data.params.quality,'high');assert.equal(h.read().nodes[0].data.params.format,'webp');await h.click('生成');assert.equal(h.generated.length,1);assert.equal(h.generated[0][1],h.read().nodes[0].id);assert.equal(h.host.querySelector('textarea').value,'茶饮海报');await h.close();});
test('image candidate selection and splitting preserve source candidates; editing creates a connected prompt',async()=>{const h0=await harness();const c=h0.model.blankCanvas();const imageNode=h0.model.imageNode({x:400,y:0},[image(1),image(2)]);c.nodes.push(imageNode);await h0.close();const h=await harness(c);await h.click('打开画布 已有画布');await h.click('切换候选');await h.click('选择候选2');assert.equal(h.read().nodes[1].data.active,1);await h.click('拆出');assert.equal(h.read().nodes.length,3);assert.equal(h.read().nodes[1].data.images.length,2);await h.click('基于此图编辑');assert.equal(h.read().nodes.filter(n=>n.type==='prompt').length,2);assert.equal(h.read().edges.length,1);assert.equal(h.read().edges[0].source,imageNode.id);await h.close();});
test('removing and restoring canvas preserves its complete graph and local record',async()=>{const h=await harness();await h.click('新建画布');await h.input('textarea','保留的内容');await h.click('返回画布列表');await h.click('移除画布 未命名画布');assert.equal(h.dialogs.length,1);await act(async()=>{await h.dialogs[0].onOk();await tick();});assert(h.read().deletedAt);assert.equal(h.records.size,1);assert.equal(h.host.querySelectorAll('.dc-canvas-card').length,0);await h.click('已移除');await h.click('恢复');assert.equal(h.read().deletedAt,undefined);await h.click('全部画布');assert.equal(h.host.querySelectorAll('.dc-canvas-card').length,1);assert.equal(h.read().nodes[0].data.prompt,'保留的内容');await h.close();});


test('unavailable desktop settings cannot crash browser canvas list or editing',async()=>{const h=await harness(undefined,true);assert(h.host.querySelector('.dc-list-header'));await h.click('新建画布');assert(h.host.querySelector('textarea'));assert.equal(h.generated.length,0);await h.close();});


test('real React Flow handles measured nodes and native drag updates without a render loop',async()=>{
 const frame=fn=>setTimeout(()=>fn(Date.now()),1);
 const observers=new Set();
 class RO { constructor(fn){this.fn=fn;this.targets=new Set();observers.add(this);}observe(target){this.targets.add(target);queueMicrotask(()=>this.fn([...this.targets].map(target=>({target,contentRect:target.getBoundingClientRect()}))));}unobserve(target){this.targets.delete(target);}disconnect(){this.targets.clear();observers.delete(this);}}
 const bbox=dom.window.HTMLElement.prototype.getBoundingClientRect;
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return{x:0,y:0,left:0,top:0,right:1000,bottom:700,width:this.classList.contains('react-flow__node')?350:1000,height:this.classList.contains('react-flow__node')?240:700,toJSON(){}};};
 Object.defineProperty(dom.window.HTMLElement.prototype,'offsetWidth',{configurable:true,get(){return this.getBoundingClientRect().width;}});
 Object.defineProperty(dom.window.HTMLElement.prototype,'offsetHeight',{configurable:true,get(){return this.getBoundingClientRect().height;}});
 class Matrix {constructor(){this.m11=1;this.m22=1;}}
 for(const [key,value] of Object.entries({ResizeObserver:RO,requestAnimationFrame:frame,cancelAnimationFrame:clearTimeout,DOMMatrixReadOnly:Matrix,SVGElement:dom.window.SVGElement,getComputedStyle:dom.window.getComputedStyle.bind(dom.window)})){globalThis[key]=value;dom.window[key]=value;}
 let h;
 try{
  h=await harness(undefined,false,true);await h.click('新建画布');
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
  assert(h.host.querySelector('.react-flow__node'));assert.equal(h.read().nodes[0].measured.width,350);
  const start={...h.read().nodes[0].position};const handle=h.host.querySelector('.dc-prompt>header');assert(handle.closest('.react-flow__node').__on?.some(o=>o.type==='mousedown'),'drag listener attached');
  await act(async()=>{handle.dispatchEvent(new dom.window.MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,clientX:100,clientY:120,view:dom.window}));});
  await act(async()=>{dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:200,clientY:250,view:dom.window}));});
  await act(async()=>{dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:240,clientY:290,view:dom.window}));});
  await act(async()=>{dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup',{bubbles:true,button:0,clientX:200,clientY:250,view:dom.window}));await tick();});
  assert.notDeepEqual(h.read().nodes[0].position,start);assert(h.host.querySelector('.dc-prompt'));assert(h.host.querySelector('[aria-label="撤销"]:not([disabled])'));
 }finally{if(h)await h.close();dom.window.HTMLElement.prototype.getBoundingClientRect=bbox;}
});
