import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const templates = JSON.parse(readFileSync(new URL('../src/html/templates.json', import.meta.url), 'utf8'));
const code=transformSync(readFileSync(new URL('../src/html/model.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
const module={exports:{}};
vm.runInNewContext(code,{module,Blob,document:new JSDOM('').window.document,require:()=>templates});
const model=module.exports;
test('HTML template catalog has unique, usable design instructions and constrained generation',()=>{
 assert.equal(new Set(templates.map(t=>t.id)).size,templates.length);
 assert.ok(templates.length>=75);
 for(const t of templates){assert.ok(t.name);assert.ok(t.body.length>20);}
 const messages=model.generationMessages({...model.emptyContent(),source:'真实收入 123',html:'<h1>old</h1>'});
 assert.match(messages[0].content,/禁止 CDN/);assert.match(messages[1].content,/真实收入 123/);assert.match(messages[1].content,/<h1>old/);
});
test('HTML parsing rejects incomplete model responses and damaged persisted content',()=>{
 assert.throws(()=>model.extractHtml('I generated it'),/完整 HTML/);
 assert.throws(()=>model.extractHtml('<!doctype html><html>unfinished'),/完整 HTML/);
 assert.equal(model.extractHtml('```html\n<!doctype html><html><body>ok</body></html>\n```'),'<!doctype html><html><body>ok</body></html>');
 assert.throws(()=>model.readContent('{"source":12}'),/损坏/);
 assert.equal(model.readContent('').html,'');
});
test('preview removes navigation, scripts, active embeds and event handlers while retaining inline layout',()=>{
 const html=model.previewHtml('<html><head><meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com"><style>h1{color:red}</style></head><body onload="alert(1)"><script>parent.document.body.remove()</script><iframe src="https://example.com"></iframe><a href="https://example.com">go</a><form action="https://example.com">bad</form><h1>中文</h1></body></html>');
 const doc=new JSDOM(html).window.document;
 assert.equal(doc.querySelectorAll('script,iframe,base,form,[onload],[href]').length,0);
 assert.match(doc.querySelector('meta').content,/default-src 'none'/);
 assert.match(doc.querySelector('meta').content,/form-action 'none'/);
 assert.equal(doc.querySelector('h1').textContent,'中文');assert.ok(doc.querySelector('style'));
 const ui=readFileSync(new URL('../src/html/LegacyHtmlApp.tsx',import.meta.url),'utf8');assert.match(ui,/sandbox=""/);
});
