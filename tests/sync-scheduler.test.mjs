import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';

const code = transformSync(readFileSync(new URL('../src/workspace.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const drain = () => new Promise(resolve => setImmediate(resolve));
function harness(invoke) {
  const timers = new Map(); let serial = 0; let time = 100000;
  const root = { inert: false };
  const window = new EventTarget(); const document = new EventTarget();
  document.visibilityState = 'visible'; document.body = root;
  const context = {
    module: { exports: {} }, window, document, console,
    Date: class extends Date { static now() { return time; } }, Math,
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay, interval: false }); return id; },
    setInterval: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay, interval: true }); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    require: id => id.includes('documentLifecycle') ? { flushDocuments: async () => {} } : { isTauri: () => true, invoke },
  };
  vm.runInNewContext(code, context);
  return { api: context.module.exports, root, window, document, timers, advance: ms => { time += ms; } };
}
test('startup, focus, reconnect and timer check remote even without saves; cleanup removes triggers', async () => {
  const calls = [];
  const h = harness(async command => { calls.push(command); return null; });
  const stop = h.api.startBackgroundSync(() => {});
  await drain(); assert.equal(calls.length, 1);
  h.window.dispatchEvent(new Event('focus')); await drain();
  h.window.dispatchEvent(new Event('online')); await drain();
  h.document.dispatchEvent(new Event('visibilitychange')); await drain();
  const interval = [...h.timers.values()].find(t => t.interval);
  assert.ok(interval.delay >= 60000 && interval.delay < 70000);
  interval.fn(); await drain(); assert.equal(calls.length, 5);
  stop(); h.window.dispatchEvent(new Event('focus')); await drain();
  assert.equal(calls.length, 5); assert.equal(h.timers.size, 0);
});
test('coalesces simultaneous checks; networking permits input, activation refreshes before unlocking', async () => {
  let resolveNetwork; const calls = [];
  const h = harness(async command => {
    calls.push(command);
    if (command === 'sync_workspace') return await new Promise(resolve => { resolveNetwork = resolve; });
    assert.equal(h.root.inert, true);
    return { changed: ['state.json'], message: 'done' };
  });
  let refreshed = false;
  h.api.registerSyncRefresher(async changed => {
    assert.equal(h.root.inert, true); assert.equal(changed[0], 'state.json'); refreshed = true;
  });
  const a = h.api.syncWorkspace(); const b = h.api.syncWorkspace();
  assert.equal(a, b); await drain(); assert.equal(h.root.inert, false);
  resolveNetwork('job'); assert.equal(await a, 'done');
  assert.deepEqual(calls, ['sync_workspace', 'finish_sync']);
  assert.equal(refreshed, true); assert.equal(h.root.inert, false);
});
test('network failure backs off, reconnect retries, manual retry remains available', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('offline'); });
  await assert.rejects(h.api.syncWorkspace());
  await h.api.syncWorkspace(); assert.equal(calls, 1);
  h.advance(5000); await assert.rejects(h.api.syncWorkspace()); assert.equal(calls, 2);
  await assert.rejects(h.api.syncWorkspace('manual')); assert.equal(calls, 3);
  assert.equal(h.root.inert, false);
});
test('changed saves debounce background sync and unchanged saves do not schedule it', async () => {
  let changed = false; const calls = [];
  const h = harness(async command => { calls.push(command); return command === 'save_workspace' ? changed : null; });
  await h.api.saveWorkspace({}); assert.equal(h.timers.size, 0);
  changed = true;
  await h.api.saveWorkspace({}); await h.api.saveWorkspace({});
  assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0]; assert.equal(timer.delay, 3000);
  timer.fn(); await drain(); assert.equal(calls.filter(c => c === 'sync_workspace').length, 1);
});
test('autosync failures remain visible during backoff and clear only after a real retry', async () => {
  let fail = true; const statuses = [];
  const h = harness(async () => { if (fail) throw new Error('fetch timeout'); return 'unchanged'; });
  const stop = h.api.startBackgroundSync(message => statuses.push(message));
  await drain();
  assert.match(statuses.at(-1), /fetch timeout/);
  const error = statuses.at(-1);
  h.window.dispatchEvent(new Event('focus')); await drain();
  assert.equal(statuses.at(-1), error);
  fail = false;
  h.window.dispatchEvent(new Event('online')); await drain();
  assert.match(statuses.at(-1), /已与其他设备保持同步/);
  stop();
});

test('unchanged pulls still reconcile the navigation and comic lists', async () => {
  const h = harness(async () => 'unchanged'); const refreshed = [];
  h.api.registerSyncRefresher(async paths => refreshed.push([...paths]));
  await h.api.syncWorkspace(); assert.deepEqual(refreshed, [[]]);
});
test('one failed list does not block others and retained paths retry on unchanged pulls', async () => {
  let first = true; let fail = true; const seen = [];
  const h = harness(async command => {
    if (command === 'sync_workspace') { const value = first ? 'job' : 'unchanged'; first = false; return value; }
    return { changed: ['state.json', 'data/app.comic/example.comic.json'], message: 'done' };
  });
  h.api.registerSyncRefresher(async () => { if (fail) throw new Error('list temporarily unavailable'); });
  h.api.registerSyncRefresher(async paths => { seen.push([...paths]); });
  await assert.rejects(h.api.syncWorkspace(), /列表刷新未完成/);
  assert.equal(seen.length, 1); assert.equal(h.root.inert, false);
  fail = false; await h.api.syncWorkspace('manual');
  assert.deepEqual(seen[1], ['state.json', 'data/app.comic/example.comic.json']);
  await h.api.syncWorkspace('manual'); assert.deepEqual(seen[2], []);
});
