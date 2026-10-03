import { ProjectSection, useProjects } from "../list-projects/Projects";
import { useState } from 'react';
import { AppstoreOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PlayCircleOutlined, PlusOutlined, ArrowRightOutlined, PauseOutlined } from '@ant-design/icons';
import './animations.css';
const templates = [
  {name:'让文字成为主角',tag:'文字动画',style:'type',title:'每个想法\n都值得被看见',desc:'大字排版 · 轻盈入场'},
  {name:'一张会动的海报',tag:'动态海报',style:'poster',title:'GOOD\nTHINGS',desc:'鲜明色块 · 节奏变化'},
  {name:'把日常装进画面',tag:'图片展示',style:'photo',title:'收集生活的\n小小美好',desc:'照片卡片 · 柔和推近'},
  {name:'三步讲清一件事',tag:'知识讲解',style:'notes',title:'灵感 → 行动\n→ 新的可能',desc:'手绘便签 · 分点呈现'},
  {name:'新事物，登场',tag:'产品介绍',style:'product',title:'少一点繁琐\n多一点从容',desc:'极简展示 · 聚焦细节'},
  {name:'给故事一个开场',tag:'标题开场',style:'intro',title:'HELLO,\nNEW DAY.',desc:'温暖配色 · 缓缓展开'},
];
type Template = typeof templates[number];
export default function AnimationApp() {
  const projects = useProjects("app.animation");
  const [collapsed,setCollapsed]=useState(false);
  const [page,setPage]=useState<'create'|'gallery'|'preview'>('create');
  const [theme,setTheme]=useState('');
  const [chosen,setChosen]=useState<Template>(templates[0]);
  const [category,setCategory]=useState('全部');
  const [ratio,setRatio]=useState('竖屏');
  const [duration,setDuration]=useState('15 秒');
  const [playing,setPlaying]=useState(true);
  const [headline,setHeadline]=useState('每个想法\n都值得被看见');
  const preview=(item:Template)=>{setChosen(item);setHeadline(theme.trim()||item.title);setPage('preview');setPlaying(true);};
  return <div className="animation-app">
    {!collapsed&&<aside className="animation-nav"><header><PlayCircleOutlined/><strong>小动画</strong><button aria-label="折叠动画导航" onClick={()=>setCollapsed(true)}><MenuFoldOutlined/></button></header>
      <div className="animation-create-nav"><small>创建</small><button className={page==='create'?'active':''} onClick={()=>setPage('create')}><PlusOutlined/>创建动画</button><button className={page==='gallery'?'active':''} onClick={()=>setPage('gallery')}><AppstoreOutlined/>风格模板</button></div>
      <ProjectSection navigation={projects} items={[]} renderItem={()=>null} />
      <section><h3>最近打开</h3><p>暂无</p></section>
      <div className="animation-nav-note">界面预览版</div>
    </aside>}
    <main className="animation-work"><header className="animation-bar">{collapsed&&<button aria-label="展开动画导航" onClick={()=>setCollapsed(false)}><MenuUnfoldOutlined/></button>}<span>{page==='create'?'创建动画':page==='gallery'?'风格模板':'动画预览'}</span><span className="animation-badge">界面预览</span></header>
    <div className="animation-content">{page==='create'?<div className="animation-start"><div className="animation-eyebrow">一点灵感，一点动感</div><h1>让你的想法，动起来。</h1><p className="animation-subtitle">一句话开始，或从喜欢的模板出发。</p>
      <div className="animation-prompt"><textarea aria-label="动画主题" value={theme} onChange={e=>setTheme(e.target.value)} placeholder="想做什么小动画？例如：用三个小习惯，开启轻松的一天"/><div className="animation-prompt-bottom"><span>文字、图片、灵感，都可以成为开场</span><button className="animation-primary" onClick={()=>preview(templates[0])}>预览创建效果 <ArrowRightOutlined/></button></div></div>
      <div className="animation-examples">试试这些灵感{['春日出游照片展示','新产品登场','三个读书小习惯'].map(x=><button key={x} onClick={()=>setTheme(x)}>{x}</button>)}</div>
      <div className="animation-section-heading"><h2>从一个喜欢的风格开始</h2><button onClick={()=>setPage('gallery')}>全部模板 <ArrowRightOutlined/></button></div><div className="animation-grid">{templates.slice(0,3).map(item=>card(item))}</div><p className="animation-footnote">当前可体验页面与样式设置；AI 生成、作品保存及视频导出尚未接入。</p>
    </div>:page==='gallery'?<div className="animation-gallery"><div className="animation-section-heading"><div><h1>选一种风格，开始你的故事。</h1><p className="animation-subtitle">先看看画面，再决定如何表达。</p></div></div><div className="animation-filters">{['全部',...templates.map(x=>x.tag)].map(x=><button className={category===x?'selected':''} key={x} onClick={()=>setCategory(x)}>{x}</button>)}</div><div className="animation-grid">{templates.filter(x=>category==='全部'||x.tag===category).map(item=>card(item))}</div><p className="animation-footnote">模板为界面示例，展示视觉方向，尚未连接 Remotion。</p></div>:<div className="animation-editor"><section className="animation-preview-area"><div className="animation-preview-label"><span>效果预览</span><span>{ratio} · {duration}</span></div><div className="animation-stage"><div className={`animation-art ${chosen.style} animation-large ${ratio==='横屏'?'landscape':ratio==='方形'?'square':'portrait'} ${playing?'playing':''}`}><span className="animation-art-kicker">{chosen.tag}</span><strong>{headline||chosen.title}</strong><span className="animation-art-shape"/><span className="animation-art-footer">MAKE YOUR IDEAS MOVE ↗</span></div></div><div className="animation-playback"><button aria-label={playing?'暂停示例动画':'播放示例动画'} onClick={()=>setPlaying(!playing)}>{playing?<PauseOutlined/>:<PlayCircleOutlined/>}</button><span>样式动效示例</span><div className="animation-track"/><span>{duration}</span></div><p className="animation-footnote">预览使用循环样式动效，尚未生成视频。</p></section><aside className="animation-settings"><h2>让它更像你的想法</h2><label>画面文字<textarea value={headline} onChange={e=>setHeadline(e.target.value)}/></label><div className="animation-setting-field">画面比例<div className="animation-choice">{['竖屏','横屏','方形'].map(x=><button className={ratio===x?'selected':''} key={x} onClick={()=>setRatio(x)}>{x}</button>)}</div></div><label>动画时长<select value={duration} onChange={e=>setDuration(e.target.value)}>{['5 秒','15 秒','30 秒'].map(x=><option key={x}>{x}</option>)}</select></label><div className="animation-setting-field">模板风格<button className="animation-template-select" onClick={()=>setPage('gallery')}>{chosen.name}<ArrowRightOutlined/></button></div><div className="animation-settings-actions"><button disabled className="animation-primary">生成动画 · 待接入</button><button disabled>导出视频 · 待接入</button><small>当前设置仅用于本次界面预览，离开工具后不保存。</small></div></aside></div>}</div></main>
  </div>;
  function card(item:Template){return <button key={item.name} className="animation-card" onClick={()=>preview(item)}><div className={`animation-art ${item.style}`}><span className="animation-art-kicker">{item.tag}</span><strong>{item.title}</strong><span className="animation-art-shape"/><span className="animation-art-footer">MAKE YOUR IDEAS MOVE ↗</span><span className="animation-card-play"><PlayCircleOutlined/></span></div><div className="animation-card-caption"><strong>{item.name}</strong><span>{item.desc}</span></div></button>;}
}
