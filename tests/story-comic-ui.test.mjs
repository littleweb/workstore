import {noProjects} from './helpers/projects.mjs';
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
  external: ["../list-projects/Projects",
    "react",
    "react/jsx-runtime",
    "antd",
    "@ant-design/icons",
    "./store",
    "./export",
    "./printExport",
    "../comics/images",
    "./render",
    "./ComicCanvas",
    "./previewImages",
    "../design-studio/images",
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
async function harness({ empty = false, upload = async()=>"workstore-image:"+"c".repeat(64) } = {}) {
  window.localStorage.clear();
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
    window: dom.window,
    setTimeout,
    clearTimeout,
    require(id) {
    if (id === "../list-projects/Projects") return noProjects;
      if (id === "react" || id === "react/jsx-runtime") return require(id);
      if (id === "@ant-design/icons")
        return new Proxy({}, { get: () => () => null });
      if (id === "./store") return store;
      if (id === "./printExport") return { clearPrintDocument() {}, exportPrintPdf: async () => {}, printSheets: async () => {} };
      if (id === "./export")
        return {
          exportZip: async () => {},
          exportPage: async () => {},
          exportPdf: async () => {},
        };
      if (id === "../design-studio/images") return {uploadImage:upload};
      if (id === "./previewImages") return {previewImageSource:async src=>src};
      if (id === "./ComicCanvas") return ({children}) => React.createElement("div", {className:"story-pages"}, children);
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
              if (input.messages?.[0]?.content.includes("现在执行一次生图前审稿")) return waiting.then(result => ({ text: JSON.stringify({ notes: "封面与正文承诺一致，保留具体动作与结尾。", plan: JSON.parse(result.text) }) }));
              return waiting;
            },
          },
        };
      if (id === "antd")
        return {
          App: { useApp: () => ({ message: { success: () => {} } }) },
          Input,
          Tabs: ({items,activeKey,onChange,className}) => React.createElement('nav',{className},items.map(item=>React.createElement('button',{key:item.key,'aria-current':activeKey===item.key?'page':undefined,onClick:()=>onChange(item.key)},item.label))),
          Empty: ({description}) => React.createElement('p',{},description),
          Card: Object.assign(({cover,children})=>React.createElement('div',{},cover,children),{Meta:({title})=>React.createElement('strong',{},title)}),
          Switch: ({checked,onChange,disabled,...props}) => React.createElement("button", {"aria-label":props["aria-label"],"aria-pressed":checked,disabled,onClick:()=>onChange(!checked)}, checked ? "开" : "关"),
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
          Modal: ({ open, children, footer }) => open ? React.createElement("div", { role: "dialog" }, children, footer) : null,
          Select: ({ value, options, onChange, ...props }) =>
            React.createElement(
              "select",
              {
                value,
                "aria-label": props["aria-label"],
                onChange: (e) => onChange(options.find(o => String(o.value) === e.target.value).value),
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
    assert.equal(h.host.querySelectorAll(".story-styles>button").length, 0);
    assert.equal(h.host.querySelectorAll(".story-tabs button").length, 5);
    assert.equal(h.host.querySelector("textarea").rows, 1);
    assert.equal(h.host.querySelector("textarea").hasAttribute("maxlength"), false);
    assert.ok(!h.host.querySelector(".story-controls").textContent.includes("包含封面"));
    await h.click("漫画");
    await h.click("故事漫画");
    assert.equal(h.host.querySelector(".story-work.controls-collapsed"), null);
    assert.equal(h.docs.size, 0);
    assert.ok(h.host.querySelector(".tool-sidebar-create.selected"));
    assert.equal(h.host.querySelector(".tool-sidebar-create.selected").getAttribute("aria-current"), "page");
    await act(async () => {
      h.host.querySelector('[aria-label="折叠故事漫画导航"]').click();
    });
    assert.equal(h.host.querySelector(".story-nav"), null);
    assert.ok(h.host.querySelector(".story-title").textContent);
    await act(async () =>
      h.host.querySelector('[aria-label="展开故事漫画导航"]').click()
    );
    assert.ok(h.host.querySelector(".story-nav"));
    await h.click("发布");
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
    assert.equal(h.host.querySelectorAll(".story-generate button").length, 1);
    assert.equal(h.host.querySelector(".story-controls .story-generate button")?.textContent, "生成");
    await h.click("生成");
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
    await h.click("发布");
    await h.click("偏好");
    assert.equal(h.host.querySelectorAll(".story-generate button").length, 1);
    assert.equal(h.host.querySelector(".story-controls .story-generate button")?.textContent, "生成");
    await h.click("生成");
    assert.equal(h.host.querySelectorAll(".story-pages article").length, 4);
    assert.equal(h.host.querySelector(".story-progress"), null);
    assert.ok(h.host.querySelector(".story-work.controls-collapsed"));
    assert.equal(h.host.querySelector('[aria-label="展开创作面板"]'), null);
    assert.equal(h.host.querySelector(".story-title").textContent, "拖延怎么办");
    assert.ok(!h.host.textContent.includes("画面已完成"));
    assert.ok(h.host.textContent.includes("正在规划"));
    assert.equal(h.host.querySelectorAll(".story-generate button").length, 0);
    assert.equal(h.host.querySelector(".story-job-status button").textContent, "暂停");
    assert.equal(h.host.querySelector(".story-job-status button").disabled, false);
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
    c.plannedConfig = JSON.stringify(c.config);
    await act(async () => {
      h.store.stageDocument("a", { content: JSON.stringify(c) });
      await drain();
    });
    await h.click("漫画");
    assert.equal(h.host.querySelectorAll(".story-page-error").length, 4);
    const retry = [...h.host.querySelectorAll('.story-job-status button')].find(b => b.textContent === '重试失败页');
    assert.ok(retry);
    assert.equal(retry.disabled, false);
    assert.equal(h.host.querySelector('[aria-label="重新生成第3页"]'), null);
    await act(async () => { retry.click(); await drain(); });
    const saved = JSON.parse(h.docs.get('a').content);
    assert.ok(saved.plan.pages.every(p => p.status === 'queued'));
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].input.image, true);
    assert.equal(h.host.querySelector('.story-job-status button').textContent, '暂停');
    assert.equal(h.host.querySelectorAll('.story-page-error').length, 0);
  } finally {
    await h.close();
  }
});

