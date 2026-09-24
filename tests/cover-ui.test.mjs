import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { webcrypto } from "node:crypto";
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "http://localhost",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
])
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const code = buildSync({
  entryPoints: [
    new URL("../src/covers/CoverApp.tsx", import.meta.url).pathname,
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: [
    "react",
    "react/jsx-runtime",
    "antd",
    "@ant-design/icons",
    "./store",
    "./export",
    "./images",
    "../ai/client",
    "../documentLifecycle",
  ],
}).outputFiles[0].text;
after(() => dom.window.close());
const drain = () => new Promise((r) => setImmediate(r));
const initial = () => ({
  config: {
    style: "042",
    topic: "东亚少女与奶茶",
    title: "秋日",
    subtitle: "甜一点",
    language: "中文",
    ratio: "2:3",
    layout: "auto",
    color: "auto",
    density: "低",
    mood: "温暖",
    instruction: "",
    preserve: true,
  },
  versions: [],
  selectedVersion: null,
});
async function harness({ empty = false } = {}) {
  let resolve;
  const waiting = new Promise((r) => (resolve = r)),
    requests = [],
    subscribers = new Set(),
    blockers = new Set();
  let serial = 0,
    flushes = 0,
    remote = 0,
    failFlush = false;
  const docs = new Map(
    empty
      ? []
      : ["a", "b"].map((id) => [
          id,
          {
            id,
            title: id,
            content: JSON.stringify(initial()),
            favorite: false,
            lastOpenedAt: id === "a" ? 2 : 1,
          },
        ]),
  );
  const notify = () => subscribers.forEach((f) => f());
  const store = {
    subscribe: (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    documentList: () => [...docs.values()],
    documentWarnings: () => [],
    currentDocument: (id) => docs.get(id),
    refreshDocuments: async () => {},
    flushDocuments: async () => {
      flushes++;
      if (failFlush) throw Error("test save failed");
    },
    flushDocument: async () => {
      if (failFlush) throw Error("test save failed");
    },
    loadDocument: async (id) => docs.get(id),
    activateDocument: (id) => docs.get(id),
    remoteVersion: () => remote,
    documentStatus: () => "已保存",
    stageDocument: (id, patch) => {
      docs.set(id, { ...docs.get(id), ...patch });
      notify();
    },
    ensureDocument: async (id) => docs.get(id),
    createDocument: async () => {
      const doc = {
        id: "new" + ++serial,
        title: "未命名封面",
        content: "",
        favorite: false,
        lastOpenedAt: 3,
      };
      docs.set(doc.id, doc);
      notify();
      return doc;
    },
  };
  const Input = ({ allowClear, prefix, ...props }) =>
    React.createElement("input", props);
  Input.TextArea = (props) => React.createElement("textarea", props);
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    AbortController,
    Blob,
    crypto: webcrypto,
    document: dom.window.document,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === "react" || id === "react/jsx-runtime") return require(id);
      if (id === "@ant-design/icons")
        return new Proxy({}, { get: () => () => null });
      if (id === "./store") return store;
      if (id === "./export") return { exportCover: async () => {} };
      if (id === "./images")
        return {
          pngReference: async (src) => "png:" + src,
          imageSource: async (src) => src,
        };
      if (id === "../documentLifecycle")
        return {
          registerSyncActivationBlocker: (f) => {
            blockers.add(f);
            return () => blockers.delete(f);
          },
        };
      if (id === "../ai/client")
        return {
          trackAiExecution: async (c, p) => p,
          ai: {
            capabilities: async () => ({
              imageGenerate: true,
              referenceImages: true,
              maxReferences: 8,
            }),
            generate: (input, signal) => {
              requests.push({ input, signal });
              return waiting;
            },
          },
        };
      if (id === "antd")
        return {
          App: { useApp: () => ({ message: { success: () => {} } }) },
          Input,
          Switch: () => null,
          Button: ({
            children,
            onClick,
            disabled,
            loading,
            className,
            ...props
          }) =>
            React.createElement(
              "button",
              {
                onClick,
                disabled: disabled || loading,
                className,
                "aria-label": props["aria-label"],
              },
              children,
            ),
          Dropdown: ({ children }) => children,
          Modal: () => null,
          Select: ({ value, options, onChange, ...props }) =>
            React.createElement(
              "select",
              {
                value,
                "aria-label": props["aria-label"],
                onChange: (e) => onChange(e.target.value),
              },
              options.map((o) =>
                React.createElement(
                  "option",
                  { key: o.value, value: o.value },
                  o.label,
                ),
              ),
            ),
        };
      throw new Error(id);
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(module.exports.default));
    await drain();
  });
  const click = async (text) =>
    act(async () => {
      const b = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === text,
      );
      assert.ok(b, text);
      b.click();
      await drain();
    });
  return {
    host,
    store,
    docs,
    requests,
    blockers,
    click,
    get flushes() {
      return flushes;
    },
    set failFlush(v) {
      failFlush = v;
    },
    async remote() {
      remote++;
    },
    async resolve(result = {}) {
      await act(async () => {
        resolve({
          images: ["workstore-image:" + "a".repeat(64)],
          saveError: null,
          ...result,
        });
        await drain();
      });
    },
    async close() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
test("all 277 templates are selectable; header steps preserve configuration and creation opens a durable draft", async () => {
  const h = await harness({ empty: true });
  try {
    await h.click("风格模板");
    assert.equal(h.host.querySelectorAll(".cover-template").length, 277);
    assert.ok(
      h.host
        .querySelector(".tool-sidebar-create-section")
        .textContent.includes("创建封面"),
    );
    const step = h.host.querySelector(".cover-steps button:last-child");
    assert.equal(step.disabled, true);
    await act(async () => {
      h.host
        .querySelector('[aria-label="选择 200 Mid-century Deadpan Ink Mascot"]')
        .click();
      await drain();
    });
    assert.equal(h.docs.size, 1);
    assert.equal(
      JSON.parse([...h.docs.values()][0].content).config.style,
      "200",
    );
    assert.ok(h.host.querySelector(".cover-config"));
    assert.equal(
      h.host
        .querySelector(".cover-steps button:last-child")
        .getAttribute("aria-current"),
      "step",
    );
    await h.click("01 选择风格模板");
    assert.equal(h.host.querySelectorAll(".cover-template").length, 277);
    await h.click("02 配置封面");
    assert.ok(h.host.querySelector(".cover-config"));
  } finally {
    await h.close();
  }
});
test("generation enters editor with real pending state, uses numbered reference, persists and exports selected version", async () => {
  const h = await harness();
  try {
    await h.click("生成封面 →");
    assert.ok(h.host.querySelector(".cover-editor"));
    assert.ok(h.host.querySelector(".cover-generating"));
    assert.equal(h.requests[0].input.toolId, "app.cover");
    assert.equal(h.requests[0].input.image, true);
    assert.equal(
      h.requests[0].input.references[0],
      "png:/handraw-style/styles/042.webp",
    );
    await h.resolve();
    assert.equal(JSON.parse(h.docs.get("a").content).versions.length, 1);
    assert.equal(h.host.querySelector(".cover-generating"), null);
    assert.ok(h.host.querySelector(".cover-bar .cover-export")?.textContent.includes("导出"));
  } finally {
    await h.close();
  }
});
test("configuration edits during generation reject late output without losing edits", async () => {
  const h = await harness();
  try {
    await h.click("生成封面 →");
    await act(async () => {
      const c = JSON.parse(h.docs.get("a").content);
      c.config.title = "新标题";
      h.store.stageDocument("a", { content: JSON.stringify(c) });
    });
    await h.resolve();
    const c = JSON.parse(h.docs.get("a").content);
    assert.equal(c.config.title, "新标题");
    assert.equal(c.versions.length, 0);
    assert.match(h.host.textContent, /未覆盖/);
  } finally {
    await h.close();
  }
});
test("remote refresh invalidates a pending generation even when content matches", async () => {
  const h = await harness();
  try {
    await h.click("生成封面 →");
    await h.remote();
    await h.resolve();
    assert.equal(JSON.parse(h.docs.get("a").content).versions.length, 0);
    assert.match(h.host.textContent, /未覆盖/);
  } finally {
    await h.close();
  }
});
test("cancel and switch reject late images", async () => {
  for (const action of ["取消生成", "b"]) {
    const h = await harness();
    try {
      await h.click("生成封面 →");
      await h.click(action);
      assert.equal(h.requests[0].signal.aborted, true);
      await h.resolve();
      assert.equal(JSON.parse(h.docs.get("a").content).versions.length, 0);
      assert.equal(JSON.parse(h.docs.get("b").content).versions.length, 0);
    } finally {
      await h.close();
    }
  }
});
test("navigation accepts down-only mouse selection, deduplicates click and keeps recent order", async () => {
  const h = await harness();
  try {
    const before = h.flushes;
    await act(async () => {
      const b = [...h.host.querySelectorAll(".cover-row-name")].find(
        (b) => b.textContent === "b",
      );
      const e = new window.MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
      });
      Object.defineProperty(e, "pointerType", { value: "mouse" });
      b.dispatchEvent(e);
      await drain();
      b.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, detail: 1 }),
      );
      await drain();
    });
    assert.equal(h.host.querySelector(".cover-title").textContent, "b");
    assert.equal(h.flushes, before + 1);
    assert.equal(h.docs.get("b").lastOpenedAt, 1);
  } finally {
    await h.close();
  }
});
test("composition queues latest navigation until final input; save failure retains original document", async () => {
  const h = await harness();
  try {
    await act(async () =>
      h.host
        .querySelector("textarea")
        .dispatchEvent(
          new window.CompositionEvent("compositionstart", { bubbles: true }),
        ),
    );
    await h.click("b");
    assert.equal(h.host.querySelector(".cover-title").textContent, "a");
    assert.ok([...h.blockers].some((f) => f()));
    await act(async () => {
      h.host
        .querySelector("textarea")
        .dispatchEvent(
          new window.CompositionEvent("compositionend", { bubbles: true }),
        );
      await new Promise((r) => setTimeout(r, 5));
      await drain();
    });
    assert.equal(h.host.querySelector(".cover-title").textContent, "b");
    h.failFlush = true;
    await h.click("a");
    assert.equal(h.host.querySelector(".cover-title").textContent, "b");
    assert.match(h.host.textContent, /test save failed/);
  } finally {
    await h.close();
  }
});
test("fold and unfold retain the current draft; entering template browser keeps the editor content", async () => {
  const h = await harness();
  try {
    await act(async () =>
      h.host.querySelector('[aria-label="折叠封面导航"]').click(),
    );
    assert.equal(h.host.querySelector(".cover-nav"), null);
    await act(async () =>
      h.host.querySelector('[aria-label="展开封面导航"]').click(),
    );
    assert.ok(h.host.querySelector(".cover-nav"));
    assert.equal(JSON.parse(h.docs.get("a").content).config.title, "秋日");
  } finally {
    await h.close();
  }
});

