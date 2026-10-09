import {test} from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import vm from 'node:vm';
function load(file){const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:[file],bundle:true,write:false,format:'cjs'}).outputFiles[0].text,{module});return module.exports;}
const {pageWindow,anchoredScroll}=load('src/story-comic/scrollWindow.ts');
const {stringCache}=load('src/comics/imageCache.ts');
test('twenty-page scrolling mounts only the viewport and adjacent pages across repeated drags',()=>{
 for(let left=0;left<8500;left+=30){const {start,end}=pageWindow(left,1000,20,448);assert(start>=0&&end<=20);assert(end-start<=6);assert(end>start);}
 assert.equal(anchoredScroll(400,1,2,1000),1300);
 const range=pageWindow(0,800,2,448);assert.equal(range.start,0);assert.equal(range.end,2);
});
test('image cache deduplicates pending reads and evicts old settled images by byte budget',async()=>{
 const read=stringCache(20,2);let calls=0,release;
 const first=read('a',()=>{calls++;return new Promise(r=>release=r);});
 const again=read('a',()=>{calls++;return Promise.resolve('bad');});assert.equal(first,again);
 await Promise.resolve();release('12345');await first;assert.equal(calls,1);
 await read('b',async()=> '12345');await read('c',async()=> '12345');
 await read('a',async()=>{calls++;return '12345';});assert.equal(calls,2);
});
test('failed reads are retryable and oversized originals are not retained',async()=>{
 const read=stringCache(4,2);let calls=0;
 await assert.rejects(read('bad',async()=>{throw Error('disk');}));
 assert.equal(await read('bad',async()=> 'ok'),'ok');
 for(let i=0;i<2;i++)await read('big',async()=>{calls++;return 'oversized';});assert.equal(calls,2);
});
