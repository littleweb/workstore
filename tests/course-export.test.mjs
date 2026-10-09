import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
import JSZip from 'jszip';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('course archive retains ordered PNGs, prompts, publication copy and original content',async()=>{
 const module={exports:{}},downloads=[],png='data:image/png;base64,aGVsbG8=';
 const code=buildSync({entryPoints:['src/course/export.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['jszip','@tauri-apps/api/core','@tauri-apps/plugin-dialog','../workspace','../comics/images','../story-comic/export']}).outputFiles[0].text;
 vm.runInNewContext(code,{module,Blob,Uint8Array,atob,setTimeout:f=>f(),URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},document:{createElement:()=>({click(){}})},require:name=>name==='jszip'?require(name):name==='../workspace'?{native:false}:name==='../comics/images'?{imageSource:async()=>png}:name==='../story-comic/export'?{pdfBlob(){}}:{}});
 const content={version:1,config:{},copy:{title:'自定义标题',description:'学习文案',hashtags:['学习'],alternatives:[]},plan:{title:'课程',summary:'学习',analysis:'分析',pages:[{title:'封面',text:['正文'],visual:'图解',prompt:'禁止页码',image:'a',status:'ready'}]}};
 await module.exports.exportZip(content,'课程');const zip=await JSZip.loadAsync(await downloads[0].arrayBuffer());
 assert.equal(await zip.file('01-cover.png').async('string'),'hello');assert.match(await zip.file('发布文案.txt').async('string'),/自定义标题[\s\S]*#学习/);assert.equal(await zip.file('prompts/01-cover.md').async('string'),'禁止页码');assert.deepEqual(JSON.parse(await zip.file('作品.course.json').async('string')),content);
});
