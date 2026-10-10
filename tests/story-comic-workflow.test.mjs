import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import vm from "node:vm";
function load(file) {
  const module = { exports: {} };
  vm.runInNewContext(
    buildSync({
      entryPoints: [`src/story-comic/${file}.ts`],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
    }).outputFiles[0].text,
    { module, structuredClone, console }
  );
  return module.exports;
}
const m = load("model"),
  { runWorkflow } = load("workflow");
const plan = () => ({
  summary: "一个完整的原创故事",
  characters: "蓝衣短发女孩与白猫，房间保持一致",
  pages: Array.from({ length: 4 }, (_, i) => ({
    title: i ? "行动起来" : "别再拖了",
    text: i ? "先做一件小事" : "从五分钟开始",
    visual: `场景${i}`,
    layout: "single",
  })),
});
const reviewed = (p = plan()) => ({ notes: "第2页动作已经推进事件，保留；封面与结尾承诺一致。", plan: p });
const isReview = prompt => prompt.includes("现在执行一次生图前审稿");
const copy = () => ({
  title: "从今天开始",
  alternatives: ["试试五分钟", "你也可以做到"],
  description: "迈出第一步。",
  hashtags: ["成长", "漫画", "行动", "自律", "生活"],
});
function harness(options = {}) {
  let current = {
      ...m.emptyContent(),
      config: { ...m.defaults(), topic: "拖延怎么办", count: 4 },
    },
    valid = true;
  const images = [],
    saves = [];
  let texts = 0,
    composes = 0;
  const abort = new AbortController();
  return {
    get current() {
      return current;
    },
    images,
    saves,
    abort,
    invalidate() {
      valid = false;
    },
    deps: {
      valid: () => valid,
      text: async (prompt) => {
        if (isReview(prompt)) return JSON.stringify(reviewed());
        texts++;
        return JSON.stringify(texts === 1 ? plan() : copy());
      },
      image: async (prompt, refs) => {
        images.push({ prompt, refs });
        return options.image
          ? options.image(prompt, refs, images.length)
          : `image-${images.length}`;
      },
      compose: async (raw) => {
        composes++;
        return `composed-${raw}-${composes}`;
      },
      save: async (c) => {
        if (options.failSave) throw Error("磁盘写入失败");
        current = structuredClone(c);
        saves.push(current);
      },
    },
    get texts() {
      return texts;
    },
  };
}
test("upstream styles and count includes cover; malformed copy, repeated pages and invalid counts rejected", () => {
  assert.equal(m.styles.length, 12);
  assert.equal(
    m.parsePlan(JSON.stringify(plan()), { ...m.defaults(), count: 4 }).pages
      .length,
    4
  );
  assert.throws(() =>
    m.parsePlan(JSON.stringify(plan()), { ...m.defaults(), count: 8 })
  );
  const p = plan();
  p.pages[3].visual = p.pages[0].visual;
  assert.throws(() => m.parsePlan(JSON.stringify(p), m.defaults()));
  assert.throws(() => m.parseCopy("{}"));
  assert.equal(m.pageFilename(0), "01-cover.png");
  assert.equal(m.pageFilename(7), "08-page.png");
});
test("one-click pipeline creates a hidden reference, independent pages and copy with durable checkpoints", async () => {
  const h = harness();
  await runWorkflow(h.current, h.deps, h.abort.signal);
  assert.equal(h.images.length, 5);
  assert.equal(h.current.plan.pages.length, 4);
  assert.equal(h.current.job.status, "done");
  assert.ok(h.current.copy);
  assert.ok(h.images.slice(1).every((i) => i.refs[0] === "image-1"));
  assert.ok(
    h.saves.some((c) => c.plan?.pages[0].image && !c.plan.pages[1].image)
  );
});
test("a failed page retries three times, preserves other pages and resumes only failed page", async () => {
  let failedAttempts = 0;
  const h = harness({
    image: async (prompt, refs, n) => {
      if (prompt.includes("当前第2页") && failedAttempts++ < 4)
        throw Error("page failed");
      return `image-${n}`;
    },
  });
  await runWorkflow(h.current, h.deps, h.abort.signal);
  assert.equal(h.current.job.status, "error");
  assert.equal(h.current.plan.pages.filter((p) => p.image).length, 3);
  assert.equal(failedAttempts, 4);
  assert.ok(h.saves.some(c => c.job.stage === "第2页自动重试 3/3"));
  assert.ok(h.current.copy);
  const before = h.images.length;
  const keep = h.current.plan.pages[0].image;
  await runWorkflow(h.current, h.deps, h.abort.signal);
  assert.equal(h.images.length, before + 1);
  assert.equal(h.current.job.status, "done");
  assert.equal(h.current.plan.pages[0].image, keep);
});
test("single page regeneration retains earlier version and does not regenerate other pages", async () => {
  const h = harness();
  await runWorkflow(h.current, h.deps, h.abort.signal);
  const before = h.images.length,
    old = h.current.plan.pages[2].image;
  await runWorkflow(h.current, h.deps, h.abort.signal, 2);
  assert.equal(h.images.length, before + 1);
  assert.equal(h.current.plan.pages[2].history[0], old);
});
test("late planning result after cancellation or remote edit cannot persist", async () => {
  for (const cancel of [false, true]) {
    const h = harness();
    let resolve;
    h.deps.text = () => new Promise((r) => (resolve = r));
    const task = runWorkflow(h.current, h.deps, h.abort.signal);
    await new Promise((r) => setImmediate(r));
    if (cancel) h.abort.abort();
    else h.invalidate();
    resolve(JSON.stringify(plan()));
    await assert.rejects(task);
    assert.equal(h.saves.length, 1);
    assert.equal(h.current.plan, undefined);
    assert.equal(h.images.length, 0);
  }
});
test("save failure halts workflow before any paid request", async () => {
  const h = harness({ failSave: true });
  await assert.rejects(runWorkflow(h.current, h.deps, h.abort.signal));
  assert.equal(h.images.length, 0);
  assert.equal(h.texts, 0);
});
test("changed settings archive old completed work before rebuilding and reject isolated regeneration", async () => {
  const h = harness();
  await runWorkflow(h.current, h.deps, h.abort.signal);
  const next = structuredClone(h.current);
  next.config.topic = "新的故事";
  await assert.rejects(runWorkflow(next, h.deps, h.abort.signal, 1));
  let n = 0;
  h.deps.text = async prompt => isReview(prompt) ? JSON.stringify(reviewed()) : JSON.stringify(++n === 1 ? plan() : copy());
  await runWorkflow(next, h.deps, h.abort.signal);
  assert.equal(h.current.history.length, 1);
  assert.ok(h.current.history[0].plan.pages.every((p) => p.image));
  assert.equal(h.current.config.topic, "新的故事");
});

