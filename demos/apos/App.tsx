import { useRef, useState, type FormEvent } from 'react';
import { Button, ConfigProvider, Input, Modal, Select, Tooltip, type ThemeConfig } from 'antd';
import { ArrowUpOutlined, AppstoreOutlined, FolderOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import Cover from './Cover';
import { createDemoDraft, defaultOptions, episodeCounts, sampleWorks, sizes, styles, type CreationOptions, type Work } from './model';

const theme: ThemeConfig = {
  token: {
    colorPrimary: '#477761', colorText: '#29362e', colorTextSecondary: '#78847c',
    colorBorder: '#e4eae5', colorBgContainer: '#ffffff', colorBgElevated: '#ffffff',
    borderRadius: 8, controlHeight: 34, fontSize: 13,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
    Select: { optionSelectedBg: '#eaf2ed', optionSelectedColor: '#376c58' },
    Modal: { borderRadiusLG: 18 },
  },
};
const selectOptions = (items: readonly string[]) => items.map(value => ({ value, label: value }));

function Studio() {
  const [works, setWorks] = useState<Work[]>(sampleWorks);
  const [topic, setTopic] = useState('');
  const [options, setOptions] = useState<CreationOptions>(defaultOptions);
  const [preview, setPreview] = useState<Work | null>(null);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<React.ComponentRef<typeof Input.TextArea>>(null);
  const focusAfterClose = useRef(false);

  function update<K extends keyof CreationOptions>(key: K, value: CreationOptions[K]) {
    setOptions(current => ({ ...current, [key]: value }));
  }
  function create(event: FormEvent) {
    event.preventDefault();
    const draft = createDemoDraft(topic, options, crypto.randomUUID());
    if (!draft) return;
    setWorks(current => [draft, ...current]);
    setTopic('');
    setNotice(`已添加演示草稿 · ${draft.style} / ${draft.size} / ${draft.episodes} 集。未调用模型，刷新后清空。`);
  }
  function reuse() {
    if (!preview) return;
    setTopic(preview.topic);
    setOptions({ style: preview.style, size: preview.size, episodes: preview.episodes, workspace: preview.workspace, permission: preview.permission });
    setNotice('已填入作品主题和参数，可继续调整。');
    focusAfterClose.current = true;
    setPreview(null);
  }

  return <div className="apos-app">
    <header className="apos-header">
      <div className="apos-context"><span className="apos-mark"><AppstoreOutlined /></span><span>创作空间</span></div>
      <h1>APOS</h1>
      <Tooltip title="React 19 + Ant Design 6 · 独立本地演示，不连接 AI 或 WorkStore 数据"><span className="apos-demo-label">本地演示</span></Tooltip>
    </header>
    <main className="apos-main">
      <section aria-label="我的作品">
        <div className="apos-section-heading"><h2>我的作品 <span>{String(works.length).padStart(2, '0')}</span></h2><p>每个想法，都值得被看见</p></div>
        <div className="apos-works">
          {works.map(work => <button key={work.id} type="button" className="apos-work" onClick={() => setPreview(work)} aria-label={`预览${work.name}`}>
            <Cover work={work} />
            <span className="apos-work-info"><span className="apos-work-name">{work.name}</span><span className="apos-work-meta"><span>{work.category}</span><span>{work.cover === 'draft' ? '演示草稿' : '示例作品'}</span></span></span>
          </button>)}
        </div>
      </section>
      <section className="apos-create-zone" aria-label="创建作品">
        <form className="apos-composer-shell" onSubmit={create}>
          <div className="apos-composer">
            <Input.TextArea ref={inputRef} className="apos-topic" value={topic} onChange={event => setTopic(event.target.value)}
              placeholder="输入你的主题，让灵感成为作品…" aria-label="输入你的主题" maxLength={1200} autoSize={{ minRows: 2, maxRows: 5 }} variant="borderless" />
            <div className="apos-composer-tools">
              <div className="apos-options">
                <div className="apos-choice"><span aria-hidden="true">风格</span><Select aria-label="风格" value={options.style} options={selectOptions(styles)} onChange={value => update('style', value)} variant="borderless" popupMatchSelectWidth={130} /></div>
                <div className="apos-choice"><span aria-hidden="true">尺寸</span><Select aria-label="尺寸" value={options.size} options={selectOptions(sizes)} onChange={value => update('size', value)} variant="borderless" popupMatchSelectWidth={125} /></div>
                <div className="apos-choice"><span aria-hidden="true">集数</span><Select aria-label="集数" value={options.episodes} options={episodeCounts.map(value => ({ value, label: `${value} 集` }))} onChange={value => update('episodes', value)} variant="borderless" popupMatchSelectWidth={125} /></div>
              </div>
              <Button className="apos-create" type="primary" htmlType="submit" disabled={!topic.trim()} icon={<ArrowUpOutlined rotate={45} />} iconPlacement="end">创建</Button>
            </div>
          </div>
          <div className="apos-composer-footer">
            <div className="apos-footer-settings">
              <Tooltip title="仅演示选项，不读取或切换实际文件目录"><div className="apos-footer-select"><FolderOutlined /><Select aria-label="工作空间（演示）" value={options.workspace} options={selectOptions(['个人空间', '灵感收集'])} onChange={value => update('workspace', value)} variant="borderless" popupMatchSelectWidth={150} /></div></Tooltip>
              <Tooltip title="权限仅为界面示意，不修改系统或应用权限"><div className="apos-footer-select"><SafetyCertificateOutlined /><Select aria-label="权限（演示）" value={options.permission} options={selectOptions(['默认权限', '每次询问', '仅供阅读'])} onChange={value => update('permission', value)} variant="borderless" popupMatchSelectWidth={150} /></div></Tooltip>
            </div>
            <Tooltip title="模型展示位，当前没有调用 Codex"><span className="apos-model"><ThunderboltOutlined />Codex</span></Tooltip>
          </div>
        </form>
        <p className={`apos-status${notice ? ' has-notice' : ''}`} role="status" aria-live="polite">{notice || '仅本地交互演示 · 不调用模型 · 草稿刷新后清空'}</p>
      </section>
    </main>
    <Modal className="apos-preview" title={preview?.name ?? '作品预览'} open={!!preview} onCancel={() => setPreview(null)}
      footer={<Button type="primary" onClick={reuse} icon={<ArrowUpOutlined rotate={45} />} iconPlacement="end">使用此主题</Button>}
      width={560} centered afterClose={() => { if (focusAfterClose.current) { focusAfterClose.current = false; inputRef.current?.focus({ cursor: 'end' }); } }}>
      {preview && <>
        <Cover work={preview} />
        <div className="apos-preview-details"><span>{preview.category} · {preview.style} · {preview.size} · {preview.episodes} 集</span><p>{preview.topic}</p><small>{preview.cover === 'draft' ? `${preview.workspace} · ${preview.permission}（演示选项）。此处是创作草稿，未生成实际作品。` : '示例封面与数值仅用于界面演示，不代表真实业务数据。'}</small></div>
      </>}
    </Modal>
  </div>;
}

export default function AposDemo() {
  return <ConfigProvider locale={zhCN} theme={theme}><Studio /></ConfigProvider>;
}
