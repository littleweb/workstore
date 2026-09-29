import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import JSZip from "jszip";
import { native } from "../workspace";
import { imageSource } from "../comics/images";
import { copyText, pageFilename, type Content } from "./model";
import { loadImage } from "./render";
const bytes = (data: string) =>
  Uint8Array.from(atob(data.split(",")[1]), (ch) => ch.charCodeAt(0));
export async function download(blob: Blob, name: string, ext: string) {
  if (native) {
    const path = await save({
      defaultPath: name,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return;
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(new Error("导出读取失败"));
      r.readAsDataURL(blob);
    });
    await invoke("save_story_comic_export", { path, data });
  } else {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function exportPage(c: Content, i: number) {
  const p = c.plan?.pages[i];
  if (!p?.image) throw new Error("本页尚未生成");
  await download(
    new Blob([bytes(await imageSource(p.image))], { type: "image/png" }),
    pageFilename(i),
    "png"
  );
}
export async function exportZip(c: Content, title: string, backup?: string) {
  const zip = new JSZip();
  if (backup) {
    zip.file("故事漫画.story-comic.json", backup);
    for (const id of new Set(
      backup.match(/workstore-image:[0-9a-f]{64}/g) ?? []
    ))
      zip.file(`images/${id.slice(16)}.png`, bytes(await imageSource(id)));
  } else {
    if (!c.plan?.pages.every((p) => p.image) || !c.copy)
      throw new Error("请先完成所有页面与发布文案");
    for (let i = 0; i < c.plan.pages.length; i++)
      zip.file(
        pageFilename(i),
        bytes(await imageSource(c.plan.pages[i].image!))
      );
    zip.file("发布文案.txt", copyText(c.copy));
  }
  await download(
    await zip.generateAsync({ type: "blob" }),
    `${title.replace(/[\\/:*?"<>|]/g, "_")}${backup ? "-备份" : ""}.zip`,
    "zip"
  );
}
/** Minimal image-only PDF; each page uses the exact composed PNG raster. */
export async function pdfBlob(images: string[]): Promise<Blob> {
  const encoded: Uint8Array[] = [];
  for (const src of images) {
    const image = await loadImage(src),
      canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    encoded.push(bytes(canvas.toDataURL("image/jpeg", 0.96)));
  }
  const encoder = new TextEncoder(),
    parts: Uint8Array[] = [],
    offsets = [0];
  let length = 0;
  const append = (v: string | Uint8Array) => {
    const b = typeof v === "string" ? encoder.encode(v) : v;
    parts.push(b);
    length += b.length;
  };
  const object = (id: number, body: string | Uint8Array[]) => {
    offsets[id] = length;
    append(`${id} 0 obj\n`);
    if (typeof body === "string") append(body);
    else body.forEach(append);
    append("\nendobj\n");
  };
  append("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${images.length} /Kids [${images
      .map((_, i) => `${3 + i * 3} 0 R`)
      .join(" ")}] >>`
  );
  for (let i = 0; i < images.length; i++) {
    const n = 3 + i * 3,
      stream = "q 540 0 0 720 0 0 cm /Im0 Do Q";
    object(
      n,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 540 720] /Resources << /XObject << /Im0 ${
        n + 2
      } 0 R >> >> /Contents ${n + 1} 0 R >>`
    );
    object(
      n + 1,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
    object(n + 2, [
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width 900 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${encoded[i].length} >>\nstream\n`
      ),
      encoded[i],
      encoder.encode("\nendstream"),
    ]);
  }
  const xref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const off of offsets.slice(1))
    append(`${String(off).padStart(10, "0")} 00000 n \n`);
  append(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  );
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}
export async function exportPdf(c: Content, title: string) {
  if (!c.plan?.pages.every((p) => p.image)) throw new Error("请先完成所有页面");
  await download(
    await pdfBlob(c.plan.pages.map((p) => p.image!)),
    title.replace(/[\\/:*?"<>|]/g, "_") + ".pdf",
    "pdf"
  );
}
