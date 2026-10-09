import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
const module={exports:{}};
vm.runInNewContext(buildSync({entryPoints:['src/story-comic/refine.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text,{module,structuredClone});
const {refinePage}=module.exports;
const image=c=>'workstore-image:'+c.repeat(64);
const source=()=>({version:1,config:{topic:'朋友',style:'manga',count:4,language:'中文',audience:'儿童'},history:[],plan:{summary:'朋友的故事',characters:'蓝衣女孩',pages:Array.from({length:4},(_,i)=>({title:'标题',text:'旧对白',visual:'场景'+i,layout:'standard',image:image('a'),history:[]}))}});
test('refinement uses current image, changes one page and preserves image, words and conversation',async()=>{
 const original=source(),refs=[];
 const next=await refinePage(original,1,'把对白改成你好',{valid:()=>true,text:async(p,r)=>{refs.push(r);return JSON.stringify({title:'标题',text:'你好',visual:'修改后的场景1',instruction:'只替换对白'});},image:async(p,r)=>{refs.push(r);assert.match(p,/你好/);return image('b');},compose:async r=>r});
 assert.equal(next.plan.pages[1].text,'你好');assert.equal(next.plan.pages[1].image,image('b'));
 assert.equal(next.plan.pages[0].image,image('a'));assert.equal(original.plan.pages[1].text,'旧对白');
 assert.equal(next.plan.pages[1].edits[0].text,'旧对白');assert.equal(next.plan.pages[1].history[0],image('a'));
 assert.equal(next.plan.pages[1].chat.length,2);assert.deepEqual(refs,[image('a'),image('a')]);
});
test('failure or stale result keeps source untouched and avoids further generation',async()=>{
 const original=source();let images=0;
 await assert.rejects(refinePage(original,0,'修改',{valid:()=>true,text:async()=>'{"title":null}',image:async()=>{images++;},compose:async()=>''}));assert.equal(images,0);
 let valid=true;
 await assert.rejects(refinePage(original,0,'修改',{valid:()=>valid,text:async()=>{valid=false;return '{}';},image:async()=>{images++;},compose:async()=>''}),/作品已修改/);
 assert.equal(images,0);assert.equal(original.plan.pages[0].chat,undefined);assert.equal(original.plan.pages[0].image,image('a'));
});

test('restoring an optimized version restores its text and allows returning to the revised version',async()=>{
 const next=await refinePage(source(),0,'改对白',{valid:()=>true,text:async()=>JSON.stringify({title:'新版',text:'你好',visual:'新场景',instruction:'改对白'}),image:async()=>image('b'),compose:async r=>r});
 const page=next.plan.pages[0];
 module.exports.restorePage(page);assert.equal(page.text,'旧对白');assert.equal(page.image,image('a'));
 module.exports.restorePage(page);assert.equal(page.text,'你好');assert.equal(page.image,image('b'));
});
