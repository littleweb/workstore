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
