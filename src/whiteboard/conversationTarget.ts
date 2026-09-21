import { CaptureUpdateAction, newElementWith, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { assertRegionSpace, parseRegionLayout, regionInsertionArea, regionLayoutElements } from "./regionLayout";
import { draftElements } from "./aiTarget";
import { captureCanvasContext, type CanvasConversationTarget } from "./conversationPlan";
import { captureSelection, mergeSelectionPatch, validateSelection, type SelectionSnapshot } from "./selectionEditing";
import { currentBoard, createBoard, flushBoard, stageBoard, type Scene } from "./store";

const pause = (signal: AbortSignal, ms: number) => new Promise<void>(resolve => {
  if (signal.aborted) { resolve(); return; }
  const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
  const timer = setTimeout(finish, ms);
  signal.addEventListener("abort", finish, { once: true });
});
export function whiteboardConversationTarget(
  activeId: () => string | null, canvas: () => ExcalidrawImperativeAPI | null, onCreated: (id: string) => void,
  stepPause: (signal: AbortSignal, ms: number) => Promise<void> = pause,
): CanvasConversationTarget {
  return {
    async retrySave() {
      const id = activeId();
      if (!id || !currentBoard(id)) throw new Error("当前没有可保存的白板。");
      await flushBoard(id);
    },
    capture(attachment, includeCanvas) {
      const id = activeId(), api = canvas();
      if (id && (!api || !currentBoard(id))) throw new Error("白板尚未准备好，请稍后发送。");
      if (api?.getAppState().editingTextElement) throw new Error("请先结束白板文字输入，再发送给 AI。");
      return captureCanvasContext(id, api?.getSceneElements() ?? [], attachment, includeCanvas);
    },
    async execute(context, plan, signal, report) {
      let id = context.boardId, api = canvas();
      if (signal.aborted) return { done: 0, total: 0, saved: true, stopped: true, region: null };
      if (activeId() !== id) throw new Error("白板已切换，未执行这次操作。");
      const fullPlan = plan.changes.changes.length > 0;
      if (plan.layout && (!context.scoped || plan.diagram || fullPlan)) throw new Error("框内新增必须限定容器范围，且不能同时修改其他内容。");
      if (context.scoped && regionInsertionArea(context.region) && plan.diagram) throw new Error("选中了容器，请在框内生成，而不是移动到框外。");
      if (plan.layout) parseRegionLayout(plan.layout, context.region);
      if (!id && !plan.diagram && !plan.layout) return { done: 0, total: 0, saved: true, stopped: false, region: null };
      // Build/validate the entire plan before first write; generated content is
      // native elements, not arbitrary JSON or an AI-controlled script.
      let generated = plan.layout ? regionLayoutElements(plan.layout, context.region) : plan.diagram ? draftElements(plan.diagram) : [];
      if (id) {
        if (!api) throw new Error("白板会话已变化，未执行操作。");
        await flushBoard(id);
        if (api !== canvas() || activeId() !== id) throw new Error("白板会话已变化，未执行操作。");
        if (fullPlan) {
          const scope = context.scoped ? context.region : captureSelection(id, context.region.elements, Object.fromEntries(plan.changes.changes.map(change => [change.id, true])));
          mergeSelectionPatch(api.getSceneElementsIncludingDeleted(), scope, plan.changes);
        }
      }
      if (signal.aborted) return { done: 0, total: 0, saved: true, stopped: true, region: null };
      if (!id) {
        const created = await createBoard(); id = created.id;
        stageBoard(id, { title: plan.diagram!.title });
        // A file was created, never delete it on cancellation. Only focus it if
        // no navigation occurred during creation.
        if (activeId() === null && !signal.aborted) onCreated(id);
        for (let tries = 0; tries < 40 && !signal.aborted; tries++) {
          if (activeId() === id && canvas()) break;
          await stepPause(signal, 50);
        }
        api = activeId() === id ? canvas() : null;
        if (!api || signal.aborted) {
          let saved = true; try { await flushBoard(id); } catch { saved = false; }
          return { done: 0, total: 0, saved, stopped: true, reason: "新白板已保留，画布尚未就绪或操作已停止。", region: null };
        }
      }
      if (!api) throw new Error("白板未就绪。");
      const editingApi = api, boardId = id;
      const valid = () => {
        if (activeId() !== boardId || canvas() !== editingApi) throw new Error("白板会话已变化，已停止后续绘制。");
        if (document.body.inert || editingApi.getAppState().editingTextElement) throw new Error("当前正在同步或编辑文字，已停止后续绘制。");
      };
      valid();
      // Unscoped generation need not lock unrelated old content. Edits track
      // their actual containers/labels; explicit attachments protect the full scope.
      let expected: SelectionSnapshot = context.scoped ? structuredClone(context.region)
        : fullPlan ? captureSelection(boardId, context.region.elements, Object.fromEntries(plan.changes.changes.map(change => [change.id, true])))
        : { boardId, elements: [] };
      // Resolve placement against the latest canvas. Append never clears old
      // elements, including edits made while AI was planning.
      // Use all live bounds locally to avoid drawing over unrelated shapes or
      // additions from an earlier turn, without sending them to a scoped prompt.
      const reference = editingApi.getSceneElements();
      if (plan.layout) {
        validateSelection(reference, context.region);
        assertRegionSpace(reference, context.region, generated);
      } else if (generated.length) {
        if (context.scoped) validateSelection(editingApi.getSceneElements(), context.region);
        const dx = reference.length ? reference.reduce((max, e) => Math.max(max, e.x + Math.abs(e.width)), -Infinity) + 100 - Math.min(...generated.map(e => e.x)) : -Math.min(...generated.map(e => e.x));
        const dy = reference.length ? reference.reduce((min, e) => Math.min(min, e.y), Infinity) - Math.min(...generated.map(e => e.y)) : -Math.min(...generated.map(e => e.y));
        generated = generated.map(e => ({ ...e, x: e.x + dx, y: e.y + dy }));
      }
      const allGenerated = new Map(generated.map(e => [e.id, e]));
      const groups = generated.filter(e => e.type !== "text" || !e.containerId).map(e =>
        generated.filter(item => item.id === e.id || (item.type === "text" && item.containerId === e.id)));
      const createdIds = new Set<string>();
      const steps = [...plan.changes.changes.map(change => ({ type: "change" as const, change })), ...groups.map(elements => ({ type: "add" as const, elements }))];
      let done = 0, reason: string | undefined;
      const write = (elements: readonly ExcalidrawElement[]) => {
        const original = currentBoard(boardId)!.scene;
        const scene = JSON.parse(serializeAsJSON(elements, editingApi.getAppState(), editingApi.getFiles(), "local")) as Scene;
        stageBoard(boardId, { scene });
        try { editingApi.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY }); }
        catch (e) { stageBoard(boardId, { scene: original }); throw e; }
      };
      try {
        for (const step of steps) {
          if (signal.aborted) break;
          valid();
          const latest = editingApi.getSceneElementsIncludingDeleted();
          if (expected.elements.length) validateSelection(latest, expected);
          if (step.type === "change") {
            const next = mergeSelectionPatch(latest, expected, { summary: plan.message, changes: [step.change] });
            if (next.changed) write(next.elements);
          } else {
            if (plan.layout) assertRegionSpace(latest, context.region, step.elements, createdIds);
            for (const element of step.elements) {
              if (latest.some(existing => existing.id === element.id)) throw new Error("新增图形标识发生冲突，已停止绘制。");
              createdIds.add(element.id);
            }
            // Nodes appear first with only currently existing text/arrow bindings.
            // When an arrow arrives its endpoint reverse bindings are updated in
            // that same atomic step; no dangling references between frames.
            const container = plan.layout ? regionInsertionArea(context.region)!.container : null;
            // Frame elements stay above their members in the stacking order. A
            // rectangle container is retained as background, before new controls.
            const frameIndex = container?.type === "frame" ? latest.findIndex(e => e.id === container.id) : -1;
            const ordered = frameIndex >= 0 ? [...latest.slice(0, frameIndex), ...step.elements, ...latest.slice(frameIndex)] : [...latest, ...step.elements];
            const combined = ordered.map(element => {
              const original = allGenerated.get(element.id);
              if (!original) return element;
              const boundElements = original.boundElements?.filter(bound => createdIds.has(bound.id)) ?? null;
              return JSON.stringify(element.boundElements) === JSON.stringify(boundElements) ? element : newElementWith(element, { boundElements });
            });
            write(combined);
            if (done === 0 && !context.region.elements.length) {
              try { editingApi.scrollToContent(step.elements, { fitToContent: true }); } catch { /* drawing succeeded; viewport changes are optional */ }
            }
          }
          done++;
          const live = editingApi.getSceneElements();
          const scopeIds = new Set([...expected.elements.map(e => e.id), ...createdIds]);
          expected = { boardId, elements: structuredClone(live.filter(e => scopeIds.has(e.id))) };
          report({ done, total: steps.length, label: step.type === "change" ? "正在修改画布内容" : step.elements.some(e => e.type === "arrow") ? "正在连接图形" : "正在绘制图形" });
          if (done < steps.length) await stepPause(signal, 220);
        }
      } catch (error) { reason = String(error); }
      let saved = true;
      try { await flushBoard(boardId); } catch { saved = false; }
      if (!done && reason) throw new Error(reason);
      // After a partial stop, preserve the executed steps and report the truth;
      // never roll back over user edits. Undo remains available in Excalidraw.
      let region: SelectionSnapshot | null = null;
      if (context.scoped && activeId() === boardId && canvas() === editingApi) {
        try { region = captureSelection(boardId, editingApi.getSceneElements(), context.region.containerId
          ? { [context.region.containerId]: true }
          : Object.fromEntries([...context.region.elements.map(e => e.id), ...createdIds].map(id => [id, true]))); } catch { /* user removed scope */ }
      }
      return { done, total: steps.length, saved, stopped: done < steps.length, reason, region };
    },
  };
}
