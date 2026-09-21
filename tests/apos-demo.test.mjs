import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><head><style>textarea { padding: 0 !important; border: 0 solid !important; font-size: 16px !important; line-height: 24px !important; box-sizing: border-box !important; }</style></head><body></body></html>', { url: 'http://127.0.0.1/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'ShadowRoot', 'DocumentFragment', 'HTMLInputElement', 'HTMLTextAreaElement']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// rc-select uses browser-lifetime MessageChannels. Track and close their Node
// equivalents after unmount so the test process can exit without forcing it.
const channels = new Set();
globalThis.MessageChannel = class extends MessageChannel {
  constructor() { super(); channels.add(this); }
};
const computedStyle = window.getComputedStyle.bind(window);
// JSDOM does not resolve Ant Design's CSS variables or perform layout. Supply
// numeric borderless textarea box metrics only; browser QA verifies real sizing.
const boxMetrics = new Set(['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width']);
window.getComputedStyle = element => {
  const style = computedStyle(element);
  if (element.tagName !== 'TEXTAREA') return style;
  return new Proxy(style, { get(target, property) {
    if (property === 'getPropertyValue') return name => {
      const value = target.getPropertyValue(name);
      return boxMetrics.has(name) && !Number.isFinite(parseFloat(value)) ? '0px' : value;
    };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
};
globalThis.getComputedStyle = window.getComputedStyle;
window.matchMedia = query => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });
globalThis.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
function load(entry) {
  const code = buildSync({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external' }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInThisContext(`(function(module,exports,require){${code}\n})`)(module, module.exports, require);
  return module.exports;
}
const { default: Demo } = load('../demos/apos/App.tsx');
const { createDemoDraft, defaultOptions } = load('../demos/apos/model.ts');
after(() => { dom.window.close(); for (const channel of channels) { channel.port1.close(); channel.port2.close(); } });

async function harness() {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Demo)));
  const byText = text => [...document.querySelectorAll('button')].find(button => button.textContent === text);
  return {
    host, byText,
    async fill(text) { await act(async () => { const input = host.querySelector('textarea'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, text); input.dispatchEvent(new window.Event('input', { bubbles: true })); }); },
    async click(button) { assert.ok(button); await act(async () => button.click()); },
    async select(label, text) {
      const input = host.querySelector(`input[aria-label="${label}"]`); assert.ok(input);
      await act(async () => input.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })));
      const item = [...document.querySelectorAll('.ant-select-item-option')].find(node => node.textContent === text); assert.ok(item, `Select option ${text}`);
      await act(async () => item.click());
    },
    async close() { await act(async () => root.unmount()); host.remove(); },
  };
}

test('draft model trims input, rejects blank/oversized input, and preserves options', () => {
  assert.equal(createDemoDraft('  ', defaultOptions, 'a'), null);
  assert.equal(createDemoDraft('x'.repeat(1201), defaultOptions, 'a'), null);
  const draft = createDemoDraft('  春日散步  ', { ...defaultOptions, style: '手绘', episodes: 6 }, 'local-1');
  assert.equal(draft.name, '春日散步'); assert.equal(draft.topic, '春日散步');
  assert.equal(draft.episodes, 6); assert.equal(draft.style, '手绘'); assert.equal(draft.cover, 'draft');
  assert.equal(createDemoDraft('🌱'.repeat(25), defaultOptions, 'emoji').name, '🌱'.repeat(24) + '…');
});

test('real Ant Design renders simplified controls without removed items; blank topic cannot submit', async () => {
  const h = await harness(); try {
    assert.equal(h.host.querySelectorAll('.apos-work').length, 3);
    assert.ok(h.host.querySelector('.ant-input')); assert.equal(h.host.querySelectorAll('.ant-select').length, 5);
    assert.equal(h.byText('创建').disabled, true);
    await h.fill('   '); assert.equal(h.byText('创建').disabled, true);
    assert.equal(h.host.querySelectorAll('input[type="file"], [aria-label*="麦克风"], .ap-categories').length, 0);
    assert.doesNotMatch(h.host.textContent, /引用文件|调用技能|金融服务|幻灯片/);
  } finally { await h.close(); }
});

