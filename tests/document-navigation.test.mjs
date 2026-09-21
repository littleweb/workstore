import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync, transformSync } from 'esbuild';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
const css = document.createElement('style');
css.textContent = readFileSync(new URL('../src/documents/documents.css', import.meta.url), 'utf8');
document.head.append(css);
const source = transformSync(readFileSync(new URL('../src/documents/DocumentApp.tsx', import.meta.url), 'utf8'), {
  loader: 'tsx', format: 'cjs', jsx: 'automatic',
}).code;
const integratedSource = buildSync({
  entryPoints: [new URL('../src/documents/DocumentApp.tsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'antd', '@ant-design/icons', '@teabook/teaeditor',
    '../ai/AiAssistant', '../ai/AiSidebar', './store', '../workspace', '../documentLifecycle', './documents.css'],
}).outputFiles[0].text;
const drain = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function harness(options = {}) {
  const documents = ['a', 'b', 'c'].map((id, index) => ({
    id, title: `Document ${id}`, content: `<p>Content ${id}</p>`, favorite: false,
    createdAt: index, lastOpenedAt: 10 - index, revision: 1,
  }));
  const cache = new Map(); const listeners = new Set(); const loads = new Map();
  const opened = []; const activated = []; const errors = []; const savedContent = [];
  let lastId = 'a'; let saveGate; let createGate; let dirty = false;
  const blockers = new Set(); const aiProps=[]; const renderVersions=new Map();
  if (options.deferInitial) loads.set('a', deferred());
  const store = {
    get lastDocumentId() { return lastId; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    documentList: () => documents,
    currentDocument: id => cache.get(id),
    documentStatus: () => dirty ? '正在保存…' : '已保存到本地',
    documentWarnings: () => [], remoteVersion: id => renderVersions.get(id)??0,
    async flushDocument(){await store.flushDocuments();},
    applyDocumentContent(id,content){cache.get(id).content=content;renderVersions.set(id,(renderVersions.get(id)??0)+1);listeners.forEach(fn=>fn());},
    refreshDocuments: async () => { listeners.forEach(fn => fn()); },
    async loadDocument(id) {
      opened.push(id);
      if (loads.has(id)) await loads.get(id).promise;
      const doc = { ...documents.find(doc => doc.id === id) };
      cache.set(id, doc); return doc;
    },
    activateDocument(id) { assert.ok(cache.has(id)); lastId = id; activated.push(id); return cache.get(id); },
    async openDocument(id) { await store.loadDocument(id); return store.activateDocument(id); },
    async createDocument() {
      if (createGate) await createGate.promise;
      const created = { ...documents[0], id: 'new', title: 'Document new', content: '' };
      documents.push(created); cache.set(created.id, created); listeners.forEach(fn => fn());
      return created;
    },
    async flushDocuments() {
      if (saveGate) await saveGate.promise;
      savedContent.push(cache.get(lastId)?.content);
      dirty = false;
    },
    stageDocument(id, patch) { Object.assign(cache.get(id), patch); dirty = true; listeners.forEach(fn => fn()); },
  };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const module = { exports: {} };
  const Pass = ({ children }) => children;
  const icon = () => React.createElement('span', { 'aria-hidden': true });
  vm.runInNewContext(options.diagnostics ? integratedSource : source, { module, DOMParser, window, document, MutationObserver: window.MutationObserver, queueMicrotask, setTimeout, clearTimeout, require(id) {
    if (id === 'react' || id === 'react-dom' || id === 'react/jsx-runtime') return require(id);
    if (id === './store') return store;
    if (id === './aiTarget') return { documentAiTarget: () => ({ kind: 'document', capture: () => ({id:lastId,title:'test',content:''}) }) };
    if (id === './DocumentClickDiagnostics') return { __esModule: true, default: () => null };
    if (id === './clickDiagnostics') return { recordDocumentClickStage: () => {} };
    if (id === '../workspace') return { native: true };
    if (id === '../documentLifecycle') return { registerSyncActivationBlocker: fn => { blockers.add(fn); return () => blockers.delete(fn); } };
    if (id === 'antd') return {
      App: { useApp: () => ({ message: { error: text => errors.push(text), warning: text => errors.push(text) } }) },
      Button: ({ children, onClick, disabled, loading }) => React.createElement('button', { onClick, disabled: disabled || loading }, children),
      Dropdown: Pass, Tooltip: Pass, Modal: ({ open, children }) => open ? children : null,
      Input: props => React.createElement('input', { value: props.value, onChange: props.onChange }),
    };
    if (id === '@ant-design/icons') return new Proxy({}, { get: () => icon });
    if (id === '../ai/AiSidebar') return { DocumentAiSidebar: props => { aiProps.push({editor:props.target}); return React.createElement('aside', {'aria-label':'AI 助手侧栏'}, 'AI'); } };
    if (id === '../ai/AiAssistant') return { AiAssistantButton: props => {aiProps.push(props);return null;} };
    if (id === '@teabook/teaeditor') return { Editor: ({ htmlContent, onHtmlChange }) => React.createElement('div', {
      'data-testid': 'editor', 'data-content': htmlContent, contentEditable: true, suppressContentEditableWarning: true,
      onInput: event => onHtmlChange(event.currentTarget.innerHTML),
    }, htmlContent) };
    if (id.endsWith('.css')) return {};
    throw new Error(`Unexpected import: ${id}`);
  } });
  await act(async () => { root.render(React.createElement(module.exports.default)); await drain(); });
  const row = id => host.querySelector(`.document-open[title="Document ${id}"]`);
  let closed = false;
  return {
    host, row, opened, activated, errors, savedContent, store, aiProps,
    get lastId() { return lastId; },
    get syncBlocked() { return [...blockers].some(fn => fn()); },
    content: () => host.querySelector('[data-testid="editor"]')?.getAttribute('data-content'),
    deferLoad(id) { const gate = deferred(); loads.set(id, gate); return gate; },
    initial: loads.get('a'),
    deferSave() { saveGate = deferred(); return saveGate; },
    deferCreate() { createGate = deferred(); return createGate; },
    async create() { await act(async () => { host.querySelector('.tool-sidebar-footer button').click(); await drain(); }); },
    async click(id) { await act(async () => { row(id).click(); await drain(); }); },
    async settle(gate, error) { await act(async () => { error ? gate.reject(error) : gate.resolve(); await drain(); }); },
    async close() { if (closed) return; closed = true; await act(async () => root.unmount()); host.remove(); },
  };
}

test('one native DOM click switches a document when idle', async () => {
  const h = await harness();
  try { await h.click('b'); assert.equal(h.content(), '<p>Content b</p>'); }
  finally { await h.close(); }
});

test('a visible document row accepts the first click during initial document loading', async () => {
  const h = await harness({ deferInitial: true });
  try {
    assert.equal(h.row('b').disabled, false, 'visible rows must not discard clicks while loading');
    await h.click('b');
    assert.equal(h.content(), '<p>Content b</p>');
    await h.settle(h.initial);
    assert.equal(h.content(), '<p>Content b</p>', 'late startup selection must not replace the clicked document');
    assert.equal(h.lastId, 'b');
  } finally { await h.close(); }
});

test('a second document choice is retained while another document is still loading', async () => {
  const h = await harness(); const b = h.deferLoad('b');
  try {
    await h.click('b'); assert.ok(h.opened.includes('b'));
    await h.click('c');
    assert.equal(h.content(), '<p>Content c</p>');
    await h.settle(b);
    assert.equal(h.content(), '<p>Content c</p>');
    assert.equal(h.lastId, 'c', 'stale loads must not update lastDocumentId');
    assert.equal(h.row('c').disabled, false);
  } finally { await h.close(); }
});

test('clicking the current document cancels a pending switch instead of requiring another click', async () => {
  const h = await harness(); const b = h.deferLoad('b');
  try {
    await h.click('b'); await h.click('a'); await h.settle(b);
    assert.equal(h.content(), '<p>Content a</p>');
    assert.equal(h.lastId, 'a');
    assert.equal(h.opened.filter(id => id === 'a').length, 1, 'keep the live editor cache when cancelling back');
  } finally { await h.close(); }
});

test('a choice made while saving is honored once saved, without a second click', async () => {
  const h = await harness(); const save = h.deferSave();
  try {
    await h.click('b'); await h.click('c');
    assert.equal(h.content(), '<p>Content a</p>');
    await h.settle(save);
    assert.equal(h.content(), '<p>Content c</p>');
    assert.equal(h.lastId, 'c');
    assert.equal(h.opened.includes('b'), false, 'obsolete requests need not read their target');
  } finally { await h.close(); }
});

test('failed saves keep the current document and do not activate the requested one', async () => {
  const h = await harness(); const save = h.deferSave();
  try {
    await h.click('b'); await h.settle(save, new Error('disk full'));
    assert.equal(h.content(), '<p>Content a</p>');
    assert.equal(h.lastId, 'a');
    assert.match(h.errors.at(-1), /disk full/);
    assert.equal(h.row('b').disabled, false);
  } finally { await h.close(); }
});

test('loading overlay is anchored to the editor workspace, not the document list or whole window', async () => {
  const h = await harness(); const b = h.deferLoad('b');
  try {
    await h.click('b');
    const workspace = h.host.querySelector('.document-workspace');
    assert.equal(window.getComputedStyle(workspace).position, 'relative');
    assert.ok(workspace.contains(h.host.querySelector('.document-busy')));
    await h.settle(b);
  } finally { await h.close(); }
});


test('a late failure for an obsolete target does not undo or report an error over the latest selection', async () => {
  const h = await harness(); const b = h.deferLoad('b');
  try {
    await h.click('b'); await h.click('c');
    await h.settle(b, new Error('old request failed'));
    assert.equal(h.content(), '<p>Content c</p>');
    assert.equal(h.lastId, 'c');
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('pending navigation blocks sync activation and unmount invalidates its completion', async () => {
  const h = await harness(); const b = h.deferLoad('b');
  try {
    await h.click('b'); assert.equal(h.syncBlocked, true);
    await h.close(); assert.equal(h.syncBlocked, false);
    await h.settle(b);
    assert.equal(h.lastId, 'a');
    assert.deepEqual(h.activated, ['a']);
  } finally { await h.close(); }
});

test('a document choice supersedes creation without deleting the newly created file', async () => {
  const h = await harness(); const created = h.deferCreate();
  try {
    await h.create(); await h.click('b'); await h.settle(created);
    assert.equal(h.content(), '<p>Content b</p>');
    assert.equal(h.lastId, 'b');
    assert.ok(h.store.currentDocument('new'));
    assert.ok(h.row('new'));
    assert.equal(h.syncBlocked, false);
  } finally { await h.close(); }
});


test('bundled DocumentApp and diagnostic panel share the same live recorder', async () => {
  const h = await harness({ diagnostics: true });
  const hotkey = code => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    code, altKey: true, shiftKey: true, cancelable: true,
  }));
  try {
    await act(async () => { hotkey('KeyD'); });
    await h.click('b');
    await act(async () => { hotkey('KeyS'); });
    const panel = h.host.querySelector('.document-click-diagnostics');
    assert.ok(panel);
    assert.match(panel.textContent, /诊断 v3/);
    assert.match(panel.textContent, /选择请求：1/);
    assert.match(panel.textContent, /手动快照：1/);
    assert.match(panel.textContent, /原生 click/);
    assert.match(panel.textContent, /提交选中状态/);
    assert.match(panel.textContent, /选中视图已提交/);
    assert.equal(h.content(), '<p>Content b</p>');
  } finally { await h.close(); }
});

function pointerEvent(type, options = {}) {
  return Object.assign(new window.MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, ...options,
  }), { pointerType: options.pointerType ?? 'mouse', isPrimary: options.isPrimary ?? true, pointerId: 1 });
}
async function dispatch(h, type, options = {}, target = h.row('b')) {
  const event = type.startsWith('pointer') ? pointerEvent(type, options)
    : new window.MouseEvent(type, { bubbles: true, cancelable: true, ...options });
  await act(async () => { target.dispatchEvent(event); await drain(); });
  return event;
}