test("corrupt persisted job is rejected instead of reaching React rendering", () => {
  const c = m.emptyContent();
  c.job = { status: "running", stage: { unexpected: true } };
  assert.throws(() => m.readContent(JSON.stringify(c)));
});

test("overlong or structured text is repaired automatically before image generation", async () => {
  for (const issue of ["length", "type"]) {
    const h = harness(),
      bad = plan(),
      prompts = [];
    if (issue === "length") bad.pages[0].title = "长".repeat(20);
    else bad.characters = [{ name: "女孩", description: "蓝衣" }];
    h.deps.text = async (prompt) => {
      if (isReview(prompt)) return JSON.stringify(reviewed());
      prompts.push(prompt);
      return JSON.stringify(
        prompts.length === 1 ? bad : prompts.length === 2 ? plan() : copy()
      );
    };
    await runWorkflow(h.current, h.deps, h.abort.signal);
    assert.equal(h.current.job.status, "done");
    assert.equal(prompts.length, 3);
    assert.match(
      prompts[1],
      issue === "length" ? /第1页标题有20字/ : /人物描述必须是文字字符串/
    );
  }
});
test("repeated invalid planning returns a precise error and never starts images", async () => {
  const h = harness();
  let requests = 0;
  h.deps.text = async () => {
    requests++;
    return JSON.stringify({ ...plan(), characters: { name: "女孩" } });
  };
  await assert.rejects(
    runWorkflow(h.current, h.deps, h.abort.signal),
    /人物描述必须是文字字符串/
  );
  assert.equal(requests, 2);
  assert.equal(h.images.length, 0);
  assert.equal(h.current.job.status, "error");
  assert.equal(h.current.job.total, 4);
});
test("two pages run concurrently, queued pages start as slots free and saves remain serialized", async () => {
  const h = harness(),
    waiting = new Map();
  let activeSaves = 0,
    maxSaves = 0;
  const save = h.deps.save;
  h.deps.save = async (c) => {
    activeSaves++;
    maxSaves = Math.max(maxSaves, activeSaves);
    await new Promise((r) => setImmediate(r));
    await save(c);
    activeSaves--;
  };
  h.deps.image = async (prompt, refs) => {
    if (!refs.length) return "reference";
    return new Promise((resolve) =>
      waiting.set(Number(prompt.match(/当前第(\d+)页/)[1]), resolve)
    );
  };
  const task = runWorkflow(h.current, h.deps, h.abort.signal);
  for (let i = 0; i < 40 && waiting.size < 2; i++)
    await new Promise((r) => setImmediate(r));
  assert.equal(waiting.size, 2);
  assert.equal(
    h.current.plan.pages.filter((p) => p.status === "generating").length,
    2
  );
  assert.equal(
    h.current.plan.pages.filter((p) => p.status === "queued").length,
    2
  );
  waiting.get(2)("raw-2");
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.equal(h.current.plan.pages[1].status, "ready");
  assert.equal(h.current.plan.pages[0].status, "generating");
  waiting.get(1)("raw-1");
  for (let n = 0; n < 40 && waiting.size < 4; n++)
    await new Promise((r) => setImmediate(r));
  assert.equal(waiting.size, 4);
  for (const i of [4, 3]) waiting.get(i)(`raw-${i}`);
  await task;
  assert.ok(h.current.plan.pages.every((p) => p.status === "ready" && p.image));
  assert.equal(maxSaves, 1);
});
test("parallel save failure drains workers and blocks every late write", async () => {
  const h = harness(),
    waiting = [],
    save = h.deps.save;
  let fail = false;
  h.deps.save = async (c) => {
    if (fail) throw Error("save failed");
    await save(c);
  };
  h.deps.image = async (prompt, refs) =>
    !refs.length
      ? "reference"
      : new Promise((resolve) => waiting.push(resolve));
  const task = runWorkflow(h.current, h.deps, h.abort.signal);
  const settled = task.then(
    () => false,
    () => true
  );
  for (let i = 0; i < 40 && waiting.length < 2; i++)
    await new Promise((r) => setImmediate(r));
  assert.equal(waiting.length, 2);
  fail = true;
  waiting[0]("first");
  await new Promise((r) => setImmediate(r));
  const before = h.saves.length;
  waiting.slice(1).forEach((resolve) => resolve("late"));
  assert.equal(await settled, true);
  assert.equal(h.saves.length, before);
});

