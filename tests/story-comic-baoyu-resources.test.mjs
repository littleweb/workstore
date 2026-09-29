import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
test('vendored original skill and runtime definitions match pinned upstream hashes', () => {
 const root = new URL('../vendor/baoyu-comic/',import.meta.url);
 const upstream = JSON.parse(readFileSync(new URL('UPSTREAM.json',root)));
 const runtime = JSON.parse(readFileSync(new URL('../src/story-comic/baoyu-resources.json',import.meta.url)));
 assert.equal(runtime.commit,upstream.commit);
 assert.match(runtime.license,/MIT License/);
 for (const [file,hash] of Object.entries(upstream.sha256)) {
   const bytes = readFileSync(new URL(file,root));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,file);
   if(file.startsWith('references/') && file.endsWith('.md')) assert.equal(runtime.references[file.slice(11,-3)],bytes.toString());
 }
});
test('native comic page is preserved without canvas or text overlay', async () => {
 const module = {exports:{}};
 const code = buildSync({entryPoints:['src/story-comic/render.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['@tauri-apps/api/core','../workspace','../comics/images']}).outputFiles[0].text;
 vm.runInNewContext(code,{module,require:()=>({})});
 const image = await module.exports.composePage('original-image',{engine:'baoyu-comic@test'},0);
 assert.equal(image,'original-image');
});
