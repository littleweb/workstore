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
function harness(imageSize = {width:900,height:1200}) {
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
        return { loadImage: async () => imageSize };
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

test("PDF preserves the selected wide page dimensions without stretching", async()=>{
 const h=harness({width:1920,height:1080});
 const text=await (await h.pdfBlob(["fixture"])).text();
 assert.match(text,/\/MediaBox \[0 0 1280 720\]/);
 assert.match(text,/\/Width 1920 \/Height 1080/);
});


test("A4 print PDF fixes physical paper size and duplex viewer preferences", async () => {
 const h=harness({width:2480,height:3508});
 const text=await (await h.pdfBlob(["fixture"], {width:210*72/25.4,height:297*72/25.4,duplex:"long"})).text();
 assert.ok(text.includes(`/MediaBox [0 0 ${210*72/25.4} ${297*72/25.4}]`));
 assert.match(text,/\/PrintScaling \/None \/Duplex \/DuplexFlipLongEdge/);
 const booklet=await (await h.pdfBlob(["fixture"], {width:297*72/25.4,height:210*72/25.4,duplex:"short"})).text();
 assert.match(booklet,/\/Duplex \/DuplexFlipShortEdge/);
});
