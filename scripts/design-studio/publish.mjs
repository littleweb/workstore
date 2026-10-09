import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {repository,branch,collectDesignAssets} from './assets.mjs';
// Only publish catalog-referenced public assets; never inspect or stage user data.
const api=(path,method='GET',payload)=>{
 const result=spawnSync('gh',['api',`repos/${repository}/${path}`,'--method',method,...(payload?['--input','-']:[])],{input:payload?JSON.stringify(payload):undefined,encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});
 if(result.status!==0)throw Error(result.stderr||'GitHub素材发布失败');
 return JSON.parse(result.stdout);
};
const entries=collectDesignAssets(), catalog={schemaVersion:1,repository,entries};
const old=api(`git/matching-refs/heads/${branch}`).find(ref=>ref.ref===`refs/heads/${branch}`)?.object.sha;
let commit;
if(old){const content=api(`contents/manifest.json?ref=${old}`);if(Buffer.from(content.content,'base64').toString()===JSON.stringify(catalog,null,2)+'\n')commit=old;}
if(!commit){
 const main=api('git/ref/heads/main').object.sha,known=api(`git/trees/${main}?recursive=1`);
 if(known.truncated)throw Error('远端树不完整，停止素材发布');
 const blobs=new Set(known.tree.filter(item=>item.type==='blob').map(item=>item.sha));
 const tree=[];
 for(const [key,entry] of Object.entries(entries)){
  if(!blobs.has(entry.blob)){
   const uploaded=api('git/blobs','POST',{encoding:'base64',content:readFileSync(`public${key}`).toString('base64')});
   if(uploaded.sha!==entry.blob)throw Error('远端素材校验失败');
   blobs.add(entry.blob);
  }
  tree.push({path:entry.path,mode:'100644',type:'blob',sha:entry.blob});
 }
 const manifest=api('git/blobs','POST',{encoding:'utf-8',content:JSON.stringify(catalog,null,2)+'\n'});
 tree.push({path:'manifest.json',mode:'100644',type:'blob',sha:manifest.sha});
 const groups=['covers','examples'].map(group=>{
  const prefix=`design-studio/${group}/`,items=tree.filter(item=>item.path.startsWith(prefix));
  const existing=known.tree.find(item=>item.path===`public/design-studio/${group}`&&item.type==='tree');
  const descendants=known.tree.filter(item=>item.path.startsWith(`public/${prefix}`));
  const identical=existing&&descendants.length===items.length&&items.every(item=>descendants.some(remote=>remote.path===`public/${item.path}`&&remote.sha===item.sha));
  const sha=identical?existing.sha:api('git/trees','POST',{tree:items.map(item=>({...item,path:item.path.slice(prefix.length)}))}).sha;
  return {path:group,mode:'040000',type:'tree',sha};
 });
 const designTree=api('git/trees','POST',{tree:groups});
 const assetTree=api('git/trees','POST',{tree:[{path:'design-studio',mode:'040000',type:'tree',sha:designTree.sha},tree.at(-1)]});
 commit=api('git/commits','POST',{message:'Publish verified design studio assets',tree:assetTree.sha,parents:old?[old]:[]}).sha;
 if(old)api(`git/refs/heads/${branch}`,'PATCH',{sha:commit,force:false});
 else api('git/refs','POST',{ref:`refs/heads/${branch}`,sha:commit});
}
const published=api(`git/trees/${commit}?recursive=1`);
if(published.truncated||Object.values(entries).some(entry=>!published.tree.some(item=>item.path===entry.path&&item.sha===entry.blob&&item.size===entry.size)))throw Error('GitHub设计室素材不完整');
writeFileSync('src/design-studio/remote-assets.json',JSON.stringify({...catalog,commit},null,2)+'\n');
console.log(`设计室素材已发布：${Object.keys(entries).length}张，版本 ${commit}`);
