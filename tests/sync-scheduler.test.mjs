import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';

const code = transformSync(readFileSync(new URL('../src/workspace.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const drain = () => new Promise(resolve => setImmediate(resolve));
function harness(invoke, options = {}) {
  const timers = new Map(); let serial = 0; let time = 100000;
  const window = new EventTarget(); const document = new EventTarget();
  let inert = false;
  const inertChanges = [];
  const root = { tagName: 'BODY', get inert() { return inert; }, set inert(value) {
    inert = value; inertChanges.push(value);
    // Browsers blur an input when its ancestor becomes inert. Excalidraw then
    // removes its textarea; setting inert=false cannot restore that session.
    if (value && document.activeElement !== root) {
      document.activeElement?.onBlur?.();
      document.activeElement = root;
    }
  } };
  document.visibilityState = 'visible'; document.body = root; document.activeElement = root;
  const context = {
    module: { exports: {} }, window, document, console,
    Date: class extends Date { static now() { return time; } }, Math,
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay, interval: false }); return id; },
    setInterval: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay, interval: true }); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    require: id => id.includes('documentLifecycle') ? { flushDocuments: async () => options.flush?.(), isSyncActivationBlocked: () => options.blocked?.() ?? false } : { isTauri: () => true, invoke },
  };
  vm.runInNewContext(code, context);
  return { api: context.module.exports, root, window, document, timers, inertChanges, advance: ms => { time += ms; } };
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

function endEditing(h) {
  h.document.activeElement = h.root;
  h.document.dispatchEvent(new Event('focusout'));
}

test('sync cannot blur whiteboard text; edits saved during the wait are flushed and synced again', async () => {
  let resolveNetwork; let text = 'before'; const flushed = []; const calls = [];
  const h = harness(async command => {
    calls.push(command);
    if (command === 'sync_workspace') return await new Promise(resolve => { resolveNetwork = resolve; });
    if (command === 'save_workspace') return true;
    return { changed: ['data/app.whiteboard/test.whiteboard.json'], message: 'done' };
  }, { flush: () => flushed.push(text) });
  const task = h.api.syncWorkspace();
  await drain();
  // The user starts text editing while the network request is in flight.
  let submitted = false;
  const editor = { tagName: 'TEXTAREA', onBlur: () => { submitted = true; } };
  h.document.activeElement = editor;
  resolveNetwork('job'); await drain();
  assert.deepEqual(calls, ['sync_workspace']);
  assert.equal(h.document.activeElement, editor);
  assert.equal(submitted, false);
  assert.deepEqual(h.inertChanges, []);
  assert.equal(h.api.syncWorkspace(), task);
  text = '输入期间继续保存的中文';
  await h.api.saveWorkspace({});
  assert.equal(h.root.inert, false);
  assert.equal([...h.timers.values()].filter(t => t.delay === 3000).length, 0);
  let refreshed = false;
  h.api.registerSyncRefresher(async () => { assert.equal(h.root.inert, true); refreshed = true; });
  endEditing(h);
  assert.equal(await task, 'done');
  assert.equal(flushed.at(-1), text);
  assert.equal(submitted, false);
  assert.equal(refreshed, true);
  assert.equal(h.root.inert, false);
  assert.equal([...h.timers.values()].filter(t => t.delay === 100).length, 0);
  // Do not lose the autosync request made while activeSync was waiting.
  const retry = [...h.timers.values()].find(t => t.delay === 3000);
  assert.ok(retry); h.advance(3000); retry.fn(); await drain();
  assert.equal(calls.filter(c => c === 'sync_workspace').length, 2);
  resolveNetwork(null); await drain();
});

test('unchanged pulls also leave focused text inputs and contenteditable sessions intact', async () => {
  for (const editor of [{ tagName: 'INPUT', type: 'text' }, { tagName: 'DIV', isContentEditable: true }]) {
    const h = harness(async () => 'unchanged');
    h.document.activeElement = editor;
    let refreshed = false;
    h.api.registerSyncRefresher(async () => { refreshed = true; });
    const task = h.api.syncWorkspace(); await drain();
    assert.equal(h.document.activeElement, editor);
    assert.deepEqual(h.inertChanges, []);
    assert.equal(refreshed, false);
    endEditing(h); await task;
    assert.equal(refreshed, true);
    assert.equal(h.root.inert, false);
  }
});

