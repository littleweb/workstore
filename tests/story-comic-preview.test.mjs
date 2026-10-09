import {test} from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import vm from 'node:vm';
test('comic previews use bounded-size JPEGs while keeping original image references untouched',async()=>{
 const module={exports:{}};let calls=0,canvas,cleared=0;
 class Image {naturalWidth=1242;naturalHeight=1656;set src(value){if(value==='')cleared++;}async decode(){}}
 const code=buildSync({entryPoints:['src/story-comic/previewImages.ts'],bundle:true,write:false,format:'cjs',external:['../comics/images']}).outputFiles[0].text;
 vm.runInNewContext(code,{module,Image,document:{createElement:()=>{canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(image,x,y,w,h){assert.equal(w,576);assert.equal(h,768);}}),toDataURL:(format,quality)=>{assert.equal(format,'image/jpeg');assert.equal(quality,.86);return 'data:image/jpeg;base64,preview';}};return canvas;}},require:()=>({imageSource:async id=>{assert.equal(id,'original');calls++;return 'data:image/png;base64,original';}})});
 const read=module.exports.previewImageSource;
 assert.equal(await read('original'),'data:image/jpeg;base64,preview');await read('original');
 assert.equal(calls,1);assert.equal(cleared,1);assert.equal(canvas.width,1);
});
