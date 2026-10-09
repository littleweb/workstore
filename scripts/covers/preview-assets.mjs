import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const repository = 'littleweb/workstore';
export const branch = 'assets/covers';
export function collectPreviews(root = process.cwd()) {
  const dir = resolve(root, 'public/handraw-style/covers');
  const entries = {};
  for (const group of readdirSync(dir).sort()) {
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(group)) continue;
    for (const file of readdirSync(resolve(dir, group)).sort()) {
      if (!/^\d{3}\.png$/.test(file)) continue;
      const path = `covers/${group}/${file}`;
      const bytes = readFileSync(resolve(dir, group, file));
      if (bytes.length > 8 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Error(`无效封面预览：${path}`);
      entries[`/handraw-style/${path}`] = {
        path, size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        blob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      };
    }
  }
  if (Object.keys(entries).length !== 277) throw Error('封面预览目录不完整');
  return entries;
}
export function validatePublished(index, entries) {
  if (index.schemaVersion !== 1 || index.repository !== repository || !/^[a-f0-9]{40}$/.test(index.commit ?? '') || JSON.stringify(index.entries) !== JSON.stringify(entries)) throw Error('封面线上索引与本地素材不一致，请先运行 npm run covers:publish');
}