test("upstream definitions drive presets, tone and legacy settings without rewriting documents", () => {
  const b = load("baoyu");
  assert.equal(m.styleFor({style:'warm-manga'}).tone, 'warm');
  assert.equal(m.styleFor({style:'vintage'}).tone, 'vintage');
  assert.equal(m.styleFor({style:'ink'}).art, 'ink-brush');
  assert.equal(m.styleFor({style:'shoujo',tone:'action'}).tone, 'romantic');
  for (const style of m.styles) {
    const config = {...m.defaults(), topic:'学习', style:style.id};
    const prompt = m.planningPrompt(config);
    assert.ok(prompt.includes(b.reference(`art-styles/${style.art}`)));
    if (style.preset) assert.ok(prompt.includes(b.reference(`presets/${style.preset}`)));
    assert.ok(Buffer.byteLength(prompt) < 100000);
  }
  const legacy = {...m.emptyContent(), config:{...m.defaults(),style:'warm-manga'}};
  assert.equal(m.readContent(JSON.stringify(legacy)).config.style,'warm-manga');
});
test("every final prompt is checkpointed before any image request and matches dispatched content", async () => {
  const h = harness();
  const image = h.deps.image;
  h.deps.image = async (prompt, refs) => {
    assert.match(h.current.engine, /^baoyu-comic@/);
    assert.ok(h.current.plan.pages.every(p => p.prompt));
    assert.ok([h.current.characterPrompt,...h.current.plan.pages.map(p=>p.prompt)].includes(prompt));
    return image(prompt, refs);
  };
  await runWorkflow(h.current,h.deps,h.abort.signal);
  assert.match(h.current.plan.pages[1].prompt, /对白气泡/);
});

test("long comics validate, retain size and apply selected ratio to page prompts",()=>{
 for(const count of [12,16,18,20]) {
  const config={...m.defaults(),topic:'一个完整的故事',count,size:'wide'};
  m.validateConfig(config);
  const source=plan();source.pages=Array.from({length:count},(_,i)=>({...source.pages[i%4],visual:`场景${i}`}));
  const parsed=m.parsePlan(JSON.stringify(source),config);
  assert.equal(parsed.pages.length,count);assert.equal(parsed.size,'wide');
  assert.match(m.artPrompt({...m.emptyContent(),config,plan:parsed},0),/16:9/);
  assert.match(m.artPrompt({...m.emptyContent(),config,plan:parsed},0),/1920×1080/);
 }
 assert.throws(()=>m.validateConfig({...m.defaults(),topic:'test',count:22}));
 assert.throws(()=>m.validateConfig({...m.defaults(),topic:'test',size:'bad-size'}));
});

