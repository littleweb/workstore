import {useSyncExternalStore} from 'react';
import * as store from './store';
import {readContent} from './model';
import {generateCourseCover} from './cover';
import {ai} from '../ai/client';
import {referenceImage} from '../comics/images';
import {updateTask} from '../tasks/store';
type Job={controller:AbortController;stage:string;progress:number};
const jobs=new Map<string,Job>(),listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(f=>f());
export const videoJob=(id:string|null)=>id?jobs.get(id):undefined;
export function useVideoJob(id:string|null){return useSyncExternalStore(f=>{listeners.add(f);return()=>{listeners.delete(f);};},()=>videoJob(id));}
export function bindVideoJob(id:string,controller:AbortController,stage:string){if(jobs.has(id))throw Error('作品正在生成，请等待完成');jobs.set(id,{controller,stage,progress:0});emit();}
export function updateVideoJob(id:string|null,controller:AbortController,stage:string,progress=0){if(!id||jobs.get(id)?.controller!==controller)return;jobs.set(id,{controller,stage,progress});updateTask(controller.signal,{stage,done:progress,total:100});emit();}
export function finishVideoJob(id:string|null,controller:AbortController){if(id&&jobs.get(id)?.controller===controller){jobs.delete(id);emit();}}
export async function generateVideoCover(id:string,controller:AbortController){
 const source=readContent(store.currentDocument(id)!.content),remote=store.remoteVersion(id);let expected=store.currentDocument(id)!.content;
 const valid=()=>!controller.signal.aborted&&store.remoteVersion(id)===remote&&store.currentDocument(id)?.content===expected;
 updateVideoJob(id,controller,'正在生成作品封面…');
 await generateCourseCover(source,undefined,{valid,reference:src=>referenceImage({src}),image:async(prompt,references)=>{const result=await ai.generate({toolId:'app.course',image:true,references,messages:[{role:'user',content:prompt}]},controller.signal);if(result.saveError)throw Error(result.saveError);if(!result.images?.[0])throw Error('封面未返回图片');return result.images[0];},save:async value=>{if(!valid())throw Error('作品已变化');expected=JSON.stringify(value);store.stageDocument(id,{content:expected});await store.flushDocument(id);}});
 updateVideoJob(id,controller,'作品及封面已完成',100);
}
