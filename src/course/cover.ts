import {emptyContent,generationPrompt,styles,stylePolicy,type CoverContent} from '../covers/model';
import type {Content} from './model';
export type CourseCover=CoverContent & {status?:'running'|'done'|'error';error?:string;prompt?:string};
export const coverVersion=(c:Content)=>c.cover?.versions.find(v=>v.id===c.cover?.selectedVersion);
export const courseSubject=(c:Content)=>c.mode==='whiteboard'?'白板沙画':c.mode==='animation'?'动画教程':'知识卡片';
export const courseReady=(c:Content)=>c.mode==='whiteboard'?!!c.whiteboardPlan?.video:c.mode==='animation'?!!c.animationPlan?.video:!!c.plan?.pages.every(p=>p.image&&p.status==='ready');
export function coverConfig(c:Content,style?:string){const plan=c.animationPlan??c.whiteboardPlan??c.plan;const chosen=style??styles[Math.floor(Math.random()*styles.length)].number;return {...emptyContent(chosen).config,topic:c.config.topic,title:plan?.title??c.config.topic.slice(0,28),subtitle:plan?.summary.slice(0,60)??'',ratio:c.mode?'16:9':c.config.ratio,preserve:false,instruction:'这是教程作品封面。突出学习主题与清楚的视觉比喻，不标页码，不放无关文字。'};}
export async function generateCourseCover(source:Content,style:string|undefined,deps:{valid():boolean;reference(src:string):Promise<string>;image(prompt:string,refs:string[]):Promise<string>;save(c:Content):Promise<void>},instruction?:string){
 const c=structuredClone(source),check=()=>{if(!deps.valid())throw Error('作品已变化，封面未覆盖新内容');};
 const config=coverConfig(c,style);if(instruction?.trim()){if(instruction.length>4000)throw Error('修改意见过长');config.instruction+='\n修改意见：'+instruction.trim();}const policy=stylePolicy(config.style),prompt=generationPrompt(config,false);
 c.cover={...(c.cover??emptyContent(config.style)),config,status:'running',error:undefined,prompt};check();await deps.save(structuredClone(c));
 try{const refs=policy.reference?[await deps.reference(policy.style.image)]:[];check();const image=await deps.image(prompt,refs);check();if(!/^workstore-image:[a-f0-9]{64}$/.test(image))throw Error('未返回已保存的封面图片');const id=crypto.randomUUID();c.cover.versions.push({id,image,config,prompt,createdAt:Date.now()});c.cover.selectedVersion=id;c.cover.status='done';await deps.save(c);return c;
 }catch(e){if(deps.valid()){c.cover.status='error';c.cover.error=String(e).slice(0,800);await deps.save(c);}throw e;}
}