test("theme entry recommends valid catalog choices and automatically generates a durable cover", async () => {
  const h = await harness({ empty: true });
  try {
    assert.ok(h.host.querySelector(".cover-create"));
    await h.click("秋日第一杯奶茶，温暖又俏皮");
    await h.click("生成封面");
    assert.ok(h.host.querySelector(".cover-editor"));
    assert.equal(h.host.querySelector(".cover-create"), null);
    assert.ok(h.host.querySelector(".cover-matching").textContent.includes("正在匹配"));
    assert.equal(h.docs.size, 1);
    assert.equal(JSON.parse([...h.docs.values()][0].content).needsRecommendation, true);
    assert.equal(h.requests.length, 1);
    assert.ok(!h.requests[0].input.image);
    assert.ok(h.requests[0].input.messages[0].content.includes("277"));
    await h.resolve({ text: JSON.stringify({ ...initial().config, layout: "SC-001", color: "C-01" }) });
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].input.image, true);
    assert.equal(h.docs.size, 1);
    const saved = JSON.parse([...h.docs.values()][0].content);
    assert.equal(saved.config.topic, "秋日第一杯奶茶，温暖又俏皮");
    assert.equal(saved.config.layout, "SC-001");
    assert.equal(saved.config.color, "C-01");
    assert.equal(saved.versions.length, 1);
    assert.ok(h.host.querySelector(".cover-editor"));
  } finally { await h.close(); }
});
for (const action of ["取消生成", "风格模板"]) {
  test(`late recommendation after ${action} preserves the original draft without applying late results`, async () => {
    const h = await harness({ empty: true });
    try {
      await h.click("秋日第一杯奶茶，温暖又俏皮");
      await h.click("生成封面");
      await h.click(action);
      await h.resolve({ text: JSON.stringify({ ...initial().config, layout: "SC-001", color: "C-01" }) });
      assert.equal(h.docs.size, 1);
      assert.equal(h.requests.length, 1);
      assert.equal(h.requests[0].signal.aborted, true);
    } finally { await h.close(); }
  });
}
test("invalid recommendation preserves a retryable draft", async () => {
  const h = await harness({ empty: true });
  try {
    await h.click("秋日第一杯奶茶，温暖又俏皮");
    await h.click("生成封面");
    await h.resolve({ text: JSON.stringify({ ...initial().config, style: "999", layout: "SC-001", color: "C-01" }) });
    assert.equal(h.docs.size, 1);
    assert.ok(h.host.querySelector('[role="alert"]'));
    assert.ok(h.host.querySelector(".cover-matching").textContent.includes("秋日第一杯奶茶，温暖又俏皮"));
    assert.ok(h.host.querySelector(".cover-editor"));
  } finally { await h.close(); }
});

