import {ai,trackAiExecution} from '../../ai/client';
import {beginTask,updateTask} from '../../tasks/store';
import * as store from '../store';
import {reference} from '../images';
import {readCanvas,submission,generationPrompt,imageNode,finishNode,type Submission} from './model';
const jobs=new Map<string,{controller:AbortController;output:string}>();
const listeners=new Set<()=>void>();
export const subscribeExecution=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
const notify=()=>listeners.forEach(fn=>fn());
export const runningNode=(docId:string,nodeId:string)=>[...jobs].some(([key,job])=>key===docId+':'+nodeId||key.startsWith(docId+':')&&job.output===nodeId);
export function stopNode(docId:string,nodeId:string){for(const [key,job] of jobs)if(key===docId+':'+nodeId||key.startsWith(docId+':')&&job.output===nodeId)job.controller.abort();}
export function stopCanvas(docId:string){for(const [key,job] of jobs)if(key.startsWith(docId+':'))job.controller.abort();}
export async function generateNode(docId:string,nodeId:string,retry=false){
 const key=docId+':'+nodeId;if(runningNode(docId,nodeId))return;
 let canvas=readCanvas(store.currentDocument(docId)!.content);if(canvas.deletedAt)throw Error('画布已移除');
 const source=canvas.nodes.find(n=>n.id===nodeId);if(!source)throw Error('节点不存在');
 const expectedRemote=store.remoteVersion(docId);
 const snapshot:Submission=retry?structuredClone(source.data.submission!):submission(canvas,nodeId);if(!snapshot)throw Error('此图片没有可重新生成的提示词');
 const caps=await ai.capabilities();if(!caps.imageGenerate)throw Error('当前AI服务不支持生图，请在设置中选择Codex');if(snapshot.references.length&&(!caps.referenceImages||snapshot.references.length>Math.min(5,caps.maxReferences)))throw Error('当前服务不支持这些参考图');
 // Re-read after the network capability check; do not overwrite intervening edits.
 if(store.remoteVersion(docId)!==expectedRemote)throw Error('画布已同步，请重新生成');
 canvas=readCanvas(store.currentDocument(docId)!.content);if(canvas.deletedAt||!canvas.nodes.some(n=>n.id===nodeId)||runningNode(docId,nodeId))return;
 if((retry?source.data.images?.length??0:0)+snapshot.params.count>200)throw Error('此节点最多保留200张候选，请先拆出或移除候选');
 if(!retry&&canvas.nodes.length>=500)throw Error('画布最多保留500个节点');
 const runId=crypto.randomUUID(),remote=expectedRemote,abort=new AbortController();
 const output=retry?canvas.nodes.find(n=>n.id===nodeId)!:imageNode({x:source.position.x+440,y:source.position.y},[],{submission:snapshot});
 output.data={...output.data,status:'generating',error:undefined,submission:snapshot,runId};
 canvas={...canvas,nodes:retry?canvas.nodes.map(n=>n.id===output.id?output:n):[...canvas.nodes,output],edges:retry?canvas.edges:[...canvas.edges,{id:crypto.randomUUID(),source:nodeId,target:output.id,sourceHandle:'out',targetHandle:'in',type:'smoothstep'}]};
 store.stageDocument(docId,{content:JSON.stringify(canvas)});jobs.set(key,{controller:abort,output:output.id});notify();
 const task=beginTask(abort,{toolId:'app.design',title:store.currentDocument(docId)!.title,stage:'准备画布参考图片…'});
 const valid=()=>{if(abort.signal.aborted)throw Error('已停止生成');if(store.remoteVersion(docId)!==remote)throw Error('画布已同步，结果未覆盖');const c=readCanvas(store.currentDocument(docId)!.content);if(c.deletedAt||c.nodes.find(n=>n.id===output.id)?.data.runId!==runId)throw Error('画布节点已变化，结果未覆盖');return c;};
 let failure:unknown;
 await trackAiExecution(abort,(async()=>{try{
  await store.flushDocument(docId);const references=await Promise.all(snapshot.references.map(reference));valid();
  for(let i=0;i<snapshot.params.count;i++){
   valid();updateTask(abort.signal,{stage:`画布生成 ${i+1}/${snapshot.params.count}`,done:i,total:snapshot.params.count});
   const response=await ai.generate({toolId:'app.design',record:true,image:true,references,messages:[{role:'user',content:generationPrompt(snapshot)}]},abort.signal);
   if(response.saveError)throw Error(response.saveError);if(!response.images?.length||response.images.some(s=>!/^workstore-image:[0-9a-f]{64}$/.test(s)))throw Error('AI没有返回已保存的图片');
   const c=valid(),n=c.nodes.find(n=>n.id===output.id)!;const images=[...(n.data.images??[]),...response.images];
   store.stageDocument(docId,{content:JSON.stringify(finishNode(c,output.id,runId,{images,active:images.length-response.images.length,status:i===snapshot.params.count-1?'ready':'generating'}))});await store.flushDocument(docId);
  }
 }catch(e){failure=e;if(store.remoteVersion(docId)===remote){try{const c=readCanvas(store.currentDocument(docId)!.content);store.stageDocument(docId,{content:JSON.stringify(finishNode(c,output.id,runId,{status:abort.signal.aborted?'cancelled':'error',error:String(e)}))});await store.flushDocument(docId);}catch{/* Deleted/replaced nodes must not be recreated. */}}throw e;
 }finally{jobs.delete(key);notify();task.finish(failure);}})());
}
