import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root = new URL('../../vendor/baoyu-comic/', import.meta.url);
const upstream = JSON.parse(readFileSync(new URL('UPSTREAM.json', root)));
const references = {};
for (const [path, hash] of Object.entries(upstream.sha256)) {
  const bytes = readFileSync(new URL(path, root));
  if(createHash('sha256').update(bytes).digest('hex') !== hash) throw Error(`Upstream changed: ${path}`);
  if (path.startsWith('references/') && path.endsWith('.md')) references[path.slice(11,-3)] = bytes.toString();
}
writeFileSync(new URL('../../src/story-comic/baoyu-resources.json', import.meta.url), JSON.stringify({commit:upstream.commit,license:readFileSync(new URL('LICENSE',root),'utf8'),references}, null, 2)+'\n');
