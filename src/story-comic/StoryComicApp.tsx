import coverThemes from './coverThemes.json';
import ReferenceUploads from './ReferenceUploads';
import { uploadImage } from '../design-studio/images';
import PageRefiner from './PageRefiner';
import { previewImageSource } from './previewImages';
import { refinePage, restorePage } from './refine';
import { audiences } from './audiences';
import WorksGallery from './WorksGallery';
import XhsPublisher from './XhsPublisher';
import { NavigationSection } from '../list-projects/NavigationSection';
import { ProjectSection, useProjects } from "../list-projects/Projects";
import { beginTask, failTask, updateTask } from "../tasks/store";
import { sizes, sizeFor, pageCounts } from "./sizes";
import ComicCanvas from "./ComicCanvas";
import PhonePreview from "./PhonePreview";
import PrintPanel from "./PrintPanel";
import { readPanels, savePanel } from "./panelState";
import { tones, resolveStyle } from "./baoyu";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Input, Modal, Select } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  EditOutlined,
  ZoomInOutlined,
  PlusOutlined,
  DownloadOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ai, trackAiExecution } from "../ai/client";
import { native } from "../workspace";
import { registerSyncActivationBlocker } from "../documentLifecycle";
import { imageSource, referenceImage } from "../comics/images";
import * as store from "./store";
import {
  defaults,
  emptyContent,
  readContent,
  signature,
  topicTitle,
  topicInputValue,
  styles,
  userReferences,
  copyText,
  type Config,
  type Content,
  type Page,
} from "./model";
import { runWorkflow } from "./workflow";
import { composePage } from "./render";
import { exportPage, exportZip, exportPdf } from "./export";
import StoryComicIcon from "./StoryComicIcon";
import "./story-comic.css";
function PageImage({ src, alt, thumbnail=false }: { src: string; alt: string; thumbnail?:boolean }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setUrl("");
    setError("");
    void (thumbnail ? previewImageSource(src) : imageSource(src))
      .then((s) => {
        if (live) setUrl(s);
      })
      .catch(() => {
        if (live) setError("图片读取失败");
      });
    return () => {
      live = false;
    };
  }, [src,thumbnail]);
  return url ? (
    <img
      src={url}
      alt={alt}
      draggable={false}
      decoding="async"
      onError={() => {
        setUrl("");
        setError("图片无法显示");
      }}
    />
  ) : (
    <span role={error ? "alert" : "status"}>{error || "正在读取…"}</span>
  );
}
const topics = [
  "拖延症怎么办",
  "如何自律",
  "第一份工作怎么选",
  "养猫的快乐",
  "情绪管理",
  "AI会取代人类吗",
];
export default function StoryComicApp() {
  const [gallery, setGallery] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInProgress = useRef(false);
  const currentConfig = useRef<Config | null>(null);
  const [refineIndex, setRefineIndex] = useState<number | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const projects = useProjects("app.story-comic");
  const creationProject = useRef<string | null>(null);
  const { message, modal } = App.useApp();
  const [, redraw] = useState(0),
    [id, setId] = useState<string | null>(() =>
      store.lastDocumentId && store.currentDocument(store.lastDocumentId)
        ? store.lastDocumentId : null
    ),
    [draft, setDraft] = useState<Config>(defaults);
  const [collapsed, setNavigationState] = useState(() => readPanels(id).navigation),
    [tab, setTab] = useState("偏好"),
    [busy, setBusy] = useState(false),
    [opening, setOpening] = useState(false),
    [error, setError] = useState("");
  const [stylePreview, setStylePreview] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null),
    [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const mounted = useRef(true),
    active = useRef<string | null>(id),
    request = useRef(0),
    pending = useRef(false),
    controller = useRef<AbortController | null>(null),
    creating = useRef(false);
  const setCollapsed = (value: boolean) => {
    setNavigationState(value); savePanel(active.current, "navigation", value);
  };
  const controlsCollapsed = tab !== "偏好";
  const setControlsCollapsed = (value: boolean) => setTab(value ? "漫画" : "偏好");
  useLayoutEffect(() => {
    const saved = readPanels(id);
    setNavigationState(saved.navigation);
  }, [id]);
  const composing = useRef(false),
    queued = useRef<(() => void) | null>(null),
    compositionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined
    );
  const doc = id ? store.currentDocument(id) : undefined;
  const { content, corrupt } = useMemo(() => {
    try {
      return { content: doc ? readContent(doc.content) : undefined, corrupt: "" };
    } catch (e) {
      return { content: undefined, corrupt: String(e) };
    }
  }, [doc?.content]);
  const config = content?.config ?? draft;
  currentConfig.current = config;
  const inputTopic = content ? topicInputValue(content, doc?.title) : config.topic;
  const fail = (e: unknown) => {
    if (mounted.current) setError(String(e));
  };
  const cancel = () => {
    controller.current?.abort();
  };
  async function navigate(next: string | null, create = false, projectId: string | null = null) {
    if (composing.current) {
      queued.current = () => void navigate(next, create, projectId);
      return;
    }
    if (create && creating.current) return;
    if (create) creating.current = true;
    const ticket = ++request.current;
    pending.current = true;
    setOpening(true);
    cancel();
    try {
      await store.flushDocuments();
      if (!mounted.current || ticket !== request.current) return;
      if (create) {
        setTab("偏好");
        setNavigationState(false);
        creationProject.current = projectId;
        setDraft(emptyContent().config);
        next = null;
      } else if (next && next !== active.current)
        await store.loadDocument(next);
      if (!mounted.current || ticket !== request.current) return;
      if (next) store.activateDocument(next);
      active.current = next;
      setGallery(false);
      setId(next);
      setError("");
      setPreview(null);
      setRefineIndex(null);
      setTab(next && store.currentDocument(next)?.content && readContent(store.currentDocument(next)!.content).plan ? "漫画" : "偏好");
    } catch (e) {
      if (ticket === request.current) fail(e);
    } finally {
      if (create) creating.current = false;
      if (ticket === request.current) {
        pending.current = false;
        if (mounted.current) setOpening(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const unsub = store.subscribe(() => redraw((n) => n + 1)),
      unblock = registerSyncActivationBlocker(
        () => pending.current || composing.current
      );
    const ticket = ++request.current;
    void store
      .refreshDocuments()
      .then(() => {
        if (!mounted.current || ticket !== request.current) return;
        const first =
          store.documentList().find((d) => d.id === store.lastDocumentId) ??
          store.documentList()[0];
        if (first?.id === active.current) {
          void store.loadDocument(first.id).catch(fail);
        } else if (first) void navigate(first.id);
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
  function patch(change: Partial<Config>) {
    if (Object.entries(change).every(([key, value]) => config[key as keyof Config] === value)) return;
    cancel();
    if (doc && content)
      store.stageDocument(doc.id, {
        content: JSON.stringify({
          ...content,
          config: { ...content.config, topic: topicInputValue(content, doc.title), ...change },
          ...(change.topic !== undefined ? { topicEdited: true } : {}),
        }),
      });
    else setDraft({ ...draft, ...change });
  }
  async function addReferences(field: 'sceneReferences' | 'characterReferences', files: File[]) {
    if (uploadInProgress.current || busy || opening || corrupt) return;
    const snapshot = signature(config), targetId = id, ticket = request.current;
    const remote = targetId ? store.remoteVersion(targetId) : 0;
    uploadInProgress.current=true;setUploading(true);setError('');
    try {
      const images=[...(config[field] ?? [])];
      if (images.length+files.length>3) throw new Error('每类参考图最多3张');
      for (const file of files) {
        images.push(await uploadImage(file));
        if (!mounted.current || ticket !== request.current || active.current !== targetId) return;
      }
      const latest=targetId ? readContent(store.currentDocument(targetId)!.content).config : currentConfig.current!;
      if (signature(latest)!==snapshot || targetId && store.remoteVersion(targetId)!==remote) throw new Error('上传期间设置已变化，请重新添加参考图');
      patch({[field]:images});
    } catch(e) { if (mounted.current && ticket===request.current) fail(e); }
    finally {uploadInProgress.current=false;if(mounted.current)setUploading(false);}
  }
  async function generate(onlyPage?: number, retryFailed = false) {
    if (controller.current || pending.current || composing.current || corrupt || uploadInProgress.current)
      return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setControlsCollapsed(true);
    setTab("漫画");
    setError("");
    let target = doc ? store.currentDocument(doc.id) : undefined,
      source = target ? readContent(target.content) : { ...emptyContent(), config: draft };
    source = { ...source, config: { ...source.config, topic: topicInputValue(source, target?.title) } };
    const ticket = request.current;
    const projectId = creationProject.current;
    const card = beginTask(abort, {toolId: "app.story-comic", title: target?.title || source.config.topic.slice(0, 40) || "生成漫画", stage: "正在准备漫画…"});
    await trackAiExecution(
      abort,
      (async () => {
        try {
          if (!source.config.topic.trim()) throw new Error("请先输入主题");
          const caps = await ai.capabilities();
          if (abort.signal.aborted || !mounted.current || ticket !== request.current) return;
          if (!caps.imageGenerate || !caps.referenceImages)
            throw new Error("当前 AI 服务需要支持图片生成及参考图，请在设置中检查");
          if (userReferences(source.config).length + 1 > caps.maxReferences) throw new Error(`当前AI服务最多支持${caps.maxReferences}张参考图，请减少参考图样数量（需预留1张人物参考图）`);
          if (!target) {
            creating.current = true;
            pending.current = true;
            const created = await store.createDocument();
            store.stageDocument(created.id, {
              title: topicTitle(source.config.topic),
              content: JSON.stringify(source),
            });
            await store.flushDocument(created.id);
            if (projectId) await projects.move(created.id, projectId);
            if (
              abort.signal.aborted ||
              !mounted.current ||
              ticket !== request.current
            )
              return;
            target = store.activateDocument(created.id);
            active.current = target.id;
            setId(target.id);
            pending.current = false;
            creating.current = false;
          }
          const targetId = target.id;
          await store.flushDocument(targetId);
          const remote = store.remoteVersion(targetId);
          let expected = store.currentDocument(targetId)!.content;
          const valid = () =>
            mounted.current &&
            !abort.signal.aborted &&
            controller.current === abort &&
            active.current === targetId &&
            store.remoteVersion(targetId) === remote &&
            store.currentDocument(targetId)?.content === expected;
          let autoTitle = topicTitle(source.config.topic);
          let refinedTitleApplied = false;
          if (!valid()) return;
          if (onlyPage === undefined && !retryFailed) {
            store.stageDocument(targetId, { title: autoTitle });
            await store.flushDocument(targetId);
          }
          await runWorkflow(
            source,
            {
              valid,
              text: async (prompt) =>
                (
                  await ai.generate(
                    {
                      toolId: "app.story-comic",
                      timeoutSeconds: 600,
                      messages: [{ role: "user", content: prompt }],
                    },
                    abort.signal
                  )
                ).text,
              image: async (prompt, references) => {
                const refs = await Promise.all(
                  references
                    .map((src) => referenceImage({ src }))
                );
                if (!valid()) throw new Error("作品已修改");
                const result = await ai.generate(
                  {
                    toolId: "app.story-comic",
                    image: true,
                    references: refs,
                    messages: [{ role: "user", content: prompt }],
                  },
                  abort.signal
                );
                if (result.saveError) throw new Error(result.saveError);
                const image = result.images?.[0];
                if (!image) throw new Error("AI 未返回图片");
                return image;
              },
              compose: composePage,
              save: async (value) => {
                if (!valid()) throw new Error("作品已修改，未覆盖新内容");
                updateTask(abort.signal, {stage: value.job?.stage || "正在保存漫画…", done: value.plan?.pages.filter(page => page.status === "ready").length ?? 0, total: value.job?.total});
                if (value.job?.status === "error") failTask(abort.signal, value.job.stage);
                expected = JSON.stringify(value);
                const refined =
                  value.plannedConfig === signature(source.config)
                    ? value.plan?.pages[0]?.title
                    : undefined;
                const rename =
                  onlyPage === undefined && !retryFailed &&
                  !refinedTitleApplied &&
                  refined &&
                  store.currentDocument(targetId)?.title === autoTitle;
                store.stageDocument(targetId, {
                  content: expected,
                  ...(rename ? { title: refined } : {}),
                });
                if (rename) refinedTitleApplied = true;
                await store.flushDocument(targetId);
              },
            },
            abort.signal,
            onlyPage,
            retryFailed
          );
        } catch (e) {
          failTask(abort.signal, e);
          if (!abort.signal.aborted) fail(e);
        } finally {
          card.finish();
          if (controller.current === abort) {
            controller.current = null;
            creating.current = false;
            if (ticket === request.current) pending.current = false;
            if (mounted.current) setBusy(false);
          }
        }
      })()
    );
  }
  async function optimize(index: number, instruction: string): Promise<boolean> {
    if (controller.current || pending.current || composing.current || !doc || corrupt) return false;
    const abort = new AbortController();
    const targetId = doc.id;
    const expected = store.currentDocument(targetId)!.content;
    const remote = store.remoteVersion(targetId);
    const source = readContent(expected);
    controller.current = abort; setBusy(true); setOptimizing(true); setError('');
    const task = beginTask(abort,{toolId:'app.story-comic',title:`优化第 ${index+1} 页 · ${doc.title}`,stage:'正在整理修改方案…'});
    const valid = () => mounted.current && !abort.signal.aborted && controller.current === abort && active.current === targetId && store.remoteVersion(targetId) === remote && store.currentDocument(targetId)?.content === expected;
    return trackAiExecution(abort,(async()=>{
      try {
        const caps = await ai.capabilities();
        if (!caps.text || !caps.imageGenerate || !caps.referenceImages || caps.maxReferences < 1) throw new Error('当前AI服务需要支持文字、参考图片及图片生成');
        const original = source.plan!.pages[index].image!;
        const reference = await referenceImage({src:original});
        const next = await refinePage(source,index,instruction,{
          valid,
          text: async prompt => {
            const result = await ai.generate({toolId:'app.story-comic',vision:true,references:[reference],messages:[{role:'user',content:prompt}]},abort.signal);
            if (result.saveError) throw new Error(result.saveError);
            return result.text;
          },
          image: async prompt => {
            updateTask(abort.signal,{stage:'正在修改本页图片…'});
            const result = await ai.generate({toolId:'app.story-comic',image:true,references:[reference],messages:[{role:'user',content:prompt}]},abort.signal);
            if (result.saveError) throw new Error(result.saveError);
            if (!result.images?.[0]) throw new Error('AI未返回修改后的图片');
            return result.images[0];
          },
          compose: composePage,
        });
        if (!valid()) throw new Error('作品已修改，未覆盖新内容');
        store.stageDocument(targetId,{content:JSON.stringify(next)});
        await store.flushDocument(targetId);
        updateTask(abort.signal,{stage:'本页优化完成'});
        return true;
      } catch(e) { failTask(abort.signal,e); if (!abort.signal.aborted) fail(e); return false; }
      finally { task.finish(); if (controller.current === abort) { controller.current=null; if (mounted.current) {setBusy(false);setOptimizing(false);} } }
    })());
  }
  async function copy(text: string) {
    try {
      if (native) await writeText(text);
      else await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch (e) {
      fail(e);
    }
  }
  const act = (task: Promise<unknown>) => void task.catch(fail);
  const renameWork = async () => {
    if (!rename) return;
    try {
      await store.ensureDocument(rename.id);
      store.stageDocument(rename.id, { title: rename.title });
      await store.flushDocument(rename.id);
      setRename(null);
    } catch (e) {
      fail(e);
    }
  };
  const backup = async (targetId: string) => {
    const d = await store.ensureDocument(targetId);
    await exportZip(emptyContent(), d.title, JSON.stringify(d, null, 2));
  };
  // These are navigation entries: accept a primary mouse press even when WebView
  // loses the subsequent click, while retaining keyboard/touch click semantics.
  const entryEvents = (action: () => void) => ({
    onPointerDownCapture: (e: React.PointerEvent<HTMLButtonElement>) => {
      delete e.currentTarget.dataset.down;
      if (e.isPrimary !== false && e.pointerType === "mouse" && e.button === 0 &&
          !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        if (!composing.current) e.preventDefault();
        e.currentTarget.dataset.down = "true";
        action();
      }
    },
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      const down = e.currentTarget.dataset.down;
      delete e.currentTarget.dataset.down;
      if (e.detail !== 0 && down) return;
      action();
    },
  });
  const openGallery = () => {
    if (composing.current) { queued.current = openGallery; return; }
    setGallery(true);
  };
  const row = (item: store.DocumentInfo) => (
        <div
          className={`story-row ${id === item.id && !gallery ? "selected" : ""}`}
          key={item.id}
        >
          <button
            className="story-row-name"
            title={item.title}
            aria-current={id === item.id && !gallery ? "page" : undefined}
            onPointerDownCapture={(e) => {
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
                void navigate(item.id);
              }
            }}
            onClick={(e) => {
              const down = e.currentTarget.dataset.down;
              delete e.currentTarget.dataset.down;
              if (e.detail !== 0 && down) return;
              void navigate(item.id);
            }}
          >
            <StoryComicIcon />
            <span>{item.title}</span>
          </button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                ...projects.menu(item.id),
                { key: "favorite", label: item.favorite ? "取消常用" : "设为常用" },
                { key: "rename", label: "重命名" },
                { key: "backup", label: "导出作品备份" },
                { key: "delete", label: "删除", danger: true },
              ],
              onClick: ({ key }) => {
                if (projects.handle(key, item.id)) return;
                if (key === "rename")
                  setRename({ id: item.id, title: item.title });
                else if (key === "backup") act(backup(item.id));
                else if (key === "delete") modal.confirm({
                  title: `删除“${item.title}”？`,
                  content: "作品将从列表移除，保留本地删除备份。",
                  okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
                  onOk: async () => {
                    if (active.current === item.id) cancel();
                    await store.deleteDocument(item.id);
                    if (active.current === item.id) {
                      ++request.current;
                      active.current = null;
                      setId(null);
                      setDraft(defaults);
                      setControlsCollapsed(false);
                      const next = store.documentList()[0];
                      if (next) await navigate(next.id);
                    }
                  },
                });
                else
                  act(
                    store
                      .ensureDocument(item.id)
                      .then(() =>
                        store.stageDocument(item.id, { favorite: !item.favorite })
                      )
                  );
              },
            }}
          >
            <button
              className="story-row-more"
              aria-label={`${item.title}更多操作`}
            >
              <MoreOutlined />
            </button>
          </Dropdown>
        </div>
      );
  const rows = (favorite: boolean) => store.documentList().filter(item=>item.favorite === favorite && !projects.projectOf(item.id)).map(row);
  const saveError =
    id && store.documentStatus(id).startsWith("保存失败")
      ? store.documentStatus(id)
      : "";
  const pages = content?.plan?.pages ?? [],
    complete = !!pages.length && pages.every((p) => p.image) && !!content?.copy;
  const changed =
    !!content?.plan && (content.plannedConfig !== signature(config) ||
      (config.count > 0 && content.plan.pages.length !== config.count));
  const provisional =
    (!content?.plan || (busy && changed)) && (busy || !!content?.job?.total);
  const displayPages: Page[] = provisional
    ? Array.from({ length: config.count || 8 }, (_, i) => ({
        title: i === 0 ? "封面" : `第${i + 1}页`,
        text: "",
        visual: "",
        layout: "single",
        history: [],
        status: "queued",
      }))
    : pages;
  const pageState = (p: Page) =>
    p.status ?? (p.error ? "error" : p.image ? "ready" : "queued");
  const pageLabel = (p: Page) => {
    const state = pageState(p);
    if (state === "ready") return "已完成";
    if (state === "error") return "生成失败，可重试";
    if (!busy) return "已暂停，等待继续";
    if (provisional) return "正在规划…";
    return {
      queued: "等待生成",
      generating: "正在生成…",
      composing: "正在排版…",
    }[state];
  };
  return (
    <section
      className="story-app"
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
        <aside className="story-nav">
          <header className="story-heading">
            <StoryComicIcon />
            <strong>画漫画</strong>
            <Button
              type="text"
              className="navigation-toggle"
              icon={<MenuFoldOutlined />}
              title="折叠故事漫画导航"
              aria-label="折叠故事漫画导航"
              onClick={() => setCollapsed(true)}
            />
          </header>
          <div className="tool-sidebar-create-section">
            <div className="tool-sidebar-create-label">创建</div>
            <button
              className={`tool-sidebar-create ${id === null && !gallery ? "selected" : ""}`}
              aria-current={id === null && !gallery ? "page" : undefined}
              disabled={opening && creating.current}
              {...entryEvents(() => void navigate(null, true))}
            >
              <PlusOutlined />
              故事漫画
            </button>
            <button className={`tool-sidebar-create ${gallery ? 'selected' : ''}`} aria-current={gallery ? 'page' : undefined}
              {...entryEvents(openGallery)}><StoryComicIcon />我的作品</button>
          </div>
          <div className="story-list">
            {rows(true).length > 0 && <NavigationSection title="常用">{rows(true)}</NavigationSection>}
            <ProjectSection navigation={projects} items={store.documentList()} renderItem={row} activeId={id} onCreate={projectId=>void navigate(null, true, projectId)} />
            <NavigationSection title="最近打开">{rows(false).length ? rows(false) : <p>暂无</p>}</NavigationSection>
          </div>
        </aside>
      )}
      {gallery && <WorksGallery collapsed={collapsed} expand={() => setCollapsed(false)} open={next => void navigate(next)} />}
      <main hidden={gallery}
        className={`story-work ${
          controlsCollapsed ? "controls-collapsed" : ""
        }`}
      >
        <header className="story-bar">
          <div className="story-bar-title">
            {collapsed && (
              <Button
                type="text"
                className="navigation-toggle"
                icon={<MenuUnfoldOutlined />}
                title="展开故事漫画导航"
                aria-label="展开故事漫画导航"
                onClick={() => setCollapsed(false)}
              />
            )}
            <span className="story-title" title={doc?.title}>{doc?.title ?? "画漫画"}</span>
            <Button type="text" size="small" icon={<EditOutlined />}
              aria-label="重命名作品" title="重命名作品" disabled={!doc}
              onClick={() => doc && setRename({ id: doc.id, title: doc.title })} />
          </div>
          <nav className="story-tabs" aria-label="作品内容">
            {["偏好", "漫画", "发布", "下载", "打印"].map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="story-job-status">
            {(busy || content?.job) && (
              <span role="status" title={busy ? (optimizing ? "正在优化本页…" : content?.job?.stage || "正在准备…") : complete ? "生成完成" : "已暂停"}>
                {busy ? (optimizing ? "正在优化本页…" : content?.job?.stage || "正在准备…") : complete ? "生成完成" : "已暂停"}
                {" · "}{displayPages.filter((p) => !!p.image && !p.error).length}/{displayPages.length || config.count || 8} 页
              </span>
            )}
            {busy ? <Button size="small" onClick={cancel}>暂停</Button> :
              pages.some((p) => p.error || p.status === "error") && (
                <Button size="small" disabled={opening || !!corrupt || changed || provisional}
                  onClick={() => void generate(undefined, true)}>重试失败页</Button>
              )}
          </div>
        </header>
        {(error ||
          corrupt ||
          saveError ||
          store.documentWarnings().length > 0) && (
          <div className="story-error" role="alert">
            {error ||
              corrupt ||
              saveError ||
              store.documentWarnings().join("；")}
            {saveError && (
              <Button size="small" onClick={() => act(store.flushDocuments())}>
                重试保存
              </Button>
            )}
            {corrupt && doc && (
              <Button size="small" onClick={() => act(backup(doc.id))}>
                导出备份
              </Button>
            )}
          </div>
        )}
        {opening && (
          <div className="story-opening" role="status">
            正在打开…
          </div>
        )}
        <div className={`story-body ${refineIndex !== null && tab === '漫画' ? 'has-refiner' : ''}`}>
          <aside className="story-controls">
            <div className="story-controls-scroll">
              <section>
                <h2>
                  <b>1</b>输入主题
                </h2>
                <Input.TextArea
                  aria-label="输入主题"
                  rows={1}
                  autoSize={{ minRows: 1, maxRows: 8 }}
                  value={inputTopic}
                  disabled={!!corrupt}
                  placeholder="输入一个主题，让故事变成漫画"
                  onChange={(e) => patch({ topic: e.target.value })}
                />
                <div className="story-topics">
                  <small>试试这些</small>
                  {topics.map((t) => (
                    <button
                      key={t}
                      disabled={!!corrupt}
                      onClick={() => patch({ topic: t })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h2 className="story-style-heading"><b>2</b>选择风格 <small>右边选 →</small></h2>
              </section>
              <section><h2><b>3</b>尺寸篇幅</h2><div className="story-options"><label className="story-size-option">
                    尺寸
                    <Select
                      aria-label="尺寸"
                      value={config.size ?? "xhs-portrait"}
                      onChange={(size) => patch({ size })}
                      options={sizes.map((s) => ({
                        value: s.id,
                        label: `${s.label}（${s.width}×${s.height}）`,
                      }))}
                    />
                  </label><label>
                    篇幅
                    <Select
                      aria-label="篇幅"
                      value={config.count}
                      onChange={(count) => patch({ count })}
                      options={[
                        { value: 0, label: "自动（4–8页）" },
                        ...pageCounts
                          .filter((n) => n > 0)
                          .map((value) => ({
                            value,
                            label: `${value}页（含封面）`,
                          })),
                      ]}
                    />
                  </label></div></section>
              <section><h2><b>4</b>其他偏好 <small>可选</small></h2><div className="story-options"><label>
                    基调
                    <Select
                      aria-label="基调"
                      value={resolveStyle(config).tone}
                      disabled={!!resolveStyle(config).preset}
                      onChange={(tone) => patch({ tone })}
                      options={tones}
                    />
                  </label><label>
                    语言
                    <Select
                      aria-label="语言"
                      value={config.language}
                      onChange={(language) => patch({ language })}
                      options={["中文", "英文"].map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </label><label>
                    受众
                    <Select
                      aria-label="受众"
                      value={config.audience}
                      onChange={(audience) => patch({ audience })}
                      options={audiences.map(
                        ({value}) => ({ value, label: value })
                      )}
                    />
                  </label></div></section>
              <section>
                <h2><b>5</b>参考图样 <small>可选</small></h2>
                <ReferenceUploads label="场景图" images={config.sceneReferences ?? []} disabled={uploading || busy || opening || !!corrupt}
                  add={files => addReferences('sceneReferences',files)} remove={index => patch({sceneReferences:(config.sceneReferences ?? []).filter((_,i)=>i!==index)})} />
                <ReferenceUploads label="角色图" images={config.characterReferences ?? []} disabled={uploading || busy || opening || !!corrupt}
                  add={files => addReferences('characterReferences',files)} remove={index => patch({characterReferences:(config.characterReferences ?? []).filter((_,i)=>i!==index)})} />
                <small className="story-reference-hint">PNG / JPG，每张不超过 10MB</small>
                {uploading && <p role="status">正在添加参考图…</p>}
              </section>
            </div>
            {!controlsCollapsed && (
              <div className="story-generate">
                <Button
                  type="primary"
                  size="small"
                  block
                  disabled={uploading || busy || opening || !!corrupt || !inputTopic.trim() ||
                    (complete && !changed && !pages.some((p) => p.error))}
                  onClick={() => void generate()}
                >生成</Button>

              </div>
            )}
          </aside>
          <section
            className={`story-results ${
              tab === "打印" ? "has-print" : tab === "偏好" ? "has-style-gallery" : tab === "漫画" && displayPages.length ? "has-canvas" : ""
            }`}
          >
            {(tab === "偏好" || tab === "漫画") &&
              (tab === "漫画" && displayPages.length ? (
                <>
                  <div className="story-result-heading">
                    {provisional && !config.count && (
                      <span>正在确定页数 · 暂展示 8 页</span>
                    )}
                    {pages.some((p) => p.error) && (
                      <Button
                        size="small"
                        disabled={busy || changed}
                        onClick={() => void generate()}
                      >
                        重试失败页
                      </Button>
                    )}
                  </div>
                  <ComicCanvas
                    key={id ?? "draft"}
                    ratio={
                      sizeFor(content?.plan ? content.plan.size : config.size)
                        .width /
                      sizeFor(content?.plan ? content.plan.size : config.size)
                        .height
                    }
                  >
                    {displayPages.map((p, i) => (
                      <article
                        key={i}
                        data-page-state={pageState(p)}
                        data-optimizing={refineIndex === i}
                        style={
                          {
                            "--story-page-ratio": `${
                              sizeFor(
                                content?.plan ? content.plan.size : config.size
                              ).width
                            } / ${
                              sizeFor(
                                content?.plan ? content.plan.size : config.size
                              ).height
                            }`,
                          } as React.CSSProperties
                        }
                      >
                        {p.image ? (
                          <button className="story-page-image" aria-label={`优化第${i+1}页`} onClick={() => setRefineIndex(i)}>
                            <PageImage thumbnail src={p.image} alt={`第${i + 1}页 ${p.title}`} />
                          </button>
                        ) : (
                          <div className="story-page-image story-page-empty">
                            <span className={`story-page-placeholder ${busy ? "active" : ""}`}>
                              <i aria-hidden="true" />
                              <strong>第 {i + 1} 页{i === 0 ? " · 封面" : ""}</strong>
                              <span>{pageLabel(p)}</span>

                            </span>
                          </div>
                        )}
                        <footer className="nopan">
                          <span>
                            第 {i + 1} 页{i === 0 ? " · 封面" : ""}
                          </span>
                          <small className="story-page-state">
                            {pageLabel(p)}
                          </small>
                          <button className="story-page-more story-page-preview" aria-label={`预览第${i+1}页`} title="放大预览"
                            disabled={!p.image} onClick={() => setPreview(i)}><ZoomInOutlined /></button>
                          <Dropdown
                            trigger={["click"]}
                            menu={{
                              items: [
                                {
                                  key: "regenerate",
                                  label: "重新生成本页",
                                  disabled: busy || changed || provisional,
                                },
                                {
                                  key: "download",
                                  label: "下载本页",
                                  disabled: !p.image,
                                },
                                {
                                  key: "restore",
                                  label: "恢复上一版",
                                  disabled: busy || !p.history.length,
                                },
                              ],
                              onClick: ({ key }) => {
                                if (key === "regenerate") void generate(i);
                                else if (key === "download")
                                  act(exportPage(content!, i));
                                else if (content && doc) {
                                  const next = structuredClone(content), page = next.plan!.pages[i];
                                  restorePage(page);
                                  store.stageDocument(doc.id, {
                                    content: JSON.stringify(next),
                                  });
                                }
                              },
                            }}
                          >
                            <button
                              className="story-page-more"
                              aria-label={`第${i + 1}页操作`}
                            >
                              <MoreOutlined />
                            </button>
                          </Dropdown>
                        </footer>
                        {p.error && p.status !== "queued" && p.status !== "generating" && p.status !== "composing" && (
                          <p className="story-page-error" role="alert">
                            {p.error}
                          </p>
                        )}
                      </article>
                    ))}
                  </ComicCanvas>
                </>
              ) : tab === "漫画" ? <div className="story-empty">请在偏好中设置并生成漫画</div> : (
                <div className="story-style-welcome">
                  <section className="story-style-gallery" aria-label="风格模板参考">

                    <div className="story-style-covers">
                      {styles.map((s) => (
                        <div key={s.id} className="story-style-card" data-selected={resolveStyle(config).id === s.id}>
                          <button type="button" className="story-style-select"
                            aria-label={`选择${s.name}模板`}
                            aria-pressed={resolveStyle(config).id === s.id}
                            title={`${s.name} · ${s.hint}`}
                            disabled={busy || opening || !!corrupt}
                            onClick={() => patch({ style: s.id, tone: s.tone })}>
                            <div className="story-cover-art"><img src={`/story-comic/covers/${s.id}.jpg?v=20261006`} alt={`${s.name}封面：${coverThemes[s.id as keyof typeof coverThemes]}`} decoding="async" /></div>
                            <span className="story-style-caption"><strong>{s.name}</strong><small>{s.hint.replace(/ · /g, "，")}</small></span>
                          </button>
                          <button type="button" className="story-style-preview-button"
                            aria-label={`预览${s.name}模板`} title="放大预览"
                            onClick={() => setStylePreview(s.id)}><ZoomInOutlined /></button>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              ))}
            {tab === "发布" && <div className="story-publish-layout">
              {content?.copy ? (
                <div className="story-copy">
                  <header>
                    <h2>发布文案</h2>
                    {doc && <XhsPublisher key={doc.id} documentId={doc.id} copy={content.copy} pages={pages} />}
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => void copy(copyText(content.copy!))}
                    >
                      复制全部
                    </Button>
                  </header>
                  {[
                    { label: "标题", text: content.copy.title },
                    { label: "描述", text: content.copy.description },
                    {
                      label: "话题",
                      text: content.copy.hashtags.map((t) => "#" + t).join(" "),
                    },
                  ].map((item) => (
                    <section key={item.label}>
                      <header>
                        <h3>{item.label}</h3>
                        <Button
                          size="small"
                          type="text"
                          onClick={() => void copy(item.text)}
                        >
                          复制{item.label}
                        </Button>
                      </header>
                      <p>{item.text}</p>
                      {item.label === "标题" && (
                        <div className="story-alternatives">
                          {content.copy!.alternatives.map((t, i) => (
                            <button key={i} onClick={() => void copy(t)}>
                              备选 {i + 1} · {t}
                              <CopyOutlined />
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="story-empty">
                  <h2>发布文案会在这里准备好</h2>
                  <p>生成漫画后，获得标题、描述与话题。</p>
                  {pages.length > 0 && !busy && (
                    <Button onClick={() => void generate()}>继续完成</Button>
                  )}
                </div>
              )}
              <PhonePreview key={doc?.id ?? "draft"} pages={pages} copy={content?.copy} renderImage={(page, index) => <PageImage src={page.image!} alt={`手机预览第${index + 1}页`} />} />
            </div>}
            {tab === "打印" && <PrintPanel key={doc?.id ?? "draft"} pages={pages} title={doc?.title ?? config.topic} renderImage={(page, index) => <PageImage src={page.image!} alt={`打印预览第${index + 1}页`} />} />}
            {tab === "下载" && (
              <div className="story-download">
                <h2>带走你的故事</h2>
                <p>每页都是独立图片，封面排在第一张。</p>
                <div className="story-download-actions">
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    disabled={!complete}
                    onClick={() =>
                      act(exportZip(content!, doc?.title ?? config.topic))
                    }
                  >
                    下载全部 · ZIP
                  </Button>
                  <Button
                    disabled={!pages[0]?.image}
                    onClick={() => act(exportPage(content!, 0))}
                  >
                    下载封面
                  </Button>
                  <Button
                    disabled={!pages.length || pages.some((p) => !p.image)}
                    onClick={() =>
                      act(exportPdf(content!, doc?.title ?? config.topic))
                    }
                  >
                    下载 PDF
                  </Button>
                </div>
                <p className="story-muted">
                  ZIP 包含按顺序命名的 PNG 图片和发布文案.txt。
                </p>
                {pages.map((p, i) => (
                  <div className="story-download-row" key={i}>
                    <span>
                      {String(i + 1).padStart(2, "0")} ·{" "}
                      {i === 0 ? "封面" : p.title}
                    </span>
                    <Button
                      size="small"
                      disabled={!p.image}
                      icon={<DownloadOutlined />}
                      onClick={() => act(exportPage(content!, i))}
                    >
                      下载本页
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
          {tab === '漫画' && refineIndex !== null && pages[refineIndex]?.image && <PageRefiner key={`${id}-${refineIndex}`} page={pages[refineIndex]} index={refineIndex} busy={busy||opening}
            close={() => setRefineIndex(null)} submit={text => optimize(refineIndex,text)} />}
        </div>
      </main>
      <Modal
        title={rename ? "重命名故事漫画" : ""}
        open={!!rename}
        onCancel={() => setRename(null)}
        onOk={() => void renameWork()}
        okText="保存"
        cancelText="取消"
      >
        <Input
          aria-label="作品名称"
          maxLength={120}
          value={rename?.title ?? ""}
          onChange={(e) =>
            rename && setRename({ ...rename, title: e.target.value })
          }
        />
      </Modal>
      <Modal
        title={
          preview !== null
            ? `第 ${preview + 1} 页${preview === 0 ? " · 封面" : ""}`
            : ""
        }
        open={preview !== null}
        footer={null}
        onCancel={() => setPreview(null)}
        width={780}
      >
        <div className="story-preview">
          {preview !== null && pages[preview]?.image && (
            <PageImage src={pages[preview].image!} alt={`第${preview + 1}页`} />
          )}
        </div>
      </Modal>
      <Modal
        title={`${styles.find((s) => s.id === stylePreview)?.name ?? ""} · 风格参考`}
        open={stylePreview !== null}
        footer={<Button size="small" disabled={busy || opening || !!corrupt}
          onClick={() => {
            const style = styles.find((s) => s.id === stylePreview);
            if (style) patch({ style: style.id, tone: style.tone });
            setStylePreview(null);
          }}>使用此风格</Button>}
        onCancel={() => setStylePreview(null)}
        width={620}
        centered
      >
        <div className="story-preview story-style-preview">
          {stylePreview && <img src={`/story-comic/covers/${stylePreview}.jpg?v=20261006`} decoding="async"
            alt={`${styles.find((s) => s.id === stylePreview)?.name}封面放大预览`} />}
        </div>
      </Modal>
    </section>
  );
}
