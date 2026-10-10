import { ProjectSection, useProjects } from "../list-projects/Projects";
import { coverJob, useCoverJob, startCoverJob, cancelCoverJob } from "./jobs";
import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Input, Modal, Select, Switch } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  LoadingOutlined,
  DownloadOutlined,
  SearchOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import { ai } from "../ai/client";
import { registerSyncActivationBlocker } from "../documentLifecycle";
import * as store from "./store";
import {
  colors,
  emptyContent,
  groups,
  layouts,
  ratios,
  readContent,
  selectedVersion,
  styles,
  type CoverConfig,
  type CoverContent,
} from "./model";
import { imageSource } from "./images";
import { exportCover } from "./export";
import CoverIcon from "./CoverIcon";
import CoverPreview from "./Preview";
import attribution from "./attribution.json";
import "./covers.css";

function CoverImage({ src }: { src: string }) {
  const [value, setValue] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setValue("");
    setError("");
    void imageSource(src)
      .then((s) => {
        if (live) setValue(s);
      })
      .catch(() => {
        if (live) setError("封面图片读取失败，请检查工作区图片文件");
      });
    return () => {
      live = false;
    };
  }, [src]);
  return value ? (
    <img
      src={value}
      alt="封面成品"
      onError={() => {
        setValue("");
        setError("封面图片无法显示");
      }}
    />
  ) : (
    <p role={error ? "alert" : "status"}>{error || "正在读取封面…"}</p>
  );
}
export default function CoverApp() {
  const projects = useProjects("app.cover");
  const creationProject = useRef<string | null>(null);
  const [, redraw] = useState(0),
    [id, setId] = useState<string | null>(null);
  const [page, setPage] = useState<"create" | "gallery" | "config" | "editor">("create");
  const [theme, setTheme] = useState("");
  const [draft, setDraft] = useState<CoverContent | undefined>();
  const [recommendTopic, setRecommendTopic] = useState<string | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [collapsed, setCollapsed] = useState(false),
    [preparing, setBusy] = useState(false),
    [opening, setOpening] = useState(false);
  const [category, setCategory] = useState(groups[0]),
    [search, setSearch] = useState(""),
    [changing, setChanging] = useState(false);
  const [error, setError] = useState(""),
    [preparationStatus, setStatus] = useState(""),
    [about, setAbout] = useState(false);
  const [rename, setRename] = useState<{ id: string; title: string } | null>(
    null,
  );
  const mounted = useRef(true),
    request = useRef(0),
    active = useRef(id),
    pending = useRef(false),
    controller = useRef<AbortController | null>(null);
  const composing = useRef(false),
    queued = useRef<(() => void) | null>(null),
    compositionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  active.current = id;
  const doc = id ? store.currentDocument(id) : undefined;
  let content: CoverContent | undefined,
    corrupt = "";
  try {
    if (doc) content = readContent(doc.content);
    else if (draft) content = draft;
    else if (page === "editor" && recommendTopic !== null) {
      content = emptyContent();
      content.config.topic = recommendTopic;
    }
  } catch (e) {
    corrupt = String(e);
  }
  const config = content?.config,
    version = content ? selectedVersion(content) : undefined;
  const job = useCoverJob(id);
  const busy = preparing || !!job?.running;
  const status = job?.running ? job.stage : preparationStatus;
  const matchingTopic = doc ? (content?.needsRecommendation ? content.config.topic : null) : recommendTopic;
  const style = styles.find((s) => s.number === config?.style);
  const fail = (e: unknown) => {
    if (mounted.current) setError(String(e));
  };
  function cancelPreparation() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setStatus("");
  }
  function cancel() {
    cancelCoverJob(active.current);
    cancelPreparation();
  }
  function afterComposition(action: () => void) {
    if (composing.current) {
      queued.current = action;
      return;
    }
    action();
  }
  async function select(next: string) {
    if (composing.current) {
      queued.current = () => void select(next);
      return;
    }
    const ticket = ++request.current;
    pending.current = true;
    setOpening(true);
    cancelPreparation();
    try {
      await store.flushDocuments();
      if (!mounted.current || ticket !== request.current) return;
      if (next !== active.current) await store.loadDocument(next);
      if (!mounted.current || ticket !== request.current) return;
      const opened = store.activateDocument(next);
      active.current = next;
      setId(next);
      setChanging(false);
      const openedContent = readContent(opened.content);
      setRecommendTopic(openedContent.needsRecommendation ? openedContent.config.topic : null);
      if (openedContent.needsRecommendation) {
        themeRef.current = openedContent.config.topic;
        setTheme(openedContent.config.topic);
      }
      setError("");
      setPage(coverJob(next)?.running || openedContent.needsRecommendation || openedContent.versions.length ? "editor" : "config");
    } catch (e) {
      if (ticket === request.current) fail(e);
    } finally {
      if (ticket === request.current) {
        pending.current = false;
        if (mounted.current) setOpening(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const unsub = store.subscribe(() => redraw((n) => n + 1));
    const unblock = registerSyncActivationBlocker(
      () => pending.current || composing.current,
    );
    const ticket = ++request.current;
    void store
      .refreshDocuments()
      .then(() => {
        if (!mounted.current || ticket !== request.current) return;
        const first =
          store.documentList().find((d) => d.id === store.lastDocumentId) ??
          store.documentList()[0];
        if (first) void select(first.id);
      })
      .catch(fail);
    return () => {
      mounted.current = false;
      ++request.current;
      controller.current?.abort();
      clearTimeout(compositionTimer.current);
      unsub();
      unblock();
    };
  }, []);
  async function startNew(destination: "create" | "gallery" = "create", projectId: string | null = null) {
    if (composing.current) {
      queued.current = () => void startNew(destination, projectId);
      return;
    }
    const ticket = ++request.current;
    pending.current = true;
    cancelPreparation();
    setOpening(true);
    try {
      await store.flushDocuments();
      if (!mounted.current || ticket !== request.current) return;
      creationProject.current = projectId;
      active.current = null;
      setId(null);
      setDraft(undefined);
      setRecommendTopic(null);
      setPage(destination);
      setChanging(false);
      setCategory(groups[0]);
      setSearch("");
      setError("");
    } catch (e) {
      if (ticket === request.current) fail(e);
    } finally {
      if (ticket === request.current) {
        pending.current = false;
        if (mounted.current) setOpening(false);
      }
    }
  }
  function patch(change: Partial<CoverConfig>) {
    if (doc && content) {
      store.stageDocument(doc.id, {
        content: JSON.stringify({
          ...content,
          config: { ...content.config, ...change },
        }),
      });
      setError("");
    } else if (content) setDraft({ ...content, config: { ...content.config, ...change } });
  }
  async function choose(number: string) {
    if (composing.current) {
      queued.current = () => void choose(number);
      return;
    }
    const ticket = ++request.current;
    pending.current = true;
    setOpening(true);
    cancelPreparation();
    try {
      await store.flushDocuments();
      if (!mounted.current || ticket !== request.current) return;
      if (!doc) {
        setDraft({ ...emptyContent(number), config: { ...emptyContent(number).config, ...(draft?.config ?? {}), style: number } });
        setPage("config");
        setChanging(false);
        return;
      }
      const target = doc;
      // A completed file stays available even when another navigation superseded creation.
      if (!mounted.current || ticket !== request.current) return;
      const latest = store.currentDocument(target.id) ?? target;
      const current = latest.content
        ? readContent(latest.content)
        : emptyContent(number);
      store.stageDocument(target.id, {
        content: JSON.stringify({
          ...current,
          config: { ...current.config, style: number },
        }),
      });
      store.activateDocument(target.id);
      active.current = target.id;
      setId(target.id);
      setPage(changing ? "editor" : "config");
      setChanging(false);
      setError("");
      await store.flushDocument(target.id);
    } catch (e) {
      if (ticket === request.current) fail(e);
    } finally {
      if (ticket === request.current) {
        pending.current = false;
        if (mounted.current) setOpening(false);
      }
    }
  }
  async function recommendAndGenerate() { await submit(true); }
  async function generate() { await submit(false); }
  async function submit(recommend: boolean) {
    if (composing.current) { queued.current = () => void submit(recommend); return; }
    let source = active.current ? store.currentDocument(active.current) : undefined;
    if (coverJob(source?.id ?? null)?.running || controller.current || pending.current) return;
    let value = source ? readContent(source.content) : draft;
    if (recommend) {
      const topic = (value?.needsRecommendation ? value.config.topic : themeRef.current).trim();
      if (!topic) return;
      if (!source || !value?.needsRecommendation) {
        source = undefined;
        value = emptyContent();
        value.config.topic = topic;
        value.config.mood = "";
        value.needsRecommendation = true;
      }
      setRecommendTopic(topic);
    }
    if (!value) return;
    if (!value.config.topic.trim() && !value.config.title.trim()) { fail("请填写主题或主标题"); return; }
    if (value.versions.length >= 200) { fail("此作品已有 200 个版本，请创建新封面继续"); return; }
    const ticket = ++request.current, projectId = creationProject.current;
    const preparation = new AbortController();
    controller.current = preparation;
    const valid = () => mounted.current && request.current === ticket && !preparation.signal.aborted;
    pending.current = true;
    setBusy(true); setError(""); setPage("editor");
    setStatus(recommend ? "正在匹配风格、版式与配色…" : "正在准备封面…");
    try {
      const caps = await ai.capabilities();
      if (!valid()) return;
      if (!caps.imageGenerate) throw Error("当前 AI 服务不支持图片生成，请在设置中选择 Codex");
      await store.flushDocuments();
      if (!valid()) return;
      if (!source) {
        source = await store.createDocument();
        store.stageDocument(source.id, { title: (value.config.title || value.config.topic).slice(0, 40), content: JSON.stringify(value) });
        await store.flushDocument(source.id);
        if (projectId) await projects.move(source.id, projectId);
      }
      if (!valid()) return;
      store.activateDocument(source.id);
      active.current = source.id;
      setId(source.id); setDraft(undefined); setChanging(false);
      // The worker owns cancellation and persistence after submission.
      void startCoverJob(source.id);
    } catch (e) { if (valid()) fail(e); }
    finally {
      if (ticket === request.current) pending.current = false;
      if (controller.current === preparation) {
        controller.current = null;
        if (mounted.current) { setBusy(false); setStatus(""); }
      }
    }
  }
  async function exportWork(target: string, backup = false) {
    try {
      const item = await store.ensureDocument(target);
      await exportCover(item, backup);
    } catch (e) {
      fail(e);
    }
  }
  function showVersion(next: string) {
    if (!doc || !content) return;
    cancelPreparation();
    store.stageDocument(doc.id, {
      content: JSON.stringify({ ...content, selectedVersion: next }),
    });
  }
  const inputField = (
    key: "topic" | "title" | "subtitle" | "mood" | "instruction",
    label: string,
    placeholder = "",
    multiline = false,
  ) => (
    <label className="cover-field" key={key}>
      <span>{label}</span>
      {multiline ? (
        <Input.TextArea
          aria-label={label}
          rows={key === "topic" ? 3 : 2}
          maxLength={12000}
          value={config?.[key]}
          placeholder={placeholder}
          onChange={(e) => patch({ [key]: e.target.value })}
        />
      ) : (
        <Input
          aria-label={label}
          maxLength={key === "title" ? 120 : 2000}
          value={config?.[key]}
          placeholder={placeholder}
          onChange={(e) => patch({ [key]: e.target.value })}
        />
      )}
    </label>
  );
  const fields = () => (
    <>
      {inputField(
        "topic",
        "主题与画面",
        "例如：秋日第一杯奶茶，东亚少女，温暖、俏皮",
        true,
      )}
      {inputField("title", "主标题", "留空自动生成，可自行填写")}
      {inputField("subtitle", "副文案", "留空自动生成，可自行填写")}
      <div className="cover-pair">
        <label className="cover-field">
          <span>语言</span>
          <Select
            aria-label="语言"
            value={config?.language}
            options={["中文", "英文"].map((value) => ({ value, label: value }))}
            onChange={(language) => patch({ language })}
          />
        </label>
        <label className="cover-field">
          <span>画面比例</span>
          <Select
            aria-label="画面比例"
            value={config?.ratio}
            options={ratios.map((value) => ({ value, label: value }))}
            onChange={(ratio) => patch({ ratio })}
          />
        </label>
      </div>
      <label className="cover-field">
        <span>主题配色</span>
        <Select
          aria-label="主题配色"
          showSearch
          optionFilterProp="label"
          value={config?.color}
          options={[
            { value: "auto", label: "根据主题推荐" },
            ...colors.map((c) => ({
              value: c.id,
              label: `${c.id} ${c.name_zh}`,
            })),
          ]}
          onChange={(color) => patch({ color })}
        />
      </label>
      <details className="cover-more-settings">
        <summary>更多配置</summary>
        <label className="cover-field">
          <span>版式</span>
          <Select
            aria-label="版式"
            showSearch
            optionFilterProp="label"
            value={config?.layout}
            options={[
              { value: "auto", label: "自由设计 · 图文融合" },
              ...layouts.map((l) => ({
                value: l.id,
                label: `${l.id} ${l.name}`,
              })),
            ]}
            onChange={(layout) => patch({ layout })}
          />
        </label>
        <label className="cover-field">
          <span>内容密度</span>
          <Select
            aria-label="内容密度"
            value={config?.density}
            options={["低", "中", "高"].map((value) => ({
              value,
              label: value,
            }))}
            onChange={(density) => patch({ density })}
          />
        </label>
        {inputField("mood", "情感基调")}
        {inputField(
          "instruction",
          "额外要求",
          "例如：标题大一点，去掉小猫",
          true,
        )}
      </details>
    </>
  );
  const row = (item: store.DocumentInfo) => (
        <div
          className={`cover-row ${item.id === id && (page === "config" || page === "editor") ? "selected" : ""}`}
          key={item.id}
        >
          <button
            className="cover-row-name"
            title={item.title}
            onPointerDown={(e) => {
              delete e.currentTarget.dataset.down;
              if (
                e.isPrimary !== false &&
                e.pointerType === "mouse" &&
                e.button === 0 &&
                !e.altKey &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.shiftKey
              ) {
                if (!composing.current) e.preventDefault();
                e.currentTarget.dataset.down = "true";
                void select(item.id);
              }
            }}
            onClick={(e) => {
              const down = e.currentTarget.dataset.down;
              delete e.currentTarget.dataset.down;
              if (e.detail !== 0 && down) return;
              void select(item.id);
            }}
          >
            <CoverIcon />
            <span>{item.title}</span>
          </button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                ...projects.menu(item.id),
                { key: "favorite", label: item.favorite ? "取消常用" : "设为常用" },
                { key: "rename", label: "重命名" },
                { key: "export", label: "导出封面图片" },
                { key: "backup", label: "导出作品备份" },
              ],
              onClick: ({ key }) => {
                if (projects.handle(key, item.id)) return;
                if (key === "export" || key === "backup") {
                  void exportWork(item.id, key === "backup");
                  return;
                }
                if (key === "rename") {
                  setRename({ id: item.id, title: item.title });
                  return;
                }
                void store
                  .ensureDocument(item.id)
                  .then(() =>
                    store.stageDocument(item.id, { favorite: !item.favorite }),
                  )
                  .catch(fail);
              },
            }}
          >
            <button
              className="cover-row-more"
              aria-label={`${item.title}更多操作`}
            >
              <MoreOutlined />
            </button>
          </Dropdown>
        </div>
      );
  const rows = (favorite: boolean) => store.documentList().filter(item=>item.favorite === favorite && !projects.projectOf(item.id)).map(row);
  const query = search.trim().toLowerCase();
  const visible = styles.filter(
    (s) =>
      s.group === category &&
      (!query ||
        `${s.number} ${s.displayName} ${s.previewTitle} ${s.generation_name} ${s.reference} ${s.traits}`
          .toLowerCase()
          .includes(query)),
  );
  const saveError =
    id && store.documentStatus(id).startsWith("保存失败")
      ? store.documentStatus(id)
      : "";
  return (
    <section
      className="cover-app"
      onCompositionStart={() => {
        clearTimeout(compositionTimer.current);
        composing.current = true;
      }}
      onCompositionEnd={() => {
        compositionTimer.current = setTimeout(() => {
          composing.current = false;
          const action = queued.current;
          queued.current = null;
          action?.();
        }, 0);
      }}
    >
      {!collapsed && (
        <aside className="cover-nav">
          <header className="cover-heading">
            <CoverIcon />
            <strong>做封面</strong>
            <Button
              type="text"
              className="navigation-toggle"
              icon={<MenuFoldOutlined />}
              aria-label="折叠封面导航"
              onClick={() => setCollapsed(true)}
            />
          </header>
          <div className="tool-sidebar-create-section">
            <div className="tool-sidebar-create-label">创建</div>
            <Button
              className="tool-sidebar-create"
              icon={<PlusOutlined />}
              aria-current={page === "create" ? "page" : undefined}
              onClick={() => void startNew()}
            >
              创建封面
            </Button>
            <Button
              className="tool-sidebar-create"
              icon={<AppstoreOutlined />}
              aria-current={page === "gallery" ? "page" : undefined}
              onClick={() => void startNew("gallery", doc ? null : creationProject.current)}
            >
              风格模板
            </Button>
          </div>
          <div className="cover-list">
            {rows(true).length > 0 && <section><h3>常用</h3>{rows(true)}</section>}
            <ProjectSection navigation={projects} items={store.documentList()} renderItem={row} activeId={id} onCreate={projectId=>void startNew("create", projectId)} />
            <section><h3>最近打开</h3>{rows(false).length ? rows(false) : <p>暂无</p>}</section>
          </div>
        </aside>
      )}
      <main className="cover-work">
        <header className="cover-bar">
          {collapsed && (
            <Button
              type="text"
              className="navigation-toggle"
              icon={<MenuUnfoldOutlined />}
              aria-label="展开封面导航"
              onClick={() => setCollapsed(false)}
            />
          )}
          <button
            className="cover-title"
            onClick={() => doc && setRename({ id: doc.id, title: doc.title })}
          >
            {page === "create" ? "创建封面" : page === "gallery" && !changing
              ? "风格模板"
              : doc?.title || "做封面"}
          </button>
          {(page === "gallery" || page === "config") && !changing && (
            <nav className="cover-steps" aria-label="创建封面步骤">
              <button
                aria-current={page === "gallery" ? "step" : undefined}
                onClick={() => afterComposition(() => setPage("gallery"))}
              >
                01 选择风格模板
              </button>
              <span>—</span>
              <button
                disabled={!content || opening}
                aria-current={page === "config" ? "step" : undefined}
                onClick={() => afterComposition(() => setPage("config"))}
              >
                02 配置封面
              </button>
            </nav>
          )}
          {page === "gallery" && (
              <Input
                aria-label="查找风格模板"
                className="cover-search"
                prefix={<SearchOutlined />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="编号、画风或作者"
                allowClear
              />
          )}
          {page === "editor" && (
            <Button
              type="text"
              className="cover-export"
              icon={<DownloadOutlined />}
              disabled={!version || opening}
              onClick={() => doc && void exportWork(doc.id)}
            >
              导出
            </Button>
          )}
        </header>
        {(error || job?.error ||
          corrupt ||
          saveError ||
          store.documentWarnings().length > 0) && (
          <div role="alert" className="cover-error">
            {error || job?.error ||
              corrupt ||
              saveError ||
              store.documentWarnings().join("；")}
            {saveError && (
              <Button
                size="small"
                onClick={() => void store.flushDocuments().catch(fail)}
              >
                重试保存
              </Button>
            )}
            {doc && (
              <Button
                size="small"
                onClick={() => void exportWork(doc.id, true)}
              >
                导出备份
              </Button>
            )}
          </div>
        )}
        {opening && (
          <div className="cover-opening" role="status">
            <LoadingOutlined /> 正在打开封面…
          </div>
        )}
        {page === "create" ? (
          <section className="cover-create">
            <div className="cover-create-intro">
              <CoverIcon />
              <h2>今天，想为怎样的灵感做封面？</h2>
              <p>写下主题，自动搭配风格、版式与配色。</p>
              <div className="cover-theme-examples">
                {["秋日第一杯奶茶，温暖又俏皮", "周末去山里，给自己放个假", "读书笔记：慢下来，发现生活的小美好"].map(example => (
                  <button key={example} disabled={busy} onClick={() => setTheme(example)}>{example}</button>
                ))}
              </div>
            </div>
            <div className="cover-theme-composer">
              <Input.TextArea aria-label="封面主题" placeholder="描述你想做的封面，也可以补充文案、受众或使用场景…"
                value={theme} maxLength={4000} disabled={busy} autoSize={{ minRows: 3, maxRows: 7 }}
                onChange={e => { themeRef.current = e.target.value; setTheme(e.target.value); }} />
              <div className="cover-theme-actions">
                <span>{busy ? "正在搭配风格、版式与配色…" : "灵感交给你，搭配交给我"}</span>
                {busy ? <Button onClick={cancel}>取消生成</Button> :
                  <Button type="primary" disabled={!theme.trim() || opening} onClick={() => void recommendAndGenerate()}>生成封面</Button>}
              </div>
            </div>
          </section>
        ) : page === "gallery" ? (
          <section className="cover-gallery">
            <div className="cover-gallery-tools">
              <div className="cover-categories" role="tablist" aria-label="风格分类">
                {groups.map((g) => (
                  <button
                    key={g}
                    role="tab"
                    id={`cover-tab-${groups.indexOf(g)}`}
                    aria-controls="cover-style-panel"
                    aria-selected={g === category}
                    tabIndex={g === category ? 0 : -1}
                    onKeyDown={(event) => {
                      const index = groups.indexOf(g);
                      const next = event.key === "ArrowRight" ? (index + 1) % groups.length : event.key === "ArrowLeft" ? (index + groups.length - 1) % groups.length : event.key === "Home" ? 0 : event.key === "End" ? groups.length - 1 : -1;
                      if (next < 0) return;
                      event.preventDefault();
                      setCategory(groups[next]);
                      document.getElementById(`cover-tab-${next}`)?.focus();
                    }}
                    onClick={() => setCategory(g)}
                  >
                    {g.replace(/^[A-Z] /, "")}
                  </button>
                ))}
              </div>

            </div>
            {groups
              .filter((g) => visible.some((s) => s.group === g))
              .map((g) => (
                <section className="cover-template-group" key={g} role="tabpanel" id="cover-style-panel" aria-labelledby={`cover-tab-${groups.indexOf(g)}`}>
                  <h3>{g.replace(/^[A-Z] /, "")}</h3>
                  <div className="cover-template-grid">
                    {visible
                      .filter((s) => s.group === g)
                      .map((s) => (
                        <button
                          className="cover-template"
                          title={`${s.number} · ${s.displayName}`}
                          key={s.number}
                          onClick={() => void choose(s.number)}
                          aria-label={`选择 ${s.number} ${s.displayName}`}
                        >
                          <div className="cover-template-image">
                            <CoverPreview
                              fallback={s.image}
                              src={s.preview}
                              alt={`${s.number} ${s.displayName}`}
                            />
                            <span className="cover-template-action">
                              选择此模板 →
                            </span>
                          </div>
                          <div className="cover-template-caption">
                            <span>{s.displayName}</span>
                            <small>{s.number}</small>
                          </div>
                        </button>
                      ))}
                  </div>
                </section>
              ))}
            {!visible.length && (
              <p className="cover-hint">没有符合条件的风格模板</p>
            )}
            <div className="cover-gallery-footer">
              {changing && (
                <Button
                  onClick={() => {
                    setChanging(false);
                    setPage("editor");
                  }}
                >
                  返回编辑
                </Button>
              )}
              <button onClick={() => setAbout(true)}>模板来源与许可</button>
            </div>
          </section>
        ) : content && config && style ? (
          page === "config" ? (
            <section className="cover-config">
              <div className="cover-reference">
                <CoverPreview src={style.preview} fallback={style.image} alt={`${style.number} 风格参考`} loading="eager" />
                <p>
                  {style.number} · {style.displayName}
                </p>
                <small>模板效果示例，生成时使用原始画风参考</small>
              </div>
              <div className="cover-config-fields">
                {fields()}
                <Button
                  type="primary"
                  onClick={() => void generate()}
                  disabled={
                    opening || (!config.topic.trim() && !config.title.trim())
                  }
                >
                  生成封面 →
                </Button>
              </div>
            </section>
          ) : (
            <div className="cover-editor">
              <section className="cover-canvas">
                <div className="cover-canvas-bar">
                  <span>{busy ? (matchingTopic !== null ? "正在匹配" : "正在生成") : "封面预览"}</span>
                  <small>{version?.config.ratio || config.ratio}</small>
                </div>
                <div
                  className="cover-poster"
                  style={{
                    aspectRatio: (
                      version?.config.ratio || config.ratio
                    ).replace(":", " / "),
                  }}
                >
                  {version && <CoverImage src={version.image} />}{" "}
                  {!version && !busy && <p>{matchingTopic !== null ? "点击右侧重新匹配并生成" : "点击右侧“生成封面”开始绘制"}</p>}
                  {busy && (
                    <div className="cover-generating" role="status" aria-label={status}>
                      <svg className="cover-drawing-grid" viewBox="0 0 240 240" preserveAspectRatio="none" fill="none" aria-hidden="true">
                        {Array.from({ length: 11 }, (_, i) => (
                          <g key={i} style={{ animationDelay: `${i * 110}ms` }}>
                            <path pathLength="1" d={`M ${i * 24} 0 V 240`} />
                            <path pathLength="1" d={`M 0 ${i * 24} H 240`} />
                          </g>
                        ))}
                        <path className="cover-grid-sketch" pathLength="1" d="M48 168 L96 96 L132 144 L168 72 L192 168 Z M156 54 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0" />
                      </svg>
                    </div>
                  )}
                </div>
                {content.versions.length > 0 && (
                  <div className="cover-versions" aria-label="封面版本">
                    {content.versions.map((v, i) => (
                      <button
                        key={v.id}
                        aria-pressed={v.id === content!.selectedVersion}
                        onClick={() => showVersion(v.id)}
                      >
                        版本 {i + 1} · {v.config.style}
                      </button>
                    ))}
                  </div>
                )}

              </section>
              <aside className="cover-settings">
                {matchingTopic !== null ? (
                  <div className="cover-matching">
                    <span>封面主题</span>
                    <p>{matchingTopic}</p>
                    <div role="status">{busy ? status : "匹配尚未完成，可重新尝试"}</div>
                    <ol>
                      <li aria-current={busy ? "step" : undefined}>匹配风格、版式与配色</li>
                      <li>生成封面图片</li>
                    </ol>
                  </div>
                ) : <>
                <div className="cover-field">
                  <span>风格模板</span>
                  <div className="cover-selected-style">
                    <CoverPreview src={style.preview} fallback={style.image} alt="当前画风" loading="eager" />
                    <span>
                      {style.number}
                      <small>{style.displayName}</small>
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        afterComposition(() => {
                          setChanging(true);
                          setCategory(groups[0]);
                          setSearch("");
                          setPage("gallery");
                        })
                      }
                    >
                      更换
                    </button>
                  </div>
                </div>
                {fields()}
                {version && (
                  <label className="cover-preserve">
                    <Switch
                      size="small"
                      checked={config.preserve}
                      onChange={(preserve) => patch({ preserve })}
                    />
                    参考当前封面修改
                  </label>
                )}
                </>}
                <Button
                  block
                  type="primary"
                  disabled={busy || opening}
                  onClick={() => void (matchingTopic !== null ? recommendAndGenerate() : generate())}
                >
                  {busy ? (matchingTopic !== null ? "匹配中…" : "生成中…") : matchingTopic !== null ? "重新匹配并生成" : version ? "重新生成" : "生成封面"}
                </Button>
                {busy && (
                  <Button block className="cover-cancel" onClick={cancel}>
                    取消生成
                  </Button>
                )}
              </aside>
            </div>
          )
        ) : null}
      </main>
      <Modal
        title="重命名封面"
        open={!!rename}
        onCancel={() => setRename(null)}
        onOk={() => {
          if (!rename) return;
          if (!rename.title.trim()) {
            fail("请输入封面名称");
            return;
          }
          const next = rename;
          void store
            .ensureDocument(next.id)
            .then(() => {
              store.stageDocument(next.id, { title: next.title });
              setRename(null);
            })
            .catch(fail);
        }}
      >
        <Input
          aria-label="封面名称"
          maxLength={120}
          value={rename?.title}
          onChange={(e) =>
            rename && setRename({ ...rename, title: e.target.value })
          }
        />
      </Modal>
      <Modal
        title={`handraw-style · ${attribution.version}`}
        open={about}
        onCancel={() => setAbout(false)}
        footer={<Button onClick={() => setAbout(false)}>关闭</Button>}
      >
        <p>{attribution.source}</p>
        <p>
          包含全部 {styles.length} 种风格、{layouts.length} 种版式与{" "}
          {colors.length} 种主题色。提示词规则与参考资源来自 handraw-style。
        </p>
        <pre className="cover-license">{attribution.license}</pre>
      </Modal>
    </section>
  );
}
