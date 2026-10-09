import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');const require=createRequire(import.meta.url);
after(()=>dom.window.close());
function load(file,external=[],extra={}){const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:[new URL(`../src/list-projects/${file}`,import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},external}).outputFiles[0].text,{module,structuredClone,crypto,Date,require,...extra});return module.exports;}
const model=load('model.ts'),{createProjectController}=load('controller.ts');
const id='11111111-1111-4111-8111-111111111111',doc='22222222-2222-4222-8222-222222222222';
async function setup(){
 let disk=model.emptyProjects('app.doc'),dialog,current;const selection=[],creations=[];
 const store=createProjectController('app.doc',{read:async()=>disk,mutate:async op=>disk=model.applyOperation(disk,op)});
 const modal={confirm:options=>{dialog=options;}},errors=[];
 const api=load('Projects.tsx',['react','react/jsx-runtime','antd','@ant-design/icons','./store'],{require(name){
  if(name==='./store')return {projectStore:()=>store};
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  if(name==='@ant-design/icons')return Object.fromEntries(['FolderOpenOutlined','FolderOutlined','MoreOutlined','PlusOutlined'].map(x=>[x,()=>React.createElement('i',{'data-icon':x})]));
  if(name==='antd')return {App:{useApp:()=>({modal,message:{error:e=>errors.push(e)}})},Input:props=>React.createElement('input',props),Button:({children,onClick})=>React.createElement('button',{onClick},children),Dropdown:({children,menu})=>React.createElement('div',null,children,...menu.items.map(item=>React.createElement('button',{key:item.key,'data-action':item.key,onClick:()=>menu.onClick({key:item.key})},item.label)))};
  throw Error(name);
 }});
 function Tool(){const navigation=api.useProjects('app.doc');current=navigation;const row=item=>React.createElement('button',{key:item.id,'data-document':item.id,onClick:()=>selection.push(item.id)},item.title);const items=[{id:doc,title:'Existing note',favorite:true}];return React.createElement('div',null,React.createElement(api.ProjectSection,{navigation,items,renderItem:row,activeId:null,onCreate:projectId=>creations.push(projectId)}),...items.filter(item=>!navigation.projectOf(item.id)).map(row));}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(React.createElement(Tool)));
 return {host,store,selection,creations,get navigation(){return current},get dialog(){return dialog},get disk(){return disk},async close(){await act(async()=>root.unmount());host.remove();}};
}
test('project navigation creates, groups an existing entry once, folds, renames and safely removes the group',async()=>{
 const h=await setup();try{
  await act(async()=>h.host.querySelector('[aria-label="创建项目"]').click());assert.equal(h.dialog.title,'创建项目');
  await act(async()=>{h.dialog.content.props.onChange({target:{value:'Research'}});await h.dialog.onOk();});
  const project=Object.keys(h.disk.projects)[0];assert.ok(project);
  await act(async()=>{assert.equal(h.navigation.handle(`list-project:move:${project}`,doc),true);await h.store.flush();});
  assert.equal(h.host.querySelectorAll('[data-document]').length,1);assert.ok(h.host.querySelector('.list-project-children [data-document]'));
  await act(async()=>h.host.querySelector('[data-document]').click());assert.deepEqual(h.selection,[doc]);
  await act(async()=>h.host.querySelector('.list-project-open').click());assert.equal(h.host.querySelector('[data-document]'),null);
  await act(async()=>h.host.querySelector('.list-project-open').click());assert.equal(h.host.querySelectorAll('[data-document]').length,1);
  await act(async()=>h.host.querySelector('[data-action="rename"]').click());
  await act(async()=>{h.dialog.content.props.onChange({target:{value:'Updated'}});await h.dialog.onOk();});assert.match(h.host.textContent,/Updated/);
  await act(async()=>h.host.querySelector('[data-action="remove"]').click());assert.match(h.dialog.content,/保留/);
  await act(async()=>h.dialog.onOk());assert.equal(h.host.querySelectorAll('[data-document]').length,1);assert.equal(h.host.querySelector('.list-project-children'),null);
 }finally{await h.close();}
});
test('move submenu uses IDs and new-project-and-move joins existing content without replacing it',async()=>{
 const h=await setup();try{
  await act(async()=>{h.navigation.handle('list-project:new',doc);h.dialog.content.props.onChange({target:{value:'Group'}});await h.dialog.onOk();});
  const group=h.disk.memberships[doc];assert.ok(group);const children=h.navigation.menu(doc)[0].children;assert.equal(children.find(x=>x.key===`list-project:move:${group}`).disabled,true);
  await act(async()=>{h.navigation.handle('list-project:root',doc);await h.store.flush();});assert.equal(h.disk.memberships[doc],null);assert.equal(h.host.querySelectorAll('[data-document]').length,1);
 }finally{await h.close();}
});

test('project folder conveys expansion and inline create opens the correct project without toggling',async()=>{
 const h=await setup();try{
  await act(async()=>{await h.store.mutate({action:'create',id,name:'Research'});});
  assert(h.host.querySelector('[data-icon="FolderOpenOutlined"]'));
  assert.equal(h.host.querySelector('[data-icon="DownOutlined"]'),null);
  await act(async()=>h.host.querySelector('.list-project-open').click());
  assert(h.host.querySelector('[data-icon="FolderOutlined"]'));
  await act(async()=>h.host.querySelector('[aria-label="在Research中创建内容"]').click());
  assert.deepEqual(h.creations,[id]);assert.equal(h.host.querySelector('.list-project-open').getAttribute('aria-expanded'),'true');
  await act(async()=>h.navigation.move(doc,id));
  assert.equal(h.disk.memberships[doc],id);assert.equal(h.host.querySelectorAll('[data-document]').length,1);
 }finally{await h.close();}
});

test('whole project section folds without changing memberships and restores its children',async()=>{
 const h=await setup();try{
  await act(async()=>{await h.store.mutate({action:'create',id,name:'Research'});await h.navigation.move(doc,id);});
  const before=structuredClone(h.disk);
  await act(async()=>h.host.querySelector('[aria-label="折叠项目"]').click());
  assert.equal(h.host.querySelector('.list-project-heading'),null);
  assert.deepEqual(h.disk,before);
  assert(h.host.querySelector('[aria-label="创建项目"]'));
  await act(async()=>h.host.querySelector('[aria-label="展开项目"]').click());
  assert.equal(h.host.querySelectorAll('[data-document]').length,1);
 }finally{await h.close();}
});
