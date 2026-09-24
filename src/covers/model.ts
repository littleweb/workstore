import catalog from "./catalog.json";
import capabilities from "./capabilities.json";
export const styles = catalog.styles;
export const layouts = catalog.layouts;
export const colors = catalog.colors;
export const groups = [...new Set(styles.map((s) => s.group))];
export const ratios = ["2:3", "3:4", "1:1", "4:3", "16:9", "9:16"];
export type CoverConfig = {
  style: string;
  topic: string;
  title: string;
  subtitle: string;
  language: string;
  ratio: string;
  layout: string;
  color: string;
  density: string;
  mood: string;
  instruction: string;
  preserve: boolean;
};
export type CoverVersion = {
  id: string;
  image: string;
  createdAt: number;
  config: CoverConfig;
  prompt: string;
};
export type CoverContent = {
  needsRecommendation?: boolean;
  config: CoverConfig;
  versions: CoverVersion[];
  selectedVersion: string | null;
};
export const emptyContent = (style = "042"): CoverContent => ({
  config: {
    style,
    topic: "",
    title: "",
    subtitle: "",
    language: "中文",
    ratio: "2:3",
    layout: "auto",
    color: "auto",
    density: "低",
    mood: "温暖、俏皮",
    instruction: "",
    preserve: true,
  },
  versions: [],
  selectedVersion: null,
});
function validConfig(c: CoverConfig) {
  return (
    c &&
    [
      "style",
      "topic",
      "title",
      "subtitle",
      "language",
      "ratio",
      "layout",
      "color",
      "density",
      "mood",
      "instruction",
    ].every(
      (k) =>
        typeof c[k as keyof CoverConfig] === "string" &&
        (c[k as keyof CoverConfig] as string).length <= 12000,
    ) &&
    typeof c.preserve === "boolean" &&
    styles.some((s) => s.number === c.style) &&
    ratios.includes(c.ratio) &&
    ["中文", "英文"].includes(c.language) &&
    ["低", "中", "高"].includes(c.density) &&
    (c.layout === "auto" || layouts.some((l) => l.id === c.layout)) &&
    (c.color === "auto" || colors.some((x) => x.id === c.color))
  );
}
export function readContent(raw: string): CoverContent {
  if (!raw) return emptyContent();
  const v = JSON.parse(raw) as CoverContent;
  if (
    !v ||
    !validConfig(v.config) ||
    (v.needsRecommendation !== undefined && typeof v.needsRecommendation !== "boolean") ||
    !Array.isArray(v.versions) ||
    v.versions.length > 200 ||
    v.versions.some(
      (x) =>
        !x ||
        typeof x.id !== "string" ||
        typeof x.image !== "string" ||
        !/^workstore-image:[0-9a-f]{64}$/.test(x.image) ||
        !Number.isFinite(x.createdAt) ||
        typeof x.prompt !== "string" ||
        !validConfig(x.config),
    ) ||
    new Set(v.versions.map((x) => x.id)).size !== v.versions.length ||
    (v.selectedVersion !== null &&
      !v.versions.some((x) => x.id === v.selectedVersion))
  )
    throw new Error("封面文件内容无效，请导出备份后检查");
  return v;
}
export const selectedVersion = (c: CoverContent) =>
  c.versions.find((v) => v.id === c.selectedVersion);
export function positiveTraits(value: string) {
  return value
    .split(/[；;。\n]+/)
    .map((s) => s.trim().replace(/^[ ，,、：:]+|[ ，,、：:]+$/g, ""))
    .filter(
      (s) =>
        s && !/避免|不要|不准|禁止|无(?:写实纹理|精细材质|真实纹理)/.test(s),
    )
    .join("；");
}
type Activation = {
  name_activation?: string;
  traits_activation?: string;
  styles?: Record<string, Activation>;
};
export function stylePolicy(number: string, imageModel = "unknown") {
  const style = styles.find((s) => s.number === number);
  if (!style) throw new Error("请选择有效画风");
  const profile = (capabilities.models as Record<string, Activation>)[
    imageModel
  ];
  const policy = {
    ...capabilities.default,
    ...profile,
    ...profile?.styles?.[number],
  } as Activation;
  const traits =
    policy.name_activation === "strong" ? "" : positiveTraits(style.traits);
  return {
    style,
    traits,
    reference:
      policy.name_activation !== "strong" &&
      !(policy.traits_activation === "strong" && traits),
  };
}
export const graphicSuffix =
  "【如果主题直白包含画面元素那就按主题出图，文案由你来升华，但是不要直接描述画面。 如果主题比较概念化，那么文案和主题尽量保持一致，如果文案较长由你提炼，由你先设计画面隐喻（人类和非人类都行）再出图   。    文字参与构图，图文一体】";
export function generationPrompt(
  config: CoverConfig,
  withCurrent: boolean,
  imageModel = "unknown",
) {
  if (!validConfig(config)) throw new Error("封面配置无效");
  if (!config.topic.trim() && !config.title.trim())
    throw new Error("请填写主题或主标题");
  const policy = stylePolicy(config.style, imageModel);
  const layout = layouts.find((l) => l.id === config.layout);
  const layoutPrompt = layout?.prompt
    .split("<!-- en -->")
    [config.language === "英文" ? 1 : 0]?.replace("<!-- zh -->", "")
    .trim();
  const color = colors.find((c) => c.id === config.color);
  return [
    `生成一张完成的封面图片，所有可见文案使用${config.language}。比例 ${config.ratio}。`,
    `主题：${config.topic}\n业务场景：社交媒体封面\n内容密度：${config.density}\n情感基调：${config.mood}`,
    `主标题（保持原文）：${config.title || "根据主题拟写"}\n副文案（保持原文）：${config.subtitle || "不添加副文案"}`,
    "用户填写的标题和副文案必须逐字保留；该要求优先于自动升华或提炼文案。",
    color
      ? `主题色：${color.name_zh}（${color.name_en}）。`
      : `根据当前主题、画风与构图动态选择和谐的主色及点缀，候选主题色：${colors.map((c) => `${c.id} ${c.name_zh}`).join("、")}。不使用固定主题与颜色映射。`,
    `画风：#${policy.style.number} · ${policy.style.generation_name}。参考作者/风格名称：${policy.style.reference}。${policy.traits ? `核心风格特征：${policy.traits}。` : ""}`,
    layoutPrompt ? `版式要求：${layoutPrompt}` : "版式：自由设计，图文一体。",
    policy.reference
      ? "第一张附图只用于画风参考。只提取线条、笔触、媒介、材质和整体视觉语言；不要复制其主体、人物、动物、服装、道具、动作、姿态、场景、背景、构图、布局、文字或故事。画面内容完全以用户主题为准。"
      : "",
    withCurrent
      ? `${policy.reference ? "第二张" : "第一张"}附图是当前封面，请按新的配置与修改要求编辑；保留未要求改变的人物、物品和布局。新选择的画风优先于旧封面画风。`
      : "",
    config.instruction ? `额外修改要求：${config.instruction}` : "",
    graphicSuffix,
  ]
    .filter(Boolean)
    .join("\n\n");
}
