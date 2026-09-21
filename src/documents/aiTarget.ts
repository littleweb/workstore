import { assertEditorTarget, documentDraftHtml, type EditorTarget } from "../ai/editing";
import { currentDocument, createDocument, flushDocuments, flushDocument, applyDocumentContent, stageDocument } from "./store";

export function documentAiTarget(activeId: () => string | null, onCreated: (id: string) => void): EditorTarget {
  const capture = () => {
    const id = activeId(), doc = id ? currentDocument(id) : undefined;
    return { id: doc?.id ?? null, title: doc?.title ?? "新文档", content: doc?.content ?? "" };
  };
  return {
    kind: "document", capture,
    async apply(draft, source, mode) {
      if (draft.kind !== "document") throw new Error("不能把白板草稿写入文档");
      const html = documentDraftHtml(draft);
      await flushDocuments(); // Save the current version first; a failed save prevents replacement.
      const current = capture();
      assertEditorTarget(current, source, mode);
      const id = mode === "create" ? (await createDocument()).id : current.id!;
      if (mode === "create") stageDocument(id, { title: draft.title });
      applyDocumentContent(id, mode === "append" ? current.content + html : html);
      let saved = true;
      try { await flushDocument(id); } catch { saved = false; }
      if (mode === "create" && activeId() === current.id) onCreated(id);
      return { saved, message: saved
        ? `${mode === "create" ? "已创建新文档" : mode === "append" ? "已追加到当前文档" : "已替换当前文档正文"}，并保存到本地。`
        : "内容已应用到编辑器，但磁盘保存失败。请在文档保存提示处重试或导出备份；不要重复应用。" };
    },
  };
}
