import { invoke } from "@tauri-apps/api/core";
import { native } from "../workspace";
import { imageSource } from "../comics/images";
import { styleFor, type Content } from "./model";
export async function loadImage(src: string) {
  const image = new Image();
  image.src = await imageSource(src);
  await image.decode();
  return image;
}
export function wrapText(
  ctx: Pick<CanvasRenderingContext2D, "measureText">,
  text: string,
  width: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
function textBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
  bold = false
) {
  let lines: string[] = [];
  while (size >= 16) {
    ctx.font = `${
      bold ? "600" : "400"
    } ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    lines = wrapText(ctx, text, width);
    if (lines.length * size * 1.45 <= height) break;
    size -= 2;
  }
  if (lines.length * size * 1.45 > height)
    throw new Error("本页文字无法完整排版，请缩短文字");
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * size * 1.45));
}
/** Art and lettering occupy separate, non-overlapping regions in the final PNG. */
export async function composePage(
  raw: string,
  content: Content,
  index: number
): Promise<string> {
  // Upstream comic pages already contain their complete lettering and composition.
  if (content.engine?.startsWith("baoyu-comic@")) return raw;
  await document.fonts.ready;
  const image = await loadImage(raw),
    style = styleFor(content.config),
    page = content.plan!.pages[index];
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建漫画画布");
  ctx.fillStyle = style.paper;
  ctx.fillRect(0, 0, 900, 1200);
  ctx.fillStyle = style.ink;
  textBlock(ctx, page.title, 50, 42, 800, 138, index === 0 ? 64 : 44, true);
  // Contain preserves the entire generated illustration, including all panels.
  const scale = Math.min(820 / image.width, 740 / image.height),
    w = image.width * scale,
    h = image.height * scale;
  ctx.drawImage(image, 40 + (820 - w) / 2, 200 + (740 - h) / 2, w, h);
  ctx.fillStyle = style.accent;
  ctx.fillRect(50, 974, 44, 4);
  ctx.fillStyle = style.ink;
  textBlock(ctx, page.text, 50, 1000, 800, 158, index === 0 ? 36 : 30);
  const data = canvas.toDataURL("image/png");
  return native ? invoke<string>("save_story_comic_image", { data }) : data;
}
