import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
function load(file){const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:[new URL(`../src/list-projects/${file}.ts`,import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,{module,structuredClone,Date});return module.exports;}
const m=load('model'),{createProjectController}=load('controller');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',d='33333333-3333-4333-8333-333333333333';
const create=(data,id,name)=>m.applyOperation(data,{action:'create',id,name});
test('move and remove groups leave original records and favorite flags untouched; dangling references remain visible',()=>{
 const original={id:d,title:'Note',favorite:true,content:'rich text',createdAt:123};let data=create(m.emptyProjects('app.doc'),a,'Alpha');
 data=m.applyOperation(data,{action:'move',documentId:d,projectId:a});assert.equal(m.projectFor(data,d),a);
 data=m.applyOperation(data,{action:'remove',id:a});assert.equal(m.projectFor(data,d),null);assert.equal(data.memberships[d],a);
 assert.deepEqual(original,{id:d,title:'Note',favorite:true,content:'rich text',createdAt:123});
 data.memberships[d]=b;assert.equal(m.projectFor(data,d),null);
 assert.throws(()=>m.applyOperation(data,{action:'move',documentId:d,projectId:a}),/移除/);
});
test('IDs drive ownership, repeated names are safe and moving out keeps metadata valid',()=>{
 let data=create(create(m.emptyProjects('app.doc'),a,'Same'),b,'Same');data=m.applyOperation(data,{action:'move',documentId:d,projectId:b});assert.equal(m.projectFor(data,d),b);
 data=m.applyOperation(data,{action:'rename',id:b,name:'Renamed'});assert.equal(m.projectFor(data,d),b);
 data=m.applyOperation(data,{action:'move',documentId:d,projectId:null});assert.equal(m.projectFor(data,d),null);
 assert.throws(()=>m.validateProjects(data,'app.cover'),/不兼容/);
 assert.throws(()=>m.applyOperation(data,{action:'create',id:crypto.randomUUID(),name:' '}));
 assert.throws(()=>m.validateProjects({...data,projects:[]},'app.doc'));
});
test('refresh and mutations serialize so late reads cannot undo user moves; mutations patch fresh data',async()=>{
 let disk=create(m.emptyProjects('app.doc'),a,'A'),finish;const gate=new Promise(r=>finish=r);let calls=0;
 const store=createProjectController('app.doc',{read:async()=>{const captured=disk;calls++;await gate;return captured;},mutate:async op=>disk=m.applyOperation(disk,op)});
 const loading=store.load();await Promise.resolve();disk=create(disk,b,'Remote');const moving=store.mutate({action:'move',documentId:d,projectId:b});finish();await loading;await moving;
 assert.equal(m.projectFor(store.snapshot().data,d),b);assert.equal(Object.keys(store.snapshot().data.projects).length,2);assert.equal(calls,1);
});
test('failed writes keep the old membership visible and errors retry without losing metadata',async()=>{
 let fail=true,disk=create(m.emptyProjects('app.doc'),a,'A');const store=createProjectController('app.doc',{read:async()=>disk,mutate:async op=>{if(fail)throw Error('disk full');return disk=m.applyOperation(disk,op);}});
 await store.load();await assert.rejects(store.mutate({action:'move',documentId:d,projectId:a}),/disk full/);assert.equal(m.projectFor(store.snapshot().data,d),null);assert.match(store.snapshot().error,/disk full/);
 fail=false;await store.mutate({action:'move',documentId:d,projectId:a});assert.equal(m.projectFor(store.snapshot().data,d),a);assert.equal(store.snapshot().error,'');
});
