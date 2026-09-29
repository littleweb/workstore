import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import vm from "node:vm";
import JSZip from "jszip";
const code = buildSync({
  entryPoints: ["src/story-comic/export.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: [
    "jszip",
    "./render",
    "../workspace",
    "../comics/images",
    "@tauri-apps/api/core",
    "@tauri-apps/plugin-dialog",
  ],
}).outputFiles[0].text;
function harness() {
  const module = { exports: {} },
    downloads = [];
  let blob;
  vm.runInNewContext(code, {
    module,
    Blob,
    TextEncoder,
    Uint8Array,
    atob,
    setTimeout: () => {},
    URL: {
      createObjectURL: (b) => {
        blob = b;
        return "blob:test";
      },
      revokeObjectURL: () => {},
    },
    document: {
      createElement: (tag) =>
        tag === "canvas"
          ? {
              getContext: () => ({ fillRect() {}, drawImage() {} }),
              toDataURL: () => "data:image/jpeg;base64,/9j/2Q==",
            }
          : {
              click() {
                downloads.push({ blob, name: this.download });
              },
            },
    },
    require(id) {
      if (id === "jszip") return JSZip;
      if (id === "../workspace") return { native: false };
      if (id === "./render")
        return { loadImage: async () => ({ width: 900, height: 1200 }) };
      if (id === "../comics/images")
        return { imageSource: async () => "data:image/png;base64,aGVsbG8=" };
      return {};
    },
  });
  return { ...module.exports, downloads };
}
test("ZIP contains numbered independent pages, first-page cover and publish text", async () => {
  const h = harness();
  const c = {
    plan: { pages: Array.from({ length: 4 }, () => ({ image: "fixture" })) },
    copy: { title: "标题", description: "说明", hashtags: ["漫画"] },
  };
  await h.exportZip(c, "测试");
  const zip = await JSZip.loadAsync(await h.downloads[0].blob.arrayBuffer());
  assert.deepEqual(Object.keys(zip.files), [
    "01-cover.png",
    "02-page.png",
    "03-page.png",
    "04-page.png",
    "发布文案.txt",
  ]);
  assert.equal(
    await zip.file("发布文案.txt").async("string"),
    "标题\n\n说明\n\n#漫画"
  );
  assert.equal(await zip.file("01-cover.png").async("string"), "hello");
  await assert.rejects(h.exportZip({ ...c, plan: { pages: [{}] } }, "未完成"));
});
test("PDF page tree, binary stream lengths and xref offsets parse correctly", async () => {
  const h = harness(),
    blob = await h.pdfBlob(["a", "b", "c", "d"]);
  const data = Buffer.from(await blob.arrayBuffer());
  const text = data.toString("latin1");
  assert.match(text, /\/Count 4/);
  const start = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(start, start + 4), "xref");
  const entries = text.slice(start).split("\n").slice(3, 17);
  for (let i = 0; i < entries.length; i++) {
    const offset = Number(entries[i].slice(0, 10));
    assert.equal(
      text.slice(offset, offset + String(i + 1).length + 6),
      `${i + 1} 0 obj`
    );
  }
});
