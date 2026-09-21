import { CaptureUpdateAction, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { captureSelection, mergeSelectionPatch, type SelectionTarget } from "./selectionEditing";
import { currentBoard, flushBoard, stageBoard, type Scene } from "./store";

export function whiteboardSelectionTarget(activeId: () => string | null, canvas: () => ExcalidrawImperativeAPI | null): SelectionTarget {
  const current = () => {
    const id = activeId(), api = canvas();
    if (!id || !api || !currentBoard(id)) throw new Error("请先打开白板并选择内容。");
    return { id, api };
  };
  return {
    capture() {
      const { id, api } = current();
      const state = api.getAppState();
      if (state.editingTextElement) throw new Error("请先结束文字输入，再把选区加入对话。");
      return captureSelection(id, api.getSceneElements(), state.selectedElementIds);
    },
    async apply(source, patch, signal) {
      const first = current();
      if (source.boardId !== first.id) throw new Error("白板已切换，未应用修改。");
      if (signal.aborted) throw new Error("已停止，未应用修改。");
      await flushBoard(first.id);
      const { id, api } = current();
      if (id !== source.boardId || api !== first.api) throw new Error("白板会话已变化，未应用修改，请重新加入选区。");
      if (signal.aborted) throw new Error("已停止，未应用修改。");
      if (document.body.inert) throw new Error("当前正在应用其他同步结果，请稍后重试，选区未修改。");
      if (api.getAppState().editingTextElement) throw new Error("白板正在输入文字，未覆盖内容。请结束输入后重试。");
      const original = api.getSceneElementsIncludingDeleted();
      const next = mergeSelectionPatch(original, source, patch);
      if (!next.changed) return { selection: source, saved: true, changed: false };
      const previousScene = currentBoard(id)!.scene;
      const nextScene = JSON.parse(serializeAsJSON(next.elements, api.getAppState(), api.getFiles(), "local")) as Scene;
      // No await between final comparison and scene application. Use a real
      // Excalidraw history entry, not a remount, so Ctrl/Cmd+Z remains available.
      stageBoard(id, { scene: nextScene });
      try { api.updateScene({ elements: next.elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY }); }
      catch (error) { stageBoard(id, { scene: previousScene }); throw error; }
      const selection = captureSelection(id, api.getSceneElements(), source.containerId ? { [source.containerId]: true } : Object.fromEntries(source.elements.map(element => [element.id, true])));
      let saved = true;
      try { await flushBoard(id); } catch { saved = false; }
      return { selection, saved, changed: true };
    },
  };
}
