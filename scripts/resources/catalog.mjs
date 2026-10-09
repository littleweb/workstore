import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
export function courseFiles(root=process.cwd()){
 const keys=new Set(['/course/web/engine.js']);
 function walk(v){if(typeof v==='string'&&v.startsWith('/course/'))keys.add(v);else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk);}
 for(const file of ['course','course-animation','course-whiteboard','course-web'])walk(JSON.parse(readFileSync(resolve(root,`src/${file}/examples.json`))));
 for(const [i,voice] of ['zf_007','zf_001','zf_002','zf_003','zf_004','zf_008','zf_017','zf_018','zf_019','zf_021','zf_022','zf_023'].entries())keys.add(`/course/voices/${String(i+1).padStart(2,'0')}-${voice}.wav`);
 return [...keys].sort().map(key=>{
  if(!/^\/course\/[a-z0-9/_.-]+\.(png|webp|jpg|mp4|wav|html|js)$/.test(key)||key.includes('..'))throw Error('不允许的课程资源路径：'+key);
  const bytes=readFileSync(resolve(root,'public',key.slice(1))),sha256=createHash('sha256').update(bytes).digest('hex');
  if(!bytes.length||bytes.length>256*1024*1024)throw Error('课程资源超出限制：'+key);
  return {key,source:`public${key}`,filename:`${sha256}.${key.split('.').at(-1)}`,sha256,size:bytes.length,kind:'file'};
 });
}
export function validateResources(root=process.cwd()){
 const index=JSON.parse(readFileSync(resolve(root,'src/remote-resources.json')));
 if(index.schemaVersion!==1||index.repository!=='littleweb/workstore'||!/^resources-[a-f0-9]{16}$/.test(index.tag))throw Error('课程资源索引无效');
 const files=courseFiles(root);
 for(const f of files){const e=index.entries[f.key];if(!e||e.sha256!==f.sha256||e.size!==f.size||e.filename!==f.filename||!Number.isSafeInteger(e.id)||e.id<=0)throw Error('课程资源未发布或已变更：'+f.key);}
 const publicKeys=Object.keys(index.entries).filter(k=>k.startsWith('/course/'));
 if(publicKeys.length!==files.length)throw Error('课程索引包含未引用资源');
 for(const kind of ['node','animation','whiteboard','html-service']){const e=index.entries[`component:${kind}:darwin-aarch64`];if(!e||e.kind!=='component'||!e.filename.endsWith('.tar.gz')||e.size>512*1024*1024||!Number.isSafeInteger(e.id)||e.id<=0||!/^[a-f0-9]{64}$/.test(e.sha256)||!e.checks||Object.entries(e.checks).some(([p,c])=>!p||p.includes('/')||p.includes('\\')||p==='..'||p==='.ready'||!Number.isSafeInteger(c.size)||c.size<=0||!/^[a-f0-9]{64}$/.test(c.sha256)||!Number.isSafeInteger(c.mode)||c.mode>511))throw Error('课程运行组件索引无效：'+kind);}
 return index;
}
