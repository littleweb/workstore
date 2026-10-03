import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost'});
for(const k of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,k,{value:dom.window[k],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;const {createRoot}=await import('react-dom/client');after(()=>dom.window.close());
const require=createRequire(import.meta.url),drain=()=>new Promise(r=>setImmediate(r));
const code=buildSync({entryPoints:['src/design-studio/DesignStudio.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},external:['react','react/jsx-runtime','antd','@ant-design/icons','./canvas/DesignCanvas','./store','./images','./export','../ai/client','../tasks/store','../documentLifecycle','../list-projects/Projects','../workspace','@tauri-apps/plugin-clipboard-manager']}).outputFiles[0].text;
async function harness({recommendations=false}={}){
 const records=new Map(),listeners=new Set(),calls=[];let serial=0,resolve,failSave=false,remote=0;const clipboard=[];
 const store={documentList:()=>[...records.values()].sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt),documentWarnings:()=>[],currentDocument:id=>records.get(id),subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},refreshDocuments:async()=>{},ensureDocument:async id=>records.get(id),loadDocument:async id=>records.get(id),activateDocument:()=>{},remoteVersion:()=>remote,documentStatus:()=>'',createDocument:async()=>{const d={id:String(++serial),title:'未命名',content:'',lastOpenedAt:serial};records.set(d.id,d);return d;},stageDocument:(id,patch)=>{records.set(id,{...records.get(id),...patch});listeners.forEach(f=>f());},flushDocument:async()=>{if(failSave)throw Error('磁盘写入失败');}};
 const ai={capabilities:async()=>({imageGenerate:true,referenceImages:true,maxReferences:8}),generate:async(input,signal)=>{calls.push(input);return new Promise((r,j)=>{resolve=r;signal.addEventListener('abort',()=>j(Error('stopped')),{once:true});});}};
 const noop=()=>React.createElement('i');const icons=new Proxy({},{get:()=>noop});const antd={App:{useApp:()=>({message:{success(){}}})},Dropdown:({children})=>children,Spin:()=>React.createElement('span',null,'loading'),Tooltip:({children})=>children,Card:Object.assign(({cover,actions,children})=>React.createElement('article',{className:'test-card'},cover,children,React.createElement('div',null,actions)),{Meta:({title,description})=>React.createElement('div',null,React.createElement('strong',null,title),description)}),Input:props=>React.createElement('input',props),Modal:Object.assign(({open,children})=>open?React.createElement('div',null,children):null,{confirm(){}})};
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='./canvas/DesignCanvas'?{DesignCanvas:({visible,collapsed,onExpand})=>visible&&collapsed?React.createElement('button',{'aria-label':'展开导航',onClick:onExpand},'展开导航'):null}:id==='./store'?store:id==='./images'?{imageSource:async x=>x,reference:async x=>x,uploadImage:async()=>'',cropImage:async()=>''}:id==='./export'?{downloadImage:async()=>{},exportBackup:async()=>{}}:id==='../ai/client'?{ai,trackAiExecution:(_,p)=>p}:id==='../tasks/store'?{beginTask:()=>({finish(){}}),updateTask(){}}:id==='../documentLifecycle'?{registerSyncActivationBlocker:()=>()=>{}}:id==='../workspace'?{native:true}:id==='@tauri-apps/plugin-clipboard-manager'?{writeText:async text=>clipboard.push(text)}:id==='../list-projects/Projects'?{useProjects:toolId=>{assert.equal(toolId,'app.design');return {projectOf:()=>null,menu:()=>[],handle:()=>false};},ProjectSection:()=>React.createElement('section',{'aria-label':'项目分组'},'项目')}:id==='antd'?antd:id==='@ant-design/icons'?icons:require(id),crypto:webcrypto,structuredClone,AbortController,setTimeout,clearTimeout,console});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>{root.render(React.createElement(module.exports.default));await drain();});
 async function click(text){const b=[...host.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===text||x.textContent.trim()===text);assert(b,'button '+text);await act(async()=>{b.click();await drain();});}
 async function input(value){const field=host.querySelector('.ds-field input:not([type=file])');await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));field.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await drain();});}
 if(!recommendations)await click('电商专区');
 return {host,records,calls,clipboard,click,input,seed:content=>{records.set("seed",{id:"seed",title:"已有作品",content:JSON.stringify(content),lastOpenedAt:0});listeners.forEach(f=>f());},sync:()=>remote++,resolve:result=>act(async()=>{resolve(result);await drain();}),failSave:()=>failSave=true,close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
test('category navigation never expands children; return restores its catalog and recent order stays stable',async()=>{const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');assert(h.host.querySelector('[aria-label="返回功能列表"]'));assert.equal(h.host.querySelector('.ds-workspace > .ds-bar'),null);assert(h.host.querySelector('.ds-config > .ds-bar'));assert(h.host.querySelector('.ds-results-panel > .ds-bar'));assert.equal(h.host.querySelector('[aria-label="项目分组"]'),null);assert(!h.host.textContent.includes('创建作品'));assert.equal(h.host.querySelector('.ds-catalog-heading'),null);await h.input('柠檬茶');await act(async()=>{h.host.querySelector('[aria-label="返回功能列表"]').click();});assert.equal(h.host.querySelectorAll('.ds-feature').length,40);await h.click('创意应用');assert.equal(h.host.querySelectorAll('.ds-feature').length,14);assert.equal(h.host.querySelectorAll('.ds-category').length,8);await h.click('电商专区');const order=[...h.records.keys()];await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');assert.deepEqual([...h.records.keys()],order);assert.equal(h.host.querySelector('.ds-field input').value,'柠檬茶');await h.close();});
test('generation uses gateway and stores result while category switches',async()=>{const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');await h.input('奶茶');await h.click('生成');assert.equal(h.calls.length,1);assert.equal(h.host.querySelector('[role=tab][aria-selected=true]').textContent,'我的作品');assert.equal(h.host.querySelector('.ds-field input').value,'');assert(h.host.querySelector('.test-card').textContent.includes('生成中'));assert.equal(h.calls[0].toolId,'app.design');assert(h.calls[0].messages[0].content.includes('奶茶'));await h.click('创意应用');await h.resolve({images:['workstore-image:'+'a'.repeat(64)],text:'',saveError:null});assert.equal(JSON.parse([...h.records.values()][0].content).works.length,1);await h.close();});
test('cancellation retains a stopped card and its submitted configuration',async()=>{const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');await h.input('抹茶');await h.click('生成');await h.click('停止生成');const c=JSON.parse([...h.records.values()][0].content);assert.equal(c.works.length,1);assert.equal(c.works[0].status,'cancelled');assert.equal(c.works[0].config.values[0],'抹茶');assert.deepEqual(c.config.values,{});await h.close();});
test('failed pre-generation flush prevents model call and displays recoverable error',async()=>{const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');await h.input('红茶');h.failSave();await h.click('生成');assert.equal(h.calls.length,0);assert(h.host.textContent.includes('磁盘写入失败'));assert.equal(JSON.parse([...h.records.values()][0].content).config.values[0],'红茶');assert.equal(JSON.parse([...h.records.values()][0].content).works.length,0);await h.close();});

test('completion preserves next draft; card regeneration and copy use the original submission',async()=>{
 const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');await h.input('原奶茶');await h.click('生成');await h.input('下一杯咖啡');await h.resolve({images:['workstore-image:'+'a'.repeat(64)],text:''});
 let c=JSON.parse([...h.records.values()][0].content);assert.equal(c.config.values[0],'下一杯咖啡');assert.equal(c.works[0].config.values[0],'原奶茶');assert.equal(c.works[0].status,'ready');
 await act(async()=>{h.host.querySelector('[aria-label="复制提示词"]').click();await drain();});assert.equal(h.clipboard[0],c.works[0].prompt);
 await act(async()=>{h.host.querySelector('[aria-label="重新生成"]').click();await drain();});assert.equal(h.calls.length,2);assert.equal(h.calls[1].messages[0].content,h.clipboard[0]);assert.equal(h.host.querySelector('.ds-field input').value,'');
 await h.resolve({images:['workstore-image:'+'b'.repeat(64)],text:''});c=JSON.parse([...h.records.values()][0].content);assert.equal(c.works.length,2);assert(c.works.every(w=>w.status==='ready'));await h.close();
});
test('failed model leaves a retryable card, preserving new draft input',async()=>{
 const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');await h.input('乌龙茶');await h.click('生成');await h.input('下次绿茶');await h.resolve({images:[],text:'',saveError:'写入失败'});
 const c=JSON.parse([...h.records.values()][0].content);assert.equal(c.works[0].status,'error');assert(c.works[0].error.includes('写入失败'));assert.equal(c.config.values[0],'下次绿茶');assert(h.host.querySelector('[aria-label="重新生成"]'));await h.close();
});
test('remote activation rejects the late result without changing the synced record',async()=>{
 const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');await h.input('红茶');await h.click('生成');h.sync();const before=[...h.records.values()][0].content;await h.resolve({images:['workstore-image:'+'c'.repeat(64)],text:''});assert.equal([...h.records.values()][0].content,before);assert(h.host.textContent.includes('已同步'));await h.close();
});
test('batch submission creates every pending card immediately; cancellation keeps completed cards',async()=>{
 const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');
 // Seed the file boundary with a valid uploaded-image configuration.
 const config={values:{2:'1:1 方图',3:'1K 标准'},uploads:{0:['workstore-image:'+'d'.repeat(64)]},quantity:3,focusX:60,focusY:70};
 await act(async()=>{h.seed({featureId:'0-17',config,works:[]});await drain();});await h.click('电商专区');await act(async()=>{[...h.host.querySelectorAll('.ds-feature')].find(b=>b.querySelector('strong').textContent==='电商海报设计').click();await drain();});await h.click('生成');
 let c=JSON.parse([...h.records.values()][0].content);assert.equal(c.works.length,3);assert(c.works.every(w=>w.status==='generating'));assert.deepEqual(c.config.values,{});assert.deepEqual(c.config.uploads,{});assert.equal(c.config.quantity,1);assert.equal(h.host.querySelectorAll('.test-card').length,3);
 await h.resolve({images:['workstore-image:'+'e'.repeat(64)],text:''});assert.equal(h.calls.length,2);await h.click('停止生成');c=JSON.parse([...h.records.values()][0].content);assert.equal(c.works.filter(w=>w.status==='ready').length,1);assert.equal(c.works.filter(w=>w.status==='cancelled').length,2);
 await act(async()=>{h.host.querySelector('[aria-label="重新生成"]').click();await drain();});assert.equal(h.calls.length,3);c=JSON.parse([...h.records.values()][0].content);assert.equal(c.works.length,4);await h.resolve({images:['workstore-image:'+'f'.repeat(64)],text:''});assert.equal(h.calls.length,3);await h.close();
});

test('opening a feature and invalid generation never creates a document',async()=>{const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');assert.equal(h.records.size,0);await h.click('生成');assert.equal(h.records.size,0);await h.input('奶茶');assert.equal(h.records.size,0);await h.click('生成');assert.equal(h.records.size,1);await h.click('停止生成');assert.equal(h.records.size,1);await h.close();});

test('reference gallery renders all four fashion pairs as four cards and opens the selected result',async()=>{
 const h=await harness();await act(async()=>{[...h.host.querySelectorAll('.ds-feature')].find(b=>b.querySelector('strong').textContent==='时尚手账风女孩穿搭拆解贴纸').click();await drain();});
 assert.equal(h.records.size,0);assert(h.host.querySelector('.ds-config-bar').textContent.includes('时尚手账风女孩穿搭拆解贴纸'));
 const groups=[...h.host.querySelectorAll('.ds-example-group')];assert.equal(groups.length,4);
 for(const group of groups){assert.equal(group.querySelectorAll('.ds-example-pair').length,1);assert.equal(group.querySelectorAll('img').length,2);assert.deepEqual([...group.querySelectorAll('.ds-example-badge')].map(x=>x.textContent),['原图','✨ AI作品']);}
 const src=groups[2].querySelectorAll('img')[1].getAttribute('src');await act(async()=>{groups[2].querySelectorAll('button')[1].click();await drain();});assert.equal(h.host.querySelector('.ds-preview img').getAttribute('src'),src);assert.equal(h.calls.length,0);await h.close();
});

test('single-image examples remain separate; copying a template preserves the complete multiline prompt',async()=>{
 const h=await harness();await h.click('极简日系饮品海报极简日系饮品海报（主图，食材准备，制作步骤）');assert.equal(h.host.querySelectorAll('.ds-example-group').length,2);assert.equal(h.host.querySelectorAll('.ds-example-pair').length,0);
 await h.click('电商专区');await act(async()=>{[...h.host.querySelectorAll('.ds-feature')].find(b=>b.querySelector('strong').textContent==='人物多姿势生成').click();await drain();});assert.equal(h.host.querySelectorAll('.ds-example-group').length,7);
 const prompt=h.host.querySelector('.ds-example-prompt p').textContent;assert(prompt.includes('\n6.右下：'));await act(async()=>{h.host.querySelector('[aria-label="复制示例第1组提示词"]').click();await drain();});assert.equal(h.clipboard[0],prompt);assert.equal(h.calls.length,0);assert.equal(h.records.size,0);await h.close();
});


test('recommendations contain 15 distinct real features, remain stable on return, and categories display scene counts without projects',async()=>{
 const h=await harness({recommendations:true});
 const titles=()=>[...h.host.querySelectorAll('.ds-feature strong')].map(x=>x.textContent);
 const first=titles();assert.equal(first.length,15);assert.equal(new Set(first).size,15);
 assert.equal(h.host.querySelector('.ds-category').getAttribute('aria-label'),'爆款推荐');
 assert.equal(h.host.querySelector('[aria-label="项目分组"]'),null);
 for(const button of [...h.host.querySelectorAll('.ds-category')].filter(b=>b.querySelector('.ds-scene-count'))){
  const name=button.getAttribute('aria-label');await h.click(name);
  assert.equal(button.querySelector('.ds-scene-count').textContent,h.host.querySelectorAll('.ds-feature').length+' 种场景');
 }
 await h.click('爆款推荐');assert.deepEqual(titles(),first);
 const chosen=h.host.querySelector('.ds-feature strong').textContent;
 await act(async()=>{h.host.querySelector('.ds-feature').click();await drain();});
 assert.equal(h.host.querySelector('.ds-config-bar strong').textContent,chosen);
 await h.click('返回功能列表');assert.deepEqual(titles(),first);assert.equal(h.records.size,0);
 await act(async()=>{h.seed({featureId:JSON.parse(readFileSync('src/design-studio/catalog.json','utf8')).find(f=>f.title===chosen).id,config:{values:{},uploads:{},quantity:1,focusX:50,focusY:50},works:[]});await drain();});
 assert(h.host.querySelector('.ds-recent-row'));assert.equal(h.records.size,1);
 await act(async()=>{h.host.querySelector('.ds-feature').click();await drain();});
 assert.equal(h.host.querySelector('.ds-config-bar strong').textContent,'已有作品');
 await h.click('返回功能列表');assert.deepEqual(titles(),first);assert.equal(h.calls.length,0);
 await h.close();
});


test('canvas navigation can expand again and keeps canvas files out of ordinary recent works',async()=>{
 const h=await harness();
 await act(async()=>{h.seed({kind:'design-canvas',version:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}});await drain();});
 assert.equal(h.host.querySelector('.ds-recent-row'),null);
 await h.click('设计画布');assert.equal(h.host.querySelector('.ds-catalog'),null);
 await h.click('折叠导航');assert.equal(h.host.querySelector('.ds-nav'),null);
 await h.click('展开导航');assert(h.host.querySelector('.ds-nav'));
 await h.click('电商专区');assert.equal(h.host.querySelectorAll('.ds-feature').length,40);assert.equal(h.calls.length,0);await h.close();
});
