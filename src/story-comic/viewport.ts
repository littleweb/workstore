export const pageStripWidth = (count: number, pageWidth = 420) =>
  Math.max(pageWidth, (count - 1) * (pageWidth + 28) + pageWidth);
export function visibleViewport(
  view: { x: number; y: number; zoom: number },
  width: number,
  height: number,
  count: number,
  pageWidth = 420
) {
  const zoom =
    Number.isFinite(view.zoom) && view.zoom > 0
      ? Math.max(0.2, Math.min(2, view.zoom))
      : 1;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Number.isFinite(value) ? value : 24));
  return {
    zoom,
    x: clamp(
      view.x,
      Math.min(24, width - 24 - pageStripWidth(count, pageWidth) * zoom),
      24
    ),
    y: clamp(view.y, Math.min(24, height - 24 - 640 * zoom), 24),
  };
}
