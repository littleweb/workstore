import { beginTask, updateTask } from '../tasks/store';
import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal, Progress, Alert } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { native } from '../workspace';
import { imageSource } from '../comics/images';
import type { Copy, Page } from './model';
import './xhs-publisher.css';
export type Account = { is_logged_in: boolean; username?: string; user_id?: string; img?: string };
export type PublishResult = {status:'success'|'unknown';message:string};
export function publishProblem(title:string,description:string,selected:number) {
  if(!title.trim() || [...title].length>20)return '发布标题需为 1–20 个字符';
  if(!description.trim() || [...description].length>1000)return '发布正文需为 1–1000 个字符';
  if(selected<1 || selected>18)return '本次接入最多发布 18 张，请选择 1–18 张图片；其余图片可另行发布';
  return '';
}
export default function XhsPublisher({documentId,copy,pages,toolId="app.story-comic",subject="漫画",size}: {documentId:string;copy:Copy;pages:Page[];toolId?:string;subject?:string;size?:"small"|"middle"|"large"}) {
  const [open,setOpen]=useState(false),[account,setAccount]=useState<Account|null>(null),[qr,setQr]=useState('');
  const [title,setTitle]=useState(copy.title),[description,setDescription]=useState(copy.description),[tags,setTags]=useState(copy.hashtags.join(' '));
  const [selected,setSelected]=useState<number[]>([]),[busy,setBusy]=useState(false),[publishing,setPublishing]=useState(false),[stage,setStage]=useState(''),[prepared,setPrepared]=useState(0),[error,setError]=useState(''),[result,setResult]=useState<PublishResult|null>(null);
  const live=useRef(true),working=useRef(false);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  async function connect(qrcode=false) {
    if(working.current)return;working.current=true;setBusy(true);setError('');setStage('正在连接本机发布浏览器…首次使用需下载组件和浏览器');
    try {
      const status=await invoke<Account>('xhs_connect',{action:qrcode?'qrcode':'status'});
      if(!live.current)return;
      setAccount(status);
      if(status.is_logged_in){setQr('');setStage(status.user_id?'已登录，可以确认发布':'已登录，但未能确认账号，请重新检查');}
      else if(qrcode){setQr(status.img??'');setStage('请用小红书 App 扫码登录，二维码约 4 分钟有效');}
      else {setStage('请扫码登录小红书');}
    }catch(e){if(live.current)setError(String(e));}
    finally{working.current=false;if(live.current)setBusy(false);}
  }
  function show() {
    if(working.current){setOpen(true);return;}
    if(result){setOpen(true);if(native)void connect();return;}
    setAccount(null);setQr('');
    setTitle(copy.title);setDescription(copy.description);setTags(copy.hashtags.join(' '));setSelected(pages.flatMap((p,i)=>p.image&&!p.error&&(!p.status||p.status==='ready')?[i]:[]));setPrepared(0);setResult(null);setError('');setOpen(true);
    if(native)void connect();
  }
  const problem=publishProblem(title,description,selected.length);
  async function publish(retryUnknown=false) {
    if(working.current || problem || !account?.user_id)return;
    const captured={documentId,title:title.trim(),description:description.trim(),tags:tags.split(/[\s,，]+/).map(t=>t.replace(/^#+/,'')).filter(Boolean),indices:[...selected].sort((a,b)=>a-b),accountId:account.user_id,retryUnknown};
    if(captured.tags.length>10 || captured.tags.some(t=>[...t].length>30)){setError('最多添加 10 个话题，每个话题不超过 30 个字符');return;}
    working.current=true;setBusy(true);setPublishing(true);setError('');setResult(null);setPrepared(0);
    const controller=new AbortController();
    const task=beginTask(controller,{toolId,title:`发布到小红书 · ${captured.title}`,stage:`正在准备${subject}图片…`,cancellable:false});
    setOpen(false);
    try {
      const images:string[]=[];
      for(const index of captured.indices){updateTask(controller.signal,{stage:`正在准备${subject}图片 ${images.length+1}/${captured.indices.length}`,done:images.length,total:captured.indices.length});if(live.current)setStage(`正在准备${subject}图片 ${images.length+1}/${captured.indices.length}`);images.push(await imageSource(pages[index].image!));if(live.current)setPrepared(images.length);}
      updateTask(controller.signal,{stage:'正在上传图片并发布，等待小红书确认…',total:undefined,done:undefined});
      if(live.current)setStage('正在上传图片并发布，请等待小红书确认…');
      const value=await invoke<PublishResult>('xhs_publish',{request:{...captured,indices:undefined,images}});
      updateTask(controller.signal,{stage:value.message});task.finish(value.status==='unknown'?value.message:undefined);
      if(live.current){setResult(value);setStage(value.message);}
    }catch(e){task.finish(e);if(live.current){setError(String(e));setStage('发布未完成');}}
    finally{working.current=false;if(live.current){setBusy(false);setPublishing(false);}}
  }
  return <>
    <Button size={size} type="primary" onClick={show}>发布到小红书</Button>
    <Modal title="发布到小红书" open={open} width={720} footer={null} maskClosable closable onCancel={()=>setOpen(false)} destroyOnHidden={false}>
      {!native?<Alert type="info" message="请在 WorkStore 桌面应用中使用本地浏览器发布"/>:<div className="xhs-publisher">
        <div className="xhs-account"><span>{busy&&!publishing?'正在检测登录状态…':account?.is_logged_in?`当前账号：${account.username||account.user_id||'待确认'}`:'尚未登录小红书'}</span><Button size="small" disabled={busy} onClick={()=>void connect()}>检查登录</Button><Button size="small" disabled={busy} onClick={()=>void connect(true)}>{qr?'刷新二维码':'扫码登录'}</Button></div>
        {qr&&<div className="xhs-qrcode"><img src={qr.startsWith('data:image/')?qr:`data:image/png;base64,${qr}`} alt="小红书登录二维码"/><Button disabled={busy} onClick={()=>void connect()}>我已扫码，检查登录</Button></div>}
        <label>标题<Input aria-label="小红书发布标题" value={title} disabled={publishing} onChange={e=>setTitle(e.target.value)}/></label>
        <label>正文<Input.TextArea aria-label="小红书发布正文" rows={4} value={description} disabled={publishing} onChange={e=>setDescription(e.target.value)}/></label>
        <label>话题<Input aria-label="小红书发布话题" value={tags} disabled={publishing} onChange={e=>setTags(e.target.value)} placeholder="用空格分隔"/></label>
        <div>发布图片 · 已选 {selected.length} 张 · 保持{subject}原顺序</div>
        <div className="xhs-images">{pages.map((page,index)=><Checkbox key={index} disabled={publishing||!page.image||!!page.error||!!page.status&&page.status!=='ready'} checked={selected.includes(index)} onChange={e=>setSelected(old=>e.target.checked?[...old,index]:old.filter(i=>i!==index))}>{index===0?'封面':`第 ${index+1} 页`}</Checkbox>)}</div>
        {problem&&<Alert type="warning" message={problem}/>}
        {error&&<Alert type="error" message={error}/>}
        {result&&<Alert type={result.status==='success'?'success':'warning'} message={result.message}/>}
        {busy&&stage.includes('正在上传')?<div className="xhs-upload-working" aria-label="正在上传并等待发布结果"/>:busy&&<Progress percent={Math.round(prepared/Math.max(selected.length,1)*100)} showInfo={false} status="active"/>}
        {stage&&<p role="status">{stage}</p>}
        {publishing&&<small>可关闭此窗口，发布会在后台继续；进度可在后台任务中查看。</small>}
        <div className="xhs-actions"><Button onClick={()=>void openUrl('https://creator.xiaohongshu.com/')} disabled={busy}>打开创作中心</Button>
          {result?.status==='unknown'?<Button disabled={busy||!!problem||!account?.user_id} onClick={()=>Modal.confirm({title:'确认没有发布成功？',content:'请先到创作中心核对这篇笔记。只有确认没有发布成功时才重试，以免重复发帖。',okText:'已核对，重新发布',cancelText:'取消',onOk:()=>publish(true)})}>核对后重试</Button>:<Button type="primary" loading={busy} disabled={busy||!!problem||!account?.is_logged_in||!account.user_id||result?.status==='success'} onClick={()=>void publish()}>确认发布</Button>}
        </div>
        <small>登录信息仅保存在本机。发布后请在创作中心查看审核和展示状态。</small>
      </div>}
    </Modal>
  </>;
}
