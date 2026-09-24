import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
const root=new URL('../',import.meta.url);
test('vendored HTML Anything files stay byte-identical to the pinned upstream revision',()=>{
 const manifest=JSON.parse(readFileSync(new URL('third-party/html-anything/upstream-manifest.json',root)));
 assert.ok(Object.keys(manifest.files).length>300);
 for(const [file,hash] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(readFileSync(new URL('vendor/html-anything/'+file,root))).digest('hex'),hash,file);
});
test('original preview is hosted separately and keeps upstream scripts, exports and generation adapters',()=>{
 const page=readFileSync(new URL('vendor/html-anything/next/src/components/preview-pane.tsx',root),'utf8');
 assert.match(page,/sandbox="allow-scripts allow-same-origin"/);
 const host=readFileSync(new URL('src/html/HtmlApp.tsx',root),'utf8');
 assert.match(host,/html_original_start/);assert.doesNotMatch(host,/srcDoc|previewHtml|generationMessages/);
 const exports=readFileSync(new URL('vendor/html-anything/next/src/components/export-menu.tsx',root),'utf8');
 for(const feature of ['wechat','zhihu','image','deck','remotion'])assert.match(exports,new RegExp(feature));
 const config=JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json',root)));
 assert.match(config.app.security.csp,/frame-src 'self' http:\/\/127\.0\.0\.1:\*/);
 assert.doesNotMatch(config.app.security.csp,/script-src[^;]*unsafe-inline/);
});
test('loopback boundary preserves streaming and rejects foreign origins and unauthenticated lifecycle requests',async()=>{
 const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const nonce='test-only-nonce';
 const script=`const http=require('http');http.createServer((req,res)=>{if(req.url==='/api/stream'){res.setHeader('Content-Type','text/event-stream');res.write('data: first\\n\\n');setTimeout(()=>res.end('data: last\\n\\n'),10);}else{res.end('original-page')}}).listen(process.env.PORT,'127.0.0.1',()=>process.stdout.write('ready\\n'));`;
 const child=spawn(process.execPath,['--require',new URL('scripts/html-anything/preload.cjs',root).pathname,'-e',script],{env:{...process.env,PORT:String(port),WORKSTORE_HTML_NONCE:nonce},stdio:['ignore','pipe','pipe']});
 try{
  await once(child.stdout,'data');const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/api/convert',{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(base+'/__workstore/cancel',{method:'POST'})).status,403);
  assert.equal((await fetch(base+'/__workstore/health',{headers:{'x-workstore-runtime':nonce}})).status,200);
  assert.equal(await (await fetch(base+'/api/stream')).text(),'data: first\n\ndata: last\n\n');
 }finally{child.kill('SIGKILL');await once(child,'close');}
});