test('observed down-only mouse sequence selects the document without requiring a later click', async () => {
  const h = await harness();
  try {
    const editor = h.host.querySelector('[data-testid="editor"]');
    editor.focus();
    const down = await dispatch(h, 'pointerdown');
    // The native evidence showed down -> editor blur -> no mouseup/click. Do not
    // supply the missing click in this regression: selection must already exist.
    assert.equal(down.defaultPrevented, true, 'keep the editor from blurring during pointerdown');
    assert.equal(h.content(), '<p>Content b</p>');
    assert.equal(h.row('b').getAttribute('aria-current'), 'page');
    assert.equal(h.lastId, 'b');
  } finally { await h.close(); }
});


test('a normal mouse click following handled pointerdown never saves or selects twice', async () => {
  const h = await harness();
  try {
    const button = h.row('b');
    await dispatch(h, 'pointerdown', {}, button);
    await dispatch(h, 'pointerup', {}, button);
    await dispatch(h, 'click', { detail: 1 }, button);
    assert.deepEqual(h.activated, ['a', 'b']);
    assert.equal(h.savedContent.length, 1);
    assert.equal(h.opened.filter(id => id === 'b').length, 1);
  } finally { await h.close(); }
});

test('the early mouse selection still waits for saves and keeps the latest intent', async () => {
  const h = await harness(); const save = h.deferSave();
  try {
    const editor = h.host.querySelector('[data-testid="editor"]'); editor.focus();
    await dispatch(h, 'pointerdown', {}, h.row('b'));
    assert.equal(document.activeElement, editor, 'no focus side effect while durable save is pending');
    assert.equal(h.content(), '<p>Content a</p>');
    await dispatch(h, 'pointerdown', {}, h.row('c'));
    await h.settle(save);
    assert.equal(h.content(), '<p>Content c</p>');
    assert.equal(h.opened.includes('b'), false);
  } finally { await h.close(); }
});

