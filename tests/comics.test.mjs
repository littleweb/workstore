import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash, webcrypto } from "node:crypto";
import { transformSync } from "esbuild";
import vm from "node:vm";
const require = createRequire(import.meta.url);
function load(name, overrides = {}) {
  const module = { exports: {} };
  const source = transformSync(
    readFileSync(new URL(`../src/comics/${name}.ts`, import.meta.url), "utf8"),
    { loader: "ts", format: "cjs" }
  ).code;
  vm.runInNewContext(source, {
    module,
    structuredClone,
    crypto: webcrypto,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Map,
    Set,
    Blob,
    window: { addEventListener() {} },
    require(id) {
      if (id === "./template-validator") return require("../src/comics/template-validator.js");
      if (id in overrides) return overrides[id];
      if (id.includes("workspace")) return { native: false };
      if (id.includes("schema"))
        return JSON.parse(
          readFileSync(
            new URL("../schemas/comic-template.schema.json", import.meta.url)
          )
        );
      return require(id);
    },
  });
  return module.exports;
}
const model = load("model");
const catalog = load("catalog");
const templates = JSON.parse(
  readFileSync(new URL("../public/comics/templates.json", import.meta.url))
);
test("all six templates contain complete, valid and distinct example pages", () => {
  assert.equal(catalog.validateTemplates(templates).length, 6);
  assert.equal(
    templates.reduce((n, t) => n + t.example.length, 0),
    32
  );
  for (const t of templates) {
    const c = model.instantiate(t, "测试主题", t.defaultPages, "3:4");
    assert.equal(c.pages.length, t.defaultPages);
    assert.equal(c.templateOrigin.revision, t.revision);
    assert.equal(c.settings.entities.length, 0);
    c.templateSnapshot.entities[0].name = "changed";
    assert.notEqual(t.entities[0].name, "changed");
  }
});
test("template validation rejects source injection, crop escape and nonexistent entities", () => {
  for (const mutate of [
    (t) => (t.cover.src = "https://untrusted.test/a.png"),
    (t) => (t.cover.crop = [0.8, 0, 0.5, 1]),
    (t) => (t.example[0].entityIds = ["missing"]),
    (t) => (t.schemaVersion = 2),
  ]) {
    const t = structuredClone(templates[0]);
    mutate(t);
    assert.throws(() => catalog.validateTemplates([t]));
  }
});
test("restore appends a new history branch and preserves old snapshots", () => {
  let c = model.instantiate(templates[0], "猫去上班", 6, "3:4");
  c = model.checkpoint(c, "initial");
  const first = c.history[0];
  c.pages[0].action = "changed";
  assert.notEqual(first.pages[0].action, "changed");
  c = model.checkpoint(c, "edit");
  const parent = c.currentRevisionId;
  c = model.checkpoint(c, "restore", first, first.id);
  assert.equal(c.history.length, 3);
  assert.equal(c.history[2].parentId, parent);
  assert.equal(c.history[2].restoredFrom, first.id);
  assert.equal(c.pages[0].action, first.pages[0].action);
});
test("AI story parsing checks count and known assets", () => {
  const page = {
    title: "第一张",
    action: "坐下",
    dialogue: "你好",
    state: "已坐下",
    entityIds: ["cat"],
  };
  assert.equal(
    model.parseStory(JSON.stringify({ pages: [page] }), 1, ["cat"]).length,
    1
  );
  assert.throws(() =>
    model.parseStory(JSON.stringify({ pages: [page] }), 4, ["cat"])
  );
  assert.throws(() =>
    model.parseStory(JSON.stringify({ pages: [page] }), 1, [])
  );
});
test("catalog appends templates, upgrades versions and never downgrades", () => {
  const newer = { ...structuredClone(templates[0]), revision: templates[0].revision + 1 };
  assert.equal(catalog.mergeTemplates([newer], [templates[0]])[0].revision, newer.revision);
  assert.equal(catalog.mergeTemplates(templates, [newer]).length, 6);
  assert.equal(catalog.mergeTemplates(templates, [newer])[0].revision, newer.revision);
});
test("public packages are immutable checksummed and images are deduplicated", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../content/comics/catalog.json", import.meta.url))
  );
  assert.equal(manifest.templates.length, 6);
  for (const entry of manifest.templates) {
    const bytes = readFileSync(new URL("../" + entry.path, import.meta.url));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256
    );
    const p = JSON.parse(bytes);
    assert.equal(Object.keys(p.assets).length, 1);
    assert.equal(p.template.templateId, entry.templateId);
    for (const [hash, data] of Object.entries(p.assets))
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(data.split(",")[1], "base64"))
          .digest("hex"),
        hash
      );
  }
});
test("comic storage creates complete content and retains edits while a save is pending", async () => {
  let remote;
  let release;
  let pause = false;
  let calls = 0;
  const invoke = async (command, args) => {
    if (command === "create_comic") {
      remote = {
        comic: {
          id: "one",
          title: "untitled",
          content: structuredClone(args.content),
          revision: 1,
        },
        token: "1",
      };
      return structuredClone(remote);
    }
    if (command === "save_comic") {
      calls++;
      if (pause) {
        pause = false;
        await new Promise((r) => (release = r));
      }
      remote = { comic: structuredClone(args.comic), token: String(calls + 1) };
      return structuredClone(remote);
    }
    throw new Error(command);
  };
  const s = load("store", {
    "@tauri-apps/api/core": { invoke },
    "../workspace": {
      native: true,
      scheduleAutosync() {},
      registerSyncRefresher() {},
    },
    "react-dom": { flushSync: (fn) => fn() },
    "../documentLifecycle": { registerDocumentFlusher() {} },
    "./export": { download() {} },
  });
  const c = model.instantiate(templates[0], "test", 6, "3:4");
  await s.createComic(c);
  await s.flushComics();
  assert.equal(remote.comic.content.pages.length, 6);
  s.stageComic("one", { title: "first" });
  pause = true;
  const pending = s.flushComic("one");
  await new Promise((r) => setImmediate(r));
  s.stageComic("one", { title: "latest" });
  release();
  await pending;
  await s.flushComics();
  assert.equal(remote.comic.title, "latest");
  assert.equal(s.currentComic("one").title, "latest");
});

