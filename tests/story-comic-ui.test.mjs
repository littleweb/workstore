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
    new URL("../src/story-comic/StoryComicApp.tsx", import.meta.url).pathname,
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
    "../comics/images",
    "./render",
    "../workspace",
    "@tauri-apps/plugin-clipboard-manager",
    "../ai/client",
    "../documentLifecycle",
  ],
}).outputFiles[0].text;
after(() => dom.window.close());
const drain = () => new Promise((r) => setImmediate(r));
const initial = () => ({
  version: 1,
  config: {
    topic: "拖延怎么办",
    style: "warm-manga",
    count: 4,
    language: "中文",
    audience: "大众读者",
  },
  history: [],
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
        ])
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
        title: "未命名故事漫画",
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
  Input.TextArea = ({ showCount, ...props }) =>
    React.createElement("textarea", props);
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    AbortController,
    structuredClone,
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
      if (id === "./export")
        return {
          exportZip: async () => {},
          exportPage: async () => {},
          exportPdf: async () => {},
        };
      if (id === "./render")
        return { composePage: async () => "workstore-image:" + "b".repeat(64) };
      if (id === "../workspace") return { native: false };
      if (id === "@tauri-apps/plugin-clipboard-manager")
        return { writeText: async () => {} };
      if (id === "../comics/images")
        return {
          referenceImage: async (src) => "png:" + src,
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
              children
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
                  o.label
                )
              )
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
        (b) => b.textContent === text
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
test("upstream styles, separate result tabs, creation at top and collapse keeps current file", async () => {
  const h = await harness({ empty: true });
  try {
    assert.equal(h.host.querySelectorAll(".story-styles>button").length, 11);
    assert.equal(h.host.querySelectorAll(".story-tabs button").length, 3);
    assert.equal(h.host.querySelector("textarea").rows, 2);
    assert.ok(!h.host.querySelector(".story-controls").textContent.includes("包含封面"));
    await h.click("创建故事漫画");
    assert.equal(h.docs.size, 1);
    const saved = [...h.docs.values()][0];
    await act(async () => {
      h.host.querySelector('[aria-label="折叠故事漫画导航"]').click();
    });
    assert.equal(h.host.querySelector(".story-nav"), null);
    assert.equal(h.host.querySelector(".story-title").textContent, saved.title);
    await act(async () =>
      h.host.querySelector('[aria-label="展开故事漫画导航"]').click()
    );
    assert.ok(h.host.querySelector(".story-nav"));
    await h.click("发布文案");
    assert.equal(h.host.querySelector(".story-pages"), null);
    assert.ok(h.host.textContent.includes("发布文案会在这里准备好"));
  } finally {
    await h.close();
  }
});
function down(el) {
  const event = new dom.window.MouseEvent("pointerdown", {
    bubbles: true,
    button: 0,
  });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  el.dispatchEvent(event);
}
test("down-only selection works and trailing click is deduplicated, save failure stays on current work", async () => {
  const h = await harness();
  try {
    const b = [...h.host.querySelectorAll(".story-row-name")].find(
      (e) => e.textContent === "b"
    );
    await act(async () => {
      down(b);
      await drain();
    });
    assert.equal(h.host.querySelector(".story-title").textContent, "b");
    const flushes = h.flushes;
    await act(async () => {
      b.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, detail: 1 })
      );
      await drain();
    });
    assert.equal(h.flushes, flushes);
    h.failFlush = true;
    const a = [...h.host.querySelectorAll(".story-row-name")].find(
      (e) => e.textContent === "a"
    );
    await act(async () => {
      down(a);
      await drain();
    });
    assert.equal(h.host.querySelector(".story-title").textContent, "b");
    assert.ok(h.host.textContent.includes("test save failed"));
  } finally {
    await h.close();
  }
});
test("generation saves pending work before AI and ignores result after navigation", async () => {
  const h = await harness();
  try {
    await h.click("一键生成完整漫画");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].input.toolId, "app.story-comic");
    assert.equal(JSON.parse(h.docs.get("a").content).job.status, "running");
    await h.click("b");
    assert.equal(h.requests[0].signal.aborted, true);
    await h.resolve({
      text: JSON.stringify({
        summary: "完整故事",
        characters: "蓝衣女孩",
        pages: Array.from({ length: 4 }, (_, i) => ({
          title: "开始",
          text: "五分钟",
          visual: "画面" + i,
          layout: "single",
        })),
      }),
    });
    assert.equal(JSON.parse(h.docs.get("a").content).plan, undefined);
    assert.equal(h.host.querySelector(".story-title").textContent, "b");
  } finally {
    await h.close();
  }
});
test("IME selection waits for composition end, keeping activation protected", async () => {
  const h = await harness();
  try {
    const field = h.host.querySelector("textarea");
    await act(async () => {
      field.dispatchEvent(
        new dom.window.CompositionEvent("compositionstart", { bubbles: true })
      );
      down(
        [...h.host.querySelectorAll(".story-row-name")].find(
          (e) => e.textContent === "b"
        )
      );
      await drain();
    });
    assert.equal(h.host.querySelector(".story-title").textContent, "a");
    assert.ok([...h.blockers].some((f) => f()));
    await act(async () => {
      field.dispatchEvent(
        new dom.window.CompositionEvent("compositionend", { bubbles: true })
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.equal(h.host.querySelector(".story-title").textContent, "b");
  } finally {
    await h.close();
  }
});
test("clicking generate lays out all placeholders immediately while planning is pending", async () => {
  const h = await harness();
  try {
    await h.click("发布文案");
    await h.click("一键生成完整漫画");
    assert.equal(h.host.querySelectorAll(".story-pages article").length, 4);
    assert.equal(h.host.querySelector("progress").value, 0);
    assert.ok(h.host.textContent.includes("画面已完成 0/4 页"));
    assert.ok(h.host.textContent.includes("正在规划"));
    assert.equal(h.host.querySelectorAll(".story-generate button").length, 1);
    assert.equal(h.host.querySelector(".story-generate button").disabled, false);
    assert.ok(!h.host.querySelector(".story-controls").textContent.includes("已完成"));
    await h.click("暂停");
    await h.resolve({ text: "{}" });
  } finally {
    await h.close();
  }
});

test("failed pages show their persisted concrete error", async () => {
  const h = await harness();
  try {
    const c = initial();
    c.plan = {
      summary: "摘要",
      characters: "人物",
      pages: Array.from({ length: 4 }, (_, i) => ({
        title: "标题",
        text: "正文",
        visual: "场景" + i,
        layout: "single",
        history: [],
        status: "error",
        error: "已有 AI 请求运行中，请等待或停止后重试",
      })),
    };
    await act(async () => {
      h.store.stageDocument("a", { content: JSON.stringify(c) });
      await drain();
    });
    assert.equal(h.host.querySelectorAll(".story-page-error").length, 4);
    assert.ok(
      h.host
        .querySelector(".story-page-error")
        .textContent.includes("已有 AI 请求运行中")
    );
  } finally {
    await h.close();
  }
});