test('a failed pointerdown save retains the editor; its trailing click cannot retry unexpectedly', async () => {
  const h = await harness(); const save = h.deferSave();
  try {
    await dispatch(h, 'pointerdown'); await h.settle(save, new Error('disk full'));
    await dispatch(h, 'click', { detail: 1 });
    assert.equal(h.content(), '<p>Content a</p>');
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0], /disk full/);
    assert.equal(h.opened.includes('b'), false);
  } finally { await h.close(); }
});

test('touch and pen scrolling do not select on contact while a completed tap still works', async () => {
  for (const pointerType of ['touch', 'pen']) {
    const h = await harness();
    try {
      const down = await dispatch(h, 'pointerdown', { pointerType });
      assert.equal(down.defaultPrevented, false);
      await dispatch(h, 'pointercancel', { pointerType });
      assert.equal(h.content(), '<p>Content a</p>');
      await dispatch(h, 'pointerdown', { pointerType });
      await dispatch(h, 'pointerup', { pointerType });
      await dispatch(h, 'click', { detail: 1 });
      assert.equal(h.content(), '<p>Content b</p>');
      assert.deepEqual(h.activated, ['a', 'b']);
    } finally { await h.close(); }
  }
});

test('drag handle, secondary mouse buttons and modified presses retain their default behavior', async () => {
  const h = await harness();
  try {
    const handle = h.row('b').querySelector('[draggable="true"]');
    assert.ok(handle);
    const down = await dispatch(h, 'pointerdown', {}, handle);
    assert.equal(down.defaultPrevented, false);
    const dragData = new Map();
    await act(async () => {
      const drag = new window.Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(drag, 'dataTransfer', { value: { setData: (type, value) => dragData.set(type, value) } });
      handle.dispatchEvent(drag);
    });
    assert.equal(dragData.get('application/workstore-document'), 'b');
    assert.equal(h.content(), '<p>Content a</p>');
    for (const option of [{button: 1}, {button: 2}, {ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}, {isPrimary: false}]) {
      assert.equal((await dispatch(h, 'pointerdown', option)).defaultPrevented, false);
    }
    assert.equal(h.content(), '<p>Content a</p>');
    await dispatch(h, 'click', { detail: 1 }, handle);
    assert.equal(h.content(), '<p>Content b</p>', 'a non-drag icon click must still work');
  } finally { await h.close(); }
});

