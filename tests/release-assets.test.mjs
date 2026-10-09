import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {publicAssets,copyPublicAssets,verifyFrontend,checkModules,readManifest,verifyMacBundle} from '../scripts/release/assets.mjs';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'workstore-assets-test-'));
 const write=(path,data)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof data==='object'?JSON.stringify(data):data);};
 const manifest=JSON.parse(readFileSync('src/release-manifest.json'));manifest.publicFiles=['icon.svg'];manifest.fontDirectories=['fonts'];manifest.maxFrontendBytes=1024;
 write('src/release-manifest.json',manifest);
 write('src/design-studio/catalog.json',[{cover:'/design-studio/a.webp',exampleGroups:[{items:[{src:'/design-studio/b.webp'}]}]}]);
 write('src/covers/catalog.json',{styles:[{image:'/handraw-style/styles/001.webp'}],layouts:[{image:'/handraw-style/layouts/L-01.webp'}],colors:[{image:'/handraw-style/colors/C-01.webp'}]});
 write('src/story-comic/coverThemes.json',{manga:'漫画'});
 for(const path of ['icon.svg','fonts/a.woff2','design-studio/a.webp','design-studio/b.webp','handraw-style/styles/001.webp','handraw-style/layouts/L-01.webp','handraw-style/colors/C-01.webp','story-comic/covers/manga.jpg'])write('public/'+path,'image');
 write('public/comics/unused.png','junk');write('public/design-studio/unused.webp','junk');write('public/fonts/unrelated.mp4','junk');
 const output=join(root,'out');mkdirSync(output);write('out/index.html','index');write('out/assets/app.js','js');
 return{root,output,write,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('formal asset list preserves references for every open tool and excludes hidden or unreferenced files',()=>{
 const files=publicAssets(),paths=new Set(files.map(f=>f.path));assert.ok(paths.has('workstore-icon.svg'));assert.ok(paths.has('icons/whiteboard-v4.png'));
 assert.ok(paths.has('handraw-style/styles/001.webp'));assert.ok(paths.has('story-comic/covers/manga.jpg'));
 assert.ok([...paths].some(p=>p.startsWith('excalidraw/fonts/')));
 assert.equal([...paths].filter(p=>p.startsWith('design-studio/')).length,0);
 assert.equal([...paths].filter(p=>p.startsWith('handraw-style/styles/')).length,277);
 assert.ok([...paths].every(p=>!p.startsWith('comics/')&&!p.startsWith('course/')&&!p.startsWith('handraw-style/covers/')));
 assert.ok([...paths].every(p=>!p.endsWith('README.md')&&!p.endsWith('sources.json')&&!p.includes('whiteboard-v2')&&!p.includes('whiteboard-v3')));
 assert.deepEqual(readManifest().nativeResources,[]);
});
test('copy follows the actual catalogs and produces a checked inventory, leaving unrelated assets out',()=>{
 const f=fixture();try{const files=copyPublicAssets(f.root,f.output);assert.equal(files.length,6);const inventory=verifyFrontend(f.root,f.output);assert.equal(inventory.publicFileCount,6);assert.equal(inventory.publicBytes,30);assert.ok(inventory.totalBytes<1024);assert.deepEqual(inventory.tools,readManifest().tools);}finally{f.close();}
});
test('missing dependencies, undeclared payloads, path escape and excessive size fail the build',()=>{
 const f=fixture();try{
  copyPublicAssets(f.root,f.output);f.write('out/comics/unused.png','junk');assert.throws(()=>verifyFrontend(f.root,f.output),/未声明/);unlinkSync(join(f.output,'comics/unused.png'));
  f.write('out/assets/huge.js','a'.repeat(1025));assert.throws(()=>verifyFrontend(f.root,f.output),/预算/);unlinkSync(join(f.output,'assets/huge.js'));
  unlinkSync(join(f.output,'handraw-style/styles/001.webp'));assert.throws(()=>verifyFrontend(f.root,f.output));
  f.write('src/release-manifest.json',{...readManifest(f.root),publicFiles:['../private.key']});assert.throws(()=>publicAssets(f.root),/不允许/);
 }finally{f.close();}
});
test('hidden entry code cannot leak via renamed generated chunks, but shared image utilities remain usable',()=>{
 const chunk=name=>({renamed:{type:'chunk',modules:Object.fromEntries([name,...readManifest().requiredModules].map(p=>[join(process.cwd(),p),{}]))}});
 for(const name of ['src/html/HtmlApp.tsx','src/animations/AnimationApp.tsx','src/comics/ComicApp.tsx','src/comics/catalog.ts'])assert.throws(()=>checkModules(process.cwd(),chunk(name)),/隐藏工具/);
 assert.doesNotThrow(()=>checkModules(process.cwd(),chunk('src/comics/images.ts')));
 assert.doesNotThrow(()=>checkModules(process.cwd(),chunk('src/html/export.ts')));
 assert.throws(()=>checkModules(process.cwd(),{entry:{type:'chunk',modules:{}}}),/正式工具缺失/);
});

test('native resource guard rejects an accidentally bundled HTML runtime',()=>{
 const f=fixture();try{
  f.write('app/Contents/Resources/icon.icns','icon');f.write('app/Contents/MacOS/workstore','binary');
  assert.equal(verifyMacBundle(join(f.root,'app')),10);
  f.write('app/Contents/Resources/html-runtime/node','unused runtime');
  assert.throws(()=>verifyMacBundle(join(f.root,'app')),/运行资源/);
 }finally{f.close();}
});
