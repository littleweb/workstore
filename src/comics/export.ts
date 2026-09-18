import { createElement } from "react";
import { Modal } from "antd";
import { native } from "../workspace";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { imageSource } from "./images";
import JSZip from "jszip";
import type { ComicContent, Picture, Platform, DialogueStyle } from "./types";
export async function download(blob: Blob, name: string) {
  if (native) {
    const ext = name.endsWith(".zip") ? "zip" : "json";
    const path = await save({
      defaultPath: name.replace(/[\\/:*?"<>|]/g, "_"),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return;
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(new Error("导出读取失败"));
      r.readAsDataURL(blob);
    });
    await invoke("save_comic_export", { path, data });
    return;
  }
  const u = URL.createObjectURL(blob);
  Modal.info({
    title: "导出已准备",
    content: createElement(
      "a",
      { href: u, download: name.replace(/[\\/:*?"<>|]/g, "_") },
      "下载 " + name
    ),
    okText: "完成",
    afterClose: () => URL.revokeObjectURL(u),
  });
}
export async function renderImage(
  image: Picture,
  text: string,
  ratio: string,
  cover = false,
  dialogueStyle?: DialogueStyle
): Promise<Blob> {
  const im = new Image();
  im.src = await imageSource(image.src);
  await im.decode();
  const canvas = document.createElement("canvas");
  const [a, b] = ratio.split(":").map(Number);
  canvas.width = 1200;
  canvas.height = Math.round((1200 * b) / a);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fffaf0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const [x, y, w, h] = image.crop ?? [0, 0, 1, 1];
  const sw = im.width * w,
    sh = im.height * h;
  const lines: string[] = [];
  ctx.font = "38px sans-serif";
  let line = "";
  for (const ch of text) {
    if (ch === "\n" || ctx.measureText(line + ch).width > 1080) {
      lines.push(line);
      line = ch === "\n" ? "" : ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  if (cover && lines.length > 8)
    throw new Error("对白过长，请缩短到 8 行以内再导出");
  const textH = 0;
  const scale = Math.min(canvas.width / sw, (canvas.height - textH) / sh);
  ctx.drawImage(
    im,
    im.width * x,
    im.height * y,
    sw,
    sh,
    (canvas.width - sw * scale) / 2,
    0,
    sw * scale,
    sh * scale
  );
  if (cover) {
    ctx.fillStyle = "rgba(255,248,221,.88)";
    ctx.fillRect(48, 48, 1104, lines.length * 54 + 48);
  }
  if (cover) {
    ctx.fillStyle = "#253c37";
    ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, 600, 100 + i * 54));
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (v) => (v ? resolve(v) : reject(new Error("图片导出失败"))),
      "image/png"
    )
  );
}
export async function exportWork(
  c: ComicContent,
  title: string,
  platform?: Platform
) {
  const zip = new JSZip();
  const draft = platform ? c.publishing[platform] : undefined;
  const pages = draft
    ? draft.imageOrder
        .map((id) => c.pages.find((p) => p.id === id))
        .filter((p): p is (typeof c.pages)[number] => !!p)
    : c.pages;
  if (!pages.length || pages.some((p) => !p.image || p.status !== "ready"))
    throw new Error("还有漫画图片未完成，请先完成绘制");
  if (pages.some((p) => p.dialogue && p.imageDialogue !== p.dialogue))
    throw new Error("部分对白尚未融入画面，请重绘后再导出");
  if (draft) {
    const cover = draft.covers[draft.selectedCover];
    if (!cover) throw new Error("请先选择封面");
    zip.file(
      "00-封面.png",
      await renderImage(cover, draft.coverText, c.settings.ratio, true)
    );
    zip.file(
      "发布文案.txt",
      `${draft.title}\n\n${draft.description}\n\n${draft.hashtags
        .map((t) => "#" + t.replace(/^#/, ""))
        .join(" ")}`
    );
  }
  for (let i = 0; i < pages.length; i++)
    zip.file(
      `${String(i + 1).padStart(2, "0")}.png`,
      await renderImage(
        pages[i].image!,
        pages[i].dialogue,
        c.settings.ratio,
        false,
        c.templateSnapshot.dialogueStyle
      )
    );
  zip.file("作品.json", JSON.stringify(c, null, 2));
  await download(
    await zip.generateAsync({ type: "blob" }),
    `${title}${platform ? "-" + platform : ""}.zip`
  );
}