test('moving between text inputs does not open an activation gap', async () => {
  const h = harness(async () => 'unchanged');
  h.document.activeElement = { tagName: 'TEXTAREA' };
  const task = h.api.syncWorkspace(); await drain();
  const next = { tagName: 'INPUT', type: 'search' };
  h.document.activeElement = next;
  h.document.dispatchEvent(new Event('focusout')); await drain();
  assert.equal(h.document.activeElement, next);
  assert.deepEqual(h.inertChanges, []);
  endEditing(h); await task;
});

test('editor session blocks activation even while a toolbar has focus; unmount resumes it', async () => {
  let blocked = true;
  const h = harness(async () => 'unchanged', { blocked: () => blocked });
  h.document.activeElement = { tagName: 'BUTTON' };
  const task = h.api.syncWorkspace(); await drain();
  assert.deepEqual(h.inertChanges, []);
  blocked = false;
  [...h.timers.values()].find(t => t.delay === 100).fn();
  await task;
  assert.equal(h.root.inert, false);
  assert.equal(h.timers.size, 0);
});

test('pausing for update cancels an editing wait and resumes with a fresh sync', async () => {
  const calls = [];
  const h = harness(async command => {
    calls.push(command);
    return command === 'sync_workspace' ? 'job' : { changed: [], message: 'done' };
  });
  h.document.activeElement = { tagName: 'TEXTAREA' };
  const task = h.api.syncWorkspace(); await drain();
  const resume = await h.api.pauseSyncForUpdate();
  assert.match(await task, /暂停同步/);
  assert.deepEqual(calls, ['sync_workspace']);
  assert.deepEqual(h.inertChanges, []);
  assert.equal(h.timers.size, 0);
  endEditing(h); resume();
  [...h.timers.values()].find(t => t.delay === 3000).fn(); await drain();
  assert.deepEqual(calls, ['sync_workspace', 'sync_workspace', 'finish_sync']);
});

test('save failure after editing ends still blocks activation and restores input', async () => {
  let fail = false; const calls = [];
  const h = harness(async command => { calls.push(command); return 'job'; }, {
    flush: () => { if (fail) throw new Error('disk full'); },
  });
  h.document.activeElement = { tagName: 'TEXTAREA' };
  const task = h.api.syncWorkspace(); await drain();
  fail = true; endEditing(h);
  await assert.rejects(task, /disk full/);
  assert.deepEqual(calls, ['sync_workspace']);
  assert.equal(h.root.inert, false);
});

function sendInput(h, type, fields = {}, target = h.document) {
  const event = Object.assign(new Event(type, { cancelable: true }), fields);
  // A real inert subtree doesn't deliver clicks to its buttons.
  if (type !== 'click' || !h.root.inert) target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false, 'sync tracking must not intercept input');
}
async function finishInteraction(h) {
  h.advance(500);
  const timer = [...h.timers.values()].find(t => t.delay === 100);
  assert.ok(timer, 'activation should still be waiting for the interaction');
  timer.fn(); await drain();
}

test('leaving an editor by clicking a button delivers the first click before activation', async () => {
  const h = harness(async command => command === 'sync_workspace'
    ? 'job' : { changed: [], message: 'done' });
  h.document.activeElement = { tagName: 'TEXTAREA' };
  let clicks = 0;
  h.document.addEventListener('click', () => { clicks++; });
  const task = h.api.syncWorkspace(); await drain();
  sendInput(h, 'pointerdown', { pointerId: 1, buttons: 1 });
  endEditing(h); await drain();
  assert.deepEqual(h.inertChanges, [], 'focusout is not the end of a click');
  sendInput(h, 'pointerup', { pointerId: 1, buttons: 0 });
  await drain();
  assert.deepEqual(h.inertChanges, [], 'pointerup must not swallow the following click');
  sendInput(h, 'click');
  assert.equal(clicks, 1);
  await finishInteraction(h); await task;
  assert.equal(clicks, 1, 'never synthesize or replay a click after refreshing');
  assert.equal(h.root.inert, false);
});