test('keyboard and assistive activation works after a mouse press with no trailing click', async () => {
  const h = await harness();
  try {
    await dispatch(h, 'pointerdown');
    await h.click('c');
    await h.click('b');
    assert.equal(h.content(), '<p>Content b</p>');
    assert.deepEqual(h.activated, ['a', 'b', 'c', 'b']);
  } finally { await h.close(); }
});

test('mouse intent during IME composition waits for final input before saving and switching', async () => {
  const h = await harness();
  try {
    const editor = h.host.querySelector('[data-testid="editor"]');
    await act(async () => { editor.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true, data: '' })); });
    const down = await dispatch(h, 'pointerdown');
    assert.equal(down.defaultPrevented, false, 'let the platform finish composition naturally');
    assert.equal(h.content(), '<p>Content a</p>');
    assert.equal(h.savedContent.length, 0);
    assert.equal(h.syncBlocked, true);
    await act(async () => {
      editor.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true, data: '最后输入的中文' }));
      editor.innerHTML = '<p>最后输入的中文</p>';
      editor.dispatchEvent(new window.InputEvent('input', { bubbles: true, data: '最后输入的中文' }));
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.equal(h.savedContent.at(-1), '<p>最后输入的中文</p>');
    assert.equal(h.content(), '<p>Content b</p>');
    assert.equal(h.store.currentDocument('a').content, '<p>最后输入的中文</p>');
    assert.equal(h.syncBlocked, false);
  } finally { await h.close(); }
});

