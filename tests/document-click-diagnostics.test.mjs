import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const code = transformSync(readFileSync(new URL('../src/documents/clickDiagnostics.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function harness() {
  const dom = new JSDOM('<!doctype html><body><aside class="document-sidebar"><div class="document-row"><button class="document-open" title="PRIVATE_TITLE" data-id="PRIVATE_ID"><span draggable="true" class="nav-drag-handle">icon</span>PRIVATE_CONTENT</button><button class="document-more">more</button></div></aside></body>');
  const timers = new Map(); let serial = 0;
  const module = { exports: {} }; const seen = [];
  vm.runInNewContext(code, { module, queueMicrotask, MutationObserver: dom.window.MutationObserver,
    setTimeout: fn => { const id = ++serial; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const api = module.exports;
  const flush = async () => {
    await new Promise(resolve => setImmediate(resolve));
    const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn());
  };
  return { dom, api, seen, timers, flush,
    start: () => api.startDocumentClickDiagnostics(dom.window.document, snapshot => seen.push(snapshot)),
    emit(type, target = dom.window.document.querySelector('.document-open')) {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true });
      target.dispatchEvent(event); return event;
    },
    last: () => seen.at(-1),
  };
}

test('diagnostics are opt-in, passive, bounded and exclude document data', async () => {
  const h = harness();
  h.api.recordDocumentClickStage('selected'); assert.equal(h.seen.length, 0);
  assert.equal(h.api.refreshDocumentClickDiagnostics(), false);
  const stop = h.start(); let clicks = 0;
  h.dom.window.document.querySelector('.document-open').addEventListener('click', () => { clicks++; });
  for (let i = 0; i < 30; i++) assert.equal(h.emit('click').defaultPrevented, false);
  h.api.recordDocumentClickStage('selected');
  h.api.recordDocumentClickStage('saving');
  await h.flush(); h.api.refreshDocumentClickDiagnostics();
  assert.equal(clicks, 30, 'observer must not prevent or replay clicks');
  assert.ok(h.last().entries.length <= 24);
  assert.ok(h.last().entries.some(entry => entry.label === '选择请求已收到'));
  const json = JSON.stringify(h.last());
  assert.ok(!json.includes('PRIVATE_'));
  assert.match(json, /列表第 1 行/);
  stop(); const count = h.seen.length;
  h.emit('click'); h.api.recordDocumentClickStage('failed'); await h.flush();
  assert.equal(h.seen.length, count);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});

test('diagnostic display never repaints during mouse events without an explicit snapshot', async () => {
  const h = harness(); const stop = h.start(); const initial = h.seen.length;
  h.emit('pointerdown'); h.emit('mousedown');
  h.api.recordDocumentClickStage('selected');
  await h.flush();
  assert.equal(h.seen.length, initial);
  h.emit('pointerup'); h.emit('mouseup'); h.emit('click');
  await h.flush();
  assert.equal(h.seen.length, initial);
  h.api.refreshDocumentClickDiagnostics();
  assert.ok(h.seen.length > initial);
  stop(); h.dom.window.close();
});

test('diagnostics distinguish an intercepted click, drag target and application handler entry', async () => {
  const h = harness(); const stop = h.start();
  const button = h.dom.window.document.querySelector('.document-open');
  button.addEventListener('click', event => { event.stopPropagation(); event.preventDefault(); });
  h.emit('click');
  h.emit('dragstart', button.querySelector('.nav-drag-handle'));
  await h.flush(); h.api.refreshDocumentClickDiagnostics();
  const click = h.last().entries.find(entry => entry.label === '原生 click');
  assert.match(click.detail, /冒泡未到达/); assert.match(click.detail, /默认动作被取消/);
  assert.ok(h.last().entries.some(entry => entry.detail.includes('拖拽图标')));
  assert.ok(!h.last().entries.some(entry => entry.label === '选择请求已收到'));
  stop(); h.dom.window.close();
});

test('diagnostics retain both transitions of a short-lived inert barrier', async () => {
  const h = harness(); const stop = h.start();
  h.dom.window.document.body.setAttribute('inert', '');
  h.dom.window.document.body.removeAttribute('inert');
  await h.flush(); h.api.refreshDocumentClickDiagnostics();
  const labels = h.last().entries.map(entry => entry.label);
  assert.ok(labels.indexOf('页面进入输入保护') < labels.indexOf('页面退出输入保护'));
  stop(); h.dom.window.close();
});

test('diagnostic panel is opt-in via shortcut, ignores pointer hits and clears when hidden', async () => {
  const h = harness();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) {
    Object.defineProperty(globalThis, key, { value: h.dom.window[key], configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ui = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/documents/DocumentClickDiagnostics.tsx', import.meta.url), 'utf8'), {
    loader: 'tsx', format: 'cjs', jsx: 'automatic',
  }).code, { module: ui, window: h.dom.window, document: h.dom.window.document, require(id) {
    return id === './clickDiagnostics' ? h.api : require(id);
  } });
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../src/documents/documents.css', import.meta.url), 'utf8');
  document.head.append(style);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const toggle = (code = 'KeyD') => window.dispatchEvent(new window.KeyboardEvent('keydown', { code, altKey: true, shiftKey: true, cancelable: true }));
  try {
    await React.act(async () => { root.render(React.createElement(ui.exports.default)); });
    assert.equal(host.textContent, '');
    await React.act(async () => { toggle(); });
    const panel = host.querySelector('.document-click-diagnostics');
    assert.ok(panel);
    assert.equal(window.getComputedStyle(panel).pointerEvents, 'none');
    await React.act(async () => { h.emit('mousedown'); h.api.recordDocumentClickStage('saving'); await h.flush(); });
    assert.ok(!panel.textContent.includes('开始保存当前内容'));
    await React.act(async () => { toggle('KeyS'); });
    assert.match(panel.textContent, /开始保存当前内容/);
    assert.match(panel.textContent, /手动快照：1/);
    assert.match(panel.textContent, /保留（未见终止事件）/);
    assert.ok(!panel.textContent.includes('PRIVATE_'));
    assert.match(panel.textContent, /JS 记录通道：自检通过/);
    const read = panel.querySelector('button[aria-label="读取点击诊断记录"]');
    assert.ok(read);
    assert.equal(window.getComputedStyle(read).pointerEvents, 'auto');
    const recordsBefore = panel.textContent.match(/事件记录：(\d+)/)[1];
    let leakedClicks = 0;
    document.body.addEventListener('click', () => leakedClicks++);
    await React.act(async () => {
      const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
      read.dispatchEvent(down);
      assert.equal(down.defaultPrevented, true, 'diagnostic control must not steal editor focus');
      read.click();
    });
    assert.match(panel.textContent, /手动快照：2/);
    assert.match(panel.textContent, /按钮响应：1/);
    assert.equal(panel.textContent.match(/事件记录：(\d+)/)[1], recordsBefore);
    assert.equal(panel.querySelector('button[aria-label="读取点击诊断记录"]'), read, 'keep the read button stable');
    assert.equal(leakedClicks, 0, 'reading diagnostics must not enter application click handlers');
    await React.act(async () => { toggle(); });
    assert.equal(host.textContent, '');
    assert.equal(h.timers.size, 0);
  } finally { await React.act(async () => root.unmount()); h.dom.window.close(); }
});

test('a manual snapshot exposes click and handler records even without an observed mouseup', async () => {
  const h = harness(); const stop = h.start(); const initial = h.seen.length;
  h.emit('mousedown');
  h.emit('click');
  h.api.recordDocumentClickStage('selected');
  await h.flush(); h.api.refreshDocumentClickDiagnostics();
  assert.equal(h.last().pressed, false);
  assert.ok(h.seen.length > initial, 'missing mouseup must not hide click and handler records forever');
  assert.ok(h.last().entries.some(entry => entry.label === '原生 click'));
  stop(); h.dom.window.close();
});

test('window capture can observe a click intercepted before document capture listeners', async () => {
  const h = harness();
  h.dom.window.document.addEventListener('click', event => event.stopImmediatePropagation(), true);
  const stop = h.start();
  h.emit('click'); await h.flush(); h.api.refreshDocumentClickDiagnostics();
  assert.ok(h.last().entries.some(entry => entry.label === '原生 click'), 'observe at the outer window before document handlers');
  stop(); h.dom.window.close();
});


test('hover-only evidence is visible without flooding duplicate hover records', async () => {
  const h = harness(); const stop = h.start();
  for (let i = 0; i < 10; i++) { h.emit('pointerover'); h.emit('mouseover'); }
  await h.flush(); h.api.refreshDocumentClickDiagnostics();
  assert.equal(h.last().capturedEvents, 1);
  assert.equal(h.last().selectionRequests, 0);
  assert.ok(h.last().entries.some(entry => entry.label === '指针进入'));
  stop(); h.dom.window.close();
});

test('focus and IME events remain observable without recording input text', async () => {
  const h = harness(); const stop = h.start();
  const target = h.dom.window.document.querySelector('.document-open');
  target.dispatchEvent(new h.dom.window.CompositionEvent('compositionend', { bubbles: true, data: 'SECRET_TYPED_TEXT' }));
  target.dispatchEvent(new h.dom.window.InputEvent('input', { bubbles: true, data: 'SECRET_TYPED_TEXT' }));
  h.emit('focusout');
  await h.flush();
  h.api.refreshDocumentClickDiagnostics();
  const json = JSON.stringify(h.last());
  assert.match(json, /输入法组合结束/);
  assert.match(json, /控件失去焦点/);
  assert.ok(!json.includes('SECRET_TYPED_TEXT'));
  stop(); h.dom.window.close();
});


test('startup self-check validates the JS listener without pretending a user clicked', () => {
  const h = harness(); const stop = h.start();
  assert.equal(h.last().channelReady, true);
  assert.equal(h.last().capturedEvents, 0);
  assert.equal(h.last().selectionRequests, 0);
  assert.equal(h.last().manualSnapshots, 0);
  assert.ok(h.last().entries.some(entry => entry.label === 'JS 记录通道自检通过'));
  stop(); h.dom.window.close();
});

test('diagnostic controls are excluded from document-event evidence', async () => {
  const h = harness();
  const panel = h.dom.window.document.createElement('aside'); panel.className = 'document-click-diagnostics';
  const button = h.dom.window.document.createElement('button'); panel.append(button);
  h.dom.window.document.body.append(panel);
  const stop = h.start();
  h.emit('pointerdown', button); h.emit('mousedown', button); h.emit('click', button);
  await h.flush(); h.api.refreshDocumentClickDiagnostics();
  assert.equal(h.last().capturedEvents, 0);
  assert.equal(h.last().pressed, false);
  assert.equal(h.last().selectionRequests, 0);
  stop(); h.dom.window.close();
});

test('propagation is annotated in a later task, not at the capture microtask checkpoint', async () => {
  const h = harness(); const stop = h.start();
  h.emit('click');
  await Promise.resolve();
  h.api.refreshDocumentClickDiagnostics();
  const first = h.last().entries.find(entry => entry.label === '原生 click');
  assert.ok(!first.detail.includes('冒泡'), 'do not infer interception before the dispatch task has finished');
  await h.flush(); h.api.refreshDocumentClickDiagnostics();
  assert.match(h.last().entries.find(entry => entry.label === '原生 click').detail, /冒泡到达/);
  h.emit('click');
  assert.ok(h.timers.size > 0);
  stop();
  assert.equal(h.timers.size, 0, 'remove pending event checks on close');
  h.dom.window.close();
});
