import { recordToolOpen } from "./navigation";
import { stopAiRequests } from "./ai/client";
import { AiAssistantButton } from "./ai/AiAssistant";
import AiSettings from "./ai/AiSettings";
import UpdateButton from "./UpdateButton";
import { isInstallingUpdate } from "./updateService";
import React, { useEffect, useState, useRef, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Dropdown,
  Input,
  Modal,
  Segmented,
  Switch,
  Tooltip,
} from "antd";
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  DownOutlined,
  FileTextOutlined,
  FolderOutlined,
  GithubOutlined,
  LinkOutlined,
  MoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SettingOutlined,
  StarOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  LockOutlined,
  ExportOutlined,
  ExperimentOutlined,
  FormatPainterOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import "./style.css";
import ComicIcon from "./comics/ComicIcon";
import WhiteboardIcon from "./whiteboard/WhiteboardIcon";
import { flushDocuments, registerDocumentFlusher } from "./documentLifecycle";
import { flushSync } from "react-dom";
const Whiteboard = lazy(() => import("./whiteboard/Whiteboard"));
const ComicApp = lazy(() => import("./comics/ComicApp"));
const HtmlApp = lazy(() => import("./html/HtmlApp"));
const DocumentApp = lazy(() => import("./documents/DocumentApp"));
import {
  native,
  loadWorkspace,
  saveWorkspace,
  relocateWorkspace,
  syncWorkspace,
  startBackgroundSync,
  registerSyncRefresher,
  scheduleAutosync,
  type WorkspaceData,
} from "./workspace";
import { open as chooseDirectory } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Tool = {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: React.ReactNode;
  status?: "dev";
};
const tools: Tool[] = [
  { id: "app.html", name: "HTML", description: "把内容变成精美的网页、卡片与演示。", category: "设计工具", color: "green", icon: <GlobalOutlined /> },
  { id: "app.comic", name: "小漫画", description: "一句话，画出你的故事。", category: "设计工具", color: "green", icon: <ComicIcon /> },
  {
    id: "app.project",
    name: "项目",
    description: "让目标、任务与进展，井然有序。",
    category: "效率办公",
    color: "blue",
    icon: <FolderOutlined />,
    status: "dev",
  },
  {
    id: "app.doc",
    name: "笔记",
    description: "记录值得留下的每一个想法。",
    category: "效率办公",
    color: "orange",
    icon: <FileTextOutlined />,
  },
  {
    id: "app.whiteboard",
    name: "白板",
    description: "自由绘图，让想法清晰可见。",
    category: "效率办公",
    color: "green",
    icon: <WhiteboardIcon />,
  },
  {
    id: "tool.color",
    name: "色彩拾取",
    description: "找到下一份作品的灵感色彩。",
    category: "设计工具",
    color: "pink",
    icon: <FormatPainterOutlined />,
  },
  {
    id: "web.github",
    name: "GitHub",
    description: "打开代码与协作的世界。",
    category: "Web 工具",
    color: "gray",
    icon: <GithubOutlined />,
  },
];
// Temporarily hidden; retain registration and saved entries for restoration.
const hiddenTools = new Set(["app.html", "tool.json", "tool.color", "web.github"]);
const visibleTools = tools.filter((tool) => !hiddenTools.has(tool.id));
type Entry = {
  id: string;
  favorite: boolean;
  rank: number;
  lastOpened: number | null;
};
const initial: Entry[] = ["app.project", "app.doc"].map(
  (id, rank) => ({ id, favorite: true, rank, lastOpened: null }),
);
function restore(): Entry[] {
  if (native) return initial;
  try {
    const a = JSON.parse(
      localStorage.getItem("workstore.preview.tools") || "null",
    );
    if (Array.isArray(a))
      return a.filter(
        (e: Entry, i: number) =>
          tools.some((t) => t.id === e.id) &&
          a.findIndex((x: Entry) => x.id === e.id) === i,
      );
  } catch {}
  return initial;
}
function ToolIcon({ tool, large = false }: { tool: Tool; large?: boolean }) {
  return (
    <span className={`tool-icon ${tool.color} ${large ? "large" : ""} ${tool.id === "app.whiteboard" ? "whiteboard-tool-icon" : tool.id === "app.comic" ? "comic-tool-icon" : ""}`}>
      {tool.icon}
    </span>
  );
}
function ToolHeader({
  tool,
  tabs,
  actions,
}: {
  tool: Tool;
  tabs?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className={`tool-heading ${tabs ? "has-tabs" : ""}`}>
      <div className="tool-title">
        <ToolIcon tool={tool} />
        <div className="tool-title-copy">
          <h2>{tool.name}</h2>

        </div>
      </div>
      {tabs && (
        <nav className="tool-tabs" aria-label="工具页面">
          {tabs}
        </nav>
      )}
      <div className="tool-actions"><AiAssistantButton toolId={tool.id} />{actions}</div>
    </header>
  );
}

