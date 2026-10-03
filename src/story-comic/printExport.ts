import { invoke } from "@tauri-apps/api/core";
import { native } from "../workspace";
import { download, pdfBlob } from "./export";
import { loadImage } from "./render";
import type { Page } from "./model";
import { fitPrintImage, paperSize, printLayout, slotRect, type PrintSettings } from "./printLayout";

/** Rasterize one sheet at a time at 300 dpi; preserve full artwork without cropping. */
export async function renderPrintSheets(pages: Page[], settings: PrintSettings, progress?: (done: number, total: number) => void) {
  const sheets = printLayout(pages.length, settings), paper = paperSize(settings.mode);
  if (!sheets.length || pages.some(p => !p.image)) throw new Error("请先生成全部漫画页面，再打印");
  const images: string[] = [], px = 300 / 25.4;
  for (const [i, sheet] of sheets.entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(paper.width * px); canvas.height = Math.round(paper.height * px);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法准备打印页面");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [slot, page] of sheet.slots.entries()) {
      if (page === null) continue;
      const image = await loadImage(pages[page].image!);
      const rect = fitPrintImage(slotRect(settings, sheet, slot), image.width, image.height);
      ctx.drawImage(image, rect.x * px, rect.y * px, rect.width * px, rect.height * px);
      if (settings.numbers) {
        ctx.fillStyle = "#555"; ctx.font = `${3 * px}px sans-serif`; ctx.textAlign = "center";
        ctx.fillText(String(page + 1), paper.width / sheet.slots.length * (slot + .5) * px, (paper.height - settings.margin) * px);
      }

    }
    images.push(canvas.toDataURL("image/jpeg", .96));
    canvas.width = canvas.height = 0;
    progress?.(i + 1, sheets.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return images;
}
export async function exportPrintPdf(pages: Page[], title: string, settings: PrintSettings, progress?: (done: number, total: number) => void) {
  const images = await renderPrintSheets(pages, settings, progress), paper = paperSize(settings.mode);
  const blob = await pdfBlob(images, { width: paper.width * 72 / 25.4, height: paper.height * 72 / 25.4, duplex: settings.mode === "single" || settings.side !== "all" ? undefined : settings.mode === "booklet" ? "short" : "long" });
  await download(blob, `${title.replace(/[\\/:*?"<>|]/g, "_")}-A4${settings.mode === "booklet" ? "小册子" : settings.mode === "duplex" ? "双面" : ""}${settings.mode !== "single" && settings.side !== "all" ? settings.side === "front" ? "-正面" : "-背面" : ""}.pdf`, "pdf");
}
let printRoot: HTMLElement | undefined;
export function clearPrintDocument() { printRoot?.remove(); printRoot = undefined; }
export async function printSheets(pages: Page[], settings: PrintSettings, progress?: (done: number, total: number) => void) {
  const images = await renderPrintSheets(pages, settings, progress), paper = paperSize(settings.mode);
  clearPrintDocument();
  const root = document.createElement("div"); root.id = "story-print-document"; root.style.display = "none";
  const style = document.createElement("style");
  style.textContent = `@media print { @page { size: ${paper.width}mm ${paper.height}mm; margin: 0; } html, body { margin: 0 !important; padding: 0 !important; background: white !important; height: auto !important; overflow: visible !important; } body > :not(#story-print-document) { display: none !important; } #story-print-document { display: block !important; } #story-print-document img { display: block; width: ${paper.width}mm; height: calc(${paper.height}mm - 1px); max-width: none; margin: 0 !important; padding: 0 !important; border: 0 !important; box-sizing: border-box; break-inside: avoid; page-break-inside: avoid; break-after: page; page-break-after: always; } #story-print-document img:last-child { break-after: auto; page-break-after: auto; } }`;
  root.append(style); document.body.append(root); printRoot = root;
  try {
    await Promise.all(images.map(async src => { const image = document.createElement("img"); image.src = src; root.append(image); await image.decode(); }));
    window.addEventListener("afterprint", clearPrintDocument, { once: true });
    // WKWebView does not reliably forward the JavaScript print request.
    const opened = native && await invoke<boolean>("open_story_comic_print_dialog", { landscape: settings.mode === "booklet" });
    if (!opened) window.print();
  } catch (error) { clearPrintDocument(); throw error; }
}
