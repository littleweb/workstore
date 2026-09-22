import { useEffect, useRef, useState } from "react";
import {
  App,
  Button,
  Input,
  Modal,
  Select,
  Tag,
  Alert,
  Dropdown,
  Switch,
} from "antd";
import {
  ArrowUpOutlined,
  CloseOutlined,
  EditOutlined,
  FireOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  DownloadOutlined,
  SendOutlined,
  LoadingOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import {
  ReactFlow,
  Background,
  Controls,
  PanOnScrollMode,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./comics.css";
import * as store from "./store";
import {
  loadFeatured,
  loadTemplates,
  refreshTemplates,
  feedConfig,
} from "./catalog";
import {
  checkpoint,
  candidate,
  instantiate,
  parseStory,
  parseObject,
} from "./model";
import { ai } from "../ai/client";
import type {
  ComicContent,
  Page,
  Template,
  Platform,
  PublishingDraft,
  Ratio,
} from "./types";
import Picture from "./Picture";
import ComicIcon from "./ComicIcon";
import {
  storyRequest,
  parseEntities,
  pageReferences,
  pageArtPrompt,
} from "./story";
import ComicSettings from "./ComicSettings";
import { exportWork } from "./export";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { native } from "../workspace";
import { referenceImage } from "./images";

type View = "create" | "featured" | "edit" | "settings" | "history" | "publish";
const platforms: Record<Platform, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  shipinhao: "视频号",
};
type PageNode = Node<{
  page: Page;
  ratio: Ratio;
  dialogueStyle?: Template["dialogueStyle"];
}>;
function ComicNode({ data, selected }: NodeProps<PageNode>) {
  return (
    <div
      className={`comic-node ${selected ? "selected" : ""}`}
      style={{ width: 300 }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: data.ratio.replace(":", "/"),
          overflow: "hidden",
        }}
      >
        <Picture value={data.page.image} alt={data.page.title} />
      </div>
      <div className="comic-node-copy">
        <small>{data.page.title}</small>
        {data.page.image &&
          data.page.dialogue &&
          data.page.imageDialogue !== data.page.dialogue && (
            <span className="comic-error">对白待融入画面，请重绘</span>
          )}

        {data.page.status === "generating" && (
          <span>
            <LoadingOutlined /> 正在生成
          </span>
        )}
        {data.page.error && (
          <span className="comic-error">{data.page.error}</span>
        )}
      </div>
    </div>
  );
}
const nodeTypes = { comic: ComicNode };
export default function ComicApp() {
  const { message } = App.useApp();
  const [, tick] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [featured, setFeatured] = useState<Template[]>([]);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("create");
  const [collapsed, setCollapsed] = useState(false);
  const [workId, setWorkId] = useState<string | null>(store.lastComicId);
  const [templateId, setTemplateId] = useState("cat-workday");
  const [theme, setTheme] = useState("");
  const [count, setCount] = useState(6);
  const countChosen = useRef(false);
  const creating = useRef(false);
  const [ratio, setRatio] = useState<Ratio>("3:4");
  const [category, setCategory] = useState("全部");
  const [preview, setPreview] = useState<Template>();
  const [previewPage, setPreviewPage] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<"page" | "related">("page");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [preparingId, setPreparingId] = useState<string>();
  const [assetId, setAssetId] = useState<string>();
  const shownWork = useRef(workId);
  shownWork.current = workId;
  const [platform, setPlatform] = useState<Platform>("xiaohongshu");
  const [historyId, setHistoryId] = useState<string>();
  const [compareCurrent, setCompareCurrent] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("全部版本");
  const [feedSearch, setFeedSearch] = useState("");
  const [more, setMore] = useState(false);
  const [tone, setTone] = useState("跟随模板");
  const [ending, setEnding] = useState("跟随模板");
  const [settingsDraft, setSettingsDraft] =
    useState<ComicContent["settings"]>();
  const abort = useRef<AbortController | undefined>(undefined);
  const doc = workId ? store.currentComic(workId) : undefined;
  const c = doc?.content?.settings ? doc.content : undefined;
  const currentPage = c?.pages.find((p) => p.id === selected);
  const template =
    templates.find((t) => t.templateId === templateId) ??
    featured.find((t) => t.templateId === templateId);
  const revision =
    c?.history.find((h) => h.id === historyId) ??
    c?.history.find((h) => h.id === c.currentRevisionId);
  const draft = c?.publishing[platform];
  useEffect(() => store.subscribe(() => tick((x) => x + 1)), []);
  useEffect(() => {
    void store.refreshComics().catch((e) => setError(String(e)));
    void loadTemplates()
      .then(async (t) => {
        setTemplates(t);
        setFeatured(await loadFeatured(t));
      })
      .catch((e) => setError(String(e)));
    return () => abort.current?.abort();
  }, []);
  const report = (e: unknown) => {
    setError(String(e));
    void message.error(String(e));
  };
  const write = (next: ComicContent, id = workId) => {
    if (id) store.stageComic(id, { content: next });
  };
  const save = (next: ComicContent, title: string) =>
    write(checkpoint(next, title));
  async function open(id: string) {
    try {
      await store.flushComics();
      await store.openComic(id);
      const opened = store.currentComic(id)!.content;
      if (!abort.current && opened.job?.status === "running") {
        write(
          {
            ...opened,
            pages: opened.pages.map((p) =>
              p.status === "generating"
                ? { ...p, status: "error", error: "上次生成已中断，可继续绘制" }
                : p
            ),
            job: {
              ...opened.job,
              status: "cancelled",
              stage: "上次生成已中断，可继续绘制",
            },
          },
          id
        );
      }
      setWorkId(id);
      setSelected(undefined);
      setSettingsDraft(structuredClone(opened.settings));
      setView(
        !opened.settings.entities.length ||
          opened.settings.entities.some((e) => !e.reference)
          ? "settings"
          : "edit"
      );
      setError("");
    } catch (e) {
      report(e);
    }
  }
  function useTemplate(t: Template) {
    setTemplateId(t.templateId);
    if (!countChosen.current || !t.supportedCounts.includes(count))
      setCount(t.defaultPages);
    setPreview(undefined);
    setView("create");
  }
  async function task(fn: (signal: AbortSignal) => Promise<void>) {
    if (abort.current) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError("");
    try {
      await fn(ctl.signal);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
      setStage("");
      abort.current = undefined;
    }
  }
  async function generateStory(id: string, signal: AbortSignal) {
    const original = store.currentComic(id)!.content;
    const job = {
      id: crypto.randomUUID(),
      stage: "正在编写故事",
      status: "running" as const,
      startedAt: Date.now(),
    };
    write({ ...original, job }, id);
    setStage(job.stage);
    try {
      const result = await ai.generate(storyRequest(original), signal);
      if (signal.aborted) throw new Error("已停止生成");
      const entities = parseEntities(result.text, original.settings.entities);
      const pages = parseStory(
        result.text,
        original.settings.count,
        entities.map((e) => e.id)
      );
      const latest = store.currentComic(id)!.content;
      if (latest.job?.id !== job.id) throw new Error("当前任务已被替换");
      if (JSON.stringify(latest.settings) !== JSON.stringify(original.settings))
        throw new Error("生成期间设定已变化，请重新生成故事");
      write(
        checkpoint(
          {
            ...latest,
            pages,
            settings: { ...original.settings, entities },
            job: { ...job, stage: "故事已生成", status: "done" },
          },
          "生成故事分镜"
        ),
        id
      );
      await store.flushComic(id);
      void message.success("故事分镜已生成");
    } catch (e) {
      const latest = store.currentComic(id)!.content;
      write(
        {
          ...latest,
          job: {
            ...job,
            status: signal.aborted ? "cancelled" : "error",
            error: String(e),
          },
        },
        id
      );
      throw e;
    }
  }
  async function generateAssetReferences(id: string, signal: AbortSignal) {
    const assets = store.currentComic(id)!.content.settings.entities;
    if (!assets.length) throw new Error("请先生成故事，建立本作品的角色与场景");
    for (const asset of assets.filter((e) => !e.reference)) {
      if (signal.aborted) throw new Error("已停止生成");
      setAssetId(asset.id);
      const base = store.currentComic(id)!.content;
      setStage(
        `正在设计${
          asset.kind === "character"
            ? "角色"
            : asset.kind === "scene"
            ? "场景"
            : "道具"
        }：${asset.name}`
      );
      const result = await ai.generate(
        {
          toolId: "app.comic",
          image: true,
          messages: [
            {
              role: "user",
              content: `为原创漫画制作一张独立资产参考图，不要拼图、文字或水印。资产类型：${asset.kind}；名称：${asset.name}；视觉设定：${asset.description}。画风：${base.settings.style}。故事主题：${base.settings.theme}。角色使用完整全身、清晰外貌和服装；场景展示空间布局；道具突出完整轮廓。只画指定资产，角色或道具使用简洁浅色背景。`,
            },
          ],
        },
        signal
      );
      if (signal.aborted) throw new Error("已停止生成资产，可继续绘制");
      const src = result.images?.[0];
      if (!src)
        throw new Error(`未能生成 ${asset.name} 的参考图，请继续绘制以重试`);
      const latest = store.currentComic(id)!.content;
      const current = latest.settings.entities.find((e) => e.id === asset.id);
      if (
        JSON.stringify(current) !== JSON.stringify(asset) ||
        latest.settings.style !== base.settings.style
      )
        throw new Error("资产设定已修改，请重新绘制");
      write(
        checkpoint(
          {
            ...latest,
            settings: {
              ...latest.settings,
              entities: latest.settings.entities.map((e) =>
                e.id === asset.id ? { ...e, reference: { src } } : e
              ),
            },
          },
          `设计资产：${asset.name}`
        ),
        id
      );
      await store.flushComic(id);
    }
  }
  async function prepareStory(id: string, signal: AbortSignal) {
    setPreparingId(id);
    try {
      const before = store.currentComic(id)!.content;
      if (
        !before.settings.entities.length ||
        before.pages.some((p) => !p.entityIds.length)
      )
        await generateStory(id, signal);
      await generateAssetReferences(id, signal);
      if (signal.aborted) throw new Error("已停止生成");
      if (shownWork.current === id) {
        setSettingsDraft(
          structuredClone(store.currentComic(id)!.content.settings)
        );
        setView("edit");
      }
    } finally {
      setAssetId(undefined);
      setPreparingId(undefined);
      if (shownWork.current === id)
        setSettingsDraft(
          structuredClone(store.currentComic(id)!.content.settings)
        );
    }
    await drawPages(id, signal);
  }
  async function drawPages(id: string, signal: AbortSignal, only?: string[]) {
    await generateAssetReferences(id, signal);
    const base = store.currentComic(id)!.content;
    const targets = base.pages.filter((p) =>
      only
        ? only.includes(p.id)
        : p.status !== "ready" ||
          (!!p.dialogue && p.imageDialogue !== p.dialogue)
    );
    if (!targets.length) {
      void message.info("所有画面已完成，点击卡片可单独重绘");
      return;
    }
    const job = {
      id: crypto.randomUUID(),
      stage: "准备绘制",
      status: "running" as const,
      startedAt: Date.now(),
    };
    write({ ...base, job }, id);
    for (const target of targets) {
      if (signal.aborted) throw new Error("已停止生成");
      const snapshot = store.currentComic(id)!.content;
      const index = snapshot.pages.findIndex((p) => p.id === target.id);
      const page = snapshot.pages[index];
      const label = `正在绘制第 ${index + 1} / ${snapshot.pages.length} 张`;
      setStage(label);
      write(
        {
          ...snapshot,
          job: { ...job, stage: label },
          pages: snapshot.pages.map((p) =>
            p.id === page.id
              ? { ...p, status: "generating", error: undefined }
              : p
          ),
        },
        id
      );
      try {
        const pictures = pageReferences(snapshot, index);
        const references = await Promise.all(pictures.map(referenceImage));
        const result = await ai.generate(
          {
            toolId: "app.comic",
            image: true,
            references,
            messages: [
              {
                role: "user",
                content: pageArtPrompt(snapshot, index),
              },
            ],
          },
          signal
        );
        if (signal.aborted) throw new Error("已停止生成");
        const src = result.images?.[0];
        if (!src) throw new Error("通用 AI 未返回图片");
        const latest = store.currentComic(id)!.content;
        if (
          latest.job?.id !== job.id ||
          JSON.stringify(latest.settings) !==
            JSON.stringify(snapshot.settings) ||
          latest.pages.find((p) => p.id === page.id)?.action !== page.action ||
          latest.pages.find((p) => p.id === page.id)?.dialogue !== page.dialogue
        ) {
          write(
            candidate(
              latest,
              {
                settings: snapshot.settings,
                pages: snapshot.pages.map((p) =>
                  p.id === page.id
                    ? {
                        ...p,
                        image: { src },
                        imageDialogue: page.dialogue,
                        status: "ready",
                      }
                    : p
                ),
              },
              `候选：第 ${index + 1} 张绘制结果`,
              snapshot.currentRevisionId
            ),
            id
          );
          throw new Error(
            "作品已修改，绘制结果已保存到历史候选，未覆盖当前画面"
          );
        }
        write(
          checkpoint(
            {
              ...latest,
              pages: latest.pages.map((p) =>
                p.id === page.id
                  ? {
                      ...p,
                      image: { src },
                      imageDialogue: page.dialogue,
                      status: "ready",
                      error: undefined,
                    }
                  : p
              ),
              job: { ...job, stage: `第 ${index + 1} 张已完成` },
            },
            `绘制第 ${index + 1} 张`
          ),
          id
        );
        await store.flushComic(id);
      } catch (e) {
        const latest = store.currentComic(id)!.content;
        write(
          {
            ...latest,
            pages: latest.pages.map((p) =>
              p.id === page.id && p.action === page.action
                ? { ...p, status: "error", error: String(e) }
                : p
            ),
            job: {
              ...job,
              status: signal.aborted ? "cancelled" : "error",
              stage: signal.aborted ? "已停止，可继续绘制" : "绘制失败，可重试",
              error: String(e),
            },
          },
          id
        );
        await store.flushComic(id);
        throw e;
      }
    }
    const latest = store.currentComic(id)!.content;
    write(
      { ...latest, job: { ...job, status: "done", stage: "画面已完成" } },
      id
    );
    await store.flushComic(id);
  }
  async function drawCover(signal: AbortSignal) {
    if (!c || !workId) return;
    const id = workId;
    const base = store.currentComic(id)!.content;
    const old = base.publishing[platform];
    setStage("正在绘制发布封面");
    const pictures = base.pages
      .flatMap((p) => (p.image ? [p.image] : []))
      .slice(0, 3);
    if (!pictures.length) throw new Error("请先完成至少一张漫画");
    const result = await ai.generate(
      {
        toolId: "app.comic",
        image: true,
        references: await Promise.all(pictures.map(referenceImage)),
        messages: [
          {
            role: "user",
            content: `以参考漫画角色和画风生成一张 ${
              base.settings.ratio
            } 的社交媒体封面。保持角色一致，突出故事情绪，构图清晰，顶部为标题预留空间。不添加文字或水印。故事：${
              base.settings.theme
            }。调整要求：${instruction || "更有吸引力，忠实于故事"}`,
          },
        ],
      },
      signal
    );
    if (signal.aborted) throw new Error("已停止生成");
    const src = result.images?.[0];
    if (!src) throw new Error("没有返回封面图片");
    const latest = store.currentComic(id)!.content;
    if (
      latest.currentRevisionId !== base.currentRevisionId ||
      JSON.stringify(latest.publishing[platform]) !== JSON.stringify(old)
    )
      throw new Error("作品或发布草稿已变化，请重新生成封面");
    const next: PublishingDraft = old ?? {
      platform,
      sourceRevisionId: base.currentRevisionId,
      title: doc!.title,
      description: "",
      hashtags: [],
      covers: [],
      coverText: doc!.title,
      selectedCover: 0,
      imageOrder: base.pages.map((p) => p.id),
      updatedAt: Date.now(),
    };
    write(
      {
        ...latest,
        publishing: {
          ...latest.publishing,
          [platform]: {
            ...next,
            covers: [...next.covers, { src }],
            selectedCover: next.covers.length,
            updatedAt: Date.now(),
          },
        },
      },
      id
    );
    setInstruction("");
  }
  async function generateCover() {
    await task((signal) => drawCover(signal));
  }

  async function create(example = false) {
    if (!template || abort.current || creating.current) return;
    creating.current = true;
    setBusy(true);
    try {
      let content = instantiate(
        template,
        theme.trim() || (example ? template.summary : ""),
        count,
        ratio
      );
      content.settings = { ...content.settings, tone, ending };
      if (example) {
        content.settings.entities = structuredClone(template.entities);
        content.pages = structuredClone(template.example);
        content.settings.count = template.defaultPages;
        content = checkpoint(content, "从完整示例创建");
      }
      const d = await store.createComic(content);
      store.stageComic(d.id, {
        title: example ? template.title : theme.trim().slice(0, 24),
      });
      await store.flushComic(d.id);
      setWorkId(d.id);
      setSettingsDraft(structuredClone(content.settings));
      setView(example ? "edit" : "settings");
      setSelected(undefined);
      if (!example)
        await task(async (signal) => {
          await prepareStory(d.id, signal);
        });
    } catch (e) {
      report(e);
    } finally {
      creating.current = false;
      if (!abort.current) setBusy(false);
    }
  }
  async function adjust() {
    if (!c || !workId || !instruction.trim()) return;
    await task(async (signal) => {
      const id = workId;
      const base = store.currentComic(id)!.content;
      setStage(selected ? "调整当前分镜" : "调整整篇剧情");
      const anchor = base.pages.find((p) => p.id === selected);
      const target = selected
        ? base.pages.filter(
            (p) =>
              p.id === selected ||
              (scope === "related" &&
                p.entityIds.some((id) => anchor?.entityIds.includes(id)))
          )
        : base.pages;
      const targetIds = target.map((p) => p.id);
      const result = await ai.generate(
        {
          toolId: "app.comic",
          messages: [
            {
              role: "system",
              content:
                "只输出 JSON {pages:[{title,action,dialogue,state,entityIds}]}。按原页数顺序改漫画分镜，保留人物、场景和未要求的剧情。",
            },
            {
              role: "user",
              content: JSON.stringify({
                settings: base.settings,
                pages: target.map(({ image, ...p }) => p),
                context: base.pages.map((p) => ({
                  title: p.title,
                  action: p.action,
                  state: p.state,
                })),
                instruction,
              }),
            },
          ],
        },
        signal
      );
      const parsed = parseStory(
        result.text,
        target.length,
        base.settings.entities.map((e) => e.id)
      );
      const latest = store.currentComic(id)!.content;
      if (JSON.stringify(latest.pages) !== JSON.stringify(base.pages))
        throw new Error("页面已有新修改，本次结果未覆盖，请重试");
      let i = 0;
      const pages = base.pages.map((p) =>
        targetIds.includes(p.id)
          ? {
              ...parsed[i++],
              id: p.id,
              image: p.image,
              status: "draft" as const,
            }
          : p
      );
      write(
        checkpoint(
          { ...latest, pages },
          selected ? "调整单张分镜" : "调整整篇剧情"
        ),
        id
      );
      setInstruction("");
      await drawPages(id, signal, targetIds);
    });
  }
  function editPage(patch: Partial<Page>) {
    if (c && selected)
      write({
        ...c,
        pages: c.pages.map((p) =>
          p.id === selected
            ? {
                ...p,
                ...patch,
                ...(patch.action !== undefined || patch.dialogue !== undefined
                  ? { status: "draft" as const }
                  : {}),
              }
            : p
        ),
      });
  }
  async function generatePublishing(
    field?: "title" | "description" | "hashtags",
    withCover = false,
    direction?: string
  ) {
    if (!c) return;
    await task(async (signal) => {
      const base = c;
      setStage("正在整理发布物料");
      const r = await ai.generate(
        {
          toolId: "app.comic",
          messages: [
            {
              role: "system",
              content:
                "为漫画准备社交媒体发布物料，只输出 JSON {title:string,titleOptions:string[],description:string,hashtags:string[]}，titleOptions提供两个备选标题。忠实于故事，不虚构互动数据。标签不要带#。",
            },
            {
              role: "user",
              content: JSON.stringify({
                platform: platforms[platform],
                direction: c.templateSnapshot.publishingDirection,
                pages: c.pages.map((p) => ({
                  action: p.action,
                  dialogue: p.dialogue,
                })),
                theme: c.settings.theme,
                instruction: direction || instruction || undefined,
              }),
            },
          ],
        },
        signal
      );
      const v = parseObject(r.text);
      if (
        typeof v.title !== "string" ||
        typeof v.description !== "string" ||
        !Array.isArray(v.hashtags) ||
        v.hashtags.some((t: unknown) => typeof t !== "string")
      )
        throw new Error("文案格式无效，请重试");
      const latest = store.currentComic(workId!)!.content;
      if (
        latest.currentRevisionId !== base.currentRevisionId ||
        JSON.stringify(latest.publishing[platform]) !==
          JSON.stringify(base.publishing[platform])
      )
        throw new Error("作品或文案已有新修改，本次结果未覆盖");
      const previous = latest.publishing[platform];
      const next: PublishingDraft = previous ?? {
        platform,
        sourceRevisionId: base.currentRevisionId,
        title: "",
        description: "",
        hashtags: [],
        covers: base.pages.flatMap((p) => (p.image ? [p.image] : [])),
        coverText: doc!.title,
        selectedCover: 0,
        imageOrder: base.pages.map((p) => p.id),
        updatedAt: Date.now(),
      };
      write({
        ...latest,
        publishing: {
          ...latest.publishing,
          [platform]: {
            ...next,
            ...(field
              ? {
                  [field]: v[field],
                  ...(field === "title"
                    ? {
                        titleOptions: Array.isArray(v.titleOptions)
                          ? v.titleOptions
                              .filter((t: unknown) => typeof t === "string")
                              .slice(0, 3)
                          : [],
                      }
                    : {}),
                }
              : {
                  title: v.title,
                  description: v.description,
                  hashtags: v.hashtags,
                  titleOptions: Array.isArray(v.titleOptions)
                    ? v.titleOptions
                        .filter((t: unknown) => typeof t === "string")
                        .slice(0, 3)
                    : [],
                }),
            sourceRevisionId: base.currentRevisionId,
            updatedAt: Date.now(),
          },
        },
      });
      if (withCover) await drawCover(signal);
      setInstruction("");
    });
  }
  function copyText(value: string) {
    void (native ? writeText(value) : navigator.clipboard.writeText(value))
      .then(() => message.success("已复制"))
      .catch(report);
  }
  function patchDraft(patch: Partial<PublishingDraft>) {
    if (!c) return;
    const base = draft ?? {
      platform,
      sourceRevisionId: c.currentRevisionId,
      title: doc!.title,
      description: "",
      hashtags: [],
      covers: c.pages.flatMap((p) => (p.image ? [p.image] : [])),
      coverText: doc!.title,
      selectedCover: 0,
      imageOrder: c.pages.map((p) => p.id),
      updatedAt: Date.now(),
    };
    write({
      ...c,
      publishing: {
        ...c.publishing,
        [platform]: { ...base, ...patch, updatedAt: Date.now() },
      },
    });
  }
  const nodes =
    (view === "history" ? revision?.pages : c?.pages)?.map((page, i) => ({
      id: page.id,
      type: "comic",
      initialWidth: 300,
      initialHeight:
        300 *
          (() => {
            const ratio =
              (view === "history"
                ? revision?.settings.ratio
                : c?.settings.ratio) ?? "3:4";
            const [width, height] = ratio.split(":").map(Number);
            return height / width;
          })() +
        50,
      position: { x: i * 340, y: 0 },
      data: {
        dialogueStyle: c?.templateSnapshot.dialogueStyle,
        page,
        ratio:
          (view === "history" ? revision?.settings.ratio : c?.settings.ratio) ??
          "3:4",
      },
      selected: page.id === selected,
      draggable: false,
    })) ?? [];
  const filtered = (view === "featured" ? featured : templates).filter(
    (t) =>
      (category === "全部" || t.category === category) &&
      (view !== "featured" ||
        `${t.title}${t.summary}${t.category}`.includes(feedSearch.trim()))
  );
  const comparison = compareCurrent
    ? c
    : c?.history.find((h) => h.id === revision?.parentId);
  const changes =
    revision?.pages.flatMap((p, i) => {
      const before =
        comparison?.pages.find((v) => v.id === p.id) ?? comparison?.pages[i];
      const items = (["action", "dialogue", "image"] as const).filter(
        (key) => JSON.stringify(p[key]) !== JSON.stringify(before?.[key])
      );
      return items.map((key) => ({
        label: `第 ${i + 1} 张 · ${
          key === "action" ? "剧情" : key === "dialogue" ? "对白" : "画面"
        }`,
        before:
          key === "image"
            ? before?.image
              ? "已有画面"
              : "尚未绘制"
            : before?.[key] || "—",
        after:
          key === "image"
            ? p.image
              ? "已更新画面"
              : "尚未绘制"
            : p[key] || "—",
      }));
    }) ?? [];
  return (
    <div className="comic-app">
      {!collapsed && (
        <aside className="comic-nav">
          <header>
            <span className="comic-mark">
              <ComicIcon />
            </span>
            <strong>小漫画</strong>

            <Button
              type="text"
              size="small"
              aria-label="收起导航"
              icon={<MenuFoldOutlined />}
              onClick={() => setCollapsed(true)}
            />
          </header>
          <div className="comic-nav-actions">
            <button
              className={view === "create" ? "active" : ""}
              onClick={() => setView("create")}
            >
              <EditOutlined /> 创建作品
            </button>
            <button
              className={view === "featured" ? "active" : ""}
              onClick={() => setView("featured")}
            >
              <FireOutlined /> 爆款作品
            </button>
          </div>
          <small className="comic-nav-label">我的作品</small>
          <div className="comic-work-list">
            {store.comicList().map((w) => (
              <div
                key={w.id}
                className={`comic-work ${
                  workId === w.id && !["create", "featured"].includes(view)
                    ? "active"
                    : ""
                }`}
              >
                <button onClick={() => void open(w.id)}>
                  {w.favorite ? "★" : "▤"} {w.title}
                </button>
                <Dropdown
                  menu={{
                    items: [
                      { key: "rename", label: "重命名" },
                      {
                        key: "favorite",
                        label: w.favorite ? "取消常用" : "设为常用",
                      },
                      { key: "export", label: "导出作品数据" },
                    ],
                    onClick: async ({ key }) => {
                      await store.ensureComic(w.id);
                      if (key === "rename") {
                        let title = w.title;
                        Modal.confirm({
                          title: "重命名作品",
                          content: (
                            <Input
                              defaultValue={title}
                              onChange={(e) => (title = e.target.value)}
                            />
                          ),
                          onOk: () => {
                            store.stageComic(w.id, { title });
                          },
                        });
                      } else if (key === "favorite")
                        store.stageComic(w.id, { favorite: !w.favorite });
                      else void store.exportComic(w.id)?.catch(report);
                    },
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    aria-label="作品菜单"
                    icon={<MoreOutlined />}
                  />
                </Dropdown>
              </div>
            ))}
            {!store.comicList().length && <small>暂无</small>}
          </div>
        </aside>
      )}
      <main className="comic-main">
        <header className="comic-header">
          <div>
            {collapsed && (
              <Button
                type="text"
                aria-label="展开导航"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setCollapsed(false)}
              />
            )}
            <strong>
              {view === "create"
                ? "创建作品"
                : view === "featured"
                ? "爆款作品"
                : doc?.title ?? "小漫画"}
            </strong>
          </div>
          {c && !["create", "featured"].includes(view) && (
            <>
              <nav>
                {(["settings", "edit", "history"] as const).map((v, i) => (
                  <button
                    key={v}
                    className={view === v ? "active" : ""}
                    onClick={() => {
                      setView(v);
                      if (v === "settings")
                        setSettingsDraft(structuredClone(c.settings));
                    }}
                  >
                    {["制作故事", "漫画编辑", "历史版本"][i]}
                  </button>
                ))}
              </nav>
              <Button
                type={view === "publish" ? "primary" : "default"}
                onClick={() => setView("publish")}
                icon={<ArrowUpOutlined />}
              >
                发布
              </Button>
            </>
          )}
        </header>
        {(error || store.comicWarnings().length > 0) && (
          <Alert
            closable
            onClose={() => setError("")}
            type="error"
            title={error || store.comicWarnings().join("；")}
          />
        )}
        {doc && store.comicStatus(doc.id).startsWith("保存失败") && (
          <Alert
            type="error"
            title={store.comicStatus(doc.id)}
            action={
              <Button
                onClick={() => void store.flushComic(doc.id).catch(report)}
              >
                重试保存
              </Button>
            }
          />
        )}
        {busy && (
          <div className="comic-progress">
            <LoadingOutlined />
            <span role="status">{stage}</span>
            <Button size="small" onClick={() => abort.current?.abort()}>
              停止
            </Button>
          </div>
        )}
        {["create", "featured"].includes(view) && (
          <>
            <div
              className={`comic-gallery ${
                view === "create"
                  ? "comic-create-gallery"
                  : "comic-featured-gallery"
              }`}
            >
              {view === "featured" && (
                <Input.Search
                  className="comic-feed-search"
                  aria-label="搜索爆款作品"
                  placeholder="搜索作品、主题或风格…"
                  value={feedSearch}
                  onChange={(e) => setFeedSearch(e.target.value)}
                  allowClear
                />
              )}
              <div className="comic-hero">
                <h1>
                  {view === "create"
                    ? "一句话，画出你的故事"
                    : "发现值得借鉴的好故事"}
                </h1>
                <p>
                  {view === "create"
                    ? "从一个灵感开始，让故事变成漫画。"
                    : "默认精选示例 · 后续支持线上更新"}
                </p>
              </div>
              <div className="comic-filter">
                {view === "create" && (
                  <Button
                    size="small"
                    style={{ float: "right" }}
                    onClick={() =>
                      void refreshTemplates()
                        .then((t) => {
                          setTemplates(t);
                          void message.success("模板已更新");
                        })
                        .catch(report)
                    }
                  >
                    更新模板
                  </Button>
                )}
                <strong>
                  {view === "create" ? "选择一个故事模板" : "精选作品"}
                </strong>
                <div>
                  {[
                    "全部",
                    ...new Set(
                      (view === "featured" ? featured : templates).map(
                        (t) => t.category
                      )
                    ),
                  ].map((cat) => (
                    <button
                      className={cat === category ? "active" : ""}
                      key={cat}
                      onClick={() => setCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={`comic-template-grid ${
                  view === "featured" ? "comic-featured" : ""
                }`}
              >
                {filtered.map((t) => (
                  <article
                    key={t.templateId}
                    className={templateId === t.templateId ? "selected" : ""}
                  >
                    <button
                      className="comic-cover-button"
                      onClick={() => {
                        if (view === "featured") {
                          setPreview(t);
                          setPreviewPage(0);
                        } else useTemplate(t);
                      }}
                    >
                      <Picture
                        value={t.cover}
                        alt={t.title}
                        fit={view === "featured" ? "contain" : "cover"}
                      />
                    </button>
                    <div className="comic-template-copy">
                      <h3>{t.title}</h3>
                      <p>{t.summary}</p>
                      <footer>
                        <span>
                          <Tag>{t.category}</Tag>
                          <small>{t.defaultPages} 张</small>
                        </span>
                        <button
                          onClick={() => {
                            setPreview(t);
                            setPreviewPage(0);
                          }}
                        >
                          预览完整作品 →
                        </button>
                      </footer>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            {view === "create" && (
              <div className="comic-create-composer">
                <Input.TextArea
                  variant="borderless"
                  aria-label="故事主题"
                  placeholder="一只猫偷偷替主人上班，结果比主人做得还好……"
                  value={theme}
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  onChange={(e) => setTheme(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.ctrlKey || e.metaKey) &&
                      e.key === "Enter" &&
                      !e.nativeEvent.isComposing
                    )
                      void create();
                  }}
                />
                <div className="comic-composer-tools">
                  <Tag closable onClose={() => setTemplateId("")}>
                    模板：{template?.title ?? "请选择"}
                  </Tag>
                  <Select
                    aria-label="画面尺寸"
                    value={ratio}
                    onChange={setRatio}
                    options={["3:4", "9:16", "1:1", "4:3"].map((v) => ({
                      value: v,
                      label: `尺寸 ${v}`,
                    }))}
                  />
                  <Select
                    aria-label="漫画张数"
                    value={count}
                    onChange={(value) => {
                      countChosen.current = true;
                      setCount(value);
                    }}
                    options={[4, 6, 8].map((v) => ({
                      value: v,
                      label: `张数 ${v} 张`,
                    }))}
                  />
                  <Button type="text" onClick={() => setMore(true)}>
                    更多设置
                  </Button>
                  <Button
                    className="comic-send"
                    shape="circle"
                    type="primary"
                    aria-label="开始创作"
                    icon={<SendOutlined />}
                    disabled={busy || !theme.trim() || !template}
                    onClick={() => void create()}
                  />
                </div>
              </div>
            )}
          </>
        )}
        {view === "edit" && c && (
          <div className="comic-editor">
            <div className="comic-flow">
              <div className="comic-canvas-tools">
                <Button
                  onClick={() =>
                    void task((signal) => generateStory(workId!, signal))
                  }
                  disabled={busy}
                >
                  生成故事
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void task((signal) => drawPages(workId!, signal))
                  }
                >
                  继续绘制
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => void exportWork(c, doc!.title).catch(report)}
                >
                  导出
                </Button>
                <small>{c.job?.stage}</small>
              </div>
              <ReactFlow
                key={workId}
                nodes={nodes}
                nodeTypes={nodeTypes}
                edges={[]}
                onNodeClick={(_, n) => setSelected(n.id)}
                onPaneClick={() => setSelected(undefined)}
                nodesConnectable={false}
                nodesDraggable={false}
                defaultViewport={{ x: 40, y: 80, zoom: 0.85 }}
                minZoom={0.3}
                maxZoom={1.5}
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Horizontal}
                zoomOnScroll={false}
              >
                <Background gap={24} color="#d5e4e0" />
                <Controls showInteractive={false} />
              </ReactFlow>
              <div className="comic-floating-composer">
                <Tag
                  closable={!!selected}
                  onClose={() => setSelected(undefined)}
                >
                  {currentPage ? `调整 ${currentPage.title}` : "调整整篇作品"}
                </Tag>
                <Input
                  variant="borderless"
                  aria-label="修改要求"
                  value={instruction}
                  placeholder="说说你想怎么改……"
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <Button
                  shape="circle"
                  type="primary"
                  icon={<SendOutlined />}
                  aria-label="发送修改要求"
                  disabled={busy || !instruction.trim()}
                  onClick={() => void adjust()}
                />
              </div>
            </div>
            {currentPage && (
              <aside className="comic-inspector">
                <header>
                  <strong>调整 {currentPage.title}</strong>
                  <Button
                    type="text"
                    aria-label="关闭配置栏"
                    icon={<CloseOutlined />}
                    onClick={() => setSelected(undefined)}
                  />
                </header>
                <label>
                  本张剧情
                  <Input.TextArea
                    value={currentPage.action}
                    onChange={(e) => editPage({ action: e.target.value })}
                    onBlur={() =>
                      save(store.currentComic(workId!)!.content, "修改分镜")
                    }
                    autoSize={{ minRows: 3, maxRows: 6 }}
                  />
                </label>
                <label>角色与场景</label>
                {c.settings.entities.map((e) => (
                  <div className="comic-entity" key={e.id}>
                    <span>{e.name}</span>
                    <small>{e.locked ? "已锁定" : "可调整"}</small>
                  </div>
                ))}
                <Button
                  type="primary"
                  block
                  disabled={busy}
                  onClick={() =>
                    void task((signal) =>
                      drawPages(workId!, signal, [selected!])
                    )
                  }
                >
                  重新绘制本张
                </Button>
                <label>
                  修改范围
                  <Select
                    value={scope}
                    onChange={setScope}
                    style={{ width: "100%" }}
                    options={[
                      { value: "page", label: "仅本张" },
                      { value: "related", label: "同步相关角色 / 场景的页面" },
                    ]}
                  />
                </label>
                <label>快捷调整</label>
                <div className="comic-quick">
                  {["表情更夸张", "镜头拉近", "画面更简洁", "换个构图"].map(
                    (t) => (
                      <Button key={t} onClick={() => setInstruction(t)}>
                        {t}
                      </Button>
                    )
                  )}
                </div>
                <label>
                  对白
                  <Input.TextArea
                    value={currentPage.dialogue}
                    onChange={(e) => editPage({ dialogue: e.target.value })}
                    onBlur={() =>
                      save(store.currentComic(workId!)!.content, "修改对白")
                    }
                    autoSize={{ minRows: 3, maxRows: 6 }}
                  />
                </label>
                <small>
                  台词会融入画面构图，修改后需重绘以更新图中的文字。
                </small>
                <Button
                  block
                  disabled={busy}
                  onClick={() =>
                    void task((signal) =>
                      drawPages(workId!, signal, [selected!])
                    )
                  }
                >
                  应用对白并重绘
                </Button>
                <small>点击画布空白处收起</small>
              </aside>
            )}
          </div>
        )}
        {view === "settings" && c && settingsDraft && (
          <ComicSettings
            value={preparingId === workId ? c.settings : settingsDraft}
            preparing={preparingId === workId}
            activeAssetId={preparingId === workId ? assetId : undefined}
            onContinue={() =>
              void task((signal) => prepareStory(workId!, signal))
            }
            canContinue={!busy && !c.pages.every((p) => p.status === "ready")}
            pages={c.pages}
            onChange={setSettingsDraft}
            onCancel={() => {
              setSettingsDraft(structuredClone(c.settings));
              setView("edit");
            }}
            onEditStory={() => {
              setView("edit");
              setSelected(undefined);
              setInstruction("调整故事走向：");
            }}
            onSave={() => {
              const styleChanged = c.settings.style !== settingsDraft.style;
              save(
                {
                  ...c,
                  settings: {
                    ...settingsDraft,
                    entities: settingsDraft.entities.map((e) =>
                      styleChanged ? { ...e, reference: undefined } : e
                    ),
                  },
                  pages: Array.from({ length: settingsDraft.count }, (_, i) =>
                    c.pages[i]
                      ? { ...c.pages[i], status: "draft" as const }
                      : {
                          id: crypto.randomUUID(),
                          title: `第 ${i + 1} 张`,
                          action: "请生成故事以补全这一张",
                          dialogue: "",
                          state: "",
                          entityIds: [],
                          status: "draft" as const,
                        }
                  ),
                },
                "更新作品设定"
              );
              void message.success("作品设定已保存");
            }}
          />
        )}
        {view === "history" && c && (
          <div className="comic-history">
            <aside>
              <div className="comic-version-heading">
                <h3>版本记录</h3>
                <Select
                  size="small"
                  aria-label="筛选历史版本"
                  value={historyFilter}
                  onChange={setHistoryFilter}
                  options={["全部版本", "生成与绘制", "手动修改"].map(
                    (value) => ({ value, label: value })
                  )}
                />
              </div>
              <p className="comic-muted">每次生成与修改都会保留记录</p>
              {[...c.history]
                .reverse()
                .filter(
                  (h) =>
                    historyFilter === "全部版本" ||
                    (historyFilter === "生成与绘制"
                      ? /生成|绘制|资产/.test(h.title)
                      : !/生成|绘制|资产/.test(h.title))
                )
                .map((h) => (
                  <button
                    className={revision?.id === h.id ? "active" : ""}
                    key={h.id}
                    onClick={() => setHistoryId(h.id)}
                  >
                    <strong>
                      V{c.history.findIndex((v) => v.id === h.id) + 1} ·{" "}
                      {h.title}{" "}
                      {h.id === c.currentRevisionId && (
                        <Tag color="green">当前</Tag>
                      )}
                    </strong>
                    <small>{new Date(h.createdAt).toLocaleString()}</small>
                  </button>
                ))}
              {!c.history.length && <p>还没有版本记录</p>}
            </aside>
            <div className="comic-history-preview">
              {revision && (
                <>
                  <header>
                    <div>
                      <h3>
                        V{c.history.findIndex((v) => v.id === revision.id) + 1}{" "}
                        · {revision.title} <Tag>只读预览</Tag>
                      </h3>
                      <small>
                        只读预览 · 与当前版本相比，
                        {
                          revision.pages.filter(
                            (p, i) =>
                              JSON.stringify(p) !== JSON.stringify(c.pages[i])
                          ).length
                        }{" "}
                        张有变化
                        {JSON.stringify(revision.settings) !==
                        JSON.stringify(c.settings)
                          ? " · 设定有变化"
                          : ""}{" "}
                        · 恢复后保留当前版本
                      </small>
                    </div>
                    <div className="comic-history-actions">
                      <Button onClick={() => setCompareCurrent((v) => !v)}>
                        {compareCurrent ? "查看本次修改" : "与当前版本对比"}
                      </Button>
                      <Button
                        disabled={revision.id === c.currentRevisionId}
                        type="primary"
                        onClick={() => {
                          write(
                            checkpoint(c, "恢复历史版本", revision, revision.id)
                          );
                          setHistoryId(undefined);
                        }}
                      >
                        恢复此版本
                      </Button>
                    </div>
                  </header>
                  <ReactFlow
                    nodes={nodes}
                    nodeTypes={nodeTypes}
                    edges={[]}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    defaultViewport={{ x: 24, y: 36, zoom: 0.75 }}
                    panOnScroll
                    panOnScrollMode={PanOnScrollMode.Horizontal}
                    zoomOnScroll={false}
                  >
                    <Background />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                  <section className="comic-history-diff">
                    <h3>{compareCurrent ? "与当前版本对比" : "本次修改"}</h3>
                    {changes.length ? (
                      changes.map((change, i) => (
                        <div className="comic-diff-row" key={i}>
                          <strong>{change.label}</strong>
                          <p>
                            <span>
                              {compareCurrent ? "当前：" : "修改前："}
                            </span>
                            {change.before}
                          </p>
                          <p>
                            <span>
                              {compareCurrent ? "所选：" : "修改后："}
                            </span>
                            {change.after}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="comic-muted">画面与剧情没有变化。</p>
                    )}
                    {JSON.stringify(comparison?.settings) !==
                      JSON.stringify(revision.settings) && (
                      <div className="comic-diff-row">
                        <strong>作品设定</strong>
                        <p>
                          <span>主题：</span>
                          {comparison?.settings.theme ?? "—"} →{" "}
                          {revision.settings.theme}
                        </p>
                        <p>
                          <span>画风：</span>
                          {comparison?.settings.style ?? "—"} →{" "}
                          {revision.settings.style}
                        </p>
                        <p>
                          <span>比例 / 张数：</span>
                          {comparison?.settings.ratio ?? "—"} /{" "}
                          {comparison?.settings.count ?? 0} →{" "}
                          {revision.settings.ratio} / {revision.settings.count}
                        </p>
                        <p>
                          <span>资产：</span>
                          {revision.settings.entities
                            .map((e) => `${e.name}（${e.description}）`)
                            .join("；")}
                        </p>
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        )}
        {view === "publish" && c && (
          <div className="comic-publish">
            <div className="comic-publish-heading">
              <div>
                <h2>发布物料</h2>
                <p>为不同平台准备封面和文案</p>
              </div>
              <div>
                {(Object.keys(platforms) as Platform[]).map((p) => (
                  <Button
                    key={p}
                    type={p === platform ? "primary" : "default"}
                    onClick={() => setPlatform(p)}
                  >
                    <span className={`comic-platform-icon ${p}`}>
                      {p === "xiaohongshu" ? "红" : p === "douyin" ? "♪" : "∞"}
                    </span>
                    {platforms[p]}
                  </Button>
                ))}
              </div>
              <Button
                disabled={busy}
                onClick={() => void generatePublishing(undefined, true)}
              >
                一键生成物料
              </Button>
            </div>
            {!draft && (
              <p className="comic-publish-empty">
                点击「一键生成物料」准备封面和文案，也可以分别生成或手动填写。
              </p>
            )}
            {draft && draft.sourceRevisionId !== c.currentRevisionId && (
              <Alert
                type="warning"
                title="作品已更新，这份物料基于历史内容，请检查或重新生成"
              />
            )}
            <div className="comic-publish-grid">
              <section>
                <div className="comic-section-heading">
                  <h3>封面</h3>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => void generateCover()}
                  >
                    重新生成
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setInstruction("调整封面：");
                      document
                        .getElementById("comic-publish-instruction")
                        ?.focus();
                    }}
                  >
                    编辑封面
                  </Button>
                </div>
                <div className="comic-publish-cover">
                  <Picture value={draft?.covers[draft.selectedCover]} />
                  {draft && <strong>{draft.coverText}</strong>}
                </div>
                <div className="comic-cover-choices">
                  {(draft?.covers ?? []).map((image, i) => (
                    <button
                      aria-label={`选择封面 ${i + 1}`}
                      key={i}
                      className={i === draft?.selectedCover ? "active" : ""}
                      onClick={() => patchDraft({ selectedCover: i })}
                    >
                      <Picture value={image} />
                    </button>
                  ))}
                </div>
                <label>
                  封面文字
                  <Input
                    value={draft?.coverText ?? ""}
                    onChange={(e) => patchDraft({ coverText: e.target.value })}
                  />
                </label>
                <small>输入封面调整要求后，点击「重新生成」。</small>
              </section>
              <section>
                {(["title", "description", "hashtags"] as const).map(
                  (field, i) => (
                    <label key={field}>
                      <span>
                        {["标题", "描述", "话题标签"][i]}
                        <Button
                          type="text"
                          size="small"
                          disabled={busy}
                          onClick={() => void generatePublishing(field)}
                        >
                          重新生成
                        </Button>
                      </span>
                      {field === "description" ? (
                        <Input.TextArea
                          aria-label="发布描述"
                          value={draft?.description ?? ""}
                          rows={4}
                          onChange={(e) =>
                            patchDraft({ description: e.target.value })
                          }
                        />
                      ) : field === "hashtags" ? (
                        <Select
                          mode="tags"
                          aria-label="话题标签"
                          className="comic-publish-tags"
                          value={draft?.hashtags ?? []}
                          tokenSeparators={[" ", ",", "，"]}
                          placeholder="+ 添加话题"
                          onChange={(hashtags) =>
                            patchDraft({
                              hashtags: hashtags
                                .map((t) => t.replace(/^#+/, ""))
                                .filter(Boolean),
                            })
                          }
                          options={(draft?.hashtags ?? []).map((value) => ({
                            value,
                            label: `#${value}`,
                          }))}
                        />
                      ) : (
                        <Input
                          aria-label="发布标题"
                          value={draft?.title ?? ""}
                          onChange={(e) =>
                            patchDraft({ title: e.target.value })
                          }
                        />
                      )}
                      {field === "title" && !!draft?.titleOptions?.length && (
                        <div className="comic-title-options">
                          {draft.titleOptions.map((title) => (
                            <Button
                              key={title}
                              size="small"
                              onClick={() => patchDraft({ title })}
                            >
                              {title}
                            </Button>
                          ))}
                        </div>
                      )}
                      {field === "description" && (
                        <div className="comic-copy-actions">
                          {["更简短", "更有趣", "更温暖"].map((direction) => (
                            <Button
                              key={direction}
                              size="small"
                              disabled={busy}
                              onClick={() =>
                                void generatePublishing(
                                  "description",
                                  false,
                                  direction
                                )
                              }
                            >
                              {direction}
                            </Button>
                          ))}
                          <Button
                            size="small"
                            type="text"
                            icon={<CopyOutlined />}
                            aria-label="复制描述"
                            onClick={() => copyText(draft?.description ?? "")}
                          />
                        </div>
                      )}
                    </label>
                  )
                )}
                <label className="comic-publish-adjust">
                  一句话调整
                  <Input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    id="comic-publish-instruction"
                    placeholder="把文案改得更轻松，保留封面"
                    suffix={
                      <Button
                        type="text"
                        icon={<SendOutlined />}
                        aria-label="调整发布文案"
                        disabled={busy || !instruction.trim()}
                        onClick={() => void generatePublishing()}
                      />
                    }
                  />
                </label>
                <h3>发布图片</h3>
                <div className="comic-publish-order">
                  {(draft?.imageOrder ?? c.pages.map((p) => p.id)).map(
                    (id, i) => {
                      const p = c.pages.find((p) => p.id === id);
                      return (
                        p && (
                          <div key={id}>
                            <Picture value={p.image} />
                            <Button
                              size="small"
                              disabled={i === 0}
                              onClick={() => {
                                const order = [
                                  ...(draft?.imageOrder ??
                                    c.pages.map((p) => p.id)),
                                ];
                                [order[i - 1], order[i]] = [
                                  order[i],
                                  order[i - 1],
                                ];
                                patchDraft({ imageOrder: order });
                              }}
                            >
                              前移
                            </Button>
                          </div>
                        )
                      );
                    }
                  )}
                </div>
              </section>
            </div>
            <footer>
              <small>{platforms[platform]} · 本地草稿</small>
              <Button
                onClick={() => {
                  void (
                    native
                      ? writeText
                      : navigator.clipboard.writeText.bind(navigator.clipboard)
                  )(
                    `${draft?.title ?? ""}\n\n${draft?.description ?? ""}\n\n${
                      draft?.hashtags.map((t) => "#" + t).join(" ") ?? ""
                    }`
                  )
                    .then(() => message.success("已复制"))
                    .catch(report);
                }}
              >
                复制文案
              </Button>
              <Button
                type="primary"
                disabled={!draft}
                onClick={() =>
                  void exportWork(c, doc!.title, platform).catch(report)
                }
              >
                导出发布物料
              </Button>
            </footer>
          </div>
        )}
      </main>
      <Modal
        title={preview?.title}
        open={!!preview}
        width={1000}
        footer={null}
        onCancel={() => setPreview(undefined)}
      >
        {preview && (
          <div className="comic-preview">
            <div>
              <div className="comic-preview-frame">
                <Picture
                  value={preview.example[previewPage]?.image}
                  fit="contain"
                />
              </div>
              <div className="comic-preview-pages">
                <Button
                  disabled={!previewPage}
                  onClick={() => setPreviewPage((p) => p - 1)}
                >
                  上一张
                </Button>
                <span>
                  {previewPage + 1} / {preview.example.length}
                </span>
                <Button
                  disabled={previewPage === preview.example.length - 1}
                  onClick={() => setPreviewPage((p) => p + 1)}
                >
                  下一张
                </Button>
              </div>
            </div>
            <aside>
              <h3>完整作品</h3>
              <p>{preview.summary}</p>
              <Tag>{preview.category}</Tag>
              <h3>故事节奏</h3>
              {preview.beats.map((b, i) => (
                <p key={i}>
                  <Tag>{i + 1}</Tag>
                  {b}
                </p>
              ))}
              <Button type="primary" block onClick={() => useTemplate(preview)}>
                用这个结构创作
              </Button>
              <Button
                block
                style={{ marginTop: 12 }}
                onClick={() => {
                  useTemplate(preview);
                  if (!theme.trim()) setTheme(preview.summary);
                }}
              >
                使用这个画风
              </Button>
              <Button
                block
                style={{ marginTop: 12 }}
                onClick={async () => {
                  const t = preview;
                  useTemplate(t);
                  let data = instantiate(t, t.summary, t.defaultPages, "3:4");
                  data.settings.entities = structuredClone(t.entities);
                  data.pages = structuredClone(t.example);
                  data = checkpoint(data, "从示例创建");
                  const d = await store.createComic(data);
                  store.stageComic(d.id, { title: t.title });
                  await store.flushComic(d.id);
                  setWorkId(d.id);
                  setView("edit");
                }}
              >
                复制示例开始编辑
              </Button>
            </aside>
          </div>
        )}
      </Modal>
      <Modal
        title="更多设置"
        open={more}
        onCancel={() => setMore(false)}
        onOk={() => setMore(false)}
      >
        <label>
          语气
          <Select
            value={tone}
            style={{ width: "100%", marginBottom: 20 }}
            onChange={setTone}
            options={["跟随模板", "轻松搞笑", "温暖治愈", "简洁科普"].map(
              (value) => ({ value, label: value })
            )}
          />
        </label>
        <label>
          结尾偏好
          <Input value={ending} onChange={(e) => setEnding(e.target.value)} />
        </label>
        <p>
          AI 使用 WorkStore 全局默认服务。爆款数据源：
          {feedConfig.mode === "builtin" ? "默认示例" : "线上数据"}。
        </p>
      </Modal>
    </div>
  );
}
