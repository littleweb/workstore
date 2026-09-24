import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import JSZip from "jszip";
import { native } from "../workspace";
import { imageSource } from "./images";
import { readContent, selectedVersion } from "./model";
import type { Document } from "./store";
async function download(blob: Blob, name: string, ext: string) {
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
    await invoke("save_cover_export", { path, data });
  } else {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function exportCover(doc: Document, backup = false) {
  const name = doc.title.replace(/[\\/:*?"<>|]/g, "_");
  if (backup) {
    const zip = new JSZip();
    zip.file("封面.cover.json", JSON.stringify(doc, null, 2));
    // Even malformed content can be backed up. Include every recognizable image ID.
    const ids = new Set(
      doc.content.match(/workstore-image:[0-9a-f]{64}/g) ?? [],
    );
    for (const id of ids) {
      const src = await imageSource(id);
      zip.file(`images/${id.slice(16)}.png`, src.split(",")[1], {
        base64: true,
      });
    }
    await download(
      await zip.generateAsync({ type: "blob" }),
      name + ".zip",
      "zip",
    );
  } else {
    const version = selectedVersion(readContent(doc.content));
    if (!version) throw new Error("请先生成封面");
    const data = await imageSource(version.image);
    const bytes = Uint8Array.from(atob(data.split(",")[1]), (ch) =>
      ch.charCodeAt(0),
    );
    await download(
      new Blob([bytes], { type: "image/png" }),
      name + ".png",
      "png",
    );
  }
}
