import {voiceProfile} from '../course-animation/model';
import {parsePlan,planPrompt,imagePrompt,inspectionPrompt,parseInspection,annotate,toSrt,validatePlan,type Config,type Plan,type Region} from './model';
export type Source={topic:string;config:Config;plan?:Plan;prompt?:string};
export type Deps={text(prompt:string):Promise<string>;prepare(plan:Plan):Promise<Plan>;image(prompt:string):Promise<string>;dimensions(image:string):Promise<{width:number;height:number;regions?:Region[]}>;inspect(prompt:string,image:string):Promise<string>;render(plan:Plan):Promise<string>;save(source:Source,stage:string):Promise<void>;valid():boolean};
/** No approval gates: durable script/SRT, actual-image inspection, then exact masks. */
export async function runWorkflow(input:Source,deps:Deps,signal:AbortSignal,skill:string){let c=structuredClone(input);const check=()=>{if(signal.aborted||!deps.valid())throw Error('已停止或作品已变化，已保存内容保留');};const save=async(stage:string)=>{check();await deps.save(structuredClone(c),stage);check();};
 if(!c.plan){c.prompt=planPrompt(c.topic,c.config,skill);await save('正在自动编写讲解内容…');let raw=await deps.text(c.prompt);check();try{c.plan=parsePlan(raw,c.config);}catch(e){raw=await deps.text(`${c.prompt}\n上次输出未通过校验：${String(e)}。修正并只返回完整JSON：\n${raw.slice(0,30000)}`);check();c.plan=parsePlan(raw,c.config);}await save('讲解与SRT已保存，正在制作配音…');}
 const plan=c.plan!;validatePlan(plan,c.config);
 if(plan.scenes.some(s=>!s.captions||(c.config.voice?(!s.audio||s.audioVoice!==voiceProfile(c.config)):!!s.audio))){c.plan=await deps.prepare(plan);check();c.plan.srt=toSrt(c.plan);for(let i=0;i<c.plan.scenes.length;i++){const s=c.plan.scenes[i];if(s.annotation){const a=s.annotation;s.annotation=annotate(s,i,a.canvas.width,a.canvas.height,a.elements.map(e=>e.region));}}await save('配音与SRT已完成，开始绘制场景…');}
 for(let i=0;i<c.plan!.scenes.length;i++){const s=c.plan!.scenes[i];if(s.image&&s.annotation&&s.inspection)continue;let passed=false,critique='';for(let attempt=0;attempt<4;attempt++){
   s.imagePrompt=imagePrompt(s,c.config)+(attempt&&!c.config.style?'\n自动修正采用纯灰色铅笔线稿：所有主体、光束、光斑、箭头及阴影均仅灰色，主体内部保持纸底色，不使用任何彩色填充。四个主体向各自象限中心收拢，距中线至少画布尺寸的10%。':'')+(critique?`\n修正上一张实际检查发现的问题：${critique}`:'');await save(`正在生成手绘线稿 ${i+1}/${c.plan!.scenes.length}${attempt?'（自动修正）':''}…`);
   let image:string;try{image=await deps.image(s.imagePrompt);check();}catch(e){check();critique=String(e);await save(`绘图服务暂未完成，正在自动重试 ${attempt+1}/4…`);continue;}if(s.image)(s.candidates??=[]).push(s.image);s.image=image;delete s.annotation;delete s.inspection;await save(`正在检查实际源图 ${i+1}/${c.plan!.scenes.length}…`);
   let dimensions,inspection;try{dimensions=await deps.dimensions(image);check();inspection=parseInspection(await deps.inspect(inspectionPrompt(s,dimensions.width,dimensions.height,c.config),image));check();}catch(e){check();critique=String(e);continue;}
   if(!inspection.ok){critique=inspection.reason;continue;}
   try{s.annotation=annotate(s,i,dimensions.width,dimensions.height,dimensions.regions);s.annotation.elements.forEach((e,k)=>e.label=inspection.subjects[k].slice(0,28));s.inspection=inspection.reason;validatePlan(c.plan!,c.config);}catch(e){critique=String(e);delete s.annotation;continue;}
   await save(`分区与字幕时序已校验 ${i+1}/${c.plan!.scenes.length}`);passed=true;break;
  }if(!passed)throw Error(`第${i+1}幕线稿自动校验失败，已保留讲解与SRT，可继续制作。${critique}`);
 }
 await save('正在按字幕逐笔绘制并合并视频…');const video=await deps.render(c.plan!);check();c.plan!.video=video;await save('白板沙画已完成');return c;
}