test("manual page counts reach all image jobs; inconsistent cached eight-page plan is archived", async () => {
  for (const count of [12, 16, 18, 20]) {
    const h = harness();
    const source = h.current;
    source.config.count = count;
    const makePlan = (length) => ({ ...plan(), pages: Array.from({ length }, (_, i) => ({ ...plan().pages[i % 4], visual: `场景${i}` })) });
    source.plan = m.parsePlan(JSON.stringify(makePlan(8)), { ...source.config, count: 8 });
    source.plannedConfig = m.signature(source.config);
    source.reference = 'old-reference';
    let calls = 0;
    h.deps.text = async (prompt) => {
      if (isReview(prompt)) return JSON.stringify(reviewed(makePlan(count)));
      if (++calls === 1) {
        assert.match(prompt, new RegExp(`总页数${count}`));
        return JSON.stringify(makePlan(8));
      }
      if (calls === 2) {
        assert.match(prompt, new RegExp(`需要${count}页.*实际返回8页`));
        return JSON.stringify(makePlan(count));
      }
      return JSON.stringify(copy());
    };
    await runWorkflow(source, h.deps, h.abort.signal);
    assert.equal(h.current.plan.pages.length, count);
    assert.equal(h.current.plan.pages.filter(p => p.status === 'ready').length, count);
    assert.equal(h.current.job.total, count);
    assert.equal(h.images.length, count + 1);
    assert.equal(h.current.history[0].plan.pages.length, 8);
    assert.equal(h.current.job.status, 'done');
  }
});

test("cover title is refined within ten characters without invalidating saved old titles", () => {
  const config = { ...m.defaults(), count: 4 };
  const p = plan();
  p.pages[0].title = '一二三四五六七八九十一';
  assert.throws(() => m.parsePlan(JSON.stringify(p), config), /最多允许10字/);
  p.pages[0].title = '一二三四五六七八九十';
  assert.equal(m.parsePlan(JSON.stringify(p), config).pages[0].title.length, 10);
  const old = { ...m.emptyContent(), plan: { ...p, pages: p.pages.map(x => ({ ...x, title: '一二三四五六七八九十一二', history: [] })) } };
  assert.equal(m.readContent(JSON.stringify(old)).plan.pages.length, 4);
  assert.equal([...m.topicTitle('一二三四五六七八九十一二三四')].length, 11);
});


test("input keeps the full original title and respects explicitly cleared drafts", () => {
  const config = { ...m.defaults(), topic: '请帮我讲一个关于拖延的完整故事', count: 4 };
  const c = { ...m.emptyContent(), config, plannedConfig: m.signature(config), plan: m.parsePlan(JSON.stringify(plan()), config) };
  assert.equal(m.topicInputValue(m.readContent(JSON.stringify(c))), config.topic);
  assert.equal(m.topicInputValue(m.emptyContent(), '完整标题'), '完整标题');
  assert.equal(m.topicInputValue(m.emptyContent(), '未命名故事漫画'), '');
  assert.equal(m.topicInputValue({ ...m.emptyContent(), topicEdited: true }, '完整标题'), '');
});

test("planning timeout identifies stage and preserves requested placeholders for retry", async () => {
  const h = harness(); h.current.config.count = 12;
  h.deps.text = async () => { throw Error('AI 文本响应超过 600 秒'); };
  await assert.rejects(runWorkflow(h.current, h.deps, h.abort.signal), /漫画内容规划失败.*600 秒/);
  assert.equal(h.current.job.total, 12);
  assert.equal(h.current.job.status, 'error');
  assert.equal(h.images.length, 0);
});

test("retry failed pages preserves completed images and the work plan", async () => {
  const h = harness(); await runWorkflow(h.current, h.deps, h.abort.signal);
  const c = structuredClone(h.current), old = c.plan.pages[0].image;
  c.plan.pages[1].error = 'timeout'; c.plan.pages[1].status = 'error'; delete c.plan.pages[1].image;
  c.plan.pages[3].error = 'timeout'; c.plan.pages[3].status = 'error'; delete c.plan.pages[3].image;
  const count = h.images.length;
  await runWorkflow(c, h.deps, h.abort.signal, undefined, true);
  assert.equal(h.images.length - count, 2);
  assert.equal(h.current.plan.pages[0].image, old);
  assert.equal(h.current.history.length, 0);
  assert.equal(h.current.job.status, 'done');
});


