import CourseTypeIcon from './CourseTypeIcon';
import RemoteImage from '../design-studio/RemoteImage';
import WebWorkspace,{type WebDraft} from '../course-web/WebWorkspace';
import WebPublication from '../course-web/WebPublication';
import {defaults as webDefaults} from '../course-web/model';
import {useVideoJob,videoJob} from './videoJobs';
import GenerationState from './GenerationState';
import {generateCourseCover,courseReady} from './cover';
import {useEffect,useMemo,useRef,useState} from 'react';
import {App,Button,Dropdown,Input,Modal,Select,Spin} from 'antd';
import {MenuFoldOutlined,MenuUnfoldOutlined,MoreOutlined,EditOutlined,DownloadOutlined,ZoomInOutlined,FileImageOutlined} from '@ant-design/icons';
import {ai,trackAiExecution} from '../ai/client';
import {beginTask,failTask,updateTask} from '../tasks/store';
import {registerSyncActivationBlocker} from '../documentLifecycle';
import {imageSource,referenceImage} from '../comics/images';
import {previewImageSource} from '../story-comic/previewImages';
import {useProjects,ProjectSection} from '../list-projects/Projects';
import {NavigationSection} from '../list-projects/NavigationSection';
import {styles,layouts,palettes,audiences,ratios,defaults,emptyContent,readContent,signature,validateConfig,topicTitle,validateCopy,type Copy,type Content,type Config} from './model';
import {runWorkflow} from './workflow';
import {examples,exampleContent} from './examples';
import {exportPage,exportZip,exportPdf,exportCover} from './export';
import * as store from './store';
import CourseIcon from './CourseIcon';
import ComicCanvas from '../story-comic/ComicCanvas';
import PrintPanel from '../story-comic/PrintPanel';
import Publication,{publicationPages} from './Publication';
import '../story-comic/story-comic.css';
import './course.css';
import WhiteboardWorkspace from '../course-whiteboard/WhiteboardWorkspace';
import {defaults as whiteboardDefaults,type Config as WhiteboardConfig} from '../course-whiteboard/model';
import AnimationWorkspace from '../course-animation/AnimationWorkspace';
import {defaults as animationDefaults,type AnimationConfig} from '../course-animation/model';
import '../course-animation/animation.css';
export function CardImage({src,alt,large=false}:{src:string;alt:string;large?:boolean}){
 if(src.startsWith('/course/'))return <RemoteImage src={src} alt={alt} loading={large?'eager':'lazy'} command="course_asset"/>;
 return <StoredCardImage src={src} alt={alt} large={large}/>;
}
function StoredCardImage({src,alt,large=false}:{src:string;alt:string;large?:boolean}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let live=true;setUrl('');setError('');void (large?imageSource(src):previewImageSource(src)).then(s=>{if(live)setUrl(s);}).catch(()=>{if(live)setError('图片读取失败');});return()=>{live=false;};},[src,large]);
 return url?<img src={url} alt={alt} decoding="async" draggable={false} onError={()=>{setUrl('');setError('图片无法显示');}}/>:<span role={error?'alert':'status'}>{error||'正在读取…'}</span>;
}
export default function CourseApp(){
 const {modal}=App.useApp(),projects=useProjects('app.course');
 const [,redraw]=useState(0),[id,setId]=useState<string|null>(null),[draft,setDraft]=useState(defaults),[collapsed,setCollapsed]=useState(false),[tab,setTab]=useState('偏好'),[example,setExample]=useState<string|null>(null),[localBusy,setBusy]=useState(false),[opening,setOpening]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<number|null>(null),[rename,setRename]=useState<{id:string;title:string}|null>(null);
 const coverPending=useRef(new Set<string>());
 const [mode,setMode]=useState<'cards'|'animation'|'whiteboard'|'web'>('cards'),[animationDraft,setAnimationDraft]=useState(()=>({topic:'',config:animationDefaults()}));
 const [webDraft,setWebDraft]=useState<WebDraft>(()=>({topic:'',config:webDefaults()}));
 const [whiteboardDraft,setWhiteboardDraft]=useState(()=>({topic:'',config:whiteboardDefaults()}));
 const active=useRef<string|null>(null),mounted=useRef(true),request=useRef(0),pending=useRef(false),controller=useRef<AbortController|null>(null),creating=useRef(false),creationProject=useRef<string|null>(null),draftRef=useRef(draft),composing=useRef(false),queued=useRef<(()=>void)|null>(null),compositionTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 draftRef.current=draft;
 const doc=id?store.currentDocument(id):undefined;
 const parsed=useMemo(()=>{try{return {content:doc?readContent(doc.content):undefined,corrupt:''};}catch(e){return {content:undefined,corrupt:String(e)};}},[doc?.content]);
 const content=parsed.content,config=content?.config??draft;const backgroundJob=useVideoJob(id),busy=localBusy||!!backgroundJob;
 const shown=content;
 const reference=example?exampleContent(example):undefined;
 const fail=(e:unknown)=>{if(mounted.current)setError(String(e));};
 const act=(p:Promise<unknown>)=>void p.catch(fail);
 const cancel=()=>{(videoJob(active.current)?.controller??controller.current)?.abort();};
 async function navigate(next:string|null,reset=false,projectId:string|null=null,exampleId:string|null=null,targetMode:'cards'|'animation'|'whiteboard'|'web'='cards'){
  if(composing.current){queued.current=()=>void navigate(next,reset,projectId,exampleId,targetMode);return;}
  const ticket=++request.current;pending.current=true;setOpening(true);if(videoJob(active.current)){controller.current=null;setBusy(false);}else cancel();
  try{if(active.current)await store.flushDocument(active.current);if(!mounted.current||ticket!==request.current)return;
   if(next)await store.loadDocument(next);if(!mounted.current||ticket!==request.current)return;
   if(next)store.activateDocument(next);active.current=next;setId(next);setExample(exampleId);setPreview(null);setError('');
   if(reset){creationProject.current=projectId;setDraft(defaults());setAnimationDraft({topic:'',config:animationDefaults()});setWhiteboardDraft({topic:'',config:whiteboardDefaults()});setWebDraft({topic:'',config:webDefaults()});}
   const loaded=next?readContent(store.currentDocument(next)!.content):undefined;setMode(loaded?.mode==='web'?'web':loaded?.mode==='whiteboard'?'whiteboard':loaded?.mode==='animation'?'animation':next?'cards':targetMode);
   setTab(loaded?.mode==='web'?((loaded.webPlan||videoJob(next))?'作品':'偏好'):loaded?.mode==='whiteboard'?((loaded.whiteboardPlan||videoJob(next))?'动画':'偏好'):loaded?.mode==='animation'?((loaded.animationPlan||videoJob(next))?'动画':'偏好'):exampleId?'知识卡片':loaded?.plan?'知识卡片':'偏好');return true;
  }catch(e){if(ticket===request.current)fail(e);}finally{if(ticket===request.current){pending.current=false;if(mounted.current)setOpening(false);}}
 }
 useEffect(()=>{mounted.current=true;const unsub=store.subscribe(()=>redraw(n=>n+1)),unblock=registerSyncActivationBlocker(()=>pending.current||composing.current);const ticket=++request.current;
  void store.refreshDocuments().then(()=>{if(!mounted.current||ticket!==request.current)return;const first=store.documentList().find(d=>d.id===store.lastDocumentId)??store.documentList()[0];if(first)void navigate(first.id);}).catch(fail);
  return()=>{mounted.current=false;++request.current;cancel();clearTimeout(compositionTimer.current);queued.current=null;unsub();unblock();};
 },[]);
 function patch(change:Partial<Config>){cancel();if(doc&&content)store.stageDocument(doc.id,{content:JSON.stringify({...content,config:{...content.config,...change}})});else setDraft(d=>({...d,...change}));}
 async function generate(onlyPage?:number,regenerate=false){
  if(controller.current||pending.current||creating.current||composing.current||parsed.corrupt)return;
  const source=content?structuredClone(content):{...emptyContent(),config:{...draftRef.current}};
  try{validateConfig(source.config);}catch(e){fail(e);return;}
  const abort=new AbortController(),ticket=request.current,projectId=creationProject.current;controller.current=abort;setBusy(true);setTab('知识卡片');setError('');
  const task=beginTask(abort,{toolId:'app.course',title:doc?.title||topicTitle(source.config.topic),stage:'正在检查生成服务…'});
  await trackAiExecution(abort,(async()=>{
   try{
    const caps=await ai.capabilities();if(abort.signal.aborted||ticket!==request.current||!mounted.current)return;
    if(!caps.text||!caps.imageGenerate||!caps.referenceImages||caps.maxReferences<1)throw Error('当前AI服务需支持文字、图片生成及至少1张参考图，请检查设置');
    let target=doc;
    if(!target){creating.current=true;pending.current=true;target=await store.createDocument();store.stageDocument(target.id,{title:topicTitle(source.config.topic),content:JSON.stringify(source)});await store.flushDocument(target.id);
     if(projectId)await projects.move(target.id,projectId);
     if(abort.signal.aborted||ticket!==request.current||!mounted.current)return;store.activateDocument(target.id);active.current=target.id;setId(target.id);setExample(null);pending.current=false;creating.current=false;
    }
    const targetId=target.id;coverPending.current.add(targetId);setTab('知识卡片');await store.flushDocument(targetId);const remote=store.remoteVersion(targetId);let expected=store.currentDocument(targetId)!.content;
    const valid=()=>mounted.current&&!abort.signal.aborted&&controller.current===abort&&active.current===targetId&&store.remoteVersion(targetId)===remote&&store.currentDocument(targetId)?.content===expected;
    const originalTitle=store.currentDocument(targetId)!.title;
    await runWorkflow(source,{valid,
     text:async prompt=>{const r=await ai.generate({toolId:'app.course',timeoutSeconds:600,messages:[{role:'user',content:prompt}]},abort.signal);if(r.saveError)throw Error(r.saveError);return r.text;},
     image:async(prompt,references)=>{const refs=await Promise.all(references.map(src=>referenceImage({src})));if(!valid())throw Error('作品已修改');const r=await ai.generate({toolId:'app.course',image:true,references:refs,messages:[{role:'user',content:prompt}]},abort.signal);if(r.saveError)throw Error(r.saveError);if(!r.images?.[0])throw Error('AI未返回图片');return r.images[0];},
     save:async value=>{if(!valid())throw Error('作品已变化，未覆盖新内容');const done=value.plan?.pages.filter(p=>p.image&&p.status==='ready').length??0;updateTask(abort.signal,{stage:value.job?.stage??'正在保存…',done,total:value.plan?.pages.length??source.config.count});expected=JSON.stringify(value);store.stageDocument(targetId,{content:expected,...(value.plan&&store.currentDocument(targetId)!.title===originalTitle&&originalTitle===topicTitle(source.config.topic)?{title:value.plan.title}:{})});await store.flushDocument(targetId);if(value.job?.status==='error')failTask(abort.signal,value.job.stage);}
    },abort.signal,onlyPage,regenerate);
   }catch(e){failTask(abort.signal,e);if(!abort.signal.aborted)fail(e);}
   finally{task.finish();if(controller.current===abort){controller.current=null;creating.current=false;if(ticket===request.current)pending.current=false;if(mounted.current)setBusy(false);}}
  })());
 }
 async function useExample(exampleId:string){
  if(composing.current){queued.current=()=>void useExample(exampleId);return;}
  if(pending.current||controller.current||creating.current)return;
  const next={...exampleContent(exampleId).config},projectId=active.current?null:creationProject.current,ticket=request.current+1;
  const success=await navigate(null);
  if(success&&mounted.current&&request.current===ticket&&active.current===null){creationProject.current=projectId;setDraft(next);setTab('偏好');}
 }
 async function createAnimationDocument(value:Content){const ticket=request.current;pending.current=true;try{const target=await store.createDocument();store.stageDocument(target.id,{title:topicTitle(value.config.topic),content:JSON.stringify(value)});await store.flushDocument(target.id);if(creationProject.current)await projects.move(target.id,creationProject.current);if(!mounted.current||request.current!==ticket)throw Error('已切换作品');store.activateDocument(target.id);active.current=target.id;setId(target.id);return store.currentDocument(target.id)!;}finally{if(request.current===ticket)pending.current=false;}}
 async function useAnimationExample(value:{topic:string;config:AnimationConfig}){if(composing.current){queued.current=()=>void useAnimationExample(value);return;}if(pending.current||controller.current)return;const ticket=request.current+1,projectId=active.current?null:creationProject.current;const success=await navigate(null,true,projectId,null,'animation');if(success&&request.current===ticket){setAnimationDraft(value);setTab('偏好');}}
 async function useWhiteboardExample(value:{topic:string;config:WhiteboardConfig}){if(composing.current){queued.current=()=>void useWhiteboardExample(value);return;}if(pending.current||controller.current)return;const ticket=request.current+1,projectId=active.current?null:creationProject.current;const success=await navigate(null,true,projectId,null,'whiteboard');if(success&&request.current===ticket){setWhiteboardDraft(value);setTab('偏好');}}
 async function useWebExample(value:WebDraft){if(composing.current){queued.current=()=>void useWebExample(value);return;}if(pending.current||controller.current)return;const ticket=request.current+1,projectId=active.current?null:creationProject.current;const success=await navigate(null,true,projectId,null,'web');if(success&&request.current===ticket){setWebDraft(value);setTab('偏好');}}
 async function generateCover(style?:string,instruction?:string){if(!id||!content||controller.current||pending.current||composing.current)return;const target=id,abort=new AbortController(),ticket=request.current;controller.current=abort;setBusy(true);setError('');const task=beginTask(abort,{toolId:'app.course',title:'生成作品封面',stage:'正在生成封面…'});let expected=store.currentDocument(target)!.content;const remote=store.remoteVersion(target);const valid=()=>mounted.current&&!abort.signal.aborted&&request.current===ticket&&active.current===target&&store.remoteVersion(target)===remote&&store.currentDocument(target)?.content===expected;
  await trackAiExecution(abort,(async()=>{try{await generateCourseCover(content,style,{valid,reference:src=>referenceImage({src}),image:async(prompt,references)=>{const r=await ai.generate({toolId:'app.course',image:true,references,messages:[{role:'user',content:prompt}]},abort.signal);if(r.saveError)throw Error(r.saveError);if(!r.images?.[0])throw Error('封面未返回图片');return r.images[0];},save:async c=>{if(!valid())throw Error('作品已变化');expected=JSON.stringify(c);store.stageDocument(target,{content:expected});await store.flushDocument(target);}},instruction);}catch(e){failTask(abort.signal,e);if(!abort.signal.aborted)fail(e);}finally{task.finish();if(controller.current===abort){controller.current=null;if(mounted.current)setBusy(false);}}})());
 }
 useEffect(()=>{if(id&&content&&!busy&&!opening&&content.job?.status==='done'&&courseReady(content)&&coverPending.current.has(id)){coverPending.current.delete(id);if(content.cover?.status!=='done')void generateCover();}},[id,content,busy,opening]);
 function updateCopy(copy:Copy){try{validateCopy(copy);if(!doc||!content||busy||opening)return;store.stageDocument(doc.id,{content:JSON.stringify({...content,copy})});}catch(e){fail(e);}}
 const backup=async(itemId:string)=>{const d=await store.ensureDocument(itemId);await exportZip(emptyContent(),d.title,JSON.stringify(d,null,2));};
 const row=(item:store.DocumentInfo)=><div className={`course-row ${id===item.id?'selected':''}`} key={item.id}><button className="course-row-name" aria-current={id===item.id?'page':undefined} title={item.title}
  onPointerDownCapture={e=>{delete e.currentTarget.dataset.down;if(e.isPrimary!==false&&e.pointerType==='mouse'&&e.button===0&&!e.altKey&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){if(!composing.current)e.preventDefault();e.currentTarget.dataset.down='true';void navigate(item.id);}}}
  onClick={e=>{const down=e.currentTarget.dataset.down;delete e.currentTarget.dataset.down;if(e.detail!==0&&down)return;void navigate(item.id);}}><span className="course-icon"><CourseTypeIcon mode={item.mode}/></span><span>{item.title}</span></button><Dropdown trigger={['click']} menu={{items:[...projects.menu(item.id),{key:'rename',label:'重命名'},{key:'backup',label:'导出作品备份'},{key:'delete',label:'删除',danger:true}],onClick:({key})=>{if(projects.handle(key,item.id))return;if(key==='rename')setRename({id:item.id,title:item.title});if(key==='backup')act(backup(item.id));if(key==='delete')modal.confirm({title:`删除“${item.title}”？`,content:'从列表移除，保留本地删除备份。',okText:'删除',cancelText:'取消',okButtonProps:{danger:true},onOk:async()=>{if(active.current===item.id)cancel();await store.deleteDocument(item.id);if(active.current===item.id)await navigate(null,true);}});}}}><button className="course-row-more" aria-label={`${item.title}更多操作`}><MoreOutlined/></button></Dropdown></div>;
 const pages=shown?.plan?.pages??[],complete=pages.length>0&&pages.every(p=>p.image&&p.status==='ready');
 const title=doc?.title??(mode==='web'?'交互网页':mode==='whiteboard'?'白板沙画':mode==='animation'?'动画教程':'知识卡片');
 const tabs=mode==='web'?['偏好','作品','发布']:mode!=='cards'?['偏好','动画','脚本','发布','下载']:['偏好','知识卡片','发布','下载','打印'];
 const savedError=id&&store.documentStatus(id).startsWith('保存失败')?store.documentStatus(id):'';
 const changed=content?.plan&&content.plannedConfig!==signature(config);
 return <section className="course-app" onCompositionStart={()=>{clearTimeout(compositionTimer.current);composing.current=true;}} onCompositionEnd={()=>{compositionTimer.current=setTimeout(()=>{composing.current=false;const action=queued.current;queued.current=null;action?.();},0);}}>
  {!collapsed&&<aside className="course-nav"><header className="course-heading"><span className="course-icon"><CourseIcon/></span><strong>做课程</strong><button className="course-fold" title="折叠导航" aria-label="折叠导航" onClick={()=>setCollapsed(true)}><MenuFoldOutlined/></button></header>
   <div className="course-create"><div className="course-group">创建</div>{([{mode:'cards',label:'知识卡片'},{mode:'whiteboard',label:'白板沙画'},{mode:'animation',label:'动画教程'},{mode:'web',label:'交互网页'}] as const).map(item=><button key={item.mode} className={`course-create-row ${!id&&mode===item.mode?'selected':''}`} title={`创建${item.label}`} onClick={()=>void navigate(null,true,null,null,item.mode)}><CourseTypeIcon mode={item.mode}/>{item.label}</button>)}</div>
   <div className="course-nav-scroll"><ProjectSection navigation={projects} items={store.documentList()} renderItem={row} activeId={id} onCreate={project=>void navigate(null,true,project,null,mode)}/><NavigationSection title="最近打开">{store.documentList().filter(d=>!projects.projectOf(d.id)).map(row)}{!store.documentList().some(d=>!projects.projectOf(d.id))&&<p>暂无</p>}</NavigationSection></div>
  </aside>}
  <main className="course-main"><header className="course-heading course-main-heading">{collapsed&&<button className="course-fold expand" aria-label="展开导航" title="展开导航" onClick={()=>setCollapsed(false)}><MenuUnfoldOutlined/></button>}<span className="course-icon"><CourseIcon/></span><strong>{title}</strong>{doc&&<button className="course-rename" title="重命名作品" aria-label="重命名作品" onClick={()=>setRename({id:doc.id,title:doc.title})}><EditOutlined/></button>}<nav className="story-tabs course-tabs" aria-label="作品内容">{tabs.map(t=><button key={t} aria-current={tab===t?'page':undefined} onClick={()=>setTab(t)}>{t}</button>)}</nav>{busy&&<Button size="small" onClick={cancel}>停止</Button>}</header>
   {(error||savedError||parsed.corrupt||store.documentWarnings().length>0)&&<div className="course-error" role="alert">{error||savedError||parsed.corrupt||store.documentWarnings().join('；')}{savedError&&id&&<Button size="small" onClick={()=>act(store.flushDocument(id))}>重试保存</Button>}{parsed.corrupt&&id&&<Button size="small" onClick={()=>act(backup(id))}>导出原文件备份</Button>}</div>}
   {opening&&<div className="course-opening" role="status"><Spin size="small"/> 正在打开…</div>}
   {mode==='web'?tab==='发布'?<section className="story-results course-results"><WebPublication id={id} content={content} disabled={busy||opening} onCover={(style,instruction)=>void generateCover(style,instruction)} onError={fail}/></section>:<WebWorkspace id={id} content={content} draft={webDraft} tab={tab} busy={busy} opening={opening||!!parsed.corrupt} onDraft={setWebDraft} onCreate={createAnimationDocument} isCurrent={target=>mounted.current&&active.current===target} onController={(c,owner)=>{if(c){controller.current=c;setBusy(true);setError('');}else if(controller.current===owner){controller.current=null;setBusy(false);}}} onTab={setTab} onUseExample={useWebExample} onError={fail}/>:tab==='发布'?<section className="story-results course-results"><Publication content={content??{...emptyContent(),mode:mode==='cards'?undefined:mode}} documentId={id??undefined} disabled={busy||opening} onChange={updateCopy} onCover={(style,instruction)=>void generateCover(style,instruction)} onError={fail}/></section>:mode==='whiteboard'?<WhiteboardWorkspace id={id} content={content} draft={whiteboardDraft} tab={tab} busy={busy} opening={opening||!!parsed.corrupt} onDraft={setWhiteboardDraft} onCreate={createAnimationDocument} isCurrent={target=>mounted.current&&active.current===target} onController={(c,owner)=>{if(c){controller.current=c;setBusy(true);setError('');}else if(controller.current===owner){controller.current=null;setBusy(false);}}} onTab={setTab} onUseExample={useWhiteboardExample} onError={fail}/>:mode==='animation'?<AnimationWorkspace id={id} content={content} draft={animationDraft} tab={tab} busy={busy} opening={opening||!!parsed.corrupt} onDraft={setAnimationDraft} onCreate={createAnimationDocument} isCurrent={target=>mounted.current&&active.current===target} onController={(c,owner)=>{if(c){controller.current=c;setBusy(true);setError('');}else if(controller.current===owner){controller.current=null;setBusy(false);}}} onTab={setTab} onUseExample={useAnimationExample} onError={fail}/>:tab==='打印'?<section className="story-results course-results has-print"><PrintPanel key={id??'draft'} pages={publicationPages(content??emptyContent())} title={title} subject="知识卡片" heading="把知识卡片印成学习手册" defaultNumbers={false} renderImage={p=><CardImage src={p.image!} alt={p.title}/>}/></section>:tab==='下载'?<div className="course-download"><h3>下载知识卡片</h3><p>图片、学习内容与生成提示词一起保留。</p><Button icon={<DownloadOutlined/>} disabled={!complete||busy} onClick={()=>act(exportZip(content!,title))}>下载全部 · ZIP</Button><Button disabled={!pages[0]?.image||busy} onClick={()=>act(exportCover(content!))}>下载封面</Button><Button disabled={!complete||busy} onClick={()=>act(exportPdf(content!,title))}>下载 PDF</Button><Button disabled={!id} onClick={()=>act(backup(id!))}>导出作品备份</Button><p>ZIP 包含按顺序命名的 PNG、发布文案、提示词及大纲。</p>{pages.map((p,i)=><div className="story-download-row" key={i}><span>{i===0?'封面':p.title}</span><Button size="small" disabled={!p.image} onClick={()=>act(exportPage(content!,i))}>下载本张</Button></div>)}</div>:tab==='知识卡片'?<>{changed&&<div className="course-notice">设置已改变，当前显示上一版卡片。重新生成后会保留旧版。</div>}<div className="course-progress"><span>{busy?(content?.cover?.status==='running'?'正在生成作品封面…':content?.job?.status==='running'?content.job.stage:'正在准备知识卡片…'):content?.job?.status==='running'?'上次生成已中断，已完成卡片仍保留':content?.job?.stage??'填写偏好后开始生成'}</span>{!busy&&(!complete||changed)&&<Button size="small" onClick={()=>act(generate())}>{changed?'生成新版本':'继续生成未完成卡片'}</Button>}</div>{busy&&!pages.length?<GenerationState kind="知识卡片" stage={content?.job?.status==='running'?content.job.stage:'正在准备知识卡片…'}/>:renderPages()}</>:<div className="course-studio"><aside className="course-config"><div className="course-fields"><label>课程内容<Input.TextArea aria-label="课程内容" placeholder="输入一个主题、一段知识或课程大纲…" rows={2} value={config.topic} maxLength={12000} disabled={busy||opening||!!parsed.corrupt} onChange={e=>patch({topic:e.target.value})}/></label>{field('学习对象','audience',audiences.map(x=>({value:x,label:x})))}{field('画面风格','style',styles)}{field('内容布局','layout',layouts)}{field('主题配色','palette',palettes)}{field('卡片数量（含封面与结尾）','count',[2,3,4,5,6,7,8,9,10].map(x=>({value:x,label:`${x} 张`})))}{field('画面比例','ratio',ratios.map(x=>({value:x,label:x})))}</div><footer className="course-generate"><Button type="primary" block disabled={opening||!!parsed.corrupt} loading={busy} onClick={()=>act(generate(undefined,!!content?.plan))}>{doc&&content?.plan?'重新生成知识卡片':'生成知识卡片'}</Button>{creationProject.current&&!doc&&<p>生成后加入所选项目</p>}</footer></aside><div className="course-gallery">
    {tab==='我的作品'?<><h3>我的作品</h3><div className="course-example-grid">{store.documentList().map(item=><WorkCard key={item.id} item={item} open={()=>void navigate(item.id)}/>)}</div>{!store.documentList().length&&<div className="course-empty">暂无作品</div>}</>:<><div className="course-gallery-title"><h3>作品参考</h3><span>{examples.length} 组主题 · 每组 5 张</span></div><div className="course-example-grid">{examples.map(x=><article className="course-reference" key={x.id}><button className="course-example" onClick={()=>setExample(x.id)}><div className="course-cover"><CardImage src={x.pages[0].image} alt={x.title}/><span className="course-example-badge">{x.pages.length} 张</span></div></button><div className="course-reference-heading"><button className="course-reference-title" title={x.title} onClick={()=>setExample(x.id)}>{x.title}</button><Button size="small" className="course-use-example" aria-label={`做${x.title}同款`} disabled={busy||opening||!!parsed.corrupt} onClick={()=>act(useExample(x.id))}>做同款</Button></div><p className="course-reference-meta">{styles.find(s=>s.value===x.style)?.label} · {x.audience}</p></article>)}</div><p className="course-example-note">点击预览内置参考作品的完整卡片。</p></>}
   </div></div>}
  </main>
  <Modal title={reference?.plan?.title??''} open={!!reference} footer={null} width={1100} onCancel={()=>setExample(null)} destroyOnHidden><div className="course-reference-results">{reference?.plan?.pages.map((page,i)=><div className="course-reference-image" key={i}><CardImage src={page.image!} alt={page.title} large/></div>)}</div></Modal>
  <Modal title={preview===null?'':pages[preview]?.title} open={preview!==null} footer={null} width={900} onCancel={()=>setPreview(null)} destroyOnHidden><div className="course-preview">{preview!==null&&pages[preview]?.image&&<CardImage src={pages[preview].image!} alt={pages[preview].title} large/>}</div></Modal>
  <Modal title="重命名作品" open={!!rename} okText="保存" cancelText="取消" onCancel={()=>setRename(null)} onOk={()=>act((async()=>{if(!rename)return;await store.ensureDocument(rename.id);store.stageDocument(rename.id,{title:rename.title});await store.flushDocument(rename.id);setRename(null);})())}><Input aria-label="作品名称" value={rename?.title??''} maxLength={120} onChange={e=>setRename(r=>r?{...r,title:e.target.value}:null)}/></Modal>
 </section>;
 function field(label:string,key: keyof Config,options:{value:string|number;label:string}[]){return <label>{label}<Select aria-label={label} value={config[key]} options={options} disabled={busy||opening||!!parsed.corrupt} onChange={value=>patch({[key]:value})}/></label>;}
 function renderPages(){const [w,h]=(content?.plannedConfigData?.ratio??config.ratio).split(':').map(Number);return pages.length?<ComicCanvas key={id??'draft'} ratio={w/h}>{pages.map((p,i)=><article className="course-card" key={i}><button className="course-card-art" disabled={!p.image} aria-label={`预览第${i+1}张：${p.title}`} onClick={()=>setPreview(i)} style={{aspectRatio:(content?.plannedConfigData?.ratio??config.ratio).replace(':','/')}}>{p.image?<CardImage src={p.image} alt={p.title}/>:<div className="course-placeholder">{busy&&p.status==='generating'?<Spin/>:<FileImageOutlined/>}<span>{p.error?'生成失败':busy?'等待生成':'尚未生成'}</span></div>}</button><footer className="course-card-title"><strong>{i+1}. {p.title}</strong><button aria-label={`放大第${i+1}张`} disabled={!p.image} onClick={()=>setPreview(i)}><ZoomInOutlined/></button></footer>{p.error&&<p className="course-error-inline">{p.error}</p>}<footer className="course-card-actions"><button disabled={!p.image} onClick={()=>act(exportPage(shown!,i))}><DownloadOutlined/>下载</button>{<button disabled={busy||!!changed} onClick={()=>act(generate(i))}>重新生成</button>}{p.history.length>0&&<button disabled={busy} onClick={()=>{const next=structuredClone(content!),page=next.plan!.pages[i],previous=page.history.pop()!;if(page.image)page.history.unshift(page.image);page.image=previous;page.status='ready';delete page.error;store.applyDocumentContent(id!,JSON.stringify(next));act(store.flushDocument(id!));}}>恢复上一版</button>}</footer></article>)}</ComicCanvas>:<div className="course-empty">还没有卡片，先填写课程内容。</div>;}
}
function WorkCard({item,open}:{item:store.DocumentInfo;open:()=>void}){
 const [image,setImage]=useState('');useEffect(()=>{let live=true;void store.ensureDocument(item.id).then(d=>{const src=readContent(d.content).plan?.pages[0]?.image;if(live)setImage(src??'');}).catch(()=>{});return()=>{live=false;};},[item.id,item.updatedAt]);
 return <button className="course-example" onClick={open}><div className="course-cover">{image?<CardImage src={image} alt={item.title}/>:<FileImageOutlined/>}</div><strong>{item.title}</strong></button>;
}
