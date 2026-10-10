import {test} from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:['src/course/cover.ts'],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,{module,crypto:webcrypto,structuredClone});const m=module.exports;
const source={version:1,config:{topic:'认识水循环',ratio:'3:4'},history:[],plan:{title:'水的一次旅行',summary:'认识水蒸气和雨',pages:[]}};
function deps(){const saves=[],requests=[];let valid=true;return {saves,requests,stop(){valid=false;},api:{valid:()=>valid,reference:async src=>src,image:async(prompt,refs)=>{requests.push({prompt,refs});return 'workstore-image:'+'a'.repeat(64);},save:async c=>saves.push(structuredClone(c))}};}
test('all course types reuse cover prompts and save configuration before image generation',async()=>{for(const mode of [undefined,'animation','whiteboard']){const h=deps(),c=await m.generateCourseCover({...source,mode},'042',h.api);assert.equal(h.saves[0].cover.status,'running');assert.ok(h.saves[0].cover.prompt.includes('画风'));assert.equal(c.cover.versions.length,1);assert.equal(c.cover.config.ratio,mode==='animation'||mode==='whiteboard'?'16:9':'3:4');assert.equal(c.cover.status,'done');}});
test('regenerating a chosen style keeps the prior image and full prompts in cover history',async()=>{const h=deps(),first=await m.generateCourseCover(source,'042',h.api),next=await m.generateCourseCover(first,'043',h.api);assert.equal(next.cover.versions.length,2);assert.equal(next.cover.versions[0].id,first.cover.selectedVersion);assert.equal(next.cover.config.style,'043');});
test('failed or stale cover generation preserves the existing selected version',async()=>{const h=deps(),first=await m.generateCourseCover(source,'042',h.api);h.api.image=async()=>{throw Error('绘图暂不可用');};await assert.rejects(()=>m.generateCourseCover(first,'043',h.api));assert.equal(h.saves.at(-1).cover.selectedVersion,first.cover.selectedVersion);assert.equal(h.saves.at(-1).cover.status,'error');const stale=deps();stale.api.image=async()=>{stale.stop();return 'workstore-image:'+'b'.repeat(64);};await assert.rejects(()=>m.generateCourseCover(first,'043',stale.api));assert.equal(stale.saves.length,1);});

test('cover revision suggestions are present in the saved configuration and final prompt',async()=>{const h=deps();const result=await m.generateCourseCover(source,'001',h.api,'标题更醒目，减少装饰');assert.match(h.requests[0].prompt,/标题更醒目，减少装饰/);assert.match(result.cover.versions[0].config.instruction,/标题更醒目/);});

test('interactive webpages have square covers directed by the webpage presentation style',()=>{
 const c={version:1,mode:'web',config:{topic:'水循环',style:'notion',layout:'dense',palette:'default',audience:'大众学习者',count:4,ratio:'16:9'},webConfig:{style:'ink',audience:'大众学习者',instruction:''},webPlan:{title:'山水间的一滴水',summary:'水循环',html:'',prompt:'',createdAt:1},history:[]};
 const script=buildSync({entryPoints:['src/course/cover.ts'],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text;const module={exports:{}};vm.runInNewContext(script,{module,structuredClone,TextEncoder});assert.equal(module.exports.courseReady(c),true);assert.equal(module.exports.courseSubject(c),'交互网页');const config=module.exports.coverConfig(c);assert.equal(config.ratio,'1:1');assert.equal(config.title,c.webPlan.title);assert.match(config.instruction,/宣纸纤维/);
});

test('video covers follow rendered sizes and web covers have independent sizes',()=>{
 for(const mode of ['animation','whiteboard'])for(const ratio of ['16:9','9:16','1:1','4:3','3:4']){
 const c={...source,mode,[mode+'Config']:{ratio:'1:1'},[mode+'PlannedConfig']:{ratio}};
 assert.equal(m.coverConfig(c).ratio,ratio);
 }
 assert.equal(m.coverConfig({...source,mode:'web',webConfig:{style:'ink',coverRatio:'2:3'}}).ratio,'2:3');
});

test('illustrated web covers reference the same saved scene instead of an unrelated style image',async()=>{
 const artwork={image:'workstore-image:'+'b'.repeat(64),prompt:'原画'},h=deps();
 const c={...source,mode:'web',webConfig:{style:'simulation'},webPlan:{title:'电车',summary:'电池到车轮',artwork}};
 const result=await m.generateCourseCover(c,undefined,h.api);
 assert.deepEqual(Array.from(h.requests[0].refs),[artwork.image]);assert.match(h.requests[0].prompt,/主场景原画/);assert.equal(result.webPlan.artwork.image,artwork.image);
});
