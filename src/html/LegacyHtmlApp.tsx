import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Segmented, Modal } from 'antd';
import { GlobalOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, MoreOutlined } from '@ant-design/icons';
import { ai } from '../ai/client';
import { registerSyncActivationBlocker } from '../documentLifecycle';
import * as store from './store';
import { templates, readContent, previewHtml, generationMessages, extractHtml, type HtmlContent } from './model';
import { exportHtmlFile } from './export';
import './html.css';
import attribution from './attribution.json';

export default function HtmlApp() {
  const { message } = App.useApp();
  const [, redraw] = useState(0);
  const [id, setId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [about, setAbout] = useState(false);
  const [view, setView] = useState('预览');
  const [width, setWidth] = useState('自适应');
  const [error, setError] = useState('');
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const request = useRef(0), controller = useRef<AbortController | null>(null), mounted = useRef(true);
  const composing = useRef(false), queued = useRef<string | null>(null), compositionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false), active = useRef(id); active.current = id;
  const input = useRef<HTMLInputElement>(null);
  const doc = id ? store.currentDocument(id) : undefined;
  let content: HtmlContent | undefined; let corrupt = '';
  try { if (doc) content = readContent(doc.content); } catch (e) { corrupt = String(e); }
  const html = useMemo(() => previewHtml(content?.html || '<html><body></body></html>'), [content?.html]);
  const fail = (e: unknown) => { if (mounted.current) setError(String(e)); };
  function cancel() { controller.current?.abort(); controller.current = null; setBusy(false); }
  async function select(next: string) {
    if (composing.current) { queued.current = next; return; }
    const token = ++request.current; pending.current = true; cancel();
    try {
      await store.flushDocuments();
      if (next !== active.current) await store.loadDocument(next);
      if (!mounted.current || token !== request.current) return;
      store.activateDocument(next); setId(next); setError('');
    } catch (e) { fail(e); } finally { if (token === request.current) pending.current = false; }
  }
  useEffect(() => {
    mounted.current = true;
    const unsub = store.subscribe(() => redraw(n => n + 1));
    const unblock = registerSyncActivationBlocker(() => pending.current || composing.current);
    const token = ++request.current;
    void store.refreshDocuments().then(() => {
      if (mounted.current && token === request.current) {
        const first = store.documentList().find(d => d.id === store.lastDocumentId) ?? store.documentList()[0];
        if (first) void select(first.id);
      }
    }).catch(fail);
    return () => { mounted.current = false; ++request.current; controller.current?.abort(); clearTimeout(compositionTimer.current); unsub(); unblock(); };
  }, []);
  function patch(change: Partial<HtmlContent>) {
    if (doc && content) { store.stageDocument(doc.id, { content: JSON.stringify({ ...content, ...change }) }); setError(''); }
  }
  async function create() {
    if (creating) return;
    setCreating(true); const token = ++request.current; pending.current = true; cancel();
    try {
      await store.flushDocuments(); const created = await store.createDocument();
      if (mounted.current && token === request.current) { store.activateDocument(created.id); setId(created.id); setError(''); }
    } catch (e) { fail(e); } finally { if (mounted.current) setCreating(false); if (token === request.current) pending.current = false; }
  }
  async function generate() {
    if (!doc || !content || busy || (!content.source.trim() && !(content.html.trim() && content.instruction.trim()))) return;
    const snapshot = doc.content, target = doc.id, version = store.remoteVersion(target);
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError('');
    try {
      await store.flushDocument(target);
      const result = await ai.generate({ toolId: 'app.html', messages: generationMessages(content), record: false }, abort.signal);
      if (abort.signal.aborted || !mounted.current) return;
      if (active.current !== target || store.currentDocument(target)?.content !== snapshot || store.remoteVersion(target) !== version) throw new Error('生成期间作品已变化，未覆盖当前编辑，请重试');
      store.stageDocument(target, { content: JSON.stringify({ ...content, html: extractHtml(result.text) }) });
      setView('预览'); await store.flushDocument(target); message.success('HTML 已生成并保存');
    } catch (e) { if (!abort.signal.aborted) fail(e); }
    finally { if (controller.current === abort) { controller.current = null; if (mounted.current) setBusy(false); } }
  }
  async function exportWork(target: string, backup = false) {
    try { const item = await store.ensureDocument(target); await exportHtmlFile(item.title, backup ? JSON.stringify(item, null, 2) : readContent(item.content).html, backup); } catch(e) { fail(e); }
  }
  const rows = (favorite: boolean) => store.documentList().filter(d => d.favorite === favorite).sort((a,b) => b.lastOpenedAt - a.lastOpenedAt).map(item => <div className={`html-row ${item.id === id ? 'selected' : ''}`} key={item.id}>
    <button className="html-row-name" onPointerDown={e => {
      delete e.currentTarget.dataset.down;
      if (e.pointerType === 'mouse' && e.button === 0 && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        if (!composing.current) e.preventDefault();
        e.currentTarget.dataset.down = 'true'; void select(item.id);
      }
    }} onClick={e => {
      const down = e.currentTarget.dataset.down; delete e.currentTarget.dataset.down;
      if (e.detail !== 0 && down) return;
      void select(item.id);
    }}><GlobalOutlined /><span>{item.title}</span></button>
    <Dropdown menu={{ items: [{ key: 'favorite', label: favorite ? '取消常用' : '设为常用' }, { key: 'rename', label: '重命名' }, { key: 'export', label: '导出 HTML' }, { key: 'backup', label: '导出作品备份' }], onClick: ({ key }) => {
      if (key === 'export' || key === 'backup') { void exportWork(item.id, key === 'backup'); return; }
      if (key === 'rename') { setRename({id: item.id, title: item.title}); return; }
      void store.ensureDocument(item.id).then(() => store.stageDocument(item.id, { favorite: !favorite })).catch(fail);
    } }} trigger={['click']}><button className="html-more" aria-label={`${item.title}更多操作`}><MoreOutlined /></button></Dropdown>
  </div>);
  return <div className="html-app" onCompositionStart={() => { clearTimeout(compositionTimer.current); composing.current = true; }} onCompositionEnd={() => {
    compositionTimer.current = setTimeout(() => { composing.current = false; const next = queued.current; queued.current = null; if (next) void select(next); }, 0);
  }}>
    {!collapsed && <aside className="html-nav"><header><GlobalOutlined /><strong>HTML</strong><button aria-label="折叠 HTML 列表" onClick={() => setCollapsed(true)}><MenuFoldOutlined /></button></header>
      <div className="html-list">{[true,false].map(favorite => <section key={String(favorite)}><h3>{favorite ? '常用' : '最近打开'}</h3>{rows(favorite).length ? rows(favorite) : <p>暂无</p>}</section>)}</div>
      <footer><Button icon={<PlusOutlined />} loading={creating} onClick={() => void create()}>创建 HTML</Button></footer>
    </aside>}
    <main className="html-work"><header>{collapsed && <button aria-label="展开 HTML 列表" onClick={() => setCollapsed(false)}><MenuUnfoldOutlined /></button>}<button className="html-title" onClick={() => doc && setRename({id: doc.id,title:doc.title})}>{doc?.title || 'HTML'}</button></header>
      {(error || corrupt || store.documentWarnings().length > 0 || (id && store.documentStatus(id).startsWith('保存失败'))) && <div role="alert" className="html-error">{error || corrupt || (id && store.documentStatus(id).startsWith('保存失败') ? store.documentStatus(id) : store.documentWarnings().join('；'))}<Button size="small" onClick={() => void store.flushDocuments().then(() => setError('')).catch(fail)}>重试保存</Button>{doc && <Button size="small" onClick={() => void exportWork(doc.id,true)}>导出备份</Button>}</div>}
      {!doc ? <div className="html-empty"><GlobalOutlined /><h2>把内容变成作品</h2><p>文章、演示、海报、网页原型，从一份材料开始。</p><Button onClick={() => void create()} loading={creating} icon={<PlusOutlined />}>创建 HTML</Button></div> : content && <div className="html-studio">
        <section className="html-input"><label>设计模板 · {templates.length} 款</label><Select aria-label="设计模板" showSearch optionFilterProp="label" value={content.template} options={templates.map(t => ({value:t.id,label:t.name}))} onChange={template => patch({template})} />
          <p className="html-template-desc">{templates.find(t => t.id === content!.template)?.description}</p>
          <label htmlFor="html-source">内容材料</label><Input.TextArea id="html-source" value={content.source} placeholder="粘贴文章、Markdown、CSV、JSON 或想法…" onChange={e => patch({source:e.target.value})} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {e.preventDefault(); void generate();} }} />
          <input ref={input} type="file" accept=".txt,.md,.csv,.tsv,.json,.html,.htm" hidden onChange={e => { const file=e.target.files?.[0]; e.target.value=''; if (!file) return; const target=doc.id, snapshot=doc.content; if(file.size>2*1024*1024){fail('导入文件不能超过 2 MB');return;} void file.text().then(text => { if(!mounted.current || active.current!==target || store.currentDocument(target)?.content!==snapshot) throw new Error('读取期间作品已变化，请重新导入'); patch(/\.html?$/i.test(file.name) ? {html:text} : {source:text}); }).catch(fail); }} />
          <Button onClick={() => input.current?.click()}>导入文本 / HTML</Button>
          <label htmlFor="html-instruction">设计或修改要求</label><Input.TextArea id="html-instruction" rows={2} value={content.instruction} placeholder="例如：暖色杂志排版，突出三个关键数字" onChange={e => patch({instruction:e.target.value})} />
          <p className="html-hint">发送材料、设计要求及当前 HTML 至统一 AI。模板动效以静态画面呈现。</p>
          {busy ? <Button onClick={cancel}>停止生成</Button> : <Button type="primary" disabled={!content.source.trim() && !(content.html.trim() && content.instruction.trim())} onClick={() => void generate()}>{content.html ? '修改 HTML' : '生成 HTML'}</Button>}
          <small role="status">{busy ? 'AI 正在生成完整 HTML…' : store.documentStatus(doc.id)}</small><button className="html-attribution" onClick={() => setAbout(true)}>模板来源与许可</button>
        </section>
        <section className="html-result"><div className="html-result-toolbar"><Segmented options={['预览','源码']} value={view} onChange={setView} /><Select aria-label="预览宽度" value={width} onChange={setWidth} options={['自适应','手机','桌面'].map(value=>({value,label:value}))} /><Button disabled={!content.html} onClick={() => void exportWork(doc.id)}>导出 HTML</Button></div>
          {view === '源码' ? <Input.TextArea aria-label="HTML 源码" className="html-code" spellCheck={false} value={content.html} onChange={e => patch({html:e.target.value})} /> : <div className="html-preview-area">{content.html ? <iframe title="HTML 作品预览" sandbox="" referrerPolicy="no-referrer" srcDoc={html} style={{width:width==='手机'?390:width==='桌面'?1200:'100%'}} /> : <div className="html-empty"><GlobalOutlined /><p>生成或导入后，在这里查看作品</p></div>}</div>}
          <div className="html-preview-note">隔离静态预览 · 不执行脚本或加载外部资源</div>
        </section>
      </div>}
    </main>
    <Modal title="HTML Anything · Apache-2.0" open={about} onCancel={() => setAbout(false)} footer={<Button onClick={() => setAbout(false)}>关闭</Button>}><p>{attribution.source}</p><p>模板来自 HTML Anything；WorkStore 适配了本地存储、统一 AI 和静态预览。原作者保留版权。</p><pre style={{whiteSpace:"pre-wrap",maxHeight:360,overflow:"auto",fontSize:12}}>{attribution.license}</pre></Modal>
    <Modal title="重命名 HTML" open={!!rename} onCancel={() => setRename(null)} onOk={() => { if (!rename) return; const target=rename; void store.ensureDocument(target.id).then(() => {store.stageDocument(target.id,{title:target.title});setRename(null);}).catch(fail); }}><Input maxLength={120} value={rename?.title} onChange={e => rename && setRename({...rename,title:e.target.value})} /></Modal>
  </div>;
}
