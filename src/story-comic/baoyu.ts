import resources from "./baoyu-resources.json";
import styles from "./styles.json";
export const baoyuVersion = `baoyu-comic@${resources.commit}`;
export const tones = [
  ["neutral", "中性"],
  ["warm", "温暖"],
  ["dramatic", "戏剧"],
  ["romantic", "浪漫"],
  ["energetic", "活力"],
  ["vintage", "复古"],
  ["action", "动作"],
].map(([value, label]) => ({ value, label }));
const aliases: Record<string, [string, string]> = {
  "warm-manga": ["manga", "warm"],
  "knowledge-euro": ["ligne-claire", "neutral"],
  vintage: ["ligne-claire", "vintage"],
  ink: ["ink-brush", "neutral"],
};
export function resolveStyle(c: { style: string; tone?: string }) {
  const alias = aliases[c.style];
  const style =
    styles.find((s) => s.id === (alias?.[0] ?? c.style)) ?? styles[0];
  return {
    ...style,
    tone: style.preset ? style.tone : c.tone || alias?.[1] || style.tone,
  };
}
export const knownStyle = (id: string) =>
  styles.some((s) => s.id === id) || Object.hasOwn(aliases, id);
export function reference(key: string): string {
  const value = (resources.references as Record<string, string>)[key];
  if (!value) throw new Error(`缺少漫画技能资源：${key}`);
  return value;
}
export function styleRules(c: { style: string; tone?: string }) {
  const s = resolveStyle(c);
  return [
    reference(`art-styles/${s.art}`),
    reference(`tones/${s.tone}`),
    reference(`layouts/${s.layout}`),
    s.preset ? reference(`presets/${s.preset}`) : "",
    s.preset === "ohmsha" ? reference("ohmsha-guide") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
