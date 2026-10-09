import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';
function lifecycle() {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/documentLifecycle.ts', import.meta.url), 'utf8'), {loader:'ts',format:'cjs'}).code,{module});
  return module.exports;
}
test('note switch waits for notes but does not enter slow workspace or comic queues', async () => {
  const l=lifecycle(), calls=[]; let finish;
  l.registerDocumentFlusher(()=>new Promise(()=>{}));
  l.registerDocumentFlusher(async()=>{calls.push('comic')},'app.story-comic');
  l.registerDocumentFlusher(()=>new Promise(resolve=>{finish=resolve;calls.push('note')}),'app.doc');
  let switched=false;
  const pending=l.flushBeforeToolSwitch('app.doc').then(()=>{switched=true});
  await Promise.resolve(); assert.equal(switched,false); assert.deepEqual(calls,['note']);
  finish(); await pending; assert.equal(switched,true);
});
test('failed note save still prevents switching; full flush still covers every owner', async()=>{
  const l=lifecycle(); const remove=l.registerDocumentFlusher(async()=>{throw Error('disk failed')},'app.doc');
  await assert.rejects(l.flushBeforeToolSwitch('app.doc'),/disk failed/); remove();
  const calls=[];
  for(const owner of [undefined,'app.doc','app.story-comic']) l.registerDocumentFlusher(async()=>calls.push(owner),owner);
  await l.flushDocuments(); assert.deepEqual(calls,[undefined,'app.doc','app.story-comic']);
});

test('every tool switch ignores hung foreign owners, including workspace and hidden HTML', async () => {
  for (const owner of ['app.doc','app.whiteboard','app.comic','app.cover','app.story-comic','app.design','app.html','app.animation']) {
    const l=lifecycle(),calls=[];
    l.registerDocumentFlusher(()=>new Promise(()=>{}));
    l.registerDocumentFlusher(()=>new Promise(()=>{}),'foreign');
    l.registerDocumentFlusher(async()=>calls.push(owner),owner);
    await l.flushBeforeToolSwitch(owner);
    assert.deepEqual(calls,[owner]);
  }
});

test('tool switch queues through sync activation and saves only after release', async () => {
  const l=lifecycle(); const release=l.beginSyncActivation(); const calls=[];
  l.registerDocumentFlusher(async()=>calls.push('save'),'app.cover');
  const pending=l.flushBeforeToolSwitch('app.cover');
  await Promise.resolve(); assert.deepEqual(calls,[]);
  release(); await pending; assert.deepEqual(calls,['save']);
});
test('new editor cannot mount when sync activation starts during its departing save', async () => {
  const l=lifecycle(); let releaseSave, committed=false;
  l.registerDocumentFlusher(()=>new Promise(resolve=>{releaseSave=resolve}),'app.doc');
  const pending=l.flushBeforeToolSwitch('app.doc').then(()=>l.runAfterSyncActivation(()=>{committed=true}));
  await Promise.resolve(); const release=l.beginSyncActivation(); releaseSave();
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(committed,false);
  release(); await pending; assert.equal(committed,true);
});
