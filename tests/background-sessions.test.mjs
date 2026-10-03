import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>');
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');const require=createRequire(import.meta.url);const module={exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/tasks/ToolSessions.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,require});
test('tool switching keeps pipeline alive, saves in background and restores its result without remount',async()=>{
 let complete,mounts=0,cancels=0,saved='';const promise=new Promise(resolve=>{complete=resolve});
 function Worker(){const[result,setResult]=React.useState('working');React.useEffect(()=>{mounts++;let alive=true;promise.then(value=>{if(alive){saved=value;setResult(value)}});return()=>{alive=false;cancels++}},[]);return React.createElement('input',{value:result,readOnly:true});}
 const tools={board:Worker,notes:()=>React.createElement('p',null,'notes')};const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const render=active=>act(async()=>root.render(React.createElement(module.exports.default,{active,tools})));
 try{await render('board');await render('notes');assert.equal(mounts,1);assert.equal(cancels,0);const hidden=host.querySelector('[hidden]');assert.ok(hidden.hasAttribute('inert'));await act(async()=>complete('saved drawing'));assert.equal(saved,'saved drawing');await render('board');assert.equal(host.querySelector('input').value,'saved drawing');assert.equal(mounts,1);}finally{await act(async()=>root.unmount());host.remove();}assert.equal(cancels,1);
});
