import { useState, type ReactNode } from "react";
import { ArrowLeftOutlined, EllipsisOutlined, HeartOutlined, HeartFilled, StarOutlined, StarFilled, MessageOutlined, ShareAltOutlined, LeftOutlined, RightOutlined, CloseOutlined } from "@ant-design/icons";
import type { Copy, Page } from "./model";
import "./phone-preview.css";

export default function PhonePreview({ pages, copy, renderImage }: { pages: Page[]; copy?: Copy; renderImage: (page: Page, index: number) => ReactNode }) {
  const [index, setIndex] = useState(0), [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState(false), [saved, setSaved] = useState(false), [followed, setFollowed] = useState(false);
  const [sheet, setSheet] = useState<"comments" | "share" | null>(null);
  const [draft, setDraft] = useState(""), [comments, setComments] = useState<string[]>([]);
  const [startX, setStartX] = useState<number | null>(null), [notice, setNotice] = useState("");
  const current = Math.min(index, Math.max(0, pages.length - 1));
  const move = (step: number) => setIndex(Math.max(0, Math.min(pages.length - 1, current + step)));
  return <aside className="story-phone-panel" aria-label="手机发布预览">
    <header><strong>手机预览</strong><span>小红书风格 · 仅本地预览</span></header>
    <div className="story-phone">
      <div className="phone-status"><b>9:41</b><i /><span aria-label="信号、电量">▮▮▮  ▰</span></div>
      <nav className="phone-nav"><button aria-label="返回笔记顶部" onClick={() => document.getElementById('story-phone-body')?.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowLeftOutlined /></button><span className="phone-avatar">绘</span><strong>我的故事</strong><button className={`phone-follow ${followed ? 'active' : ''}`} onClick={() => setFollowed(!followed)}>{followed ? '已关注' : '关注'}</button><button aria-label="更多分享选项" onClick={() => setSheet('share')}><EllipsisOutlined /></button></nav>
      <div className="phone-body" id="story-phone-body">
        <div className="phone-carousel" tabIndex={0} aria-label="漫画图片轮播"
          onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1); } }}
          onPointerDown={e => { setStartX(e.clientX); e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerUp={e => { if(startX !== null && Math.abs(e.clientX-startX)>35) move(e.clientX<startX?1:-1); setStartX(null); }}
          onPointerCancel={() => setStartX(null)}>
          {pages[current]?.image ? renderImage(pages[current], current) : <div className="phone-image-empty">{pages.length ? `第 ${current+1} 页尚未生成` : '漫画封面将在这里展示'}</div>}
          {pages.length > 0 && <span className="phone-page-count">{current+1}/{pages.length}</span>}
          {pages.length > 1 && <><button className="phone-prev" aria-label="预览上一页" disabled={current===0} onPointerDown={e=>e.stopPropagation()} onClick={()=>move(-1)}><LeftOutlined /></button><button className="phone-next" aria-label="预览下一页" disabled={current===pages.length-1} onPointerDown={e=>e.stopPropagation()} onClick={()=>move(1)}><RightOutlined /></button></>}
        </div>
        <div className="phone-dots" aria-label="选择预览页">{pages.map((_,i)=><button key={i} aria-label={`预览第${i+1}页`} aria-current={i===current?'true':undefined} onClick={()=>setIndex(i)} />)}</div>
        <article className="phone-copy"><h3>{copy?.title || '你的故事标题'}</h3><p className={expanded?'':'clamped'}>{copy?.description || '生成完成后，发布文案会同步显示在这里。'}</p>{copy && <button className="phone-expand" onClick={()=>setExpanded(!expanded)}>{expanded?'收起':'展开全文'}</button>}<div className="phone-tags">{copy?.hashtags.map(tag=><button key={tag} onClick={()=>setNotice(`#${tag} · 话题展示预览`)}>#{tag}</button>)}</div><small>刚刚 · 发布效果预览</small><hr/><button className="phone-comment-link" onClick={()=>setSheet('comments')}>共 {comments.length} 条评论 · 说点什么吧</button>{comments.slice(-2).map((text,i)=><p className="phone-comment" key={i}><b>我</b> {text}</p>)}{notice && <button className="phone-notice" onClick={()=>setNotice('')}>{notice} ×</button>}</article>
      </div>
      <footer className="phone-actions"><button className="phone-write" onClick={()=>setSheet('comments')}>说点什么…</button><button aria-label="预览点赞" aria-pressed={liked} onClick={()=>setLiked(!liked)}>{liked?<HeartFilled style={{color:'#ff2442'}}/>:<HeartOutlined/>}<small>{liked?1:'赞'}</small></button><button aria-label="预览收藏" aria-pressed={saved} onClick={()=>setSaved(!saved)}>{saved?<StarFilled style={{color:'#f5b83d'}}/>:<StarOutlined/>}<small>{saved?1:'收藏'}</small></button><button aria-label="预览评论" onClick={()=>setSheet('comments')}><MessageOutlined/><small>{comments.length || '评论'}</small></button><button aria-label="预览分享" onClick={()=>setSheet('share')}><ShareAltOutlined/></button></footer>
      <div className="phone-home"><i/></div>
      {sheet && <div className="phone-sheet-mask" onClick={()=>setSheet(null)}><section className="phone-sheet" role="dialog" aria-label={sheet==='comments'?'评论预览':'分享预览'} onClick={e=>e.stopPropagation()}><header><strong>{sheet==='comments'?`评论 (${comments.length})`:'分享预览'}</strong><button aria-label="关闭手机弹层" onClick={()=>setSheet(null)}><CloseOutlined/></button></header>{sheet==='comments'?<><div className="phone-comment-list">{comments.length?comments.map((text,i)=><p key={i}><b>我</b> {text}</p>):<p>还没有评论，来写下第一条吧</p>}</div><form onSubmit={e=>{e.preventDefault();if(draft.trim()){setComments([...comments,draft.trim()]);setDraft('');}}}><input aria-label="预览评论内容" placeholder="写一条评论…" value={draft} onChange={e=>setDraft(e.target.value)}/><button disabled={!draft.trim()}>发送</button></form></>:<><p>看看读者打开分享菜单时的效果</p><div className="phone-share-options">{['微信好友','朋友圈','复制链接'].map(label=><button key={label} onClick={()=>{setNotice(`${label} · 预览操作，未实际分享`);setSheet(null);}}><ShareAltOutlined/>{label}</button>)}</div></>}</section></div>}
    </div>
  </aside>;
}
