import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Select, Switch } from "antd";
import { PrinterOutlined, FilePdfOutlined } from "@ant-design/icons";
import type { Page } from "./model";
import { clearPrintDocument, exportPrintPdf, printSheets } from "./printExport";
import { paperSize, printDefaults, printLayout, slotRect, type PrintSettings } from "./printLayout";
import "./print.css";

export default function PrintPanel({ pages, title, renderImage }: { pages: Page[]; title: string; renderImage: (page: Page, index: number) => ReactNode }) {
  const [settings, setSettings] = useState<PrintSettings>(printDefaults), [working, setWorking] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState("");
  useEffect(() => () => clearPrintDocument(), []);
  const patch = (value: Partial<PrintSettings>) => setSettings(s => ({ ...s, ...value }));
  const sheets = printLayout(pages.length, settings), all = printLayout(pages.length, { ...settings, side: "all" }), paper = paperSize(settings.mode);
  const ready = pages.length > 0 && pages.every(p => !!p.image), blanks = all.reduce((n, s) => n + s.slots.filter(p => p === null).length, 0);
  async function output(pdf: boolean) {
    setWorking(true); setError(""); setProgress("准备打印页面…");
    try {
      const report = (done: number, total: number) => setProgress(`准备打印页面 ${done}/${total}`);
      if (pdf) await exportPrintPdf(pages, title, settings, report); else await printSheets(pages, settings, report);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); setProgress(""); }
  }
  return <div className="story-print-layout">
    <aside className="story-print-settings">
      <div className="story-print-settings-scroll">
      <h2>把故事印成一本书</h2><p>A4 纸 · 完整保留画面</p>
      <fieldset disabled={working}>
        <label>排版方式<Select disabled={working} aria-label="打印排版" value={settings.mode} onChange={mode => patch({ mode, side: "all", reverseBack: false })} options={[{ value: "single", label: "普通 A4 · 单面" }, { value: "duplex", label: "A4 双面 · 左侧装订" }, { value: "booklet", label: "对折小册子 · A4 印成 A5" }]} /></label>
        <label>纸张边距<Select disabled={working} aria-label="打印边距" value={settings.margin} onChange={margin => patch({ margin })} options={[8, 12, 16, 20].map(value => ({ value, label: `${value} mm` }))} /></label>
        {settings.mode !== "single" && <label>装订预留<Select disabled={working} aria-label="装订预留" value={settings.binding} onChange={binding => patch({ binding })} options={[0, 4, 6, 8, 12].map(value => ({ value, label: `${value} mm` }))} /></label>}
        {settings.mode === "duplex" && <label className="story-print-toggle">封面背面留白<Switch aria-label="封面背面留白" checked={settings.coverBlank} onChange={coverBlank => patch({ coverBlank })} disabled={working} /></label>}
        {settings.mode !== "single" && <><label>输出页面<Select disabled={working} aria-label="打印输出页面" value={settings.side} onChange={side => patch({ side })} options={[{ value: "all", label: "全部 · 自动双面打印" }, { value: "front", label: "只输出正面 · 手动双面第一步" }, { value: "back", label: "只输出背面 · 手动双面第二步" }]} /></label>{settings.side === "back" && <label className="story-print-toggle">背面倒序输出<Switch aria-label="背面倒序输出" checked={settings.reverseBack} onChange={reverseBack => patch({ reverseBack })} disabled={working} /></label>}</>}
        <label className="story-print-toggle">显示漫画页码<Switch aria-label="显示漫画页码" checked={settings.numbers} onChange={numbers => patch({ numbers })} disabled={working} /></label>
      </fieldset>
      <div className="story-print-instructions"><strong>打印设置</strong><p>选择 A4、实际大小 / 100%，关闭页眉页脚，每张纸打印 1 页。</p>{settings.mode === "single" ? <p>使用纵向、单面打印。</p> : settings.mode === "booklet" ? <p>使用横向、短边翻转双面打印。页序已重排，打印后按纸张顺序叠放，对折装订。</p> : <p>使用纵向、长边翻转双面打印。装订边距已左右镜像。</p>}{settings.mode !== "single" && <p>手动双面：先印正面，再把纸放回纸盒印背面。不同打印机进纸方向不同，先试印 1 张；按进纸顺序选择背面倒序。</p>}</div>
      {!ready && <p className="story-print-warning">{pages.length ? `还有 ${pages.filter(p => !p.image).length} 页未生成，完成后可打印。` : "生成漫画后，在这里预览和打印。"}</p>}
      {error && <p role="alert" className="story-print-warning">{error}</p>}
      </div>
      <footer className="story-print-footer">
      <div className="story-print-actions"><Button type="primary" icon={<PrinterOutlined />} disabled={!ready || working} loading={working} onClick={() => void output(false)}>打印</Button><Button icon={<FilePdfOutlined />} disabled={!ready || working} onClick={() => void output(true)}>导出打印 PDF</Button></div>
      {progress && <p role="status">{progress}</p>}
      </footer>
    </aside>
    <section className="story-print-preview" aria-label="A4打印预览"><header><h3>纸张预览</h3><span>{pages.length} 页漫画 · {settings.mode === "single" ? all.length : all.length / 2} 张 A4{blanks ? ` · 补 ${blanks} 页空白` : ""}</span></header><p className="story-print-preview-hint">{settings.mode === "booklet" ? "横向 A4，中线为对折位置，已按装订顺序排版。" : "每张纸的正反面依次展示，空白页也会保留在打印文件中。"}</p>
      <div className="story-print-sheets">{sheets.map(sheet => <figure key={`${sheet.sheet}-${sheet.back}`}><figcaption>第 {sheet.sheet} 张纸{settings.mode !== "single" ? sheet.back ? " · 背面" : " · 正面" : ""}</figcaption><div className="story-print-paper" style={{ aspectRatio: `${paper.width}/${paper.height}` }}>{settings.mode === "booklet" && <i className="story-print-fold" />}{sheet.slots.map((page, slot) => {
        const rect = slotRect(settings, sheet, slot), style: CSSProperties = { left: `${rect.x / paper.width * 100}%`, top: `${rect.y / paper.height * 100}%`, width: `${rect.width / paper.width * 100}%`, height: `${rect.height / paper.height * 100}%` };
        return <div key={slot} className="story-print-slot" style={style}>{page === null ? <span className="story-print-blank">空白页</span> : pages[page].image ? renderImage(pages[page], page) : <span className="story-print-blank">第 {page + 1} 页待生成</span>}{page !== null && settings.numbers && <small className="story-print-page-number">{page + 1}</small>}</div>;
      })}</div></figure>)}</div>{!sheets.length && <div className="story-print-no-pages">暂无漫画页面</div>}</section>
  </div>;
}
