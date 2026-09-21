import type { Work } from './model';

export default function Cover({ work }: { work: Work }) {
  return <div className={`apos-cover apos-cover--${work.cover}`} aria-hidden="true">
    {work.cover === 'report' && <div className="apos-report-paper">
      <span className="apos-eyebrow">MONTHLY REVIEW</span>
      <strong className="apos-paper-title">每一份努力，都有回响</strong>
      <div className="apos-report-numbers"><div><b>248,800</b><small>本月营收 · CNY</small></div><span className="apos-trend">↗ 18.6%</span></div>
      <div className="apos-bars">{[29, 46, 35, 64, 57, 80, 100].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</div>
    </div>}
    {work.cover === 'editorial' && <>
      <div className="apos-edition"><span>THE FIRST LETTER</span><span>01</span></div>
      <strong className="apos-editorial-title">从一页空白，<br />到无限可能。</strong>
      <div className="apos-editorial-line" /><span className="apos-editorial-caption">写给每一个，刚刚开始的你。</span>
    </>}
    {work.cover === 'dashboard' && <div className="apos-dashboard">
      <div className="apos-dashboard-title"><span>销售数据分析</span><span className="apos-dots">•••</span></div>
      <div className="apos-kpis"><div><small>总销售额</small><b>128,560</b></div><div><small>转化率</small><b>24.8%</b></div></div>
      <div className="apos-horizontal-bars">{[77, 59, 43, 30].map((width, i) => <div key={i}><small>产品 {String.fromCharCode(65 + i)}</small><i style={{ width: `${width}%` }} /></div>)}</div>
    </div>}
    {work.cover === 'draft' && <div className="apos-draft-paper" data-style={work.style}>
      <span className="apos-eyebrow">A NEW IDEA</span><strong>{work.name}</strong>
      <span className="apos-draft-rule" /><small>{work.style} / {work.size} / {work.episodes} 集</small>
    </div>}
  </div>;
}