test('real Select options feed creation, newest draft appears first, and textarea resets', async () => {
  const h = await harness(); try {
    await h.select('风格', '手绘'); await h.select('尺寸', '3:4'); await h.select('集数', '6 集');
    await h.fill('春日的第一场旅行'); await h.click(h.byText('创建'));
    assert.equal(h.host.querySelectorAll('.apos-work').length, 4);
    assert.equal(h.host.querySelector('.apos-work-name').textContent, '春日的第一场旅行');
    assert.match(h.host.querySelector('[role="status"]').textContent, /手绘 \/ 3:4 \/ 6 集/);
    assert.equal(h.host.querySelector('textarea').value, ''); assert.equal(h.byText('创建').disabled, true);
  } finally { await h.close(); }
});

test('real Modal previews without reordering; reusing theme returns text and options', async () => {
  const h = await harness(); try {
    const before = [...h.host.querySelectorAll('.apos-work-name')].map(n => n.textContent);
    await h.click(h.host.querySelectorAll('.apos-work')[1]);
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.match(document.querySelector('[role="dialog"]').textContent, /公众号创刊推文/);
    assert.deepEqual([...h.host.querySelectorAll('.apos-work-name')].map(n => n.textContent), before);
    await h.click(h.byText('使用此主题'));
    assert.match(h.host.querySelector('textarea').value, /公众号创刊推文/);
    assert.match(h.host.querySelector('.apos-options').textContent, /杂志/);
    await act(async () => new Promise(resolve => setTimeout(resolve, 500)));
    assert.equal(document.activeElement, h.host.querySelector('textarea'));
  } finally { await h.close(); }
});

test('topic is rendered as text; session remount resets drafts without persistence', async () => {
  const h = await harness(); try {
    await h.fill('<img src=x onerror=alert(1)>'); await h.click(h.byText('创建'));
    assert.equal(h.host.querySelectorAll('.apos-work img').length, 0);
    assert.match(h.host.querySelector('.apos-work-name').textContent, /<img/);
    assert.equal(window.localStorage.length, 0); assert.equal(window.sessionStorage.length, 0);
  } finally { await h.close(); }
  const fresh = await harness(); try { assert.equal(fresh.host.querySelectorAll('.apos-work').length, 3); } finally { await fresh.close(); }
});

test('demo entry and build are isolated from production application', () => {
  const main = readFileSync(new URL('../demos/apos/main.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../demos/apos/App.tsx', import.meta.url), 'utf8');
  const config = readFileSync(new URL('../demos/apos/vite.config.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(main + app, /from ['"].*(workspace|ai\/client|@tauri)|fetch\(|localStorage|sessionStorage|onPointerDown/);
  assert.match(config, /host: '127\.0\.0\.1'/); assert.match(config, /outDir: 'dist'/);
});

test('compact layout reduces empty composer and list covers without shrinking the preview', () => {
  const css = readFileSync(new URL('../demos/apos/styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../demos/apos/App.tsx', import.meta.url), 'utf8');
  const sheet = new JSDOM(`<style>${css}</style>`);
  try {
    const rules = [...sheet.window.document.styleSheets[0].cssRules];
    const find = (list, selector) => list.find(rule => rule.selectorText === selector)?.style;
    assert.equal(find(rules, '.apos-cover').getPropertyValue('height'), '156px');
    assert.equal(find(rules, '.apos-create-zone').getPropertyValue('padding-top'), '32px');
    assert.equal(find(rules, '.apos-preview .apos-cover').getPropertyValue('height'), '255px');
    const tablet = rules.find(rule => rule.conditionText === '(max-width: 900px)');
    assert.equal(find([...tablet.cssRules], '.apos-cover').getPropertyValue('height'), '140px');
    assert.match(app, /autoSize=\{\{ minRows: 2, maxRows: 5 \}\}/);
  } finally { sheet.window.close(); }
});
