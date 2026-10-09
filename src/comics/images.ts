import {courseAssetSource} from '../course/assets';
import { invoke } from "@tauri-apps/api/core";
import type { Picture } from "./types";
import { stringCache } from './imageCache';
const cachedRead = stringCache(24*1024*1024,12);
export function imageSource(src: string): Promise<string> {
  if (src.startsWith('/course/')) return courseAssetSource(src);
  if (!src.startsWith("workstore-image:")) return Promise.resolve(src);
  return cachedRead(src,()=>invoke<string>("ai_read_image", { id: src }));
}
export async function referenceImage(p: Picture): Promise<string> {
  const im = new Image();
  const resolved = await imageSource(p.src);
  if (/^asset:|^https?:\/\/asset\.localhost/.test(resolved)) im.crossOrigin='anonymous';
  im.src = resolved;
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
