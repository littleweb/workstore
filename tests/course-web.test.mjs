import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {buildSync} from 'esbuild';import {JSDOM} from 'jsdom';
function bundle(file,extra={}){const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:[file],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,{module,structuredClone,TextEncoder,Date,...extra});return module.exports;}
const model=bundle('src/course-web/model.ts'),workflow=bundle('src/course-web/workflow.ts');const refs=JSON.parse(fs.readFileSync('src/course-web/examples.json'));
const html=id=>fs.readFileSync('public/course/web/'+id+'/index.html','utf8');
test('scene packing uses the same uncropped canvas for PNG vision and bounded JPEG export',async()=>{
 const draws=[],canvas={getContext:()=>({fillRect(){},drawImage(...args){draws.push(args);}}),toDataURL:type=>type==='image/png'?'data:image/png;base64,YQ==':'data:image/jpeg;base64,YQ=='};
 const art=bundle('src/course-web/artwork.ts',{Image:class{width=1600;height=1200;decode(){return Promise.resolve();}},document:{createElement:()=>canvas}});
 const packed=await art.sceneData('data:image/png;base64,YQ==');
 assert.equal(canvas.width,1600);assert.equal(canvas.height,900);
 assert.equal(draws[0][1],200);assert.equal(draws[0][2],0);assert.equal(draws[0][3],1200);assert.equal(draws[0][4],900);
 assert.match(packed.reference,/^data:image\/png/);assert.match(packed.data,/^data:image\/jpeg/);
});
test('illustrated pages embed the actual artwork safely and preserve it in sandbox previews',()=>{
 const art=bundle('src/course-web/artwork.ts'),data='data:image/jpeg;base64,YQ==';
 const input='<!DOCTYPE html><html><body><img src="COURSE_SCENE_IMAGE"><input><script>document.body.dataset.ready=1</script></body></html>';
 const result=art.embedScene(input,data);assert.match(result,/src="data:image\/jpeg;base64,YQ=="/);
 assert.throws(()=>art.embedScene(input.replace('COURSE_SCENE_IMAGE','fake'),data),/原画/);
 assert.throws(()=>art.embedScene(input,'https://example.com/image'),/数据无效/);
 assert.throws(()=>art.embedScene(input.replace('<input>','<img src="COURSE_SCENE_IMAGE"><input>'),data),/原画/);
 const dom=new JSDOM(''),policy=bundle('src/course-web/htmlPolicy.ts',{document:dom.window.document});
 const preview=policy.previewHtml(result.replace('<input>','<img src="https://example.com/x"><input>'));
 assert.match(preview,/src="data:image\/jpeg;base64,YQ=="/);assert.doesNotMatch(preview,/https:\/\/example.com/);dom.window.close();
 assert.match(art.illustratedPrompt('base'),/不承诺自由旋转/);assert.match(art.scenePrompt('电车',model.defaults()),/不画燃油发动机/);
 const old=model.generationPrompt('电车',model.defaults(),result);assert.doesNotMatch(old,/YQ==/);
});
test('12 self-contained references have unique styles and operating controls',()=>{assert.equal(refs.length,12);assert.equal(new Set(refs.map(r=>r.config.style)).size,12);for(const r of refs){model.validateConfig(r.config);model.extractHtml(html(r.id));assert.ok(fs.existsSync('public'+r.cover));const dom=new JSDOM(html(r.id),{runScripts:'dangerously',beforeParse(w){w.HTMLCanvasElement.prototype.getContext=type=>type==='webgl'?null:new Proxy({},{get:(_,key)=>key==='getExtension'?()=>null:()=>{}});w.requestAnimationFrame=()=>{};w.matchMedia=()=>({matches:false});}});const d=dom.window.document;assert.ok(d.getElementById('feedback').textContent);const el=d.querySelector('input');el.value=el.max;el.dispatchEvent(new dom.window.Event('input'));assert.equal(d.getElementById(el.id+'-value').textContent,el.value);d.getElementById('reset').click();assert.equal(el.value,el.defaultValue);dom.window.close();}});
test('reference experiments produce calculated state, not decorative changes',()=>{function run(id,check){const dom=new JSDOM(html(id),{runScripts:'dangerously',beforeParse(w){w.HTMLCanvasElement.prototype.getContext=()=>null;w.requestAnimationFrame=()=>{};}});check(dom.window.document,dom.window);dom.window.close();}
 run('circuit-lab',d=>{assert.match(d.getElementById('feedback').textContent,/0.500 A/);d.querySelector('[data-action=switch]').click();assert.match(d.getElementById('feedback').textContent,/0.000 A.*断路/);});
 run('loop-playground',d=>{d.querySelector('[data-action=step]').click();d.querySelector('[data-action=step]').click();assert.match(d.getElementById('feedback').textContent,/i = 2 · sum = 3/);});
 run('fraction-pieces',(d,w)=>{const n=d.getElementById('numerator');n.value=12;n.dispatchEvent(new w.Event('input'));assert.match(d.getElementById('feedback').textContent,/4 \/ 4 = 1.000/);});
 run('coin-probability',(d,w)=>{const p=d.getElementById('probability');p.value=100;p.dispatchEvent(new w.Event('input'));d.querySelector('[data-action=hundred]').click();assert.match(d.getElementById('feedback').textContent,/试验 100 次 · 正面 100 次/);});
 run('human-layers',d=>{d.querySelector('[data-action=skeleton]').click();assert.match(d.getElementById('feedback').textContent,/骨骼/);d.querySelector('[data-organ=liver]').click();assert.match(d.getElementById('detail').textContent,/右上腹/);});
});
test('sandbox policy preserves inline interactions and removes active network/navigation embeddings',()=>{const dom=new JSDOM(''),policy=bundle('src/course-web/htmlPolicy.ts',{document:dom.window.document});const result=policy.previewHtml('<!DOCTYPE html><html><body><button onclick="bad()">test</button><iframe src="https://example.com"></iframe><script src="https://example.com/x"></script><script>document.body.dataset.ok=1</script><form action="https://example.com"><input></form><a href="https://example.com">link</a></body></html>');assert.match(result,/connect-src 'none'/);assert.match(result,/document.body.dataset.ok/);assert.doesNotMatch(result,/onclick|<iframe|<script src|href=|action=/);const ui=fs.readFileSync('src/course-web/Preview.tsx','utf8');assert.match(ui,/sandbox="allow-scripts"/);assert.doesNotMatch(ui,/allow-same-origin/);dom.window.close();});
test('generation saves prompt before model, rejects stale and preserves prior work on invalid output',async()=>{const events=[],signal=new AbortController().signal,prior={title:'old',summary:'old',html:html('circuit-lab'),prompt:'old',createdAt:1};let valid=true;const deps={valid:()=>valid,text:async p=>{events.push('model');return html('circuit-lab');},save:async(p,prompt,stage)=>events.push(p?'done':'prompt')};const result=await workflow.runWorkflow('电路',model.defaults(),prior,deps,signal);assert.deepEqual(events,['prompt','model','done']);assert.match(result.html,/电路参数/);const stale={...deps,text:async()=>{valid=false;return html('circuit-lab');}};await assert.rejects(()=>workflow.runWorkflow('电路',model.defaults(),prior,stale,signal),/作品已变化/);valid=true;await assert.rejects(()=>workflow.runWorkflow('电路',model.defaults(),prior,{...deps,text:async()=>'<html>bad</html>'},signal),/完整/);assert.equal(prior.title,'old');});
test('saved interactive documents retain HTML, config and history without affecting existing card parsing',()=>{const course=bundle('src/course/model.ts');const c={version:1,mode:'web',config:{topic:'电路',style:'notion',layout:'dense',palette:'default',audience:'大众学习者',count:4,ratio:'1:1'},webConfig:model.defaults(),webPlan:{title:'电路',summary:'实验',html:html('circuit-lab'),prompt:'prompt',createdAt:1},history:[]};assert.equal(course.readContent(JSON.stringify(c)).webPlan.html,c.webPlan.html);assert.throws(()=>course.readContent(JSON.stringify({...c,webConfig:{...c.webConfig,style:'invalid'}})));});

test('new 3D generations embed the local renderer and remain self-contained after export',async()=>{
 const runtime=fs.readFileSync('public/course/web/engine.js','utf8');let requests=0;const renderer=bundle('src/course-web/renderer.ts',{fetch:async()=>{requests++;return {ok:true,text:async()=>runtime};}});
 const input='<!DOCTYPE html><html><head><title>材料实验</title></head><body><button>旋转</button><script>const {THREE}=window.Course3D;new THREE.Scene();</script></body></html>';
 const result=await renderer.withRenderer(input);model.extractHtml(result);assert.equal(requests,1);assert.match(result,/data-course-renderer/);assert.ok(result.indexOf('data-course-renderer')<result.indexOf('const {THREE}'));assert.equal(await renderer.withRenderer(result),result);assert.equal(await renderer.withRenderer(html('circuit-lab')),html('circuit-lab'));assert.equal(requests,1);
 const config=model.defaults();const prompt=model.generationPrompt('任意科学主题',config);assert.match(prompt,/风格指材质、光影、空间、构图和字体/);assert.match(prompt,/Course3D/);
});
