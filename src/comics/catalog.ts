import { invoke } from "@tauri-apps/api/core";
import validate from "./template-validator";
import { native } from "../workspace";
import type { Template, FeedConfig } from "./types";
export const feedConfig: FeedConfig = {
  mode: "builtin",
  endpoint: "",
  enabled: false,
};
export const templateSource = {
  repository: "littleweb/workstore",
  branch: "main",
  path: "content/comics/catalog.json",
};
export function validateTemplates(value: unknown): Template[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error("模板目录格式无效");
  const ids = new Set<string>();
  for (const t of value) {
    if (!validate(t))
      throw new Error(
        `模板格式无效：${validate.errors?.[0]?.instancePath} ${validate.errors?.[0]?.message}`
      );
    if (
      ids.has(t.templateId) ||
      t.example.length !== t.defaultPages ||
      t.beats.length !== t.defaultPages ||
      !t.supportedCounts.includes(t.defaultPages)
    )
      throw new Error("模板编号或张数无效");
    ids.add(t.templateId);
    const entities = new Set(t.entities.map((e: { id: string }) => e.id));
    if (entities.size !== t.entities.length) throw new Error("资产编号重复");
    const pages = new Set();
    for (const p of t.example) {
      if (
        pages.has(p.id) ||
        p.entityIds.some((id: string) => !entities.has(id))
      )
        throw new Error("分镜编号或资产引用无效");
      pages.add(p.id);
    }
    for (const p of [
      t.cover,
      ...t.example.map((p) => p.image),
      ...t.entities.map((e) => e.reference),
    ].filter((p): p is NonNullable<typeof p> => !!p)) {
      if (p.crop) {
        const [x, y, w, h] = p.crop;
        if (w <= 0 || h <= 0 || x + w > 1.000001 || y + h > 1.000001)
          throw new Error("模板图片裁切范围无效");
      }
    }
  }
  return value as Template[];
}
let builtin: Template[] = [];
export let templateUpdateStatus = "使用内置模板";
export async function loadTemplates(): Promise<Template[]> {
  const response = await fetch("/comics/templates.json");
  if (!response.ok) throw new Error("默认模板未能读取");
  builtin = validateTemplates(await response.json());
  if (!native) return builtin;
  try {
    const cached = await invoke<{ templates: unknown[]; token?: string }>(
      "comic_template_catalog",
      {
        refresh: false,
      }
    );
    return mergeTemplates(builtin, validateTemplates(cached.templates));
  } catch {
    return builtin;
  }
}
export function mergeTemplates(
  local: Template[],
  remote: Template[]
): Template[] {
  const map = new Map(local.map((t) => [t.templateId, t]));
  for (const t of remote) {
    const old = map.get(t.templateId);
    if (!old || old.revision < t.revision) map.set(t.templateId, t);
  }
  return [...map.values()];
}
export async function refreshTemplates(): Promise<Template[]> {
  if (!native) throw new Error("请在桌面版中更新公共模板");
  const candidate = await invoke<{ templates: unknown[]; token: string }>(
    "comic_template_catalog",
    { refresh: true }
  );
  const remote = validateTemplates(candidate.templates);
  await invoke("comic_template_activate", { token: candidate.token });
  templateUpdateStatus = "已从公共仓库更新";
  return mergeTemplates(builtin, remote);
}
export async function loadFeatured(
  templates: Template[],
  config = feedConfig
): Promise<Template[]> {
  if (config.mode === "builtin" || !config.enabled) {
    const response = await fetch("/comics/featured.json");
    if (!response.ok) throw new Error("默认精选作品未能读取");
    return mergeTemplates(
      (builtin.length ? builtin : templates).slice(0, 6),
      validateTemplates(await response.json())
    );
  }
  throw new Error("线上爆款数据源尚未启用，当前版本使用默认示例");
}
