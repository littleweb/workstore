import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
const code=buildSync({entryPoints:['src/design-studio/images.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['@tauri-apps/plugin-clipboard-manager','@tauri-apps/api/core','../workspace','../comics/images']}).outputFiles[0].text;
function setup({width=1,height=1,rgba=new Uint8Array([255,0,0,255]),encode=true}={}){
 let closed=0,pixels;const saved=[];const image={size:async()=>({width,height}),rgba:async()=>rgba,close:async()=>closed++};
 class TestImageData{constructor(data,w,h){this.data=data;this.width=w;this.height=h;}}
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='@tauri-apps/plugin-clipboard-manager'?{readImage:async()=>image}:id==='../workspace'?{native:true,scheduleAutosync(){}}:id==='../comics/images'?{referenceImage:async()=> 'data:image/png;base64,eA=='}:{invoke:async(_,args)=>{saved.push(args.data);return 'saved-image';}},document:{createElement:()=>({getContext:()=>({putImageData:data=>pixels=data}),toBlob:callback=>callback(encode?new Blob(['encoded-png'],{type:'image/png'}):null)})},ImageData:TestImageData,File,Blob,Uint8ClampedArray,Promise,Error,setTimeout,URL:{createObjectURL:()=>'blob:test',revokeObjectURL(){} }});
 return {detect:module.exports.hasClipboardImage,read:module.exports.clipboardImageFile,upload:module.exports.uploadImage,saved,closed:()=>closed,pixels:()=>pixels};
}
test('system clipboard RGBA is encoded as PNG before entering the ordinary upload pipeline',async()=>{
 const h=setup();const stages=[];const file=await h.read(stage=>stages.push(stage));assert.deepEqual(stages,['正在读取剪贴板…','正在转换图片…']);assert.equal(file.type,'image/png');assert.equal(await file.text(),'encoded-png');assert.deepEqual([...h.pixels().data],[255,0,0,255]);assert.equal(h.closed(),1);
});
test('invalid, incomplete and failed encodings release the native image and return an error',async()=>{
 for(const options of [{width:0,height:0},{rgba:new Uint8Array(3)},{encode:false}]){const h=setup(options);await assert.rejects(h.read());assert.equal(h.closed(),1);}
});


test('images exceeding the former 10MB input limit are processed and saved with real stage updates',async()=>{
 const h=setup(),stages=[];const result=await h.upload(new File([new Uint8Array(11*1024*1024)],'large.png',{type:'image/png'}),s=>stages.push(s));assert.equal(result,'saved-image');assert.equal(h.saved.length,1);assert.deepEqual(stages,['正在处理图片…','正在保存图片…']);
});


test('page-entry detection checks presence and releases the image without encoding or saving',async()=>{
 const h=setup();assert.equal(await h.detect(),true);assert.equal(h.closed(),1);assert.equal(h.pixels(),undefined);assert.deepEqual(h.saved,[]);const empty=setup({width:0});assert.equal(await empty.detect(),false);assert.equal(empty.closed(),1);
});
