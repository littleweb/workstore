import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const catalog=JSON.parse(readFileSync('src/design-studio/catalog.json'));
const source=JSON.parse(readFileSync('public/design-studio/sources.json'));
const pages=new Map(source.examplePages.map(p=>[p.id,p]));
const assets=new Map(source.exampleAssets.map(a=>[a.src,a]));
const hash=value=>createHash('sha256').update(value).digest('hex');

test('all functions bind complete ordered groups to their verified reference page',()=>{
 assert.equal(pages.size,101);assert.equal(assets.size,917);
 assert.equal(new Set(source.examplePages.map(p=>p.pageUrl)).size,101);
 let groups=0,images=0,pairs=0;
 for(const feature of catalog){
  const page=pages.get(feature.id);assert(page,feature.title);assert.equal(page.title,feature.title);assert.equal(page.captureMethod,'chrome-mhtml');
  assert.equal(new URL(page.pageUrl).origin,'https://yunshu.quantv.com');assert(new URL(page.pageUrl).searchParams.get('id'));
  assert.equal(feature.exampleGroups.length,page.groupCount);assert.equal(page.groups.length,page.groupCount);
  let pageImages=0;
  feature.exampleGroups.forEach((group,n)=>{
   const evidence=page.groups[n];assert.equal(group.id,feature.id+'-example-'+(n+1));assert.equal(group.id,evidence.id);assert.equal(group.kind,evidence.kind);
   assert.deepEqual(group.items,evidence.items.map(({src,label})=>({src,label})));
   assert.equal(group.items.length,group.kind==='comparison'?2:1);
   if(group.kind==='comparison'){assert.deepEqual(group.items.map(a=>a.label),['原图','✨ AI作品']);pairs++;}
   if(group.prompt)assert.equal(hash(group.prompt),evidence.promptSha256);
   else assert.equal(evidence.promptSha256,undefined);
   for(const item of evidence.items){assert.equal(assets.get(item.src)?.url,item.url);pageImages++;}
   groups++;
  });
  assert.equal(pageImages,page.imageCount);images+=pageImages;
 }
 assert.equal(groups,479);assert.equal(images,932);assert.equal(pairs,453);
});

test('fashion scrapbook keeps the four exact original/result pairs from the reference',()=>{
 const page=pages.get('0-1');assert.equal(page.groupCount,4);
 const filenames=[['1784360339242_u1y1oqxzrea.png','1784360342041_22dhf22j88t.png'],['1784360346080_crh8a2uisn5.png','1784360348687_tcrvhzfhf5p.png'],['1784360353619_q4f0sekyqel.png','1784360357507_t5ibzghj2vk.png'],['1784360419791_fwy7uns2n4.png','1784360421994_2hyzg6f4htu.png']];
 assert.deepEqual(page.groups.map(g=>g.items.map(a=>new URL(a.url).pathname.split('/').pop())),filenames);
 assert.equal(pages.get('0-26').groupCount,7);assert.equal(pages.get('0-15').groupCount,6);
 assert(pages.get('0-15').groups.every(g=>g.kind==='single'));
});

test('every bundled reference asset matches its verified source bytes',()=>{
 for(const asset of assets.values()){
  assert.equal(new URL(asset.url).origin,'https://cdn.quantv.com');assert(new URL(asset.url).pathname.startsWith('/models/image-creation/'));
  assert(asset.size.every(n=>Number.isInteger(n)&&n>0));assert.match(asset.src,/^\/design-studio\/examples\/[0-9a-f]{24}\.webp$/);
  const path='public'+asset.src;assert(existsSync(path),path);const bytes=readFileSync(path);
  assert.equal(bytes.length,asset.bytes);assert.equal(hash(bytes),asset.sha256);assert.equal(bytes.subarray(8,12).toString(),'WEBP');
 }
});
