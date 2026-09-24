import { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { native } from '../workspace';
import { registerDocumentFlusher } from '../documentLifecycle';
import { registerAiStopper } from '../ai/client';
import './original.css';

type Pending = { resolve: (snapshot: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export default function HtmlApp() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<string, Pending>());
  const ready = useRef(false);
  useEffect(() => {
    let alive = true; ready.current = false; setError('');
    const startup = native ? invoke<{url:string}>('html_original_start') : Promise.resolve({url:'http://127.0.0.1:43187/'});
    void startup.then(result => { if (alive) setUrl(result.url + (native ? '?workstore=desktop' : '')); }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [retry]);
  useEffect(() => {
    if (!url) return;
    const origin = new URL(url).origin;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      if (event.data?.type === 'workstore:html-ready') {
        ready.current = true; frame.current?.contentWindow?.postMessage({type:'workstore:html-init',desktop:native},origin); return;
      }
      if (native && event.data?.type === 'workstore:html-download') {
        const { filename, data } = event.data;
        if (typeof filename !== 'string' || !(data instanceof ArrayBuffer) || data.byteLength > 128 * 1024 * 1024) {setError('HTML 导出文件无效或超过 128 MB');return;}
        void (async () => {
          const clean = filename.replace(/[\\/:*?"<>|]/g, '_').slice(0,180);
          const path = await save({defaultPath:clean}); if (!path) return;
          const blob = new Blob([data]);
          const encoded = await new Promise<string>((resolve,reject) => {const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('读取导出文件失败'));reader.readAsDataURL(blob);});
          await invoke('html_original_export', {path,data:encoded});
        })().catch(e=>setError(String(e)));
        return;
      }
      if (event.data?.type !== 'workstore:html-response') return;
      const request = pending.current.get(event.data.requestId);
      if (!request) return;
      clearTimeout(request.timer); pending.current.delete(event.data.requestId);
      if (event.data.error) request.reject(new Error(event.data.error)); else request.resolve(event.data.snapshot);
    };
    window.addEventListener('message', receive);
    const send = (action: 'flush' | 'stop') => new Promise<unknown>((resolve, reject) => {
      if (!ready.current) { resolve(null); return; }
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error('HTML Anything 未确认保存，请在工具中导出作品后重试')); }, 8000);
      pending.current.set(requestId, {resolve,reject,timer});
      frame.current?.contentWindow?.postMessage({type:'workstore:html-request',requestId,action}, origin);
    });
    const persist = async (action: 'flush' | 'stop') => {
      const snapshot = await send(action);
      if (native && snapshot) await invoke('html_original_backup', {snapshot});
    };
    const unflush = registerDocumentFlusher(() => persist('flush'));
    const unstop = registerAiStopper(async () => { await persist('stop'); if (native) await invoke('html_original_cancel'); });
    const timer = setInterval(() => { void persist('flush').catch(e => setError(String(e))); }, 15000);
    return () => {
      clearInterval(timer); unflush(); unstop(); window.removeEventListener('message', receive);
      pending.current.forEach(request => {clearTimeout(request.timer);request.reject(new Error('HTML 页面已关闭'));});pending.current.clear();
    };
  }, [url]);
  return <div className="html-original-app">
    {error && <div className="html-original-error" role="alert">{error}<Button size="small" onClick={() => {setUrl('');setRetry(n=>n+1);}}>重试</Button></div>}
    {url ? <iframe ref={frame} title="HTML Anything 原版" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals allow-presentation" src={url} onLoad={() => frame.current?.contentWindow?.postMessage({type:'workstore:html-init',desktop:native},new URL(url).origin)} allow="clipboard-read; clipboard-write; fullscreen" /> : !error && <div className="html-original-loading">正在启动 HTML Anything…</div>}
  </div>;
}