test('network completion during a held pointer waits for release and click, even outside editors', async () => {
  const h = harness(async () => 'unchanged');
  sendInput(h, 'pointerdown', { pointerId: 7, buttons: 1 });
  const task = h.api.syncWorkspace(); await drain();
  h.advance(2000);
  [...h.timers.values()].find(t => t.delay === 100)?.fn(); await drain();
  assert.deepEqual(h.inertChanges, [], 'a long press is not idle');
  sendInput(h, 'pointerup', { pointerId: 7, buttons: 0 });
  sendInput(h, 'click');
  await finishInteraction(h); await task;
});

test('Space keyup can activate a focused button before sync refreshes the page', async () => {
  const h = harness(async () => 'unchanged');
  h.document.activeElement = { tagName: 'BUTTON' };
  sendInput(h, 'keydown', { code: 'Space', key: ' ' });
  const task = h.api.syncWorkspace(); await drain();
  assert.deepEqual(h.inertChanges, []);
  sendInput(h, 'keyup', { code: 'Space', key: ' ' });
  await drain();
  assert.deepEqual(h.inertChanges, []);
  let clicks = 0;
  h.document.addEventListener('click', () => { clicks++; });
  sendInput(h, 'click');
  await finishInteraction(h); await task;
  assert.equal(clicks, 1);
});

test('pointer cancellation, drag end and window blur cannot strand pending activation', async () => {
  for (const release of ['pointercancel', 'dragend', 'blur']) {
    const h = harness(async () => 'unchanged');
    sendInput(h, 'pointerdown', { pointerId: 1, buttons: 1 });
    const task = h.api.syncWorkspace(); await drain();
    assert.deepEqual(h.inertChanges, []);
    sendInput(h, release, { pointerId: 1 }, release === 'blur' ? h.window : h.document);
    await finishInteraction(h); await task;
    assert.equal(h.root.inert, false);
  }
});

test('a second pointer and a second click extend the interaction rather than being swallowed', async () => {
  const h = harness(async () => 'unchanged');
  sendInput(h, 'pointerdown', { pointerId: 1, buttons: 1 });
  sendInput(h, 'pointerdown', { pointerId: 2, buttons: 1 });
  const task = h.api.syncWorkspace(); await drain();
  sendInput(h, 'pointerup', { pointerId: 1, buttons: 0 });
  await finishInteraction(h);
  assert.deepEqual(h.inertChanges, []);
  sendInput(h, 'pointerup', { pointerId: 2, buttons: 0 });
  sendInput(h, 'click');
  h.advance(300);
  [...h.timers.values()].find(t => t.delay === 100).fn(); await drain();
  assert.deepEqual(h.inertChanges, []);
  sendInput(h, 'click'); sendInput(h, 'dblclick');
  h.advance(300);
  [...h.timers.values()].find(t => t.delay === 100).fn(); await drain();
  assert.deepEqual(h.inertChanges, []);
  await finishInteraction(h); await task;
});

test('returning after a pointer release outside the webview clears the stale press', async () => {
  const h = harness(async () => 'unchanged');
  sendInput(h, 'pointerdown', { pointerId: 1, buttons: 1 });
  const task = h.api.syncWorkspace(); await drain();
  assert.deepEqual(h.inertChanges, []);
  sendInput(h, 'pointermove', { pointerId: 1, buttons: 0 });
  await finishInteraction(h); await task;
  assert.equal(h.root.inert, false);
});

test('update pause cancels a held-gesture wait without replaying the pending click', async () => {
  const calls = [];
  const h = harness(async command => { calls.push(command); return 'job'; });
  sendInput(h, 'pointerdown', { pointerId: 1, buttons: 1 });
  const task = h.api.syncWorkspace(); await drain();
  let clicks = 0;
  h.document.addEventListener('click', () => { clicks++; });
  const resume = await h.api.pauseSyncForUpdate();
  assert.match(await task, /暂停同步/);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(calls, ['sync_workspace']);
  assert.deepEqual(h.inertChanges, []);
  assert.equal(clicks, 0);
  sendInput(h, 'pointercancel', { pointerId: 1 });
  resume();
  assert.equal(clicks, 0);
});
