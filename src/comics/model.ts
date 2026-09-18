import type {
  ComicContent,
  Template,
  Ratio,
  Snapshot,
  Revision,
  Page,
} from "./types";
export function instantiate(
  t: Template,
  theme: string,
  count: number,
  ratio: Ratio
): ComicContent {
  if (!t.supportedCounts.includes(count) || !theme.trim())
    throw new Error("请选择有效张数并输入主题");
  return {
    templateSnapshot: structuredClone(t),
    templateOrigin: { templateId: t.templateId, revision: t.revision },
    settings: {
      theme,
      count,
      ratio,
      style: templateStyle(t.style),
      tone: "跟随模板",
      ending: "跟随模板",
      entities: [],
    },
    pages: Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      title: `第 ${i + 1} 张`,
      action: "等待生成故事",
      dialogue: "",
      entityIds: [],
      state: "",
      status: "draft",
    })),
    history: [],
    currentRevisionId: "",
    publishing: {},
  };
}
export function checkpoint(
  c: ComicContent,
  title: string,
  snapshot?: Snapshot,
  restoredFrom?: string
): ComicContent {
  const s = structuredClone({
    settings: snapshot?.settings ?? c.settings,
    pages: snapshot?.pages ?? c.pages,
  });
  const revision: Revision = {
    ...structuredClone(s),
    id: crypto.randomUUID(),
    parentId: c.currentRevisionId || undefined,
    restoredFrom,
    title,
    createdAt: Date.now(),
  };
  return {
    ...c,
    ...s,
    currentRevisionId: revision.id,
    history: [...c.history, revision],
  };
}
export function parseObject(text: string): Record<string, any> {
  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{"),
      end = raw.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("AI 未返回有效内容，请重试");
    return JSON.parse(raw.slice(start, end + 1));
  }
}
export function parseStory(
  text: string,
  count: number,
  entityIds: string[]
): Page[] {
  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const data = parseObject(raw);
  const pages = data.pages;
  if (!Array.isArray(pages) || pages.length !== count)
    throw new Error(`故事需要恰好 ${count} 张，请重试`);
  return pages.map((p: Record<string, unknown>, i: number) => {
    for (const key of ["title", "action", "dialogue", "state"])
      if (typeof p[key] !== "string" || (p[key] as string).length > 3000)
        throw new Error(`第 ${i + 1} 张内容格式无效`);
    if (
      !Array.isArray(p.entityIds) ||
      p.entityIds.some(
        (id) => typeof id !== "string" || !entityIds.includes(id)
      )
    )
      throw new Error("故事引用了不存在的角色或场景");
    return {
      id: crypto.randomUUID(),
      title: p.title as string,
      action: p.action as string,
      dialogue: p.dialogue as string,
      state: p.state as string,
      entityIds: p.entityIds as string[],
      status: "draft",
    };
  });
}

/** Keep late AI results reviewable without moving the active version. */
export function candidate(
  c: ComicContent,
  snapshot: Snapshot,
  title: string,
  parentId?: string
): ComicContent {
  const revision: Revision = {
    ...structuredClone(snapshot),
    id: crypto.randomUUID(),
    parentId,
    title,
    createdAt: Date.now(),
  };
  return { ...c, history: [...c.history, revision] };
}

/** Template visual direction must never smuggle example characters into a new work. */
export function templateStyle(description: string): string {
  if (/黑白|线稿/.test(description))
    return "黑白线稿，清晰轮廓，简洁分明的明暗层次";
  if (/水彩/.test(description))
    return "清新水彩，柔和色彩，细腻纸张肌理，轻盈手绘线条";
  return "暖色手绘，柔和光影，清晰线条，温暖细腻的绘本质感";
}
