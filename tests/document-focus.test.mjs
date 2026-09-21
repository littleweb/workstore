import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'Text', 'DocumentFragment']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
const { createEditor, $getRoot, $createParagraphNode, $createTextNode } = await import('lexical');
const style = document.createElement('style');
style.textContent = readFileSync(new URL('../src/documents/documents.css', import.meta.url), 'utf8');
document.head.append(style);
after(() => dom.window.close());

function mountEditor() {
  const host = document.createElement('section');
  // This is the actual TeaEditor wrapper hierarchy. Unlike the navigation test
  // double, its contenteditable is a real Lexical root, so Lexical also validates
  // the parent layout when mounting.
  host.innerHTML = '<button type="button">Open another document</button><div class="document-editor-root"><div class="editor-shell"><div class="editor-container"><div class="editor-scroller"><div class="editor"><div class="ContentEditable__root" contenteditable="true"></div></div></div></div></div></div>';
  document.body.append(host);
  const editable = host.querySelector('[contenteditable]');
  const editor = createEditor({ namespace: 'WorkStore focus regression', onError: error => { throw error; } });
  editor.setRootElement(editable);
  editor.update(() => { $getRoot().append($createParagraphNode().append($createTextNode('Test document'))); }, { discrete: true });
  return { host, editable, editor, button: host.querySelector('button'), close() { editor.setRootElement(null); host.remove(); } };
}

test('document layout does not trigger the real Lexical flex-parent focus warning', () => {
  const warnings = []; const original = console.warn; let fixture;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    fixture = mountEditor();
    assert.equal(window.getComputedStyle(fixture.editable.parentElement).display, 'block', 'contenteditable must not be a direct flex item');
    assert.equal(warnings.some(text => text.includes('unwanted focusing behavior')), false, warnings.join('\n'));
    assert.equal(window.getComputedStyle(fixture.editable).minHeight, '100%', 'keep the empty editor hit area');
  } finally { fixture?.close(); console.warn = original; }
});

test('leaving a real Lexical root delivers one button click without replacing the target', async () => {
  const fixture = mountEditor(); let clicks = 0;
  fixture.button.addEventListener('click', () => clicks++);
  try {
    fixture.editable.focus();
    fixture.button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    fixture.button.focus();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.activeElement, fixture.button);
    assert.equal(fixture.button.isConnected, true);
    fixture.button.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    fixture.button.click();
    assert.equal(clicks, 1);
  } finally { fixture.close(); }
});
