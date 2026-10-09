import { useEffect, useState } from 'react';
import { Button, Card, Empty, Tabs } from 'antd';
import { MenuUnfoldOutlined } from '@ant-design/icons';
import * as store from './store';
import { readContent, styles } from './model';
import { previewImageSource } from './previewImages';
import { resolveStyle } from './baoyu';
import StoryComicIcon from './StoryComicIcon';

type Work = { id: string; title: string; style?: string; cover?: string; error?: string };
export default function WorksGallery({ collapsed, expand, open }: { collapsed: boolean; expand: () => void; open: (id: string) => void }) {
  const [filter, setFilter] = useState('all');
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    let generation = 0;
    async function refresh() {
      const ticket = ++generation;
      const documents = store.documentList();
      setWorks(documents.map(({id,title}) => ({id,title})));
      setLoading(true);
      let cursor = 0;
      const valid = () => live && ticket === generation;
      async function worker() {
        while (valid() && cursor < documents.length) {
          const item = documents[cursor++];
          let work: Work = { id: item.id, title: item.title };
          try {
            const doc = store.currentDocument(item.id) ?? await store.loadDocument(item.id);
            if (!valid()) return;
            const content = readContent(doc.content);
            work.style = resolveStyle(content.config).id;
            const image = content.plan?.pages[0]?.image;
            if (image) work.cover = await previewImageSource(image);
          } catch { work.error = '封面暂不可用'; }
          if (valid()) setWorks(old => old.map(w => w.id === item.id ? work : w));
        }
      }
      await Promise.all([worker(), worker()]);
      if (valid()) setLoading(false);
    }
    void refresh();
    const unsubscribe = store.subscribe(() => { void refresh(); });
    return () => { live = false; ++generation; unsubscribe(); };
  }, []);
  const visible = works.filter(w => filter === 'all' || w.style === filter);
  return <main className="story-work-gallery">
    <header className="story-bar story-gallery-bar">
      <div className="story-bar-title">
        {collapsed && <Button type="text" icon={<MenuUnfoldOutlined />} aria-label="展开故事漫画导航" onClick={expand} />}
        <StoryComicIcon /><strong>我的作品</strong>
      </div>
      <Tabs className="story-gallery-tabs" activeKey={filter} onChange={setFilter}
        items={[{key:'all',label:'所有'},...styles.map(style => ({key:style.id,label:style.name}))]} />
    </header>
    <div className="story-gallery-scroll" aria-busy={loading}>
      {!visible.length ? <Empty description={loading ? '正在读取作品…' : '暂无作品'} /> :
        <div className="story-gallery-grid">{visible.map(work => <button key={work.id} className="story-work-card" onClick={() => open(work.id)} aria-label={`打开作品：${work.title}`}>
          <Card cover={work.cover ? <img src={work.cover} alt={work.title} loading="lazy" decoding="async" /> : <div className="story-work-cover-empty"><StoryComicIcon /><span>{work.error || '暂无封面'}</span></div>}>
            <Card.Meta title={work.title} />
          </Card>
        </button>)}</div>}
    </div>
  </main>;
}
