import {test} from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import vm from 'node:vm';
test('selected dimensions resize the whole page without cropping or rewriting text',async()=>{
 const module={exports:{}};const canvases=[];let lastDraw;
 const code=buildSync({entryPoints:['src/story-comic/render.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['@tauri-apps/api/core','../workspace','../comics/images']}).outputFiles[0].text;
 vm.runInNewContext(code,{module,Image:class{width=900;height=1200;async decode(){}},document:{createElement:()=>{const c={width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){lastDraw=args;}}),toDataURL:()=> 'data:image/png;base64,test'};canvases.push(c);return c;}},require:(id)=>id==='../comics/images'?{imageSource:async s=>s}:{native:false}});
 for(const [size,w,h] of [['xhs-portrait',1242,1656],['square',1080,1080],['portrait',1080,1920],['landscape',1600,1200],['wide',1920,1080]]){
  await module.exports.composePage('image',{engine:'baoyu-comic@test',config:{style:'manga',size}},0);
  const c=canvases.at(-1);assert.equal(c.width,w);assert.equal(c.height,h);
  const [,x,y,dw,dh]=lastDraw;assert.ok(Math.abs(dw/dh-.75)<1e-12);assert.ok(x>=0&&y>=0&&x+dw<=w+1e-9&&y+dh<=h+1e-9);
 }
});
