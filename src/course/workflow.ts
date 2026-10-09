import {artPrompt,engine,parsePlan,planningPrompt,signature,validateConfig,type Content} from './model';
export type Dependencies={text(prompt:string):Promise<string>;image(prompt:string,refs:string[]):Promise<string>;save(c:Content):Promise<void>;valid():boolean};
/** Serialize durable checkpoints; only network work overlaps. Cover anchors the series. */
export async function runWorkflow(source:Content,deps:Dependencies,signal:AbortSignal,onlyPage?:number,regenerate=false){
  validateConfig(source.config);let c=structuredClone(source),fatal:unknown,tail=Promise.resolve();
  const check=()=>{if(fatal)throw fatal;if(signal.aborted||!deps.valid())throw Error('已停止生成或作品已变化，保留已完成卡片');};
  const save=(change:()=>void,stage:string|(()=>string),status:'running'|'done'|'error'='running')=>{
    const next=tail.then(async()=>{check();change();c.job={status,stage:typeof stage==='function'?stage():stage};await deps.save(structuredClone(c));check();});tail=next.catch(e=>{fatal=e;});return next;
  };
  if(regenerate||c.plannedConfig!==signature(c.config)){
    if(onlyPage!==undefined)throw Error('设置已改变，请先生成完整作品');
    if(c.plan){const {history,...old}=c;c.history.push({...old,config:structuredClone(c.plannedConfigData??c.config)});}
    c={version:1,config:c.config,history:c.history};
  }
  try{
    if(!c.plan){
      await save(()=>{},'正在规划知识卡片…');const prompt=planningPrompt(c.config);let raw=await deps.text(prompt);check();
      let plan;try{plan=parsePlan(raw,c.config);}catch(e){await save(()=>{},'正在校正规划格式…');raw=await deps.text(`${prompt}\n上次输出无效：${String(e)}。精简修复，不机械截断。只返回完整JSON。\n${raw.slice(0,16000)}`);check();plan=parsePlan(raw,c.config);}
      await save(()=>{c.plan=plan;c.engine=engine;c.plannedConfig=signature(c.config);c.plannedConfigData=structuredClone(c.config);},'正在准备画面…');
    }
    const pages=c.plan!.pages;
    if(onlyPage!==undefined&&(!Number.isInteger(onlyPage)||onlyPage<0||onlyPage>=pages.length))throw Error('卡片编号无效');
    const targets=pages.map((p,i)=>({p,i})).filter(({p,i})=>onlyPage===undefined?!p.image||p.status==='error'||!!p.error:i===onlyPage);
    // The entire final group is on disk before even the anchor request.
    await save(()=>{for(let i=0;i<pages.length;i++)pages[i].prompt=artPrompt(c,i);for(const {p} of targets){p.status='queued';delete p.error;}},'提示词已保存，准备生成封面…');
    const generate=async(i:number)=>{
      for(let attempt=0;attempt<2;attempt++){
        await save(()=>{pages[i].status='generating';delete pages[i].error;},`正在生成第${i+1}/${pages.length}张${attempt?'（重试）':''}…`);
        let image:string;
        try{image=await deps.image(pages[i].prompt!,i===0?[]:[pages[0].image!]);check();}
        catch(e){check();await save(()=>{pages[i].status='error';pages[i].error=String(e);},`第${i+1}张生成失败${attempt?'，可稍后重试':'，准备重试'}…`);continue;}
        await save(()=>{const p=pages[i];if(p.image)p.history.push(p.image);p.image=image;p.status='ready';delete p.error;},()=>`已完成 ${pages.filter(p=>p.image&&p.status==='ready').length}/${pages.length} 张`);return;
      }
    };
    if(targets.some(t=>t.i===0))await generate(0);
    check();if(!pages[0].image||pages[0].status==='error')throw Error('封面未完成，后续卡片等待统一视觉参考');
    const remaining=targets.filter(t=>t.i!==0);let cursor=0;
    const results=await Promise.allSettled(Array.from({length:Math.min(2,remaining.length)},async()=>{while(cursor<remaining.length){check();await generate(remaining[cursor++].i);}}));
    const rejected=results.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(rejected)throw rejected.reason;
    check();const failed=pages.some(p=>!p.image||p.status==='error');await save(()=>{},failed?'部分卡片失败，可继续生成未完成卡片':'全部卡片已完成',failed?'error':'done');
  }catch(e){await tail;if(!fatal&&!signal.aborted&&deps.valid())await save(()=>{},String(e),'error');throw e;}
}
