export type PrintMode = "single" | "duplex" | "booklet";
export type PrintSide = "all" | "front" | "back";
export type PrintSettings = { mode: PrintMode; margin: number; binding: number; numbers: boolean; coverBlank: boolean; side: PrintSide; reverseBack: boolean };
export type PrintSheet = { sheet: number; back: boolean; slots: (number | null)[] };
export const printDefaults: PrintSettings = { mode: "duplex", margin: 12, binding: 6, numbers: true, coverBlank: false, side: "all", reverseBack: false };
/** Zero-based comic indices; null is an intentional blank, never a missing image. */
export function printLayout(count: number, settings: PrintSettings): PrintSheet[] {
  if (!count) return [];
  const pages: (number | null)[] = Array.from({ length: count }, (_, i) => i);
  const sheets: PrintSheet[] = [];
  if (settings.mode === "booklet") {
    while (pages.length % 4) pages.push(null);
    for (let i = 0; i < pages.length / 4; i++) {
      sheets.push({ sheet: i + 1, back: false, slots: [pages[pages.length - 1 - i * 2], pages[i * 2]] });
      sheets.push({ sheet: i + 1, back: true, slots: [pages[i * 2 + 1], pages[pages.length - 2 - i * 2]] });
    }
  } else {
    if (settings.mode === "duplex" && settings.coverBlank) pages.splice(1, 0, null);
    if (settings.mode === "duplex" && pages.length % 2) pages.push(null);
    pages.forEach((page, i) => sheets.push({ sheet: settings.mode === "single" ? i + 1 : Math.floor(i / 2) + 1, back: settings.mode !== "single" && i % 2 === 1, slots: [page] }));
  }
  const selected = settings.mode === "single" || settings.side === "all" ? sheets : sheets.filter(s => s.back === (settings.side === "back"));
  return settings.mode !== "single" && settings.side === "back" && settings.reverseBack ? selected.reverse() : selected;
}
export function paperSize(mode: PrintMode) { return mode === "booklet" ? { width: 297, height: 210 } : { width: 210, height: 297 }; }
export function slotRect(settings: PrintSettings, sheet: PrintSheet, slot: number) {
  const paper = paperSize(settings.mode), half = paper.width / sheet.slots.length;
  const leftBinding = settings.mode === "booklet" ? slot === 1 : settings.mode === "duplex" && !sheet.back;
  const rightBinding = settings.mode === "booklet" ? slot === 0 : settings.mode === "duplex" && sheet.back;
  return { x: half * slot + settings.margin + (leftBinding ? settings.binding : 0), y: settings.margin,
    width: half - settings.margin * 2 - ((leftBinding || rightBinding) ? settings.binding : 0),
    height: paper.height - settings.margin * 2 - (settings.numbers ? 6 : 0) };
}
export function fitPrintImage(box: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  const scale = Math.min(box.width / width, box.height / height);
  return { x: box.x + (box.width - width * scale) / 2, y: box.y + (box.height - height * scale) / 2, width: width * scale, height: height * scale };
}