test("planning refines an existing work title before images finish", async () => {
  const h = await harness();
  try {
    assert.equal(h.host.querySelectorAll(".story-generate button").length, 1);
    assert.equal(h.host.querySelector(".story-controls .story-generate button")?.textContent, "生成");
    await h.click("生成");
    await h.resolve({ text: JSON.stringify({
      summary: "从小事开始行动", characters: "蓝衣女孩",
      pages: Array.from({length:4}, (_, i) => ({
        title: i ? "开始行动" : "告别拖延", text: "从小事开始",
        visual: `不同场景${i}`, layout: "standard"
      }))
    }) });
    assert.equal(h.host.querySelector(".story-title").textContent, "告别拖延");
    assert.equal(h.docs.get("a").title, "告别拖延");
    assert.equal(h.host.querySelector('textarea').value, '拖延怎么办');
    assert.equal(JSON.parse(h.docs.get('a').content).config.topic, '拖延怎么办');
  } finally { await h.close(); }
});

test("card selection does not open preview and selects matching style", async () => {
  const h = await harness({ empty: true });
  try {
    assert.equal(h.host.querySelectorAll('.story-style-select').length, 12);
    assert.equal(h.host.querySelector('.story-empty-intro p'), null);
    assert.equal(h.host.querySelector('.story-empty-intro svg'), null);
    assert.equal(h.host.querySelectorAll('.story-empty-panels span').length, 0);
    const topic = h.host.querySelector('textarea').value;
    for (const cover of h.host.querySelectorAll('.story-style-select')) {
      await act(async () => { cover.click(); await drain(); });
      const name = cover.querySelector('span').textContent;
      assert.equal(h.host.querySelector('.story-style-preview img'), null);
      assert.equal(h.requests.length, 0);
      assert.equal(cover.getAttribute('aria-pressed'), 'true');

      const selected = h.host.querySelector('.story-style-card[data-selected="true"]');
      assert.ok(selected.textContent.includes(name));
      assert.equal(h.host.querySelector('textarea').value, topic);
      assert.equal(h.requests.length, 0);
    }
  } finally { await h.close(); }
});


