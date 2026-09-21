import { convertToExcalidrawElements, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { SelectionSnapshot } from "./selectionEditing";

export type RegionLayout = {
  containerId: string;
  style: "inherit" | "hand-drawn";
  items: { id: string; type: "rectangle" | "ellipse" | "text" | "line"; x: number; y: number; width: number; height: number; text?: string; fontSize?: number }[];
};
export function elementBox(element: ExcalidrawElement) {
  const [x, y, right, bottom] = getCommonBounds([element]);
  return { x, y, width: right - x, height: bottom - y };
}
export function containsElement(container: ExcalidrawElement, child: ExcalidrawElement) {
  const a = elementBox(container), b = elementBox(child);
  return b.x >= a.x - .01 && b.y >= a.y - .01 && b.x + b.width <= a.x + a.width + .01 && b.y + b.height <= a.y + a.height + .01;
}
export function findRegionContainer(elements: readonly ExcalidrawElement[]) {
  const candidates = elements.filter(e => (e.type === "rectangle" || e.type === "frame") && !e.locked && !e.isDeleted &&
    Math.abs(e.angle) < .0001 && e.width >= 120 && e.height >= 80 && elements.every(other => other.id === e.id || containsElement(e, other)));
  return candidates.length === 1 ? candidates[0] : null;
}
export function regionInsertionArea(source: SelectionSnapshot) {
  const container = source.containerId ? source.elements.find(e => e.id === source.containerId) : findRegionContainer(source.elements);
  if (!container || !["rectangle", "frame"].includes(container.type) || container.locked || Math.abs(container.angle) > .0001) return null;
  const padding = Math.min(container.width, container.height) * .035;
  const inner = { x: container.x + padding, y: container.y + padding, width: container.width - padding * 2, height: container.height - padding * 2 };
  const designWidth = 1000, scale = inner.width / designWidth;
  const designHeight = Math.floor(inner.height / scale);
  if (designHeight < 100 || designHeight > 5000) return null;
  return { container, inner, designWidth, designHeight, scale };
}
export function regionLayoutReference(source: SelectionSnapshot) {
  const area = regionInsertionArea(source);
  if (!area) return null;
  return {
    containerId: area.container.id, designWidth: area.designWidth, designHeight: area.designHeight,
    paddingAlreadyReserved: true,
    occupied: source.elements.filter(e => e.id !== area.container.id && !e.isDeleted).map(e => {
      const b = elementBox(e);
      return { id: e.id, type: e.type, x: (b.x - area.inner.x) / area.scale, y: (b.y - area.inner.y) / area.scale,
        width: b.width / area.scale, height: b.height / area.scale };
    }),
    style: { strokeColor: area.container.strokeColor, strokeWidth: area.container.strokeWidth, roughness: area.container.roughness,
      fillStyle: area.container.fillStyle, backgroundColor: area.container.backgroundColor },
  };
}
const invalid = (): never => { throw new Error("框内布局无效或超出范围，未绘制新内容。请让 AI 按提供的可用区域重新布局。"); };
export function parseRegionLayout(value: unknown, source: SelectionSnapshot): RegionLayout {
  const area = regionInsertionArea(source);
  if (!area || !value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["containerId", "style", "items"].includes(k)) || v.containerId !== area.container.id ||
    !["inherit", "hand-drawn"].includes(String(v.style)) || !Array.isArray(v.items) || !v.items.length || v.items.length > 60) return invalid();
  const ids = new Set<string>();
  const items = v.items.map((raw): RegionLayout["items"][number] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(k => !["id", "type", "x", "y", "width", "height", "text", "fontSize"].includes(k)) ||
      typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(item.id) || ids.has(item.id) ||
      !["rectangle", "ellipse", "text", "line"].includes(String(item.type))) return invalid();
    ids.add(item.id);
    for (const key of ["x", "y", "width", "height"] as const) if (typeof item[key] !== "number" || !Number.isFinite(item[key])) return invalid();
    const { x, y, width, height } = item as { x: number; y: number; width: number; height: number };
    if (x < 0 || y < 0 || width < 0 || height < 0 || x + width > area.designWidth || y + height > area.designHeight ||
      (item.type === "line" ? Math.max(width, height) < 1 : width < 10 || height < 10)) return invalid();
    if (item.text !== undefined && (typeof item.text !== "string" || item.text.length > 2000)) return invalid();
    if (item.type === "text" && (typeof item.text !== "string" || !item.text.trim())) return invalid();
    if (item.type === "line" && (item.text !== undefined || item.fontSize !== undefined)) return invalid();
    if (item.fontSize !== undefined && (typeof item.fontSize !== "number" || !Number.isFinite(item.fontSize) || item.fontSize < 12 || item.fontSize > 80)) return invalid();
    return { id: item.id, type: item.type as RegionLayout["items"][number]["type"], x, y, width, height,
      ...(item.text !== undefined ? { text: item.text as string } : {}), ...(item.fontSize !== undefined ? { fontSize: item.fontSize as number } : {}) };
  });
  return { containerId: area.container.id, style: v.style as RegionLayout["style"], items };
}
export function regionLayoutElements(layout: RegionLayout, source: SelectionSnapshot) {
  const checked = parseRegionLayout(layout, source), area = regionInsertionArea(source)!;
  const c = area.container;
  const label = source.elements.find(e => e.type === "text");
  const fontFamily = checked.style === "hand-drawn" ? (label?.type === "text" && [1, 5].includes(label.fontFamily) ? label.fontFamily : 5)
    : label?.type === "text" ? label.fontFamily : 5;
  const roughness = checked.style === "hand-drawn" ? Math.max(1, c.roughness) : c.roughness;
  const frameId = c.type === "frame" ? c.id : c.frameId;
  const skeletons: ExcalidrawElementSkeleton[] = checked.items.map(item => {
    const base = { id: crypto.randomUUID(), x: area.inner.x + item.x * area.scale, y: area.inner.y + item.y * area.scale,
      width: item.width * area.scale, height: item.height * area.scale, strokeColor: c.strokeColor,
      strokeWidth: c.strokeWidth, strokeStyle: c.strokeStyle, fillStyle: c.fillStyle, roughness,
      opacity: c.opacity, backgroundColor: "transparent", frameId, roundness: c.roundness ? { ...c.roundness } : null };
    if (item.type === "line") return { ...base, type: "line", points: [[0, 0], [base.width, base.height]] };
    if (item.type === "text") return { ...base, type: "text", text: item.text!, fontSize: (item.fontSize ?? 24) * area.scale,
      fontFamily, textAlign: "left", verticalAlign: "top", autoResize: false };
    return { ...base, type: item.type, ...(item.text?.trim() ? {
      label: { text: item.text, fontFamily, fontSize: (item.fontSize ?? 24) * area.scale, textAlign: "left", verticalAlign: "middle" },
    } : {}) };
  });
  const elements = convertToExcalidrawElements(skeletons, { regenerateIds: false }).map(element => ({
    ...element, frameId, // converter-generated bound labels must share their parent's frame
  }));
  if (elements.length + source.elements.length > 100) throw new Error("新增元素过多，请将本次原型拆分为更小的区域，未绘制新内容。");
  // Restore/generation can expand text containers. Validate the *actual* result,
  // not only the suggested boxes. Oversized labels never leak outside the region.
  for (const e of elements) {
    const b = elementBox(e);
    if (b.x < area.inner.x - .1 || b.y < area.inner.y - .1 || b.x + b.width > area.inner.x + area.inner.width + .1 ||
      b.y + b.height > area.inner.y + area.inner.height + .1) return invalid();
  }
  return elements;
}
export function assertRegionSpace(current: readonly ExcalidrawElement[], source: SelectionSnapshot, generated: readonly ExcalidrawElement[], created: ReadonlySet<string> = new Set()) {
  const area = regionInsertionArea(source);
  if (!area) return invalid();
  if (area.container.frameId && !current.some(e => e.id === area.container.frameId && e.type === "frame" && !e.isDeleted)) {
    throw new Error("容器所属的画框已变化，已停止绘制。请重新选择目标区域。");
  }
  const obstacles = current.filter(e => !e.isDeleted && !created.has(e.id) && e.id !== area.container.id &&
    // Outer frames/containers are not obstacles; all other existing elements,
    // even locked/unsupported ones, must not be covered by new controls.
    !(["frame", "rectangle"].includes(e.type) && containsElement(e, area.container)));
  for (const added of generated) {
    const a = elementBox(added);
    for (const existing of obstacles) {
      const b = elementBox(existing);
      if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .5 &&
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .5) {
        throw new Error("框内已有内容与新增控件重叠，已停止绘制并保留原内容。请指定留白区域后重试。");
      }
    }
  }
}
