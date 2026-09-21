import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';

function lifecycle() {
  const module = { exports: {} };
  const code = transformSync(readFileSync(new URL('../src/documentLifecycle.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, Set });
  return module.exports;
}

test('editing blockers are independent and are removed when their editor unmounts', () => {
  const api = lifecycle();
  let first = true;
  const removeFirst = api.registerSyncActivationBlocker(() => first);
  const removeSecond = api.registerSyncActivationBlocker(() => true);
  assert.equal(api.isSyncActivationBlocked(), true);
  first = false;
  assert.equal(api.isSyncActivationBlocked(), true);
  removeSecond();
  assert.equal(api.isSyncActivationBlocked(), false);
  first = true;
  removeFirst();
  assert.equal(api.isSyncActivationBlocked(), false);
});

test('whiteboard tracks transient text sessions even when serialized content is unchanged', () => {
  const api = lifecycle();
  const cleanups = []; const staged = []; let version = 0;
  const source = readFileSync(new URL('../src/whiteboard/Whiteboard.tsx', import.meta.url), 'utf8');
  // Exercise Canvas's real onChange and effect wiring without mounting a native
  // WebView or touching a user's board files. Excalidraw serialization excludes
  // editingTextElement; changing it alone must still update the blocker.
  const code = transformSync(`${source}\nexport { Canvas };`, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, require(id) {
    if (id === 'react') return {
      useMemo: fn => fn(), useRef: current => ({ current }), useCallback: fn => fn,
      useEffect: fn => cleanups.push(fn()),
    };
    if (id === 'react/jsx-runtime') {
      const jsx = (type, props) => ({ type, props });
      return { jsx, jsxs: jsx };
    }
    if (id.includes('documentLifecycle')) return api;
    if (id === '@excalidraw/excalidraw') return {
      Excalidraw: 'excalidraw',
      MainMenu: { Item: 'item', Separator: 'separator', DefaultItems: {} },
      serializeAsJSON: () => JSON.stringify({ elements: [], appState: {}, files: {} }),
    };
    if (id === './store') return {
      remoteVersion: () => version,
      currentBoard: () => ({ title: 'test', scene: { elements: [] } }),
      stageBoard: (...args) => staged.push(args),
    };
    return {};
  } });
  const canvas = module.exports.Canvas({ id: 'test-board' });
  const change = editingTextElement => canvas.props.onChange([], { editingTextElement, selectedElementIds: {} }, {});
  change(null);
  assert.equal(api.isSyncActivationBlocked(), false);
  change({ id: 'text-element' });
  assert.equal(api.isSyncActivationBlocked(), true);
  change(null);
  assert.equal(api.isSyncActivationBlocked(), false);
  assert.equal(staged.length, 1);
  change({ id: 'text-element' });
  version++;
  canvas.props.onChange([{ id: 'stale' }], { editingTextElement: null }, {});
  assert.equal(staged.length, 1, 'an obsolete canvas callback must not overwrite imported AI content');
  cleanups.forEach(cleanup => cleanup());
  assert.equal(api.isSyncActivationBlocked(), false);
});
