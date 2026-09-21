import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
function load(path, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, crypto: globalThis.crypto, require(id) { if (id in dependencies) return dependencies[id]; throw new Error(id); },
  });
  return module.exports;
}
const editing = load('../src/ai/editing.ts');
const doc = { kind: 'document', title: 'Plan', blocks: [{type:'heading',level:1,text:'Plan'},{type:'paragraph',text:'Actual editable content'},{type:'bullets',items:['A','B']},{type:'table',rows:[['Name','State'],['Build','Ready']]}] };
const board = { kind:'whiteboard',title:'Flow',nodes:[{id:'a',label:'Start',shape:'rectangle',x:0,y:0,width:200,height:100},{id:'b',label:'End',shape:'ellipse',x:400,y:0,width:200,height:100}],edges:[{from:'a',to:'b',label:'next'}] };

test('editor protocol produces real formatted content and rejects narrative-only or malformed results', () => {
  const parsed=editing.parseEditorDraft('```json\n'+JSON.stringify(doc)+'\n```','document');
  assert.equal(parsed.blocks.length,4);
  const dom = new JSDOM(editing.documentDraftHtml(parsed));
  assert.equal(dom.window.document.querySelector('h1').textContent,'Plan');
  assert.equal(dom.window.document.querySelectorAll('li').length,2);
  assert.equal(dom.window.document.querySelectorAll('td').length,4);
  dom.window.close();
  for(const value of ['已插入文档', '{}', JSON.stringify({...doc,blocks:[{type:'heading',level:1.5,text:'invalid'}]}), JSON.stringify({...doc,blocks:[{type:'table',rows:[['a','b'],['c']]}]})]) {
    assert.throws(()=>editing.parseEditorDraft(value,'document'),/未修改/);
  }
});

test('model strings are escaped and cannot inject script, resource requests or HTML event handlers', () => {
  const malicious={...doc,blocks:[{type:'paragraph',text:'<img src="https://attacker.invalid" onerror="alert(1)"><script>alert(2)</script>'}]};
  const html=editing.documentDraftHtml(editing.parseEditorDraft(JSON.stringify(malicious),'document'));
  const dom=new JSDOM(html);
  assert.equal(dom.window.document.querySelectorAll('img,script,iframe').length,0);
  assert.match(dom.window.document.body.textContent, /<script>/);
  dom.window.close();
});

test('whiteboard protocol allows only bounded native shapes and validated relationships', () => {
  const parsed=editing.parseEditorDraft(JSON.stringify(board),'whiteboard');
  assert.equal(parsed.nodes.length,2); assert.equal(parsed.edges[0].to,'b');
  for(const bad of [
    {...board,nodes:[{...board.nodes[0],shape:'iframe'}]},
    {...board,nodes:[{...board.nodes[0],x:1e99}]},
    {...board,nodes:[board.nodes[0],board.nodes[0]]},
    {...board,edges:[{from:'a',to:'missing'}]},
    {...board,edges:[{from:'a',to:'a'}]},
    {...board,nodes:Array.from({length:41},(_,i)=>({...board.nodes[0],id:String(i)}))},
  ]) assert.throws(()=>editing.parseEditorDraft(JSON.stringify(bad),'whiteboard'));
  const extra={...board,nodes:[{...board.nodes[0],link:'javascript:bad()',customData:{secret:'x'}}],edges:[]};
  const safe=editing.parseEditorDraft(JSON.stringify(extra),'whiteboard');
  assert.equal(safe.nodes[0].link,undefined); assert.equal(safe.nodes[0].customData,undefined);
});

test('current contents leave the device only with attach enabled and diagram references omit image blobs', () => {
  const source={id:'a',title:'private',content:'PRIVATE_BODY'};
  assert.ok(!JSON.stringify(editing.editorMessages('document','write',source,false)).includes('PRIVATE_BODY'));
  assert.match(JSON.stringify(editing.editorMessages('document','write',source,true)),/PRIVATE_BODY/);
  const scene={elements:[{id:'a',type:'text',text:'node'}, {id:'gone',isDeleted:true,text:'REMOVED_TEXT'}],files:{image:{dataURL:'PRIVATE_IMAGE'}}};
  const messages=editing.editorMessages('whiteboard','write',{...source,content:JSON.stringify(scene)},true);
  assert.match(JSON.stringify(messages),/node/); assert.ok(!JSON.stringify(messages).includes('PRIVATE_IMAGE')); assert.ok(!JSON.stringify(messages).includes('REMOVED_TEXT'));
});

function documentTarget() {
  let active='a',failBefore=false,failAfter=false; const versions=new Map([['a',{id:'a',title:'Existing',content:'<p>original</p>'}]]); const calls=[];
  const store={currentDocument:id=>versions.get(id),
    async flushDocuments(){calls.push('flush-old');if(failBefore) throw new Error('disk full');},
    async flushDocument(){calls.push('flush-new');if(failAfter) throw new Error('disk full');},
    async createDocument(){calls.push('create');versions.set('new',{id:'new',title:'Untitled',content:''});return versions.get('new');},
    stageDocument(id,patch){calls.push('stage');Object.assign(versions.get(id),patch);},
    applyDocumentContent(id,content){calls.push('apply');versions.get(id).content=content;},
  };
  const target=load('../src/documents/aiTarget.ts',{'../ai/editing':editing,'./store':store}).documentAiTarget(()=>active,id=>{active=id;calls.push('select-new');});
  return {target,versions,calls,setActive:id=>{active=id;},failBefore:()=>{failBefore=true;},failAfter:()=>{failAfter=true;}};
}
test('document apply appends to latest contents, refuses stale replacement and never writes to another document',async()=>{
  const h=documentTarget(); const source=h.target.capture();
  h.versions.get('a').content='<p>edited during generation</p>';
  await assert.rejects(h.target.apply(doc,source,'replace'),/阻止覆盖/);
  assert.ok(!h.calls.includes('apply'));
  const result=await h.target.apply(doc,source,'append');
  assert.equal(result.saved,true);assert.ok(h.versions.get('a').content.startsWith('<p>edited during generation</p>'));
  assert.equal(h.versions.get('a').title,'Existing');
  h.setActive('other');await assert.rejects(h.target.apply(doc,source,'append'),/切换/);
});
test('replace saves old content first; creating a new document leaves the source untouched',async()=>{
  const h=documentTarget(); const source=h.target.capture();
  await h.target.apply(doc,source,'replace');
  assert.deepEqual(h.calls,['flush-old','apply','flush-new']);
  assert.match(h.versions.get('a').content,/Actual editable content/);
  const before=h.versions.get('a').content;
  await h.target.apply(doc,source,'create');
  assert.equal(h.versions.get('new').title,'Plan');assert.equal(h.versions.get('a').content,before);
  assert.equal(h.calls.at(-1),'select-new');
});
test('save failure before applying prevents a change; after applying reports unsaved content accurately',async()=>{
  const h=documentTarget();h.failBefore();
  await assert.rejects(h.target.apply(doc,h.target.capture(),'replace'),/disk full/);
  assert.equal(h.versions.get('a').content,'<p>original</p>');assert.ok(!h.calls.includes('apply'));
  const after=documentTarget();after.failAfter();
  const result=await after.target.apply(doc,after.target.capture(),'append');
  assert.equal(result.saved,false);assert.match(result.message,/不要重复应用/);assert.match(after.versions.get('a').content,/Actual editable content/);
});
