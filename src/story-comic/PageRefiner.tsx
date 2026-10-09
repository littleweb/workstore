import { useEffect, useRef, useState } from 'react';
import { Button, Input } from 'antd';
import { CloseOutlined, SendOutlined, BulbOutlined, LoadingOutlined } from '@ant-design/icons';
import type { Page } from './model';
const suggestions=[['调整画面','请调整这页的画面：'],['修改文字','请把这页的文字修改为：'],['优化细节','请优化这页的细节：']];
export default function PageRefiner({page,index,busy,close,submit}: {page:Page;index:number;busy:boolean;close:()=>void;submit:(text:string)=>Promise<boolean>}) {
  const [input,setInput] = useState('');
  const [error,setError] = useState('');
  const messages=useRef<HTMLDivElement>(null);
  useEffect(()=>{messages.current?.scrollTo?.({top:messages.current.scrollHeight});},[page.chat?.length,busy]);
  async function send() {
    const value=input.trim(); if (!value || busy) return;
    setError('');
    if (await submit(value)) setInput(''); else setError('优化未完成，原页面已保留。请检查错误提示后重试。');
  }
  return <aside className="story-refiner" aria-label="页面AI优化">
    <header className="story-refiner-header">
      <div className="story-refiner-heading"><span className="story-refiner-symbol"><BulbOutlined/></span><div><strong>AI 页面优化</strong><small>{index===0?'封面':`第 ${index+1} 页`}<i/>保留修改前版本</small></div></div>
      <Button size="small" type="text" icon={<CloseOutlined/>} onClick={close} aria-label="关闭AI优化" title="关闭" />
    </header>
    <div className="story-refiner-messages" ref={messages}>
      {!page.chat?.length && <div className="story-refiner-welcome"><span className="story-refiner-welcome-icon"><BulbOutlined/></span><h3>让这一页更出色</h3><p>调整画面、角色或文字，<br/>用一句话描述你想要的变化。</p><div className="story-refiner-suggestions">{suggestions.map(([label,value])=><button key={label} disabled={busy} onClick={()=>setInput(value)}>{label}<span>↗</span></button>)}</div></div>}
      {page.chat?.map((m,i)=><div key={i} className={`story-refiner-message ${m.role}`}>
        {m.role==='assistant'&&<span className="story-refiner-avatar">AI</span>}
        <div className="story-refiner-message-content"><small>{m.role==='user'?'你':'页面助手'}</small><p>{m.content}</p></div>
      </div>)}
      {busy&&<div className="story-refiner-thinking" role="status"><LoadingOutlined/><span>正在优化当前页…</span></div>}
      {error&&<p className="story-refiner-error" role="alert">{error}</p>}
    </div>
    <div className="story-refiner-input">
      <div className="story-refiner-composer"><Input.TextArea aria-label="页面修改要求" value={input} onChange={e=>setInput(e.target.value)} autoSize={{minRows:3,maxRows:8}} placeholder="描述你想修改的画面或文字…" disabled={busy} />
        <div className="story-refiner-composer-actions"><small>仅修改当前页</small><Button type="primary" size="small" icon={<SendOutlined/>} disabled={busy||!input.trim()} loading={busy} onClick={()=>void send()}>发送</Button></div>
      </div>
      <p className="story-refiner-footnote">未提及的内容将尽量保持不变</p>
    </div>
  </aside>;
}
