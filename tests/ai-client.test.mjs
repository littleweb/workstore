import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';
const source = transformSync(readFileSync(new URL('../src/ai/client.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function harness({ native = true, saveError = null, wait = false } = {}) {
  let finish; let synced = 0; const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(source, { module, setInterval, clearInterval, AbortController, crypto: { randomUUID: () => 'request-id' }, require(id) {
    if (id.includes('workspace')) return { native, scheduleAutosync: () => synced++ };
    return { invoke: async (command, args) => { calls.push({ command, args }); if (command === 'ai_cancel') return;
      if (wait) await new Promise(resolve => { finish = resolve; });
      return { text: 'answer', saveError };
    } };
  } });
  return { ai: module.exports.ai, calls, finish: () => finish(), flush: () => module.exports.stopAiRequests(), synced: () => synced };
}
test('shared gateway keeps tool identity/messages and syncs successfully saved records', async () => {
  const h = harness(); const messages = [{ role: 'user', content: 'hello' }];
  await h.ai.generate({ toolId: 'app.doc', messages, record: true });
  assert.equal(h.calls[0].args.request.toolId, 'app.doc'); assert.deepEqual(h.calls[0].args.request.messages, messages); assert.equal(h.synced(), 1);
});
test('failed record save does not report success to sync; pure requests are not archived', async () => {
  const h = harness({ saveError: 'disk full' }); assert.equal((await h.ai.generate({ toolId: 'app.ai', messages: [], record: true })).saveError, 'disk full'); assert.equal(h.synced(), 0);
  const pure = harness(); await pure.ai.generate({ toolId: 'tool.json', messages: [] }); assert.equal(pure.synced(), 0);
});
test('abort forwards matching request ID and pre-aborted requests do not run', async () => {
  const h = harness({ wait: true }); const abort = new AbortController();
  const request = h.ai.generate({ toolId: 'app.ai', messages: [] }, abort.signal);
  abort.abort(); assert.equal(h.calls[1].command, 'ai_cancel'); assert.equal(h.calls[1].args.id, 'request-id'); h.finish(); await request;
  const other = harness(); await assert.rejects(other.ai.generate({ toolId: 'app.ai', messages: [] }, abort.signal), /已停止/); assert.equal(other.calls.length, 0);
});
test('browser preview cannot invoke desktop inference', async () => { const h = harness({ native: false }); await assert.rejects(h.ai.generate({ toolId: 'app.ai', messages: [] }), /桌面版/); assert.equal(h.calls.length, 0); });

test('workspace close or relocation stops pending generation and waits for settlement', async () => {
  const h = harness({ wait: true }); const response = h.ai.generate({ toolId: 'app.ai', messages: [] });
  let done = false; const closing = h.flush().then(() => { done = true; });
  assert.equal(h.calls[1].command, 'ai_cancel'); await Promise.resolve(); assert.equal(done, false);
  h.finish(); await response; await closing; assert.equal(done, true);
});
