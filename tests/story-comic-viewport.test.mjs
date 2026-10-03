import {test} from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import vm from 'node:vm';
const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:['src/story-comic/viewport.ts'],bundle:true,write:false,format:'cjs'}).outputFiles[0].text,{module});
const {visibleViewport,pageStripWidth}=module.exports;
test('provisional eight-page viewport is brought back when planning returns four pages',()=>{
 const v=visibleViewport({x:-2536,y:24,zoom:.95625},1264,660,4);
 assert.ok(v.x+pageStripWidth(4)*v.zoom>=1240);
 assert.equal(v.zoom,.95625);
});
test('valid reading position survives updates; overscroll, resized canvas and invalid transforms recover',()=>{
 const v=visibleViewport({x:-400,y:24,zoom:.8},1000,640,6);
 assert.equal(v.x,-400);assert.equal(v.y,24);
 for(const input of [{x:10000,y:-10000,zoom:1},{x:NaN,y:Infinity,zoom:0}]){
  const out=visibleViewport(input,900,500,4);
  assert.ok(Number.isFinite(out.x+out.y+out.zoom));
  assert.ok(out.x<=24 && out.y<=24);
  assert.ok(out.x+pageStripWidth(4)*out.zoom>0);
  assert.ok(out.y+640*out.zoom>0);
 }
});
