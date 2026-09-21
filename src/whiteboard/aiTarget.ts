import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { assertEditorTarget, diagramConnection, type EditorTarget, type WhiteboardDraft } from "../ai/editing";
import { applyBoardScene, createBoard, currentBoard, flushBoard, flushWhiteboards, stageBoard, type Scene } from "./store";

export function draftElements(draft: WhiteboardDraft) {
  const ids = new Map(draft.nodes.map(node => [node.id, crypto.randomUUID()]));
  const shapes: ExcalidrawElementSkeleton[] = draft.nodes.map(node => ({
    id: ids.get(node.id), type: node.shape, x: node.x, y: node.y, width: node.width, height: node.height,
    strokeColor: "#376c58", backgroundColor: "#edf4f0", fillStyle: "solid", roughness: 0,
    label: { text: node.label, fontSize: 20, fontFamily: 2, textAlign: "center", verticalAlign: "middle" },
  }));
  for (const edge of draft.edges) {
    const a = draft.nodes.find(node => node.id === edge.from)!;
    const b = draft.nodes.find(node => node.id === edge.to)!;
    const { start, end } = diagramConnection(a, b);
    shapes.push({ type: "arrow", x: start.x, y: start.y,
      points: [[0, 0], [end.x - start.x, end.y - start.y]],
      start: { id: ids.get(a.id)! }, end: { id: ids.get(b.id)! },
      strokeColor: "#647b71", roughness: 0,
      ...(edge.label ? { label: { text: edge.label, fontSize: 16, fontFamily: 2 } } : {}),
    });
  }
  return convertToExcalidrawElements(shapes, { regenerateIds: false });
}
export function whiteboardAiTarget(activeId: () => string | null, onCreated: (id: string) => void): EditorTarget {
  const capture = () => {
    const id = activeId(), doc = id ? currentBoard(id) : undefined;
    return { id: doc?.id ?? null, title: doc?.title ?? "新白板", content: doc ? JSON.stringify(doc.scene) : "" };
  };
  return {
    kind: "whiteboard", capture,
    async apply(draft, source, mode) {
      if (draft.kind !== "whiteboard") throw new Error("不能把文档草稿写入白板");
      await flushWhiteboards();
      const current = capture();
      assertEditorTarget(current, source, mode);
      const generated = draftElements(draft);
      const id = mode === "create" ? (await createBoard()).id : current.id!;
      const original = currentBoard(id)!;
      let elements = generated;
      if (mode === "append") {
        const existing = original.scene.elements ?? [];
        const visible = existing.filter(element => !element.isDeleted);
        const dx = visible.length ? visible.reduce((right, e) => Math.max(right, e.x + Math.abs(e.width)), -Infinity) + 100 - Math.min(...generated.map(e => e.x)) : 0;
        elements = generated.map(element => ({ ...element, x: element.x + dx }));
        elements = [...existing, ...elements] as typeof elements;
      }
      const scene: Scene = { ...original.scene, elements, scrollToContent: true,
        // Existing files remain available; new drafts never import remote images.
        files: original.scene.files ?? {},
        appState: { ...original.scene.appState, selectedElementIds: {}, scrollX: 0, scrollY: 0 },
      };
      if (mode === "create") stageBoard(id, { title: draft.title });
      applyBoardScene(id, scene);
      let saved = true;
      try { await flushBoard(id); } catch { saved = false; }
      if (mode === "create" && activeId() === current.id) onCreated(id);
      return { saved, message: saved
        ? `${mode === "create" ? "已创建新白板" : mode === "append" ? "已在现有图形右侧追加" : "已替换当前白板"}，并保存到本地。`
        : "图形已应用到白板，但磁盘保存失败。请重试保存或导出备份；不要重复应用。" };
    },
  };
}