test("long topics remain intact through validation, persistence and planning", () => {
  const topic = '这是完整的故事创作要求。'.repeat(1000);
  const c = { ...m.emptyContent(), config: { ...m.defaults(), topic } };
  m.validateConfig(c.config);
  assert.equal(m.readContent(JSON.stringify(c)).config.topic, topic);
  assert.ok(m.planningPrompt(c.config).includes(topic));
  assert.throws(() => m.validateConfig({ ...c.config, topic: '  ' }), /主题不能为空/);
});


test("third automatic retry can succeed without regenerating completed pages", async () => {
  let attempts = 0;
  const h = harness({ image: async (prompt, refs, n) => {
    if (prompt.includes('当前第2页') && ++attempts <= 3) throw Error('temporary failure');
    return `image-${n}`;
  } });
  await runWorkflow(h.current, h.deps, h.abort.signal);
  assert.equal(attempts, 4);
  assert.equal(h.current.job.status, 'done');
  assert.equal(h.images.length, 8);
});

test('audiences survive persisted content and guide planning for children, students and workplace', () => {
  for (const audience of ['大众读者','学龄前儿童','儿童','青少年','学生','大学生','职场人士','职场新人','家长','教师','中老年读者']) {
    const content = m.emptyContent(); content.config.audience = audience;
    assert.equal(m.readContent(JSON.stringify(content)).config.audience, audience);
    assert.match(m.planningPrompt(content.config), new RegExp('目标受众：'+audience));
    assert.doesNotThrow(()=>m.parsePlan(JSON.stringify(plan()), {...content.config,count:4}));
  }
  const invalid = m.emptyContent(); invalid.config.audience = 'unknown';
  assert.throws(()=>m.readContent(JSON.stringify(invalid)));
  assert.match(m.planningPrompt({...m.defaults(),audience:'儿童'}), /儿童能理解的词语/);
});

test('scene and character references survive storage and reach the matching generation requests',async()=>{
 const id=c=>'workstore-image:'+c.repeat(64);
 const c=m.emptyContent();c.config={...c.config,topic:'朋友',count:4,characterReferences:[id('a')],sceneReferences:[id('b')]};
 assert.equal(m.readContent(JSON.stringify(c)).config.sceneReferences[0],id('b'));
 const calls=[];let saved;
 await runWorkflow(c,{valid:()=>true,text:async prompt=>isReview(prompt)?JSON.stringify(reviewed()):prompt.includes('只输出 JSON')?JSON.stringify(plan()):JSON.stringify({title:'朋友',alternatives:['朋友们','友情'],description:'朋友的故事',hashtags:['朋友','友情','成长','漫画','故事']}),image:async(prompt,refs)=>{calls.push({prompt,refs});return id('c');},compose:async raw=>raw,save:async next=>saved=next},new AbortController().signal);
 assert.deepEqual(Array.from(calls[0].refs),[id('a')]);
 assert.deepEqual(Array.from(calls[1].refs),[id('c'),id('a'),id('b')]);
 assert.match(calls[1].prompt,/用户场景图/);assert.equal(saved.plan.pages.length,4);
 const invalid=m.emptyContent();invalid.config.sceneReferences=Array(4).fill(id('a'));
 assert.throws(()=>m.readContent(JSON.stringify(invalid)));
});


test('reviewed story is saved before images; original draft remains recoverable', async () => {
  const h = harness(), edited = plan(); edited.pages[1].text = '手机翻过来，又翻回去';
  h.deps.text = async prompt => JSON.stringify(isReview(prompt) ? reviewed(edited) : prompt.includes('只输出 JSON') ? plan() : copy());
  const image = h.deps.image;
  h.deps.image = async (prompt, refs) => {
    assert.equal(h.current.editorialDraft.pages[1].text, '先做一件小事');
    assert.equal(h.current.plan.pages[1].text, edited.pages[1].text);
    assert.ok(h.current.editorialReview.includes('第2页'));
    return image(prompt, refs);
  };
  await runWorkflow(h.current, h.deps, h.abort.signal);
});

