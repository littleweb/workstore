import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {courseFiles} from './catalog.mjs';
const repository='littleweb/workstore';
function run(args,timeout=60000){const r=spawnSync('gh',args,{encoding:'utf8',timeout,maxBuffer:32*1024*1024});if(r.status!==0)throw Error(r.stderr||'GitHub资源发布失败');return r.stdout;}
const api=path=>JSON.parse(run(['api',`repos/${repository}/${path}${path.includes('?')?'&':'?'}fresh=${Date.now()}`,'-H','Cache-Control: no-cache']));
const files=[...courseFiles(),...JSON.parse(readFileSync('.release-build/resources/components.json'))];
const tag='resources-'+createHash('sha256').update(JSON.stringify(files.map(({key,size,sha256,kind})=>({key,size,sha256,kind})))).digest('hex').slice(0,16);
let release=api('releases?per_page=100').find(r=>r.tag_name===tag);
if(!release){run(['release','create',tag,'--repo',repository,'--draft','--prerelease','--title','WorkStore course resources','--notes','Verified public course examples and optional runtime components. Not a software update.']);release=api('releases?per_page=100').find(r=>r.tag_name===tag);}
mkdirSync('.release-build/upload',{recursive:true});
for(const f of new Map(files.map(f=>[f.filename,f])).values()){
 const existing=release.assets.find(a=>a.name===f.filename);
 if(existing){if(existing.size!==f.size||existing.digest!==`sha256:${f.sha256}`||existing.state!=='uploaded')throw Error('已发布资源不可覆盖：'+f.filename);continue;}
 if(!release.draft)throw Error('不可修改已发布资源');
 const dest=`.release-build/upload/${f.filename}`;copyFileSync(f.source,dest);
 run(['release','upload',tag,dest,'--repo',repository],600000);
 console.log('Uploaded public resource',f.filename.slice(0,16),f.size);
}
release=api(`releases/${release.id}`);
const entries={};
for(const f of files){const a=release.assets.find(a=>a.name===f.filename);if(!a||a.size!==f.size||a.digest!==`sha256:${f.sha256}`||a.state!=='uploaded')throw Error('资源远端校验失败');entries[f.key]={filename:f.filename,id:a.id,size:f.size,sha256:f.sha256,kind:f.kind,...(f.checks?{checks:f.checks}:{})};}
if(release.draft)run(['release','edit',tag,'--repo',repository,'--draft=false','--prerelease','--latest=false']);
writeFileSync('src/remote-resources.json',JSON.stringify({schemaVersion:1,repository,tag,entries},null,2)+'\n');
console.log('Verified immutable resources',tag,'entries',files.length);