test("selecting twelve pages sends twelve to planning and immediately creates twelve placeholders", async () => {
  const h = await harness();
  try {
    await act(async () => {
      const select = h.host.querySelector('[aria-label="篇幅"]');
      select.value = '12';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    await h.click('生成');
    assert.equal(JSON.parse(h.docs.get('a').content).config.count, 12);
    assert.match(h.requests[0].input.messages[0].content, /总页数12/);
    assert.equal(h.requests[0].input.timeoutSeconds, 600);
    assert.equal(JSON.parse(h.docs.get('a').content).job.total, 12);
    assert.ok(h.host.textContent.includes('/12'));
  } finally { await h.close(); }
});


test("title-only draft restores full input and sends it to generation", async () => {
  const h = await harness();
  try {
    const title = '一只小狐狸第一次走进森林图书馆，发现每本书都会发出不同的声音';
    const c = initial(); c.config.topic = '';
    await act(async () => h.store.stageDocument('a', { title, content: JSON.stringify(c) }));
    assert.equal(h.host.querySelector('textarea').value, title);
    await h.click('生成');
    assert.equal(JSON.parse(h.docs.get('a').content).config.topic, title);
    assert.ok(h.requests[0].input.messages[0].content.includes(title));
  } finally { await h.close(); }
});


test("preferences tab contains settings and title has a rename action", async () => {
 const h = await harness();
 try {
  assert.deepEqual([...h.host.querySelectorAll('.story-tabs button')].map(b=>b.textContent), ['偏好','漫画','发布','下载','打印']);
  assert.equal(h.host.querySelector('.controls-collapsed'), null);
  await h.click('漫画'); assert.ok(h.host.querySelector('.controls-collapsed'));
  await h.click('偏好'); assert.equal(h.host.querySelector('.controls-collapsed'), null);
  assert.ok(h.host.querySelector('[aria-label="重命名作品"]'));
 } finally { await h.close(); }
});


test("opening template preview does not mutate an existing work", async () => {
  const h = await harness();
  try {
    const before = h.docs.get('a').content;
    await act(async () => h.host.querySelectorAll('.story-style-preview-button')[3].click());
    assert.ok(h.host.querySelector('.story-style-preview img'));
    assert.equal(h.docs.get('a').content, before);
    assert.equal(h.requests.length, 0);
  } finally { await h.close(); }
});

test("phone preview supports carousel, likes, follows, comments and simulated share", async () => {
 const h = await harness();
 try {
  const c=initial();c.plan={summary:'故事',characters:'角色',pages:Array.from({length:4},(_,i)=>({title:'页',text:'',visual:`场景${i}`,layout:'single',history:[]}))};
  c.copy={title:'预览标题',alternatives:['备选一','备选二'],description:'完整描述',hashtags:['故事','漫画','阅读','成长','生活']};
  await act(async()=>h.store.stageDocument('a',{content:JSON.stringify(c)}));
  await h.click('发布');
  const before=h.docs.get('a').content;
  const button=label=>h.host.querySelector(`[aria-label="${label}"]`);
  assert.equal(h.host.querySelector('.phone-copy h3').textContent,'预览标题');
  await act(async()=>button('预览下一页').click());
  assert.equal(h.host.querySelector('.phone-page-count').textContent,'2/4');
  await act(async()=>button('预览点赞').click());assert.equal(button('预览点赞').getAttribute('aria-pressed'),'true');
  await act(async()=>button('预览收藏').click());assert.equal(button('预览收藏').getAttribute('aria-pressed'),'true');
  await h.click('关注');assert.equal(h.host.querySelector('.phone-follow').textContent,'已关注');
  await act(async()=>button('预览评论').click());
  await act(async()=>{const input=button('预览评论内容');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'真有趣');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await act(async()=>h.host.querySelector('.phone-sheet form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.ok(h.host.querySelector('.phone-comment-list').textContent.includes('真有趣'));
  await act(async()=>button('关闭手机弹层').click());
  await act(async()=>button('预览分享').click());await h.click('微信好友');
  assert.ok(h.host.querySelector('.phone-notice').textContent.includes('未实际分享'));
  assert.equal(h.docs.get('a').content,before);assert.equal(h.requests.length,0);
 } finally {await h.close();}
});


test("print tab previews duplex blanks, booklet imposition and prevents incomplete output", async () => {
 const h=await harness();
 try {
  const c=initial(); c.plan={summary:'故事',characters:'角色',pages:Array.from({length:5},(_,i)=>({title:'页',text:'',visual:`场景${i}`,layout:'single',history:[],image:i<4?'data:image/png;base64,aGVsbG8=':undefined}))};
  await act(async()=>h.store.stageDocument('a',{content:JSON.stringify(c)})); await h.click('打印');
  const before=h.docs.get('a').content;
  assert.equal(h.host.querySelectorAll('.story-print-paper').length,6);
  assert.ok(h.host.querySelector('.story-print-preview header').textContent.includes('3 张 A4 · 补 1 页空白'));
  assert.ok([...h.host.querySelectorAll('button')].find(b=>b.textContent==='打印'&&b.closest('.story-print-actions')).disabled);
  await act(async()=>h.host.querySelector('[aria-label="封面背面留白"]').click());
  assert.equal(h.host.querySelectorAll('.story-print-paper')[1].textContent,'空白页');
  await act(async()=>{const select=h.host.querySelector('[aria-label="打印排版"]');select.value='booklet';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(h.host.querySelectorAll('.story-print-paper').length,4);
  assert.ok(h.host.querySelector('.story-print-preview header').textContent.includes('2 张 A4 · 补 3 页空白'));
  const first=h.host.querySelector('.story-print-paper'); assert.equal(first.querySelectorAll('.story-print-slot').length,2);
  assert.equal(first.querySelector('.story-print-page-number').textContent,'1');
  await act(async()=>{const select=h.host.querySelector('[aria-label="打印输出页面"]');select.value='back';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(h.host.querySelectorAll('.story-print-paper').length,2);
  assert.ok([...h.host.querySelectorAll('figcaption')].every(n=>n.textContent.includes('背面')));
  assert.equal(h.docs.get('a').content,before);assert.equal(h.requests.length,0);
 } finally { await h.close(); }
});

test('my works includes every saved work, filters styles and opens original document without creating', async () => {
  const h = await harness();
  try {
    const a = h.docs.get('a'), b = h.docs.get('b');
    const ca = JSON.parse(a.content), cb = JSON.parse(b.content);
    ca.config.style = 'ligne-claire'; cb.config.style = 'warm-manga';
    const plan = hash => ({summary:'故事摘要',characters:'主角',pages:Array.from({length:4},(_,i)=>({title:'标题',text:'正文',visual:'场景'+i,layout:'standard',history:[],image:'workstore-image:'+hash.repeat(64)}))});
    ca.plan = plan('a'); cb.plan = plan('b');
    a.content = JSON.stringify(ca); b.content = JSON.stringify(cb);
    await h.click('我的作品');
    assert.equal(h.host.querySelectorAll('.story-work-card').length, 2);
    assert.equal(h.host.querySelector('.story-work').hidden, true);
    assert.equal(h.host.querySelectorAll('.story-gallery-tabs button').length, 13);
    assert.equal(h.host.querySelector('.story-work-card img').getAttribute('src'), 'workstore-image:'+'a'.repeat(64));
    const tabs = [...h.host.querySelectorAll('.story-gallery-tabs button')];
    await act(async()=>tabs[2].click());
    assert.equal(h.host.querySelectorAll('.story-work-card').length, 1);
    assert.match(h.host.querySelector('.story-work-card').textContent, /b/);
    await act(async()=>h.host.querySelector('.story-work-card').click());
    assert.equal(h.host.querySelector('.story-work-gallery'), null);
    assert.equal(h.host.querySelector('.story-title').textContent, 'b');
    assert.equal(h.docs.size, 2);
  } finally { await h.close(); }
});

test('clicking a completed page opens its own AI conversation and can close without editing the work', async()=>{
 const h=await harness();
 try {
  const c=JSON.parse(h.docs.get('a').content);
  c.plan={summary:'故事摘要',characters:'主角',pages:Array.from({length:4},(_,i)=>({title:'标题',text:'对白',visual:'场景'+i,layout:'standard',history:[],image:'workstore-image:'+'a'.repeat(64)}))};
  await act(async()=>{h.store.stageDocument('a',{content:JSON.stringify(c)});await drain();});
  await h.click('漫画');
  const before=h.docs.get('a').content;
  await act(async()=>{h.host.querySelector('[aria-label="优化第2页"]').click();await drain();});
  assert.match(h.host.querySelector('[aria-label="页面AI优化"]').textContent,/第 2 页/);
  assert(h.host.querySelector('[aria-label="页面修改要求"]'));
  assert.equal(h.host.querySelectorAll('.story-refiner-suggestions button').length,3);
  await act(async()=>h.host.querySelectorAll('.story-refiner-suggestions button')[1].click());
  assert.match(h.host.querySelector('[aria-label="页面修改要求"]').value,/文字修改/);
  await act(async()=>h.host.querySelector('[aria-label="关闭AI优化"]').click());
  assert.equal(h.host.querySelector('[aria-label="页面AI优化"]'),null);
  const preview=h.host.querySelector('[aria-label="预览第2页"]');
  assert(preview.closest('footer'));
  await act(async()=>{preview.click();await drain();});
  assert(h.host.querySelector('[role="dialog"] .story-preview img'));
  assert.equal(h.docs.get('a').content,before);assert.equal(h.requests.length,0);
 } finally {await h.close();}
});

test('preferences keep references optional in a draft and show split settings with three upload tiles per kind',async()=>{
 const h=await harness({empty:true});try{
  const headings=[...h.host.querySelectorAll('.story-controls h2')].map(n=>n.textContent);
  assert(headings.some(t=>t.includes('尺寸篇幅')));assert(headings.some(t=>t.includes('其他偏好')));assert(headings.some(t=>t.includes('参考图样')));
  assert.equal(h.host.querySelectorAll('.story-reference-tile').length,6);assert.equal(h.host.querySelector('.story-style-gallery header'),null);
  assert.match(h.host.querySelector('.story-style-caption').textContent,/清晰轮廓，平涂叙事/);
  const input=h.host.querySelector('[aria-label="上传场景图"]');
  Object.defineProperty(input,'files',{value:[new window.File(['image'],'scene.png',{type:'image/png'})],configurable:true});
  await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await drain();});
  assert(h.host.querySelector('[aria-label="移除场景图1"]'));assert.equal(h.docs.size,0);
  await act(async()=>h.host.querySelector('[aria-label="移除场景图1"]').click());
  assert.equal(h.host.querySelector('[aria-label="移除场景图1"]'),null);
 }finally{await h.close();}
});
test('late reference upload does not overwrite a new draft after navigation',async()=>{
 let release;const waiting=new Promise(r=>release=r);const h=await harness({upload:()=>waiting});
 try{
  await h.click('偏好');const input=h.host.querySelector('[aria-label="上传角色图"]');
  Object.defineProperty(input,'files',{value:[new window.File(['image'],'role.png',{type:'image/png'})],configurable:true});
  await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await drain();});
  await h.click('故事漫画');
  await act(async()=>{release('workstore-image:'+'c'.repeat(64));await drain();});
  assert.equal(h.host.querySelector('[aria-label="移除角色图1"]'),null);assert.equal(h.docs.size,2);
 }finally{await h.close();}
});

test("create and works entries accept down-only navigation and deduplicate trailing clicks", async () => {
  const h = await harness();
  try {
    const create = [...h.host.querySelectorAll(".tool-sidebar-create")].find(e => e.textContent.includes("故事漫画"));
    await act(async () => { down(create); await drain(); });
    assert.equal(h.host.querySelector(".story-title").textContent, "画漫画");
    const flushes = h.flushes;
    await act(async () => { create.dispatchEvent(new dom.window.MouseEvent("click", {bubbles:true,detail:1})); await drain(); });
    assert.equal(h.flushes, flushes);
    const works = [...h.host.querySelectorAll(".tool-sidebar-create")].find(e => e.textContent.includes("我的作品"));
    await act(async () => { down(works); await drain(); });
    assert.equal(works.getAttribute("aria-current"), "page");
    await act(async () => { works.dispatchEvent(new dom.window.MouseEvent("click", {bubbles:true,detail:1})); await drain(); });
    assert.equal(works.getAttribute("aria-current"), "page");
  } finally { await h.close(); }
});

test("works navigation defers during IME and touch requires click", async () => {
 const h=await harness();
 try {
  const works=[...h.host.querySelectorAll('.tool-sidebar-create')].find(e=>e.textContent.includes('我的作品'));
  const field=h.host.querySelector('textarea');
  await act(async()=>{
   const event=new dom.window.MouseEvent('pointerdown',{bubbles:true,button:0});
   Object.defineProperty(event,'pointerType',{value:'touch'}); works.dispatchEvent(event); await drain();
  });
  assert.notEqual(works.getAttribute('aria-current'),'page');
  await act(async()=>{field.dispatchEvent(new dom.window.CompositionEvent('compositionstart',{bubbles:true}));down(works);await drain();});
  assert.notEqual(works.getAttribute('aria-current'),'page');
  await act(async()=>{field.dispatchEvent(new dom.window.CompositionEvent('compositionend',{bubbles:true}));await new Promise(r=>setTimeout(r,15));});
  assert.equal(works.getAttribute('aria-current'),'page');
 } finally {await h.close();}
});