test('failed review resumes saved draft without replanning or generating images early', async () => {
  const h = harness(); let planning = 0;
  h.deps.text = async prompt => {
    if (isReview(prompt)) throw Error('temporary timeout');
    planning++; return JSON.stringify(plan());
  };
  await assert.rejects(runWorkflow(h.current, h.deps, h.abort.signal), /漫画内容审稿失败/);
  assert.ok(h.current.editorialDraft); assert.equal(h.current.plan, undefined); assert.equal(h.images.length, 0);
  h.deps.text = async prompt => {
    if (isReview(prompt)) return JSON.stringify(reviewed());
    assert.ok(!prompt.includes('只输出 JSON')); return JSON.stringify(copy());
  };
  await runWorkflow(h.current, h.deps, h.abort.signal);
  assert.equal(planning, 1); assert.equal(h.current.job.status, 'done');
});

test('late review after cancellation or concurrent edit cannot replace saved draft', async () => {
  for (const cancel of [false, true]) {
    const h = harness(); let resolve;
    h.deps.text = async prompt => isReview(prompt) ? new Promise(r => resolve = r) : JSON.stringify(plan());
    const task = runWorkflow(h.current, h.deps, h.abort.signal);
    for (let i = 0; i < 40 && !resolve; i++) await new Promise(r => setImmediate(r));
    const before = h.saves.length;
    if (cancel) h.abort.abort(); else h.invalidate();
    resolve(JSON.stringify(reviewed())); await assert.rejects(task);
    assert.equal(h.saves.length, before); assert.equal(h.current.plan, undefined); assert.equal(h.images.length, 0);
  }
});

test('review cannot silently change automatic page count; corrupt internal records rejected', () => {
  const e = load('editorial'), p = plan(); p.pages.push({...p.pages[0],visual:'extra'});
  assert.throws(() => e.parseReview(JSON.stringify(reviewed(p)), m.defaults(), plan()), /需要4页/);
  const c = m.emptyContent(); c.editorialReview = {};
  assert.throws(() => m.readContent(JSON.stringify(c)), /审稿记录损坏/);
  const prompt = m.planningPrompt({...m.defaults(),topic:'固定结局'});
  assert.match(prompt, /三个简短故事方向/); assert.match(prompt, /用户给出完整剧情/);
  assert.match(m.copyPrompt({...m.emptyContent(),plan:plan()}), /不超过20个字符/);
});

test('new publishing titles are validated while old copy remains readable', () => {
  const e = load('editorial'), value = copy(); value.alternatives[0] = '长'.repeat(21);
  assert.throws(() => e.parsePublishingCopy(JSON.stringify(value)), /最多20个字符/);
  const c = m.emptyContent(); c.copy = value;
  assert.equal(m.readContent(JSON.stringify(c)).copy.alternatives[0], value.alternatives[0]);
});

test('existing completed and manually edited stories never enter automatic review', async () => {
  const h = harness(); await runWorkflow(h.current, h.deps, h.abort.signal);
  const c = structuredClone(h.current); delete c.editorialDraft; delete c.editorialReview;
  c.plan.pages[2].text = '用户自己写的对白';
  h.deps.text = async () => { throw Error('不应请求审稿'); };
  await runWorkflow(c, h.deps, h.abort.signal, 2);
  assert.equal(h.current.plan.pages[2].text, '用户自己写的对白');
});

test('cover and publishing use independent angle selection within existing requests', async () => {
  const h = harness(), prompts = [];
  h.current.config.topic = '沙坡头的来历，以及沙漠历史故事';
  h.deps.text = async prompt => {
    prompts.push(prompt);
    return JSON.stringify(isReview(prompt) ? reviewed() : prompt.includes('只输出 JSON') ? plan() : copy());
  };
  await runWorkflow(h.current, h.deps, h.abort.signal);
  assert.equal(prompts.length, 3); // planning, existing review, existing publishing
  assert.equal(h.images.length, 5); // same reference and four pages
  assert.match(prompts[0], /约六个标题候选/);
  assert.match(prompts[0], /中文title最多10字、text最多20字/);
  assert.match(prompts[0], /不能包装成游玩攻略/);
  assert.match(prompts[1], /已经合格则保留/);
  assert.match(prompts[2], /主标题和备选标题均最多20个字符/);
  assert.match(prompts[2], /不新增输出字段/);
  assert.match(prompts[2], /正文实际兑现/);
  assert.match(prompts[2], /没有外部样本时不声称/);
  assert.equal(h.current.copy.alternatives.length, 2);
});