function WorkStore() {
  const [htmlOpened, setHtmlOpened] = useState(false);
  const { message } = AntApp.useApp();
  const [entries, setEntries] = useState<Entry[]>(restore),
    [active, setActive] = useState("app.project"),
    [collapsed, setCollapsed] = useState(false),
    [catalog, setCatalog] = useState(false),
    [settings, setSettings] = useState(false),
    [category, setCategory] = useState("全部工具"),
    [dragging, setDragging] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general"),
    [path, setPath] = useState("~/WorkStore"),
    [json, setJson] = useState('{"hello":"WorkStore","local":true}'),
    [color, setColor] = useState("#28796B"),
    [stamp, setStamp] = useState("1789257600");
  const [maximizeOnStart, setMaximizeOnStart] = useState(true);
  const [githubSyncEnabled, setGithubSyncEnabled] = useState(false);
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [githubSyncBranch, setGithubSyncBranch] = useState("main");
  const [githubToken, setGithubToken] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [ready, setReady] = useState(!native),
    [loadError, setLoadError] = useState(""),
    [saveStatus, setSaveStatus] = useState(""),
    [migrating, setMigrating] = useState(false);
  useEffect(() => {
    if (!native) return;
    invoke<{
      maximizeOnStart: boolean;
      githubSyncEnabled: boolean;
      githubRepoUrl: string;
      githubSyncBranch: string;
      githubToken: string;
    }>("load_preferences")
      .then((preferences) => {
        setMaximizeOnStart(preferences.maximizeOnStart);
        setGithubSyncEnabled(preferences.githubSyncEnabled);
        setGithubRepoUrl(preferences.githubRepoUrl);
        setGithubSyncBranch(preferences.githubSyncBranch);
        setGithubToken(preferences.githubToken);
        setPreferencesReady(true);
      })
      .catch((error) => message.error("读取启动配置失败：" + String(error)));
  }, []);
  const syncNow = async () => {
    if (!native) return;
    setSyncing(true);
    setSyncStatus("");
    try {
      const status = await syncWorkspace("manual");
      setSyncStatus(status);
      message.success("同步完成");
    } catch (error) {
      const text = "同步失败：" + String(error);
      setSyncStatus(text);
      message.error(text);
    } finally {
      setSyncing(false);
    }
  };
  const savePreferences = async (next: {
    maximizeOnStart: boolean;
    githubSyncEnabled: boolean;
    githubRepoUrl: string;
    githubSyncBranch: string;
    githubToken: string;
  }, notify = false) => {
    setSavingPreferences(true);
    try {
      await invoke("save_preferences", { preferences: next });
      setMaximizeOnStart(next.maximizeOnStart);
      setGithubSyncEnabled(next.githubSyncEnabled);
      setGithubRepoUrl(next.githubRepoUrl);
      setGithubSyncBranch(next.githubSyncBranch);
      setGithubToken(next.githubToken);
      scheduleAutosync();
      if (notify) message.success("设置已保存");
    } catch (error) {
      message.error("保存启动配置失败：" + String(error));
    } finally {
      setSavingPreferences(false);
    }
  };
  const changeMaximizeOnStart = (checked: boolean) => {
    void savePreferences({
      maximizeOnStart: checked,
      githubSyncEnabled,
      githubRepoUrl,
      githubSyncBranch,
      githubToken,
    }, true);
  };
  const applySyncPreferences = (patch: {
    githubSyncEnabled?: boolean;
    githubRepoUrl?: string;
    githubSyncBranch?: string;
    githubToken?: string;
  }) => {
    void savePreferences({
      maximizeOnStart,
      githubSyncEnabled: patch.githubSyncEnabled ?? githubSyncEnabled,
      githubRepoUrl: patch.githubRepoUrl ?? githubRepoUrl,
      githubSyncBranch: patch.githubSyncBranch ?? githubSyncBranch,
      githubToken: patch.githubToken ?? githubToken,
    });
  };
  const changeSyncEnabled = (checked: boolean) => {
    setGithubSyncEnabled(checked);
    applySyncPreferences({ githubSyncEnabled: checked });
  };
  const changeSyncRepoUrl = (value: string) => {
    setGithubRepoUrl(value);
    applySyncPreferences({ githubRepoUrl: value });
  };
  const changeSyncBranch = (value: string) => {
    setGithubSyncBranch(value);
    applySyncPreferences({ githubSyncBranch: value });
  };
  const changeSyncToken = (value: string) => {
    setGithubToken(value);
    applySyncPreferences({ githubToken: value });
  };
  useEffect(() => {
    if (!native || !ready || !githubSyncEnabled) return;
    return startBackgroundSync(setSyncStatus);
  }, [ready, githubSyncEnabled]);
  const latest = useRef<WorkspaceData>({
    schemaVersion: 1,
    entries,
    json,
    color,
    stamp,
    collapsed,
  });
  latest.current = { schemaVersion: 1, entries, json, color, stamp, collapsed };
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef(0);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  useEffect(() => {
    if (!native || !ready) return;
    const removeFlush = registerDocumentFlusher(async () => {
      if (pending.current) { clearTimeout(pending.current); pending.current = null; }
      await saveWorkspace(latest.current);
    });
    const removeRefresh = registerSyncRefresher(async (changed) => {
      if (changed.length && !changed.includes("state.json")) return;
      if (pending.current) { clearTimeout(pending.current); pending.current = null; }
      const { data } = await loadWorkspace();
      latest.current = data;
      flushSync(() => {
        setEntries(data.entries); setJson(data.json); setColor(data.color);
        setStamp(data.stamp); setCollapsed(data.collapsed);
      });
    });
    return () => { removeFlush(); removeRefresh(); };
  }, [ready]);
  useEffect(() => {
    if (!native) return;
    let alive = true;
    loadWorkspace()
      .then(({ path, data }) => {
        if (!alive) return;
        setPath(path);
        setEntries(data.entries);
        setJson(data.json);
        setColor(data.color);
        setStamp(data.stamp);
        setCollapsed(data.collapsed);
        setReady(true);
      })
      .catch((e) => {
        if (alive) setLoadError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (!native) {
      localStorage.setItem("workstore.preview.tools", JSON.stringify(entries));
      return;
    }
    const revision = ++version.current;
    setSaveStatus("保存中…");
    pending.current = setTimeout(() => {
      saveWorkspace(latest.current)
        .then(() => {
          if (version.current === revision) setSaveStatus("已保存");
        })
        .catch((e) => {
          if (version.current === revision)
            setSaveStatus("保存失败：" + String(e));
        });
    }, 300);
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, [ready, entries, json, color, stamp, collapsed]);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (isInstallingUpdate()) { event.preventDefault(); return; }
        if (!readyRef.current) return;
        event.preventDefault();
        if (pending.current) clearTimeout(pending.current);
        try {
          await stopAiRequests();
          await flushDocuments();
          await saveWorkspace(latest.current);
          await getCurrentWindow().destroy();
        } catch (e) {
          message.error("保存失败，窗口暂未关闭：" + String(e));
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else remove = fn;
      });
    return () => {
      disposed = true;
      remove?.();
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen("workspace-quit", async () => {
      if (isInstallingUpdate()) return;
      try {
        if (readyRef.current) {
          if (pending.current) clearTimeout(pending.current);
          await stopAiRequests();
          await flushDocuments();
          await saveWorkspace(latest.current);
        }
        await invoke("quit_ready");
      } catch (e) {
        message.error("保存失败，暂未退出：" + String(e));
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const changeDirectory = async () => {
    try {
      const selected = await chooseDirectory({
        directory: true,
        multiple: false,
        title: "选择新的空工作目录",
      });
      if (typeof selected !== "string") return;
      setMigrating(true);
      await stopAiRequests();
      if (pending.current) clearTimeout(pending.current);
      await flushDocuments();
      await saveWorkspace(latest.current);
      const result = await relocateWorkspace(selected);
      setPath(result.path);
      setSaveStatus("已保存");
      message.success("工作目录已切换，原目录已保留");
    } catch (e) {
      message.error("切换失败：" + String(e));
    } finally {
      setMigrating(false);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest(".excalidraw"))
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCatalog((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const navigate = async (id: string) => {
    try {
      await flushDocuments();
      setActive(id);
    } catch (e) {
      message.error("文档尚未保存：" + String(e));
    }
  };
  const open = async (id: string) => {
    try {
      await flushDocuments();
    } catch (e) {
      message.error("文档尚未保存：" + String(e));
      return;
    }
    // Commit the recent entry before opening the tool, including before a close/sync flush.
    const openedAt = Date.now();
    flushSync(() => {
      setEntries((es) => recordToolOpen(es, id, openedAt));
    });
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    const revision = version.current;
    try {
      if (native) await saveWorkspace(latest.current);
      else localStorage.setItem("workstore.preview.tools", JSON.stringify(latest.current.entries));
      if (version.current === revision) setSaveStatus("已保存");
      setActive(id);
      setCatalog(false);
    } catch (e) {
      if (version.current === revision) setSaveStatus("保存失败：" + String(e));
      message.error("打开记录保存失败，请重试：" + String(e));
    }
  };

  const favorite = (id: string, value = true) => {
    setEntries((es) =>
      es.map((e) =>
        e.id === id
          ? {
              ...e,
              favorite: value,
              rank: Math.max(0, ...es.map((x) => x.rank)) + 1,
              lastOpened: e.lastOpened || Date.now(),
            }
          : e,
      ),
    );
    message.success(value ? "已添加到常用工具" : "已移到最近工具");
  };
  const favorites = entries
      .filter((e) => e.favorite && visibleTools.some((t) => t.id === e.id))
      .sort((a, b) => a.rank - b.rank),
    recent = entries
      .filter((e) => !e.favorite && e.lastOpened && visibleTools.some((t) => t.id === e.id))
      .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0) || a.id.localeCompare(b.id));
  const tool = tools.find((t) => t.id === active);
  useEffect(() => { if (active === "app.html") setHtmlOpened(true); }, [active]);
  const row = (entry: Entry) => {
    const t = tools.find((t) => t.id === entry.id)!;
    return (
      <div
        key={t.id}
        className={`nav-row ${active === t.id ? "selected" : ""}`}
      >
        <button
          className="nav-open"
          aria-label={t.name}
          onClick={() => open(t.id)}
          title={collapsed ? t.name : undefined}
        >
          <span
            className="nav-drag-handle"
            draggable={!entry.favorite}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", t.id);
              setDragging(true);
            }}
            onDragEnd={() => setDragging(false)}
          >
            <ToolIcon tool={t} />
          </span>
          <span>{t.name}</span>
          {t.status && <small>开发中</small>}
        </button>
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "favorite",
                icon: <StarOutlined />,
                label: entry.favorite ? "取消常用" : "设为常用",
              },
              {
                key: "delete",
                icon: <DeleteOutlined />,
                label: entry.favorite ? "从常用移除" : "删除记录",
              },
            ],
            onClick: ({ key }) => {
              if (key === "favorite") favorite(t.id, !entry.favorite);
              else if (entry.favorite) favorite(t.id, false);
              else {
                setEntries((es) => es.filter((e) => e.id !== t.id));
                if (active === t.id) void navigate("app.project");
              }
            },
          }}
        >
          <button className="more" aria-label={`${t.name}更多操作`}>
            <MoreOutlined />
          </button>
        </Dropdown>
      </div>
    );
  };
  if (!ready)
    return (
      <div className="startup">
        <h2>WorkStore</h2>
        <p>{loadError || "正在打开本地工作空间…"}</p>
        {loadError && (
          <Button onClick={() => window.location.reload()}>重试</Button>
        )}
      </div>
    );
  return (
    <div
      className={`shell ${collapsed ? "collapsed" : ""} ${native ? "native" : ""} ${navigator.platform.includes("Mac") ? "macos" : ""}`}
    >
      <aside className="workspace-sidebar">
        <div className="window-bar" data-tauri-drag-region>
          <div className="traffic" aria-label="macOS 窗口按钮外观示意">
            <i />
            <i />
            <i />
          </div>
          <div className="window-actions">
          <UpdateButton ready={ready} />
          <Tooltip title="设置">
            <button className="icon-button" aria-label="设置" onClick={() => setSettings(true)}><SettingOutlined /></button>
          </Tooltip>
          <Tooltip title={collapsed ? "展开导航" : "折叠导航"}>
            <button
              className="icon-button collapse-toggle navigation-toggle"
              aria-label={collapsed ? "展开导航" : "折叠导航"}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
          </Tooltip>
          </div>
        </div>
        <div className="brand-row">
          <button
            className="brand"
            aria-label="WorkStore 项目"
            onClick={() => void navigate("app.project")}
          >
            <img src="/workstore-icon.svg" />
            <span>WorkStore</span>
          </button>
          <Button
            className="open-tools"
            size="small"
            onClick={() => {
              setCatalog(true);
            }}
          >
            打开工具 <DownOutlined />
          </Button>
        </div>
        {collapsed && (
          <Tooltip title="打开工具" placement="right">
            <Button
              className="collapsed-add"
              aria-label="打开工具"
              icon={<PlusOutlined />}
              onClick={() => setCatalog(true)}
            />
          </Tooltip>
        )}
        <div className="nav-scroll">
          <div
            className={`nav-section ${dragging ? "drop-target" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (entries.some((x) => x.id === id)) favorite(id);
              setDragging(false);
            }}
          >
            {favorites.map(row)}
            {!favorites.length && !collapsed && (
              <p className="nav-empty">将最近工具拖到这里</p>
            )}
          </div>
          <div className="nav-section recent-section">
            <div className="section-label">
              <span>最近</span>
            </div>
            {recent.map(row)}
            {!recent.length && !collapsed && <p className="nav-empty">暂无</p>}
          </div>
        </div>
        <div className="sidebar-bottom">
          {native && !collapsed && saveStatus.startsWith("保存失败") && (
            <div
              role="status"
              className={`save-state ${saveStatus.startsWith("保存失败") ? "error" : ""}`}
            >
              {saveStatus}
              {saveStatus.startsWith("保存失败") && (
                <Button
                  type="link"
                  size="small"
                  onClick={() =>
                    saveWorkspace(latest.current)
                      .then(() => setSaveStatus("已保存"))
                      .catch((e) => setSaveStatus("保存失败：" + String(e)))
                  }
                >
                  重试
                </Button>
              )}
            </div>
          )}

        </div>
      </aside>
      <main className="workspace-main">
        {collapsed && (
          <header className="compact-tool-heading" data-tauri-drag-region>
            <button className="icon-button navigation-toggle" aria-label="展开主导航" aria-expanded={false}
              onClick={() => setCollapsed(false)}><MenuUnfoldOutlined /></button>
            <button className="compact-brand" onClick={() => void navigate("app.project")}>WorkStore</button>
            <button className="compact-tool-switch" aria-label="打开工具" aria-haspopup="dialog"
              onClick={() => { setCatalog(true); }}>
              打开工具 <DownOutlined />
            </button>
            <nav className="compact-tool-list" aria-label="常用和最近工具">
              {[...favorites, ...recent].map((entry) => {
                const item = tools.find((candidate) => candidate.id === entry.id)!;
                return <button key={item.id} className={`compact-tool-item ${active === item.id ? "selected" : ""}`}
                  aria-current={active === item.id ? "page" : undefined}
                  onClick={() => open(item.id)}
                  onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}>
                  <ToolIcon tool={item} /><span>{item.name}</span>
                </button>;
              })}
            </nav>
            <div className="compact-window-space" data-tauri-drag-region />
            <UpdateButton ready={ready} autoCheck={false} />
            <button className="icon-button compact-settings" aria-label="设置" onClick={() => setSettings(true)}><SettingOutlined /></button>
          </header>
        )}
        {(htmlOpened || active === "app.html") && <div style={{display:active === "app.html" ? "contents" : "none"}}><Suspense fallback={<div className="startup">正在加载 HTML…</div>}><HtmlApp /></Suspense></div>}
        {active === "app.html" ? null : active === "app.comic" ? (
          <Suspense fallback={<div className="tool-page">正在打开小漫画…</div>}><ComicApp /></Suspense>
        ) : active === "app.whiteboard" ? (
          <Suspense fallback={<div className="startup">正在加载白板…</div>}>
            <Whiteboard />
          </Suspense>

        ) : active === "app.doc" ? (
          <Suspense fallback={<div className="startup">正在加载笔记…</div>}>
            <DocumentApp />
          </Suspense>
        ) : tool ? (
          <div className="tool-page">
            <ToolHeader
              tool={tool}
              actions={
                tool.status ? null : tool.id === "tool.color" ? (
                  <Button
                    onClick={async () => {
                      try {
                        if (native) await writeText(color);
                        else await navigator.clipboard.writeText(color);
                        message.success("色值已复制");
                      } catch {
                        message.info("请手动复制色值");
                      }
                    }}
                  >
                    复制 HEX
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    onClick={() => {
                      if (native)
                        openUrl("https://github.com").catch((e) =>
                          message.error(String(e)),
                        );
                      else
                        window.open(
                          "https://github.com",
                          "_blank",
                          "noopener,noreferrer",
                        );
                    }}
                  >
                    在浏览器中打开 <ExportOutlined />
                  </Button>
                )
              }
            />
            {tool.status ? (
              <div className="development">
                <div className="dev-illustration">
                  <ToolIcon tool={tool} large />
                  <span>
                    <ExperimentOutlined />
                  </span>
                </div>
                <span className="dev-label">正在打磨中</span>
                <h1>{tool.name}，即将就绪。</h1>
                <p>
                  {tool.description}
                  <br />
                  我们正在为它打造更专注、更流畅的本地体验。
                </p>
                <Button type="primary" onClick={() => setCatalog(true)}>
                  探索其他工具 <ArrowRightOutlined />
                </Button>
                <small>你的常用位置已保留，准备好后即可使用。</small>
              </div>
            ) : (
              <div className="tool-content">
                {tool.id === "tool.color" ? (
                  <div className="color-tool">
                    <input
                      aria-label="选择颜色"
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                    />
                    <div>
                      <h2>{color.toUpperCase()}</h2>
                      <p>点击色块选择颜色</p>
                    </div>
                  </div>
                ) : (
                  <div className="web-placeholder">
                    <GlobalOutlined />
                    <h2>前往 GitHub</h2>
                    <p>
                      通过系统浏览器打开 GitHub。独立 WebView 将在后续版本接入。
                    </p>
                  </div>
                )}
                <div className="tool-footnote">
                  <LockOutlined />{" "}
                  {native
                    ? "内容自动保存到工作目录，不上传。"
                    : "浏览器预览：输入仅保留当前会话。"}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </main>
      <Modal
        title={
          <div className="modal-title">
            <AppstoreOutlined />
            <span>打开工具</span>
          </div>
        }
        open={catalog}
        onCancel={() => setCatalog(false)}
        footer={null}
        width={780}
        centered
        destroyOnHidden
      >
        <p className="modal-description">找到顺手的工具，开始下一件事。</p>
        <div className="catalog-filters">
          <Segmented
            value={category}
            onChange={(v) => setCategory(String(v))}
            options={[
              "全部工具",
              "效率办公",
              "开发工具",
              "设计工具",
              "Web 工具",
            ]}
          />
        </div>
        <div className="catalog-grid">
          {visibleTools
            .filter(
              (t) =>
                (category === "全部工具" || t.category === category),
            )
            .map((t) => (
              <button
                className="catalog-card"
                key={t.id}
                onClick={() => open(t.id)}
              >
                <ToolIcon tool={t} />
                <div>
                  <h3>
                    {t.name}
                    {t.status && <span className="dev-badge">开发中</span>}
                  </h3>
                  <p>{t.description}</p>
                  <small>
                    {t.category === "Web 工具" ? (
                      <GlobalOutlined />
                    ) : (
                      <LockOutlined />
                    )}{" "}
                    {t.category === "Web 工具" ? "Web" : "本地"}{" "}
                    <span>· {t.id}</span>
                  </small>
                </div>
                <ArrowRightOutlined />
              </button>
            ))}
        </div>
        {!visibleTools.some(
          (t) =>
            (category === "全部工具" || t.category === category),
        ) && (
          <div className="no-results">
            此分类暂无工具
            <Button
              type="link"
              onClick={() => {
                  setCategory("全部工具");
              }}
            >
              查看全部工具
            </Button>
          </div>
        )}
        <div className="modal-footer">
          <span>
            <CheckCircleOutlined /> 打开后自动记录，常用工具不重复显示
          </span>
          <kbd>ESC 关闭</kbd>
        </div>
      </Modal>
      <Modal
        title="工作空间设置"
        open={settings}
        onCancel={() => setSettings(false)}
        footer={
          <Button type="primary" onClick={() => setSettings(false)}>
            完成
          </Button>
        }
        width={670}
        centered
      >
        <div className="settings-tabs">
          <Segmented
            value={settingsTab}
            onChange={(v) => setSettingsTab(String(v))}
            options={[
              { label: "通用", value: "general" },
              { label: "GitHub 同步", value: "sync" },
              { label: "AI", value: "ai" },
              { label: "关于与图标", value: "about" },
            ]}
          />
        </div>
        {settingsTab === "ai" ? <AiSettings /> : settingsTab === "general" ? (
          <div className="settings-content">
            <div className="setting-row">
              <div>
                <strong>启动时最大化</strong>
                <p>下次打开 WorkStore 时生效。</p>
              </div>
              <Switch
                aria-label="启动时最大化"
                checked={maximizeOnStart}
                disabled={!native || !preferencesReady}
                loading={savingPreferences}
                onChange={changeMaximizeOnStart}
              />
            </div>
            <h3>工作目录</h3>
            <p>默认使用应用专属目录，日常读写无需申请文稿文件夹权限。</p>
            <Input
              prefix={<FolderOutlined />}
              value={native ? path : "仅桌面版可用"}
              readOnly
            />
            <Button
              style={{ marginTop: 12 }}
              disabled={!native}
              loading={migrating}
              onClick={changeDirectory}
            >
              选择工作目录
            </Button>
            <div className="preview-note">
              {native
                ? "选择一个空目录。复制和校验成功后切换，原目录与文件保留。"
                : "请运行桌面版以使用本地文件存储与目录选择。"}
            </div>
            <div className="setting-row">
              <div>
                <strong>无需登录，直接开始</strong>
                <p>工作空间独立于账号，未来登录也无需迁移本地文件。</p>
              </div>
              <LockOutlined />
            </div>
            <div className="setting-row">
              <div>
                <strong>导航状态</strong>
                <p>
                  {native
                    ? "常用、最近与工具输入自动保存为本地文件。"
                    : "浏览器预览仅保存导航状态。"}
                </p>
              </div>
              <Button
                onClick={() => {
                  setEntries(initial);
                  void navigate("app.project");
                  message.success("已重置导航");
                }}
              >
                重置
              </Button>
            </div>
          </div>
        ) : settingsTab === "sync" ? (
          <div className="settings-content">
            <div className="setting-row">
              <div>
                <h3>
                  <GithubOutlined /> GitHub 同步
                </h3>
                <p>可选配置。关闭时，所有工作依然正常进行。</p>
              </div>
              <Switch
                aria-label="启用 GitHub 同步"
                checked={githubSyncEnabled}
                disabled={!native || !preferencesReady || savingPreferences}
                loading={savingPreferences}
                onChange={changeSyncEnabled}
              />
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <Input
                placeholder="仓库地址，例如 https://github.com/owner/workstore-space.git"
                value={githubRepoUrl}
                disabled={!native}
                onChange={(event) => changeSyncRepoUrl(event.target.value)}
              />
              <Input
                placeholder="分支名（默认 main）"
                value={githubSyncBranch}
                disabled={!native}
                onChange={(event) => changeSyncBranch(event.target.value)}
              />
              <Input.Password
                placeholder="Personal Access Token（可选）"
                value={githubToken}
                disabled={!native}
                onChange={(event) => changeSyncToken(event.target.value)}
              />
            </div>
            <div className="sync-guide">
              <strong>推荐配置流程（首次）</strong>
              <ol>
                <li>
                  在 GitHub 创建一个空仓库（建议私有），打开
                  <code>https://github.com/new</code>。
                </li>
                <li>
                  在仓库页复制 HTTPS 地址，填到上方「仓库地址」。
                  例如：<code>https://github.com/yourname/workstore-space.git</code>
                </li>
                <li>
                  生成 PAT：
                  <ol className="sub-steps">
                    <li>登录 GitHub → Settings → Developer settings。</li>
                    <li>选择 Fine-grained tokens → Generate new token。</li>
                    <li>仓库范围可选 <code>workstore-space</code>，授权 <code>Contents: Read and write</code>。</li>
                    <li>复制 Token，粘贴到「Token」输入框。</li>
                  </ol>
                </li>
                <li>
                  回到本页开启「GitHub 同步」，应用会自动初始化；其他设备填写相同的仓库与分支即可。
                </li>
              </ol>
            </div>
            <div className="setting-row" style={{ marginTop: 14 }}>
              <div>
                <strong>同步动作</strong>
                <p>
                  {syncStatus ||
                    "本地修改后自动同步；启动、回到窗口、恢复联网和每隔约一分钟都会检查其他设备的更新。离线时继续本地保存，联网后自动重试。"}
                </p>
              </div>
              <Button
                onClick={syncNow}
                loading={syncing}
                disabled={!native || !githubSyncEnabled}
              >
                立即同步
              </Button>
            </div>
            <div className="preview-note">
              同步在应用运行时执行，无需额外服务端。内容冲突时保留副本；关闭应用的设备会在下次启动时补齐更新。
            </div>
          </div>
        ) : (
          <div className="about">
            <img src="/workstore-icon.svg" />
            <h2>WorkStore</h2>
            <p>你的工具，你的空间。</p>
            <small>{native ? "v0.1 · 本地桌面版" : "v0.1 · 浏览器预览"}</small>
            <div className="icon-story">
              图标将收纳盒与字母 W
              融合。三条竖线代表不同工具，右上角的浅绿色圆点代表就绪与灵感。
            </div>
            <a href="/workstore-icon.svg" download="workstore-icon.svg">
              下载 SVG 图标 <ExportOutlined />
            </a>
          </div>
        )}
      </Modal>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#28796b",
          colorInfo: "#28796b",
          borderRadius: 10,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          colorText: "#252c2b",
          colorBorder: "#e4e8e6",
          controlHeight: 36,
        },
        components: {
          Modal: { borderRadiusLG: 18 },
          Button: { defaultShadow: "none", primaryShadow: "none" },
        },
      }}
    >
      <AntApp>
        <WorkStore />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
