import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const module={exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/toolNavigation.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module});
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){let active='cover',resolve,reject;const states=[],errors=[],calls=[];const nav=module.exports.createToolNavigation({active:()=>active,flush:owner=>{calls.push(owner);return new Promise((r,j)=>{resolve=r;reject=j;});},pending:id=>states.push(id),error:e=>errors.push(e)});return {nav,states,errors,calls,get active(){return active},select:id=>nav.select(id,()=>{active=id}),finish:()=>resolve(),fail:()=>reject(Error('save failed'))};}
test('rapid switch requests share a slow departing save and only latest destination commits',async()=>{const h=setup();const a=h.select('notes'),b=h.select('board');await tick();assert.deepEqual(h.calls,['cover']);assert.equal(h.active,'cover');assert.equal(h.states.at(-1),'board');h.finish();assert.equal(await a,false);assert.equal(await b,true);assert.equal(h.active,'board');assert.equal(h.states.at(-1),null);});
test('clicking the current tool cancels pending navigation without waiting for the disk',async()=>{const h=setup();const a=h.select('board');await tick();assert.equal(await h.select('cover'),true);h.finish();assert.equal(await a,false);assert.equal(h.active,'cover');});
test('save failure leaves current content visible; retry uses a new save',async()=>{const h=setup();const a=h.select('board');await tick();h.fail();assert.equal(await a,false);assert.equal(h.active,'cover');assert.equal(h.errors.length,1);const b=h.select('notes');await tick();h.finish();assert.equal(await b,true);assert.equal(h.calls.length,2);});
test('late failure or completion cannot change state after disposal',async()=>{const h=setup();const a=h.select('board');await tick();h.nav.dispose();h.fail();assert.equal(await a,false);assert.equal(h.errors.length,0);assert.equal(h.active,'cover');});

test('latest destination still wins when sync begins after saving and delays activation', async () => {
  const life={exports:{}};
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/documentLifecycle.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module:life});
  const release=life.exports.beginSyncActivation(); let active='notes';
  const nav=module.exports.createToolNavigation({active:()=>active,flush:async()=>{},pending:()=>{},error:e=>{throw e},activate:life.exports.runAfterSyncActivation});
  const a=nav.select('board',()=>{active='board'}); await tick();
  const b=nav.select('cover',()=>{active='cover'}); await tick(); assert.equal(active,'notes');
  release(); assert.equal(await a,false); assert.equal(await b,true); assert.equal(active,'cover');
});