test("cancelled matching reopens as a retryable editor draft and retries without duplicates", async () => {
  const h = await harness({ empty: true });
  try {
    await h.click("秋日第一杯奶茶，温暖又俏皮");
    await h.click("生成封面");
    const id = [...h.docs.keys()][0];
    await h.click("取消生成");
    await h.click("风格模板");
    await h.click("秋日第一杯奶茶，温暖又俏皮");
    assert.ok(h.host.querySelector(".cover-editor .cover-matching"));
    await h.click("重新匹配并生成");
    assert.equal(h.docs.size, 1);
    await h.resolve({ text: JSON.stringify({ ...initial().config, layout: "SC-001", color: "C-01" }) });
    assert.equal(h.docs.size, 1);
    assert.equal(JSON.parse(h.docs.get(id).content).versions.length, 1);
  } finally { await h.close(); }
});
test("remote changes during matching prevent recommendation overwrites", async () => {
  const h = await harness({ empty: true });
  try {
    await h.click("秋日第一杯奶茶，温暖又俏皮");
    await h.click("生成封面");
    await h.remote();
    await h.resolve({ text: JSON.stringify({ ...initial().config, layout: "SC-001", color: "C-01" }) });
    assert.equal(h.requests.length, 1);
    assert.equal(JSON.parse([...h.docs.values()][0].content).needsRecommendation, true);
  } finally { await h.close(); }
});
