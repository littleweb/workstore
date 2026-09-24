import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';

const code = transformSync(readFileSync(new URL('../src/html/store.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function loaded(id, content = 'original', revision = 1) {
  return { document: { id, type: 'workstore.html', schemaVersion: 1, title: id, content,
    favorite: false, createdAt: 1, updatedAt: revision, lastOpenedAt: 1, revision }, token: `${id}:${revision}` };
}
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function harness(invoke) {
  const module = { exports: {} }; const timers = new Map(); let serial = 0;
  vm.runInNewContext(code, { module, console, Blob,
    setTimeout: fn => { const id = ++serial; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    require(id) {
      if (id === 'react-dom') return { flushSync: fn => fn() };
      if (id === '@tauri-apps/api/core') return { invoke };
      if (id.includes('documentLifecycle')) return { registerDocumentFlusher: () => {} };
      if (id.includes('workspace')) return { native: true, scheduleAutosync: () => {}, registerSyncRefresher: () => {} };
      throw new Error(id);
    },
  });
  return module.exports;
}

test('loading or creating a document cannot change the active document until explicitly activated', async () => {
  const store = harness(async (command, args) => loaded(command === 'create_html_document' ? 'new' : args.id));
  await store.openDocument('a');
  await store.loadDocument('b');
  assert.equal(store.lastDocumentId, 'a');
  await store.createDocument();
  assert.equal(store.lastDocumentId, 'a');
  assert.ok(store.currentDocument('new'));
  store.activateDocument('b');
  assert.equal(store.lastDocumentId, 'b');
  assert.equal(store.currentDocument('b').lastOpenedAt, 1, 'switches must not reorder recent documents');
});

test('a slow read cannot overwrite edits staged after that read started', async () => {
  const read = deferred(); let reads = 0;
  const store = harness(async () => ++reads === 1 ? loaded('a') : read.promise);
  await store.openDocument('a');
  const loading = store.loadDocument('a');
  store.stageDocument('a', { content: 'new unsaved text' });
  read.resolve(loaded('a'));
  assert.equal((await loading).content, 'new unsaved text');
  assert.equal(store.currentDocument('a').content, 'new unsaved text');
  assert.match(store.documentStatus('a'), /正在保存/);
});

test('a slow read cannot roll back content or its token even if a newer edit has already saved', async () => {
  const read = deferred(); let reads = 0; const saves = [];
  const store = harness(async (command, args) => {
    if (command === 'load_html_document') return ++reads === 1 ? loaded('a') : read.promise;
    saves.push(args);
    return loaded('a', args.document.content, saves.length + 1);
  });
  await store.openDocument('a');
  const loading = store.loadDocument('a');
  store.stageDocument('a', { content: 'new saved text' });
  await store.flushDocuments();
  read.resolve(loaded('a'));
  assert.equal((await loading).content, 'new saved text');
  store.stageDocument('a', { content: 'next edit' });
  await store.flushDocuments();
  assert.equal(saves[1].expectedToken, 'a:2');
  assert.equal(saves[1].document.content, 'next edit');
});

test('out-of-order reads cannot replace a newer cache entry installed by another request', async () => {
  const slow = deferred(); let reads = 0;
  const store = harness(async () => ++reads === 1 ? slow.promise : loaded('b', 'newer', 2));
  const first = store.loadDocument('b');
  await store.loadDocument('b');
  slow.resolve(loaded('b', 'older', 1));
  assert.equal((await first).content, 'newer');
  assert.equal(store.currentDocument('b').revision, 2);
  assert.equal(store.lastDocumentId, null);
});

test('ensuring an uncached document cannot overwrite edits after a concurrent open', async () => {
  const slow = deferred(); let reads = 0;
  const store = harness(async () => ++reads === 1 ? slow.promise : loaded('b'));
  const ensuring = store.ensureDocument('b');
  await store.openDocument('b');
  store.stageDocument('b', { content: 'just typed' });
  slow.resolve(loaded('b'));
  assert.equal((await ensuring).content, 'just typed');
  assert.equal(store.currentDocument('b').content, 'just typed');
});

test('AI content starts a new editor session and persists through normal guarded saves', async () => {
  let disk=loaded('a','old content'); const tokens=[];
  const store=harness(async(command,args)=>{
    if(command==='load_html_document')return structuredClone(disk);
    if(command==='save_html_document'){
      tokens.push(args.expectedToken);
      disk=loaded('a',args.document.content,disk.document.revision+1);
      return structuredClone(disk);
    }
  });
  await store.openDocument('a');
  const old=store.remoteVersion('a');
  store.applyDocumentContent('a','<h1>New AI content</h1>');
  assert.equal(store.remoteVersion('a'),old+1);
  assert.equal(store.currentDocument('a').content,'<h1>New AI content</h1>');
  await store.flushDocuments();
  assert.equal(disk.document.content,'<h1>New AI content</h1>');
  assert.deepEqual(tokens,['a:1']);
  await store.openDocument('a');assert.equal(store.currentDocument('a').content,'<h1>New AI content</h1>');
});
