import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';
const module = { exports: {} };
vm.runInNewContext(transformSync(readFileSync(new URL('../src/navigation.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module });
const { recordToolOpen } = module.exports;
test('switching existing recent tools keeps their ordering timestamps', () => {
  const original = [{ id: 'app.comic', favorite: false, rank: 3, lastOpened: 100 }];
  assert.equal(recordToolOpen(original, 'app.comic', 300), original);
  const next = recordToolOpen(original, 'tool.json', 200);
  assert.equal(next[1].lastOpened, 200); assert.equal(next[0].lastOpened, 100);
  assert.equal(recordToolOpen(next, 'app.comic', 400), next);
});
test('removed then reopened tool gets a new position; favorites stay unique', () => {
  const entries = [{ id: 'app.doc', favorite: true, rank: 2, lastOpened: null }];
  const opened = recordToolOpen(entries, 'app.doc', 100);
  assert.equal(opened.length, 1); assert.equal(opened[0].favorite, true);
  const reopened = recordToolOpen(entries, 'app.comic', 500);
  assert.equal(reopened[1].lastOpened, 500);
});
