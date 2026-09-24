import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildSync } from "esbuild";
import vm from "node:vm";
const root = new URL("../", import.meta.url);
const code = buildSync({
  entryPoints: [new URL("../src/covers/model.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
}).outputFiles[0].text;
const module = { exports: {} };
vm.runInNewContext(code, { module });
const m = module.exports;
test("cover library includes every upstream style, layout and color with valid bundled references", () => {
  const source = JSON.parse(
    readFileSync(
      new URL(
        "third-party/handraw-style/skills/handdraw-style-prompter/references/styles.json",
        root,
      ),
      "utf8",
    ),
  );
  assert.equal(m.styles.length, 277);
  assert.equal(m.layouts.length, 119);
  assert.equal(m.colors.length, 30);
  assert.deepEqual(
    Array.from(m.styles, (s) => s.number),
    source.map((s) => s.number),
  );
  for (const item of [...m.styles, ...m.layouts, ...m.colors])
    assert.ok(existsSync(new URL("public" + item.image, root)), item.image);
  for (const item of m.styles) {
    const original = source.find((s) => s.number === item.number);
    assert.equal(item.traits, original.traits);
    assert.equal(item.reference, original.reference);
  }
  const manifest = JSON.parse(
    readFileSync(
      new URL("third-party/handraw-style/manifest.json", root),
      "utf8",
    ),
  );
  for (const [file, { sha256 }] of Object.entries(manifest))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL(file, root)))
        .digest("hex"),
      sha256,
      file,
    );
});
test("unknown image model attaches numbered reference; calibrated names and traits obey upstream rules", () => {
  assert.equal(m.stylePolicy("042").reference, true);
  assert.equal(m.stylePolicy("042", "gpt-image-2").reference, false);
  assert.equal(m.stylePolicy("042", "gpt-image-2").traits, "");
  assert.equal(m.stylePolicy("200").traits.includes("黑白墨线"), true);
  assert.equal(
    m.positiveTraits("流动线条。避免写实。不要文字；纸张感"),
    "流动线条；纸张感",
  );
  assert.throws(() => m.stylePolicy("999"));
});
test("cover prompts preserve exact Chinese copy, selected layout and distinguish edit reference from style", () => {
  const c = {
    ...m.emptyContent("200").config,
    topic: "东亚少女与奶茶",
    title: "秋日第一杯奶茶",
    subtitle: "甜一点。",
    layout: "SC-001",
    color: "C-28",
    instruction: "标题大一点",
  };
  const p = m.generationPrompt(c, true);
  assert.match(p, /秋日第一杯奶茶/);
  assert.match(p, /甜一点/);
  assert.match(p, /上文下图/);
  assert.match(p, /芥末黄/);
  assert.match(p, /第一张附图只用于画风/);
  assert.match(p, /第二张附图是当前封面/);
  assert.match(p, /2:3/);
  assert.ok(p.endsWith(m.graphicSuffix));
  const english = m.generationPrompt({ ...c, language: "英文" }, false);
  assert.match(english, /Text|text-above-image/);
  assert.doesNotMatch(english, /小红书社媒卡/);
});
test("stored cover validation rejects external image URLs and dangling version selections", () => {
  const c = m.emptyContent();
  assert.equal(m.readContent(JSON.stringify(c)).versions.length, 0);
  c.selectedVersion = "missing";
  assert.throws(() => m.readContent(JSON.stringify(c)));
  c.versions = [
    {
      id: "missing",
      createdAt: 1,
      image: "https://example.com/x.png",
      config: c.config,
      prompt: "test",
    },
  ];
  assert.throws(() => m.readContent(JSON.stringify(c)));
  c.versions[0].image = "workstore-image:" + "a".repeat(64);
  assert.equal(m.readContent(JSON.stringify(c)).selectedVersion, "missing");
  c.config.style = "999";
  assert.throws(() => m.readContent(JSON.stringify(c)));
});