test('a new IME composition cannot be interrupted by the preceding composition-end timer', async () => {
  const h = await harness();
  try {
    const editor = h.host.querySelector('[data-testid="editor"]');
    await act(async () => { editor.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true })); });
    await dispatch(h, 'pointerdown');
    await act(async () => {
      editor.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
      editor.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.equal(h.content(), '<p>Content a</p>');
    assert.equal(h.savedContent.length, 0);
    await dispatch(h, 'pointerdown', {}, h.row('c'));
    await act(async () => {
      editor.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.equal(h.content(), '<p>Content c</p>');
  } finally { await h.close(); }
});

test('unmount cancels a selection queued behind composition completion', async () => {
  const h = await harness();
  try {
    const editor = h.host.querySelector('[data-testid="editor"]');
    await act(async () => { editor.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true })); });
    await dispatch(h, 'pointerdown');
    await h.close();
    await act(async () => {
      editor.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.deepEqual(h.activated, ['a']);
    assert.equal(h.syncBlocked, false);
  } finally { await h.close(); }
});


test('document AI adapter is wired to the active editor and applied content remounts immediately', async () => {
  const h = await harness({ diagnostics: true });
  try {
    await act(async () => { [...h.host.querySelectorAll('button')].find(button => button.textContent === 'AI 助手').click(); await drain(); });
    const editor = h.aiProps.at(-1).editor;
    const source = editor.capture();
    const draft = {kind:'document',title:'Generated',blocks:[{type:'paragraph',text:'AI linked content'}]};
    await act(async()=>{await editor.apply(draft,source,'append');await drain();});
    assert.match(h.content(),/AI linked content/);
    assert.ok(h.content().startsWith('<p>Content a</p>'));
    await act(async()=>{await editor.apply(draft,source,'create');await drain();});
    assert.equal(h.lastId,'new');assert.match(h.content(),/AI linked content/);
    assert.equal(h.store.currentDocument('new').title,'Generated');
    assert.match(h.store.currentDocument('a').content,/AI linked content/);
  } finally {await h.close();}
});


test('AI assistant docks beside the editor without a dialog or replacing the live document', async () => {
  const h=await harness();
  try {
    const editor=h.host.querySelector('[data-testid="editor"]');
    const toggle=[...h.host.querySelectorAll('button')].find(button=>button.textContent==='AI 助手');
    await act(async()=>{toggle.click();await drain();});
    const sidebar=h.host.querySelector('[aria-label="AI 助手侧栏"]');
    assert.ok(sidebar);assert.equal(sidebar.parentElement,h.host.querySelector('.document-body'));
    assert.equal(sidebar.previousElementSibling,h.host.querySelector('.document-workspace'));
    assert.equal(h.host.querySelector('[role="dialog"]'),null);
    assert.equal(h.host.querySelector('[data-testid="editor"]'),editor);
    await act(async()=>{toggle.click();await drain();});
    assert.equal(h.host.querySelector('[aria-label="AI 助手侧栏"]'),null);
    assert.equal(h.host.querySelector('[data-testid="editor"]'),editor);
  }finally{await h.close();}
});
