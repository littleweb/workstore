import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
export const repository='littleweb/workstore', branch='assets/design-studio';
export function designPaths(root=process.cwd()) {
 const files=new Set();
 function walk(value) {
  if(typeof value==='string'&&value.startsWith('/design-studio/'))files.add(value);
  else if(Array.isArray(value))value.forEach(walk);
  else if(value&&typeof value==='object')Object.values(value).forEach(walk);
 }
 walk(JSON.parse(readFileSync(resolve(root,'src/design-studio/catalog.json'),'utf8')));
 return [...files].sort();
}
export function collectDesignAssets(root=process.cwd()) {
 const entries={};
 for(const key of designPaths(root)) {
  if(!/^\/design-studio\/(covers|examples)\/[a-z0-9-]+\.webp$/.test(key))throw Error(`设计室素材路径不允许：${key}`);
  const bytes=readFileSync(resolve(root,'public',key.slice(1)));
  if(bytes.length<12||bytes.length>8*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw Error(`设计室素材无效：${key}`);
  entries[key]={path:key.slice(1),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),blob:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')};
 }
 if(!Object.keys(entries).length)throw Error('设计室素材目录为空');
 return entries;
}
export function validateDesignPublished(index,entries) {
 if(index.schemaVersion!==1||index.repository!==repository||!/^[a-f0-9]{40}$/.test(index.commit??'')||JSON.stringify(index.entries)!==JSON.stringify(entries))throw Error('设计室线上索引与本地素材不一致，请先运行 npm run design:publish');
}
