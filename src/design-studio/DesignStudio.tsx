import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {App,Card,Dropdown,Input,Modal,Spin,Tooltip} from 'antd';
import {ArrowLeftOutlined,MenuFoldOutlined,MenuUnfoldOutlined,ExperimentOutlined,ShoppingOutlined,BulbOutlined,AppstoreOutlined,CameraOutlined,HomeOutlined,PictureOutlined,PlusOutlined,MoreOutlined,DownloadOutlined,CloseOutlined,ReloadOutlined,CopyOutlined,FireOutlined,ApartmentOutlined} from '@ant-design/icons';
import {ai,trackAiExecution} from '../ai/client';
import {beginTask,updateTask} from '../tasks/store';
import {writeText} from '@tauri-apps/plugin-clipboard-manager';
import {native} from '../workspace';
import {registerSyncActivationBlocker} from '../documentLifecycle';
import * as store from './store';
import {features,categories,emptyContent,readContent,validateGeneration,buildPrompt,finishWork,clearedConfig,uploadLimit,isAnalysis,type Feature,type Config,type Content,type Work} from './model';
import {imageSource,uploadImage,reference,cropImage,clipboardImageFile,hasClipboardImage} from './images';
import {downloadImage,exportBackup} from './export';
import {DesignCanvas} from './canvas/DesignCanvas';
import {isCanvas} from './canvas/model';
import {ExampleGallery} from './ExampleGallery';
import RemoteImage from './RemoteImage';
import './design-studio.css';
const recommendationCategory='爆款推荐';
function pickRecommendations(){
 const pool=[...features];
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 return pool.slice(0,15);
}
const icons=[FireOutlined,ShoppingOutlined,BulbOutlined,AppstoreOutlined,CameraOutlined,HomeOutlined,PictureOutlined];
function ImageView({src,alt,onClick,loading}:{src:string;alt:string;onClick?:()=>void;loading?:'lazy'|'eager'}){
 if(src.startsWith('/design-studio/'))return <RemoteImage src={src} alt={alt} onClick={onClick} loading={loading}/>;
 return <StoredImageView src={src} alt={alt} onClick={onClick}/>;
}
function StoredImageView({src,alt,onClick}:{src:string;alt:string;onClick?:()=>void}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let alive=true;setUrl('');setError('');void imageSource(src).then(value=>{if(alive)setUrl(value);}).catch(e=>{if(alive)setError(String(e));});return()=>{alive=false;};},[src]);
 return error?<span role="alert">图片读取失败：{error}</span>:url?<img src={url} alt={alt} loading="lazy" onClick={onClick}/>:<span className="ds-hint">正在读取图片…</span>;
}
export default function DesignStudio(){
 const {message}=App.useApp();
 const [recommended]=useState(pickRecommendations);
 const [docs,setDocs]=useState<store.DocumentInfo[]>([]),[id,setId]=useState<string|null>(null),[category,setCategory]=useState(recommendationCategory),[page,setPage]=useState<'catalog'|'editor'|'canvas'>('catalog'),[tab,setTab]=useState<'examples'|'works'>('examples'),[collapsed,setCollapsed]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[stage,setStage]=useState(''),[preview,setPreview]=useState<{src:string;title:string}|null>(null);
 const [,redraw]=useState(0),mounted=useRef(true),selection=useRef(0),creating=useRef(false),controller=useRef<AbortController|null>(null),composing=useRef(false),queued=useRef<(()=>void)|null>(null),pendingFeature=useRef<Feature|null>(null),activeWorks=useRef(new Set<string>());
 const [importStatus,setImportStatus]=useState<{index:number;text:string}|null>(null);
 const [clipboardAvailable,setClipboardAvailable]=useState(false);
 const readingClipboard=useRef(false);
 const drafts=useRef(new Map<string,Content>());
 const [draft,setDraft]=useState<Content|undefined>();
 if(draft&&!id)drafts.current.set(draft.featureId,draft);
 const doc=id?store.currentDocument(id):undefined;
 const workDocs=docs.filter(d=>!isCanvas(store.currentDocument(d.id)?.content||''));
 let content:Content|undefined,contentError='';try{if(doc?.content)content=readContent(doc.content);else content=draft;}catch(e){contentError=String(e);}
 const feature=features.find(f=>f.id===content?.featureId),config=content?.config;
 useEffect(()=>{let active=true;setClipboardAvailable(false);if(page==='editor'&&feature?.fields.some(field=>field.type==='upload'))void hasClipboardImage().then(found=>{if(active)setClipboardAvailable(found);});return()=>{active=false;};},[page,feature?.id,id]);
 const showError=(e:unknown)=>{if(mounted.current)setError(String(e));};
 const syncList=()=>{setDocs(store.documentList());redraw(x=>x+1);};
 useEffect(()=>{mounted.current=true;const unsub=store.subscribe(syncList);void (async()=>{await store.refreshDocuments();for(const d of store.documentList())await store.ensureDocument(d.id);if(mounted.current)syncList();})().catch(showError);const unblock=registerSyncActivationBlocker(()=>composing.current);return()=>{mounted.current=false;selection.current++;controller.current?.abort();unsub();unblock();};},[]);
 function transition(run:()=>void){if(composing.current){queued.current=run;return;}run();}
 function compositionEnd(){composing.current=false;const action=queued.current;queued.current=null;if(action)setTimeout(action,0);}
 async function openDocument(target:string,origin?:string){
  const ticket=++selection.current;setLoading(true);setError('');
  try{if(id)await store.flushDocument(id);await store.loadDocument(target);if(!mounted.current||ticket!==selection.current)return;store.activateDocument(target);const c=readContent(store.currentDocument(target)!.content);setId(target);setCategory(origin??features.find(f=>f.id===c.featureId)!.category);setPage('editor');setTab(c.works.some(w=>activeWorks.current.has(w.id))?'works':'examples');}
  catch(e){showError(e);}finally{if(mounted.current&&ticket===selection.current)setLoading(false);}
 }
 async function create(feature:Feature){
  if(creating.current)return;creating.current=true;setLoading(true);const ticket=++selection.current;
  try{if(id)await store.flushDocument(id);if(!mounted.current||ticket!==selection.current)return;setDraft(drafts.current.get(feature.id)??emptyContent(feature.id));setId(null);setPage('editor');setTab('examples');setError('');}
  catch(e){showError(e);}finally{creating.current=false;if(mounted.current&&ticket===selection.current)setLoading(false);const pending=pendingFeature.current;pendingFeature.current=null;if(pending&&mounted.current)openFeature(pending);}
 }
 function openFeature(f:Feature){transition(()=>{if(creating.current){pendingFeature.current=f;selection.current++;return;}const existing=workDocs.find(d=>{try{return readContent(store.currentDocument(d.id)?.content||'').featureId===f.id;}catch{return false;}});void (existing?openDocument(existing.id,category):create(f));});}
 function openCategory(name:string){transition(()=>{pendingFeature.current=null;selection.current++;setCategory(name);setPage('catalog');setLoading(false);});}
 function updateConfig(patch:Partial<Config>){if(uploading||importStatus)return;if(!doc){setDraft(current=>current?{...current,config:{...current.config,...patch}}:current);return;}try{const current=readContent(store.currentDocument(doc.id)!.content);store.stageDocument(doc.id,{content:JSON.stringify({...current,config:{...current.config,...patch}})});}catch(e){showError(e);}}
 function value(index:number,value:string){updateConfig({values:{...config!.values,[index]:value}});}
 async function addFiles(index:number,files:FileList|File[]|null,fromClipboard=false){
  if(!files||!feature||!content||uploading||(readingClipboard.current&&!fromClipboard))return;if(!doc){const captured=draft,ticket=selection.current;setUploading(true);try{const total=[...(content.config.uploads[index]||[])];if(files.length>uploadLimit(feature.fields[index])-total.length)throw Error('上传图片数量超出限制');for(const file of Array.from(files))total.push(await uploadImage(file,text=>{if(mounted.current)setImportStatus({index,text});}));if(mounted.current&&ticket===selection.current)setDraft(current=>current===captured?{...current!,config:{...current!.config,uploads:{...current!.config.uploads,[index]:total}}}:current);}catch(e){showError(e);}finally{setUploading(false);setImportStatus(null);}return;}const target=doc.id,captured=doc.content,remote=store.remoteVersion(target);setUploading(true);setError('');
  try{const current=readContent(captured);const total=[...(current.config.uploads[index]||[])];const remaining=uploadLimit(feature.fields[index])-total.length;if(files.length>remaining)throw Error('此项最多上传'+uploadLimit(feature.fields[index])+'张图片');for(const file of Array.from(files))total.push(await uploadImage(file,text=>{if(mounted.current)setImportStatus({index,text});}));const latest=readContent(store.currentDocument(target)!.content);if(JSON.stringify(latest.config)!==JSON.stringify(current.config)||store.remoteVersion(target)!==remote)throw Error('上传期间配置已变化，请重新添加图片');store.stageDocument(target,{content:JSON.stringify({...latest,config:{...latest.config,uploads:{...latest.config.uploads,[index]:total}}})});await store.flushDocument(target);}
  catch(e){showError(e);}finally{if(mounted.current){setUploading(false);setImportStatus(null);}}
 }
 async function pasteImage(index:number){
  if(uploading||readingClipboard.current)return;
  readingClipboard.current=true;setError('');setImportStatus({index,text:'正在读取剪贴板…'});const ticket=selection.current;
  try{const file=await clipboardImageFile(text=>{if(mounted.current&&ticket===selection.current)setImportStatus({index,text});});if(mounted.current&&ticket===selection.current)await addFiles(index,[file],true);}
  catch(e){if(mounted.current&&ticket===selection.current)showError('无法粘贴图片：'+String(e));}
  finally{readingClipboard.current=false;if(mounted.current)setImportStatus(null);}
 }
 async function copyPrompt(prompt:string){
  try{if(native)await writeText(prompt);else await navigator.clipboard.writeText(prompt);message.success('提示词已复制');}catch(e){showError(e);}
 }
 async function generate(previous?:Work){
  if(!feature||!content||busy||uploading||importStatus||controller.current||creating.current)return;
  if(composing.current){queued.current=()=>void generate(previous);return;}
  const f=feature,current=doc?readContent(store.currentDocument(doc.id)!.content):content;
  const submittedConfig=structuredClone(previous?.config||current.config);
  const total=previous?1:f.quantity?submittedConfig.quantity:1;
  if(previous)submittedConfig.quantity=1;
  try{validateGeneration(f,submittedConfig);if(current.works.length+total>200)throw Error('此功能最多保存200个结果，请先导出备份');}catch(e){showError(e);return;}
  let targetDoc=doc;
  if(!targetDoc){creating.current=true;setLoading(true);const ticket=selection.current;try{
   if(f.title!=='一键裁剪图片'){const caps=await ai.capabilities();if(!isAnalysis(f)&&!caps.imageGenerate)throw Error('当前AI服务不支持生图');const refs=Object.values(submittedConfig.uploads).flat();if(refs.length&&(!caps.referenceImages||refs.length>caps.maxReferences))throw Error('当前AI服务不支持这些参考图片');}
   if(!mounted.current||ticket!==selection.current)return;
   targetDoc=await store.createDocument();store.stageDocument(targetDoc.id,{title:f.title,content:JSON.stringify(current)});await store.flushDocument(targetDoc.id);
   if(!mounted.current||ticket!==selection.current)return;store.activateDocument(targetDoc.id);setId(targetDoc.id);
  }catch(e){showError(e);return;}finally{creating.current=false;setLoading(false);}}
  const target=targetDoc.id,remote=store.remoteVersion(target);
  const prompt=previous?.prompt||buildPrompt(f,submittedConfig);
  const works:Work[]=Array.from({length:total},(_,n)=>({id:crypto.randomUUID(),createdAt:Date.now(),name:`${f.title} · ${current.works.length+n+1}`,config:submittedConfig,prompt,images:[],text:'',status:'generating'}));
  const abort=new AbortController();controller.current=abort;works.forEach(w=>activeWorks.current.add(w.id));
  setBusy(true);setError('');setTab('works');setStage('正在准备…');
  const submitted=JSON.stringify({...current,config:clearedConfig(),works:[...works,...current.works]});
  store.stageDocument(target,{content:submitted});
  const card=beginTask(abort,{toolId:'app.design',title:targetDoc.title,stage:'正在准备参考图片…'});let failure:unknown,accepted=false;
  await trackAiExecution(abort,(async()=>{try{
   await store.flushDocument(target);accepted=true;
   const valid=()=>{if(abort.signal.aborted)throw Error('已停止生成');if(!mounted.current)throw Error('工具已关闭');if(store.remoteVersion(target)!==remote)throw Error('作品已同步，生成已停止，当前内容保留');};valid();
   const refs=Object.values(submittedConfig.uploads).flat();
   if(f.title!=='一键裁剪图片'){const caps=await ai.capabilities();valid();if(!isAnalysis(f)&&!caps.imageGenerate)throw Error('当前AI服务不支持生图，请在设置中选择Codex');if(refs.length&&(!caps.referenceImages||refs.length>caps.maxReferences))throw Error('当前AI服务不支持这些参考图片，请减少数量或选择Codex');}
   const references=f.title==='一键裁剪图片'?[]:await Promise.all(refs.map(reference));valid();
   for(let n=0;n<total;n++){
    valid();const status=`${isAnalysis(f)?'正在分析图片':f.title==='一键裁剪图片'?'正在裁剪':'正在生成'} ${n+1}/${total}`;setStage(status);updateTask(abort.signal,{stage:status,done:n,total});
    let images:string[]=[],text='';
    if(f.title==='一键裁剪图片'){const ratio=Object.values(submittedConfig.values).find(x=>/\d+:\d+/.test(x))!;images=[await cropImage(refs[0],ratio,submittedConfig.focusX,submittedConfig.focusY)];}
    else {const result=await ai.generate({toolId:'app.design',record:true,image:!isAnalysis(f),vision:isAnalysis(f),references,messages:[{role:'user',content:prompt}]},abort.signal);if(result.saveError)throw Error('结果保存失败：'+result.saveError);images=result.images||[];text=result.text;if(!isAnalysis(f)&&(!images.length||images.some(x=>!/^workstore-image:[0-9a-f]{64}$/.test(x))))throw Error('AI没有返回已保存的图片');}
    valid();const next=finishWork(store.currentDocument(target)!.content,remote,store.remoteVersion(target),works[n],{status:'ready',images,text});store.stageDocument(target,{content:next});await store.flushDocument(target);valid();updateTask(abort.signal,{done:n+1,total});
   }
   if(mounted.current)message.success('作品已保存');
  }catch(e){failure=e;
   // Before durable submission, restore the draft only if no newer input exists.
   if(!accepted && store.currentDocument(target)?.content===submitted && store.remoteVersion(target)===remote){store.stageDocument(target,{content:JSON.stringify(current)});}
   else if(store.remoteVersion(target)===remote){
    try{let raw=store.currentDocument(target)!.content;for(const work of works){if(readContent(raw).works.find(w=>w.id===work.id)?.status==='generating')raw=finishWork(raw,remote,store.remoteVersion(target),work,{status:abort.signal.aborted?'cancelled':'error',error:abort.signal.aborted?'已停止生成':String(e)});}store.stageDocument(target,{content:raw});await store.flushDocument(target);}catch(saveError){if(mounted.current)showError(saveError);}
   }
   if(!abort.signal.aborted)showError(e);
  }finally{works.forEach(w=>activeWorks.current.delete(w.id));card.finish(failure);if(controller.current===abort){controller.current=null;if(mounted.current){setBusy(false);setStage('');}}}})());
 }
 async function rename(d:store.DocumentInfo){let title=d.title;Modal.confirm({title:'重命名作品',icon:null,content:<Input defaultValue={title} maxLength={120} onChange={e=>title=e.target.value}/>,okText:'保存',cancelText:'取消',onOk:async()=>{await store.ensureDocument(d.id);store.stageDocument(d.id,{title});await store.flushDocument(d.id);}});}
 const row=(d:store.DocumentInfo)=><div className={'ds-recent-row'+(page==='editor'&&d.id===id?' selected':'')} key={d.id}><button onClick={()=>transition(()=>void openDocument(d.id))} title={d.title}><PictureOutlined/><span>{d.title}</span></button><Dropdown trigger={['click']} menu={{items:[{key:'rename',label:'重命名'},{key:'backup',label:'导出备份'}],onClick:({key})=>{if(key==='rename')void rename(d);else void store.ensureDocument(d.id).then(()=>exportBackup(store.currentDocument(d.id)!)).catch(showError);}}}><button className="ds-more" aria-label={d.title+'更多操作'}><MoreOutlined/></button></Dropdown></div>;
 return <div className="ds-app" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={compositionEnd}>
 {!collapsed&&<aside className="ds-nav"><header className="ds-heading"><ExperimentOutlined/><strong>设计室</strong><button aria-label="折叠导航" title="折叠导航" onClick={()=>setCollapsed(true)}><MenuFoldOutlined/></button></header><div className="ds-nav-body"><section>{[recommendationCategory,...categories].map((name,i)=>{const Icon=icons[i],count=name===recommendationCategory?recommended.length:features.filter(f=>f.category===name).length;return <button key={name} aria-label={name} className={'ds-category'+(name===category&&page!=='canvas'?' selected':'')} onClick={()=>openCategory(name)}><Icon/><span className="ds-category-name">{name}</span><span className="ds-scene-count">{count} 种场景</span></button>;})}<button aria-label="设计画布" className={'ds-category'+(page==='canvas'?' selected':'')} onClick={()=>transition(()=>{selection.current++;setPage('canvas');setError('');})}><ApartmentOutlined/><span>设计画布</span></button></section><section className="ds-recents"><h3>最近打开</h3>{workDocs.length?workDocs.map(row):<p>暂无</p>}</section></div></aside>}
 <main className="ds-workspace">{page==='catalog'&&<header className="ds-bar">{collapsed&&<button aria-label="展开导航" title="展开导航" onClick={()=>setCollapsed(false)}><MenuUnfoldOutlined/></button>}<strong>{category}</strong></header>}
 {(error||contentError||store.documentWarnings().length>0)&&<div className="ds-error" role="alert">{error||contentError||store.documentWarnings().join('；')}<button onClick={()=>{setError('');void store.refreshDocuments().catch(showError);}}>刷新列表</button>{doc&&<button onClick={()=>void exportBackup(doc).catch(showError)}>导出备份</button>}</div>}
 {doc&&store.documentStatus(doc.id).startsWith('保存失败')&&<div role="alert" className="ds-error">{store.documentStatus(doc.id)}<button onClick={()=>void store.flushDocument(doc.id).catch(showError)}>重试保存</button></div>}
 {loading&&<div className="ds-hint ds-loading">正在打开…</div>}
 <DesignCanvas visible={page==='canvas'} collapsed={collapsed} onExpand={()=>setCollapsed(false)}/>{page==='canvas'?null:page==='catalog'?<div className="ds-catalog"><div className="ds-grid">{(category===recommendationCategory?recommended:features.filter(f=>f.category===category)).map(f=><button key={f.id} className="ds-feature" onClick={()=>openFeature(f)}><ImageView src={f.cover} alt={f.title}/><div><strong>{f.title}</strong><p title={f.description}>{f.description}</p></div></button>)}</div></div>:feature&&config&&content?<div className="ds-editor"><section className="ds-config"><header className="ds-bar ds-config-bar">{collapsed&&<button aria-label="展开导航" title="展开导航" onClick={()=>setCollapsed(false)}><MenuUnfoldOutlined/></button>}<button aria-label="返回功能列表" title="返回功能列表" onClick={()=>openCategory(category)}><ArrowLeftOutlined/></button><strong title={doc?.title||feature.title}>{doc?.title||feature.title}</strong></header><div className="ds-fields"><p className="ds-hint">{feature.description}</p>{feature.fields.map((field,index)=><div className="ds-field" key={index}><label htmlFor={'ds-value-'+index}>{field.label}</label>{field.type==='upload'?<><div className="ds-upload" tabIndex={0} role="group" aria-label={field.label+'，支持粘贴图片'} onKeyDown={e=>{if(native&&(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='v'){e.preventDefault();void pasteImage(index);}}} onPaste={e=>{const files=Array.from(e.clipboardData.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>file!==null);if(files.length){e.preventDefault();void addFiles(index,files);}else if(native){e.preventDefault();void pasteImage(index);}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void addFiles(index,e.dataTransfer.files);}}>{clipboardAvailable&&<div className="ds-clipboard-notice" role="status"><span>剪贴板中有图像，是否载入？</span><button disabled={uploading||!!importStatus} onClick={()=>{setClipboardAvailable(false);void pasteImage(index);}}>载入</button><button aria-label={'忽略剪贴板图像提示'} onClick={()=>setClipboardAvailable(false)}>忽略</button></div>}<div className="ds-uploads">{(config.uploads[index]||[]).map((src,n)=><div className="ds-upload-image" key={src+n}><ImageView src={src} alt={field.label} onClick={()=>setPreview({src,title:field.label})}/><button disabled={uploading||!!importStatus} aria-label={'移除'+field.label+'第'+(n+1)+'张'} onClick={()=>updateConfig({uploads:{...config.uploads,[index]:config.uploads[index].filter((_,i)=>i!==n)}})}><CloseOutlined/></button></div>)}</div><label className="ds-file-button"><PlusOutlined/> 添加图片<input type="file" accept="image/*" multiple={uploadLimit(field)>1} disabled={uploading||!!importStatus} onChange={(e:ChangeEvent<HTMLInputElement>)=>{void addFiles(index,e.target.files);e.target.value='';}}/></label><button className="ds-file-button ds-paste-button" disabled={uploading||!!importStatus} aria-label={'粘贴'+field.label} onClick={()=>void pasteImage(index)}><CopyOutlined/> 粘贴图片</button><small>{(field.hint||'').replace(/，?单张不超过\s*10MB/g,'').replace(/，?单张不超过\s*10\s*MB/g,'')} · 支持粘贴图片</small>{importStatus?.index===index&&<div role="status" aria-live="polite" className="ds-import-status"><Spin size="small"/><span>{importStatus.text}</span></div>}</div></>:field.type==='choices'?<div className="ds-choices">{field.options.map(option=><button key={option} disabled={uploading||!!importStatus} className={config.values[index]===option?'selected':''} onClick={()=>value(index,option)}>{option}</button>)}</div>:<>{field.type==='textarea'?<textarea id={'ds-value-'+index} disabled={uploading||!!importStatus} placeholder={field.placeholder} value={config.values[index]||''} maxLength={12000} onChange={e=>value(index,e.target.value)}/>:<input id={'ds-value-'+index} disabled={uploading||!!importStatus} placeholder={field.placeholder} value={config.values[index]||''} maxLength={12000} onChange={e=>value(index,e.target.value)}/>} {!!field.presets?.length&&<details><summary>快捷预设 · {field.presets.length} 项</summary>{field.presets.map(p=><button className="ds-preset" key={p} disabled={uploading||!!importStatus} onClick={()=>value(index,p)}>{p}</button>)}</details>}</>}</div>)}{feature.title==='一键裁剪图片'&&<div className="ds-field"><label>裁剪位置</label><span>水平 {config.focusX}%</span><input type="range" aria-label="水平裁剪位置" min={0} max={100} value={config.focusX} onChange={e=>updateConfig({focusX:Number(e.target.value)})}/><span>垂直 {config.focusY}%</span><input type="range" aria-label="垂直裁剪位置" min={0} max={100} value={config.focusY} onChange={e=>updateConfig({focusY:Number(e.target.value)})}/></div>}{feature.quantity&&<div className="ds-field"><label htmlFor="ds-count">生成数量</label><input id="ds-count" type="number" min={1} max={8} disabled={uploading||!!importStatus} value={config.quantity} onChange={e=>updateConfig({quantity:Math.max(1,Math.min(8,Number(e.target.value)||1))})}/></div>}</div><footer className="ds-action">{busy?<><button onClick={()=>controller.current?.abort()}>停止生成</button><span>{stage}</span></>:<button className="ds-generate" disabled={uploading||!!importStatus||loading} onClick={()=>void generate()}>{uploading?'正在添加图片…':isAnalysis(feature)?'分析图片':feature.title==='一键裁剪图片'?'裁剪图片':'生成'}</button>}</footer></section>
 <section className="ds-results-panel"><header className="ds-bar ds-results-bar"><div className="ds-tabs" role="tablist">{(['examples','works'] as const).map(t=><button role="tab" aria-selected={tab===t} className={tab===t?'selected':''} key={t} onClick={()=>setTab(t)}>{t==='examples'?'作品示例':'我的作品'}</button>)}</div></header><div className="ds-results">{tab==='examples'?<ExampleGallery title={feature.title} groups={feature.exampleGroups} renderImage={(asset,alt)=><ImageView src={asset.src} alt={alt}/>} onPreview={(src,title)=>setPreview({src,title})} onCopyPrompt={prompt=>void copyPrompt(prompt)}/>:content.works.length?<div className="ds-works">{content.works.map((work,n)=>{
 const live=work.status==='generating'&&activeWorks.current.has(work.id);
 const status=live?'生成中':work.status==='generating'?'生成已中断':work.status==='error'?'生成失败':work.status==='cancelled'?'已停止':work.text&&!work.images.length?'分析完成':'已完成';
 return <Card className="ds-work-card" key={work.id} cover={work.images.length?<div className="ds-work-cover"><ImageView src={work.images[0]} alt={work.name||feature.title} onClick={()=>setPreview({src:work.images[0],title:work.name||feature.title})}/></div>:<div className="ds-work-placeholder" role="status">{live?<Spin/>:<PictureOutlined/>}<span>{status}</span></div>} actions={[
  <Tooltip title="重新生成" key="regenerate"><button className="ds-card-action" aria-label="重新生成" disabled={busy||uploading} onClick={()=>void generate(work)}><ReloadOutlined/></button></Tooltip>,
  <Tooltip title="复制提示词" key="copy"><button className="ds-card-action" aria-label="复制提示词" onClick={()=>void copyPrompt(work.prompt)}><CopyOutlined/></button></Tooltip>,
  ...(work.images.length?[<Tooltip title="下载图片" key="download"><button className="ds-card-action" aria-label="下载图片" onClick={()=>void downloadImage(work.images[0],work.name||feature.title).catch(showError)}><DownloadOutlined/></button></Tooltip>]:[])
 ]}><Card.Meta title={work.name||`${feature.title} · ${content!.works.length-n}`} description={<><span className="ds-work-status" role="status">{status}</span><time>{new Date(work.createdAt).toLocaleString()}</time></>}/>{work.error&&<p className="ds-work-error">{work.error}</p>}{work.text&&!work.images.length&&<details><summary>查看分析结果</summary><pre>{work.text}</pre></details>}</Card>;
 })}</div>:<div className="ds-empty">暂无作品</div>}</div></section></div>:<div className="ds-empty">{contentError?'请导出备份后重新打开作品':'请从功能列表选择一个功能'}</div>}
 </main>{preview&&<Modal open title={preview.title} width="90vw" footer={null} onCancel={()=>setPreview(null)} destroyOnHidden><div className="ds-preview"><ImageView src={preview.src} alt={preview.title} loading="eager"/></div></Modal>}
 </div>;
}
