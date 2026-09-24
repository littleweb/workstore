import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';
const source = transformSync(readFileSync(new URL('../src/updateService.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function harness(options = {}) {
  const calls = []; const body = { inert: false };
  const update = {
    version: '0.2.0',
    async download(fn) { calls.push('download'); assert.equal(body.inert, false); if (options.transientFailures > 0) { options.transientFailures--; throw new Error('error decoding response body'); } if (options.downloadError) throw new Error('signature invalid'); fn({ event: 'Started', data: { contentLength: 100 } }); fn({ event: 'Progress', data: { chunkLength: 100 } }); },
    async install() { calls.push('install'); assert.equal(body.inert, true); },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, setTimeout: fn => fn(), document: { body }, require(id) {
    if (id.includes('ai/client')) return { stopAiRequests: async () => {} };
    if (id.includes('plugin-updater')) return { check: async () => { calls.push('check'); return options.noUpdate ? null : update; } };
    if (id.includes('plugin-process')) return { relaunch: async () => { calls.push('restart'); } };
    if (id.includes('api/core')) return { invoke: async () => options.configured !== false };
    if (id.includes('workspace')) return { native: true, pauseSyncForUpdate: async () => { calls.push('pause'); return () => calls.push('resume'); } };
    if (id.includes('documentLifecycle')) return { flushDocuments: async () => { calls.push('save'); if (options.saveError) throw new Error('disk full'); } };
    throw new Error(id);
  } });
  return { api: module.exports, calls, body, options };
}
test('download first, save before installation, then restart; no installation on check alone', async () => {
  const h = harness(); await h.api.checkUpdates();
  assert.equal(h.api.updateState().phase, 'available'); assert.deepEqual(h.calls, ['check']);
  await h.api.installUpdate();
  assert.deepEqual(h.calls, ['check', 'download', 'pause', 'save', 'install', 'restart', 'resume']);
  assert.equal(h.body.inert, false); assert.equal(h.api.isInstallingUpdate(), false);
});
test('failed save blocks installation and restart; retry reuses completed download', async () => {
  const h = harness({ saveError: true }); await h.api.checkUpdates(); await h.api.installUpdate();
  assert.equal(h.api.updateState().phase, 'error'); assert.ok(!h.calls.includes('install')); assert.equal(h.body.inert, false);
  h.options.saveError = false; await h.api.installUpdate();
  assert.equal(h.calls.filter(x => x === 'download').length, 1); assert.ok(h.calls.includes('restart'));
});
test('signature/download error never reaches save, install, or restart', async () => {
  const h = harness({ downloadError: true }); await h.api.checkUpdates(); await h.api.installUpdate();
  assert.deepEqual(h.calls, ['check', 'download']); assert.equal(h.api.updateState().phase, 'error');
});
test('unconfigured and current are distinct states', async () => {
  const h = harness({ configured: false }); await h.api.checkUpdates();
  assert.equal(h.api.updateState().phase, 'unconfigured'); assert.deepEqual(h.calls, []);
  const current = harness({ noUpdate: true }); await current.api.checkUpdates(); assert.equal(current.api.updateState().phase, 'current');
});

test('interrupted response reconnects and only installs after a complete verified download', async () => {
  const h = harness({ transientFailures: 2 });
  await h.api.checkUpdates(); await h.api.installUpdate();
  assert.deepEqual(h.calls, ['check', 'download', 'download', 'download', 'pause', 'save', 'install', 'restart', 'resume']);
});
test('three interrupted downloads preserve installed app and allow a later manual retry', async () => {
  const h = harness({ transientFailures: 3 });
  await h.api.checkUpdates(); await h.api.installUpdate();
  assert.deepEqual(h.calls, ['check', 'download', 'download', 'download']);
  assert.equal(h.api.updateState().phase, 'error');
  assert.match(h.api.updateState().message, /当前版本未更改/);
  await h.api.installUpdate();
  assert.equal(h.calls.filter(x => x === 'install').length, 1);
  assert.equal(h.calls.filter(x => x === 'download').length, 4);
});
