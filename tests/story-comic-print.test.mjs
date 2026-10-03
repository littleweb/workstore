import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
function load(entry, globals={}) { const module={exports:{}}; const code=buildSync({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',external:['./export','./render','../workspace','@tauri-apps/api/core']}).outputFiles[0].text;vm.runInNewContext(code,{module,setTimeout,...globals});return module.exports; }
const {printLayout,printDefaults,paperSize,slotRect,fitPrintImage}=load('src/story-comic/printLayout.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
test('duplex retains every page in order, mirrors binding and pads odd tails',()=>{
 for(const count of [1,5,12,16,18,20]) {
  const sheets=printLayout(count,printDefaults);
  assert.deepEqual(plain(sheets.flatMap(s=>s.slots).filter(p=>p!==null)),Array.from({length:count},(_,i)=>i));
  assert.equal(sheets.length%2,0); assert.equal(sheets.length,count+count%2);
  const front=slotRect(printDefaults,sheets[0],0),back=slotRect(printDefaults,sheets[1],0);
  assert.equal(front.width,back.width);assert.equal(front.x-back.x,printDefaults.binding);
 }
 const withCover=printLayout(12,{...printDefaults,coverBlank:true});
 assert.equal(withCover.length,14);assert.equal(withCover[1].slots[0],null);assert.equal(withCover.at(-1).slots[0],null);
});
test('booklet imposes folded reading order and pads to multiples of four',()=>{
 const settings={...printDefaults,mode:'booklet'};
 assert.deepEqual(plain(printLayout(8,settings).map(s=>s.slots)),[[7,0],[1,6],[5,2],[3,4]]);
 for(const count of [1,5,12,16,18,20]) {
  const sheets=printLayout(count,settings),length=Math.ceil(count/4)*4;
  assert.equal(sheets.length,length/2);
  const actual=sheets.flatMap(s=>s.slots).filter(p=>p!==null).sort((a,b)=>a-b);
  assert.deepEqual(plain(actual),Array.from({length:count},(_,i)=>i));
  const order=Array(length);
  for(let i=0;i<sheets.length/2;i++) {const front=sheets[i*2].slots,back=sheets[i*2+1].slots;order[i*2]=front[1];order[i*2+1]=back[0];order[length-1-i*2]=front[0];order[length-2-i*2]=back[1];}
  assert.deepEqual(plain(order.slice(0,count)),Array.from({length:count},(_,i)=>i));
 }
});
test('manual duplex filters sides and reverses only selected backs',()=>{
 const settings={...printDefaults,mode:'booklet'};
 assert.deepEqual(plain(printLayout(12,{...settings,side:'front'}).map(s=>s.sheet)),[1,2,3]);
 assert.deepEqual(plain(printLayout(12,{...settings,side:'back',reverseBack:true}).map(s=>s.sheet)),[3,2,1]);
 assert.equal(printLayout(5,{...printDefaults,mode:'single',coverBlank:true,side:'back'}).length,5);
 assert.equal(printLayout(0,printDefaults).length,0);
});
test('artwork fits A4 boxes without cropping or distortion across all layouts',()=>{
 for(const mode of ['single','duplex','booklet']) for(const margin of [8,12,16,20]) for(const binding of [0,4,6,8,12]) {
  const settings={...printDefaults,mode,margin,binding},paper=paperSize(mode);
  for(const sheet of printLayout(5,settings)) sheet.slots.forEach((_,i)=>{
   const box=slotRect(settings,sheet,i);assert.ok(box.width>0&&box.height>0);
   for(const [w,h] of [[900,1200],[1920,1080],[1080,1080]]) {const rect=fitPrintImage(box,w,h);assert.ok(Math.abs(rect.width/rect.height-w/h)<1e-10);assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=paper.width&&rect.y+rect.height<=paper.height);}
  });
 }
});
test('print rasterizes at 300 dpi, keeps blank sheets and rejects missing images',async()=>{
 const canvases=[],draws=[],progress=[],loads=[];
 const api=load('src/story-comic/printExport.ts',{document:{createElement:()=>{const c={getContext:()=>({fillRect(){},drawImage(...args){draws.push(args)},fillText(){}}),toDataURL:()=>{canvases.push([c.width,c.height]);return 'data:image/jpeg;base64,/9j/2Q=='}};return c;}},require:id=>id==='./render'?{loadImage:async src=>{loads.push(src);return {width:900,height:1200}}}:{}});
 const pages=Array.from({length:5},(_,i)=>({image:`page${i}`}));
 const images=await api.renderPrintSheets(pages,printDefaults,(...args)=>progress.push(args));
 assert.equal(images.length,6);assert.equal(draws.length,5);assert.deepEqual(loads,['page0','page1','page2','page3','page4']);
 assert.deepEqual(canvases,Array.from({length:6},()=>[2480,3508]));assert.deepEqual(progress.at(-1),[6,6]);
 await assert.rejects(api.renderPrintSheets([...pages,{}],printDefaults),/全部漫画/);
});

for (const native of [false,true]) test(`direct print waits for images and opens ${native?'native':'browser'} dialog`,async()=>{
 let root,printed=0,decoded=0,afterPrint;
 const document={body:{append(node){root=node;}},createElement(tag){
  if(tag==='canvas')return {getContext:()=>({fillRect(){},drawImage(){},fillText(){}}),toDataURL:()=> 'data:image/jpeg;base64,/9j/2Q=='};
  if(tag==='img')return {decode:async()=>{await Promise.resolve();decoded++;}};
  return {style:{},children:[],append(node){this.children.push(node)},remove(){root=undefined;}};
 }};
 const api=load('src/story-comic/printExport.ts',{document,window:{addEventListener(event,fn){assert.equal(event,'afterprint');afterPrint=fn;},print(){assert.equal(decoded,2);assert.equal(root.id,'story-print-document');printed++;}},require:id=>id==='./render'?{loadImage:async()=>({width:900,height:1200})}:id==='../workspace'?{native}:id==='@tauri-apps/api/core'?{invoke:async (name,args)=>{assert.equal(args.landscape,false);assert.equal(name,'open_story_comic_print_dialog');assert.equal(decoded,2);assert.ok(root);printed++;return true;}}:{}});
 await api.printSheets([{image:'cover'}],printDefaults);
 assert.equal(printed,1);assert.equal(root.children.length,3);
 assert.match(root.children[0].textContent,/size: 210mm 297mm/);
 assert.match(root.children[0].textContent,/height: calc\(297mm - 1px\)/);
 assert.match(root.children[0].textContent,/body > :not\(#story-print-document\)/);
 afterPrint();assert.equal(root,undefined);
});
