import { invoke } from "@tauri-apps/api/core";
import type { Picture } from "./types";
const cache = new Map<string, Promise<string>>();
export function imageSource(src: string): Promise<string> {
  if (!src.startsWith("workstore-image:")) return Promise.resolve(src);
  let value = cache.get(src);
  if (!value) {
    value = invoke<string>("ai_read_image", { id: src });
    cache.set(src, value);
    value.catch(() => cache.delete(src));
  }
  return value;
}
export async function referenceImage(p: Picture): Promise<string> {
  const im = new Image();
  im.src = await imageSource(p.src);
  await im.decode();
  const [x, y, w, h] = p.crop ?? [0, 0, 1, 1];
  const scale = Math.min(1, 1024 / Math.max(im.width * w, im.height * h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(im.width * w * scale);
  canvas.height = Math.round(im.height * h * scale);
  canvas
    .getContext("2d")!
    .drawImage(
      im,
      im.width * x,
      im.height * y,
      im.width * w,
      im.height * h,
      0,
      0,
      canvas.width,
      canvas.height
    );
  return canvas.toDataURL("image/png");
}
