'use client';
import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { useConvert } from '@/lib/use-convert';
// Invisible host integration only. Task/store/export semantics remain upstream-owned.
export default function WorkStoreBridge() {
  const { cancel } = useConvert();
  useEffect(() => {
    const applyDefault = () => {
      const key = 'workstore:html-codex-default-v1';
      if (localStorage.getItem(key)) return;
      useStore.getState().setSelectedAgent('codex');
      localStorage.setItem(key, '1');
    };
    if (useStore.persist.hasHydrated()) applyDefault();
    return useStore.persist.onFinishHydration(applyDefault);
  }, []);
  useEffect(() => {
    if (window.parent === window) return;
    const allowed = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://127.0.0.1:1420', 'http://localhost:1420']);
    let desktop = new URLSearchParams(window.location.search).get('workstore') === 'desktop';
    const download = (event: MouseEvent) => {
      if (!desktop || !(event.target instanceof Element)) return;
      const link = event.target.closest('a[download]') as HTMLAnchorElement | null;
      if (!link || !link.href.startsWith('blob:')) return;
      event.preventDefault();
      void fetch(link.href).then(response => response.arrayBuffer()).then(data => {
        // Only the embedding desktop host receives this export, never a pathname from the page.
        const parentOrigin = document.referrer ? new URL(document.referrer).origin : 'tauri://localhost';
        if (!allowed.has(parentOrigin)) return;
        window.parent.postMessage({type:'workstore:html-download',filename:link.download,data},parentOrigin,[data]);
      });
    };
    document.addEventListener('click', download, true);
    const handler = async (event: MessageEvent) => {
      if (event.source !== window.parent || !allowed.has(event.origin)) return;
      if (event.data?.type === 'workstore:html-init') { desktop = event.data.desktop === true; return; }
      if (event.data?.type !== 'workstore:html-request') return;
      const { requestId, action } = event.data;
      if (typeof requestId !== 'string' || !['flush', 'stop'].includes(action)) return;
      try {
        if (action === 'stop') {
          for (const task of useStore.getState().tasks) if (task.status === 'running') cancel(task.id);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        const local: Record<string, string> = {};
        for (const key of ['html-everything-store', 'html-everything-drafts']) {
          const value = localStorage.getItem(key); if (value !== null) local[key] = value;
        }
        const history = await new Promise<unknown[]>((resolve, reject) => {
          const request = indexedDB.open('html-anything-history', 1);
          request.onupgradeneeded = () => { request.transaction?.abort(); resolve([]); };
          request.onerror = () => request.error?.name === 'AbortError' ? resolve([]) : reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('runs')) { db.close(); resolve([]); return; }
            const tx = db.transaction('runs', 'readonly'); const rows = tx.objectStore('runs').getAll();
            tx.oncomplete = () => { db.close(); resolve(rows.result); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          };
        });
        window.parent.postMessage({type:'workstore:html-response',requestId,snapshot:{schemaVersion:1,local,history}},event.origin);
      } catch {
        window.parent.postMessage({type:'workstore:html-response',requestId,error:'HTML Anything 本地存储读取失败，请先在工具中导出作品。'},event.origin);
      }
    };
    window.addEventListener('message', handler);
    const parentOrigin = document.referrer ? new URL(document.referrer).origin : 'tauri://localhost';
    if (allowed.has(parentOrigin)) window.parent.postMessage({type:'workstore:html-ready'},parentOrigin);
    return () => {window.removeEventListener('message', handler);document.removeEventListener('click', download, true);};
  }, [cancel]);
  return null;
}