test("late image results stay in history without replacing current work", () => {
  let c = model.checkpoint(
    model.instantiate(templates[0], "主题", 6, "3:4"),
    "initial"
  );
  const id = c.currentRevisionId;
  const alternate = structuredClone(c);
  alternate.pages[0].action = "late result";
  const next = model.candidate(c, alternate, "candidate", id);
  assert.equal(next.currentRevisionId, id);
  assert.notEqual(next.pages[0].action, "late result");
  assert.equal(next.history.at(-1).pages[0].action, "late result");
});
test("six seeds have explicit 4/6/8 beat strategies and a seventh template appends without release", () => {
  for (const t of templates)
    for (const count of [4, 6, 8])
      assert.equal(t.narrativeByCount[String(count)].length, count);
  const seventh = {
    ...structuredClone(templates[0]),
    templateId: "rainy-day",
    title: "雨天的小事",
  };
  const result = catalog.mergeTemplates(
    templates,
    catalog.validateTemplates([seventh])
  );
  assert.equal(result.length, 7);
  assert.equal(result.at(-1).templateId, "rainy-day");
});

test('desktop template validation works when dynamic code generation is forbidden',()=>{const source=readFileSync(new URL('../src/comics/template-validator.js',import.meta.url),'utf8');const context=vm.createContext({module:{exports:{}}},{codeGeneration:{strings:false,wasm:false}});vm.runInContext(transformSync(source,{format:'cjs'}).code,context);assert.equal(context.module.exports.default(templates[0]),true);const invalid={...templates[0],schemaVersion:2};assert.equal(context.module.exports.default(invalid),false)});

const story = load("story", { "./model": model });
test("new story requests cannot inherit template characters or images", () => {
  const c = model.instantiate(templates[0], "一位宇航员和机器人探索火星", 4, "9:16");
  const request = story.storyRequest(c);
  const input = JSON.parse(request.messages[1].content);
  assert.equal(input.theme, "一位宇航员和机器人探索火星");
  assert.equal(input.existingEntities.length, 0);
  assert.equal("beats" in input, false);
  assert.equal(input.style.includes("领带"), false);
  assert.equal(input.style.includes("橘猫"), false);
  for (const entity of templates[0].entities) assert.equal(JSON.stringify(input).includes(entity.name), false);
  assert.equal(story.pageReferences(c, 0).length, 0);
  const text = JSON.stringify({ entities: [
    { id: "astronaut", name: "宇航员", kind: "character", description: "白色航天服，蓝色面罩" },
    { id: "mars", name: "火星", kind: "scene", description: "红色沙地，岩石和空间站" }
  ] });
  c.settings.entities = story.parseEntities(text);
  assert.equal(c.settings.entities[0].reference, undefined);
  c.settings.entities[0].reference = { src: "workstore-image:new-astronaut" };
  c.pages[0].entityIds = ["astronaut", "mars"];
  assert.equal(story.pageReferences(c, 0)[0].src, "workstore-image:new-astronaut");
  assert.equal(JSON.stringify(story.pageReferences(c, 0)).includes("/comics/"), false);
  assert.equal(story.parseEntities(text, c.settings.entities)[0].reference.src, "workstore-image:new-astronaut");
});
test("asset parsing rejects duplicates, unknown kinds and missing scenes", () => {
  for (const entities of [[], [{id:"a", name:"a", kind:"character",description:"a"}], [{id:"a",name:"a",kind:"character",description:"a"},{id:"a",name:"s",kind:"scene",description:"s"}], [{id:"a",name:"a",kind:"invalid",description:"a"}]])
    assert.throws(() => story.parseEntities(JSON.stringify({entities})));
});

test("featured gallery includes six additional complete original stories", () => {
  const extra = JSON.parse(readFileSync(new URL("../public/comics/featured.json", import.meta.url)));
  assert.equal(catalog.validateTemplates(extra).length, 6);
  assert.equal(catalog.mergeTemplates(templates, extra).length, 12);
  for (const item of extra) {
    assert.equal(item.example.length, 4);
    assert.ok(readFileSync(new URL(`../public${item.cover.src}`, import.meta.url)).length > 10000);
    assert.equal(new Set(item.example.map((p) => JSON.stringify(p.image.crop))).size, 4);
  }
});

test("dialogue is sent to image generation as integrated lettering", () => {
  const c = model.instantiate(templates[0], "火星故事", 4, "9:16");
  c.pages[0].dialogue = "你好，火星！";
  const prompt = story.pageArtPrompt(c, 0);
  assert.ok(prompt.includes('你好，火星！'));
  assert.ok(prompt.includes('直接绘制在最终图像'));
  assert.ok(prompt.includes('绝不遮挡脸'));
  assert.ok(prompt.includes('彻底替换旧台词'));
  assert.equal(prompt.includes('预留约25%'), false);
  assert.equal(prompt.includes('不要文字'), false);
  for(const t of templates) {assert.equal(t.dialogueStyle.rendering, 'integrated');assert.equal(t.dialogueStyle.position, 'auto');}
});
test("template schema rejects unsupported bubble settings", () => {
  const t=structuredClone(templates[0]);t.dialogueStyle.position='outside';
  assert.throws(()=>catalog.validateTemplates([t]));
});
