import { AiAssistantButton } from "../ai/AiAssistant";
import "./assets";
import { Excalidraw, MainMenu, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { App, Button, Dropdown, Input, Modal } from "antd";
import {
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import { native } from "../workspace";
import {
  boardList,
  boardWarnings,
  createBoard,
  currentBoard,
  ensureBoard,
  exportBoard,
  flushWhiteboards,
  lastBoardId,
  openBoard,
  refreshBoards,
  stageBoard,
  subscribe,
  remoteVersion,
  type BoardInfo,
  type Scene,
} from "./store";
import "./whiteboard.css";
import WhiteboardIcon from "./WhiteboardIcon";
function Canvas({ id }: { id: string }) {
  const initialData = useMemo(() => currentBoard(id)!.scene, [id]);
  const previous = useRef("");
  const onChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
    (elements, appState, files) => {
      const serialized = serializeAsJSON(elements, appState, files, "local");
      if (serialized === previous.current) return;
      previous.current = serialized;
      stageBoard(id, { scene: JSON.parse(serialized) as Scene });
    },
    [id],
  );
  return (
    <Excalidraw
      initialData={initialData}
      onChange={onChange}
      langCode="zh-CN"
      name={currentBoard(id)?.title}
      validateEmbeddable={false}
      UIOptions={{
        canvasActions: { loadScene: false, saveToActiveFile: false },
      }}
    >
      <MainMenu>
        <MainMenu.Item
          icon={<ExportOutlined />}
          onSelect={() => exportBoard(id)}
        >
          导出白板 JSON
        </MainMenu.Item>
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}
export default function Whiteboard() {
  const { message } = App.useApp();
  const [, render] = useState(0);
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => subscribe(() => render((x) => x + 1)), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refreshBoards();
        if (!alive) return;
        const items = boardList();
        const selected = items.some((x) => x.id === lastBoardId)
          ? lastBoardId
          : items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]?.id;
        if (selected) {
          await openBoard(selected);
          if (alive) setId(selected);
        }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
      void flushWhiteboards().catch(() => {});
    };
  }, []);
  const select = async (next: string) => {
    if (next === id) return;
    setBusy(true);
    try {
      await flushWhiteboards();
      await openBoard(next);
      setId(next);
      setError("");
    } catch (e) {
      message.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      await flushWhiteboards();
      const doc = await createBoard();
      setId(doc.id);
      setError("");
    } catch (e) {
      message.error("创建失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };
  const pin = async (item: BoardInfo) => {
    try {
      await ensureBoard(item.id);
      stageBoard(item.id, { favorite: !item.favorite });
      await flushWhiteboards();
    } catch (e) {
      message.error(String(e));
    }
  };
  const rename = async () => {
    const title = name.trim();
    if (!renaming || !title) return;
    try {
      await ensureBoard(renaming);
      stageBoard(renaming, { title });
      await flushWhiteboards();
      setRenaming(null);
    } catch (e) {
      message.error(String(e));
    }
  };
  const items = boardList();
  const favorites = items
    .filter((x) => x.favorite)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const recent = items
    .filter((x) => !x.favorite)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const doc = id ? currentBoard(id) : undefined;
  const row = (item: BoardInfo) => (
    <div
      className={`board-row ${item.id === id ? "active" : ""}`}
      key={item.id}
    >
      <button
        className="board-open"
        disabled={busy}
        onClick={() => void select(item.id)}
        title={item.title}
      >
        <span className="nav-drag-handle"
      draggable={!item.favorite && !busy}
      onDragStart={(e) =>
        e.dataTransfer.setData("application/workstore-whiteboard", item.id)
      }
        >
          <FileTextOutlined />
        </span>
        <span>{item.title}</span>
      </button>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            {
              key: "favorite",
              icon: item.favorite ? <StarFilled /> : <StarOutlined />,
              label: item.favorite ? "取消常用" : "设为常用",
            },
            { key: "rename", icon: <EditOutlined />, label: "重命名" },
            { key: "export", icon: <ExportOutlined />, label: "导出 JSON" },
          ],
          onClick: ({ key }) => {
            if (key === "favorite") void pin(item);
            if (key === "rename") {
              setName(item.title);
              setRenaming(item.id);
            }
            if (key === "export")
              void ensureBoard(item.id)
                .then(() => exportBoard(item.id))
                .catch((e) => message.error(String(e)));
          },
        }}
      >
        <button className="board-more" aria-label={`${item.title}更多操作`}>
          <MoreOutlined />
        </button>
      </Dropdown>
    </div>
  );
  return (
    <section className="whiteboard-app">
      <div className="whiteboard-body">
        <aside className="board-sidebar" style={sidebarCollapsed ? { display: "none" } : undefined}>
            <header className="whiteboard-heading">
            <div>
              <span className="whiteboard-brand-icon"><WhiteboardIcon /></span>
              <h2>白板</h2>
              <span className="whiteboard-description" title="把想法，画出来。">把想法，画出来。</span>
            </div>
            <Button type="text" size="small" icon={<MenuFoldOutlined />}
              aria-label="折叠白板导航栏" title="折叠导航栏"
              onClick={() => setSidebarCollapsed(true)} />
          </header>
          <div className="board-navigation">
          <div
            className="board-section"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const item = items.find(
                (x) =>
                  x.id ===
                  e.dataTransfer.getData("application/workstore-whiteboard"),
              );
              if (item && !item.favorite) void pin(item);
            }}
          >
            <div className="board-section-label">常用</div>
            {favorites.map(row)}
            {!favorites.length && <p>暂无</p>}
          </div>
          <div className="board-section">
            <div className="board-section-label">最近打开</div>
            {recent.map(row)}
            {!recent.length && <p>暂无</p>}
          </div>
          </div>
          <div className="tool-sidebar-footer">
            <Button
              className="tool-sidebar-create"
              icon={<PlusOutlined />}
              loading={busy}
              onClick={() => void create()}
            >
              创建白板
            </Button>
          </div>
        </aside>
        <div className="board-workspace">
          <div className="board-document-bar">
            {sidebarCollapsed && (
              <Button type="text" size="small" icon={<MenuUnfoldOutlined />}
                aria-label="展开白板导航栏" title="展开导航栏"
                onClick={() => setSidebarCollapsed(false)} />
            )}
            {doc ? (
              <button className="board-title-edit" title="重命名白板"
                onClick={() => { setName(doc.title); setRenaming(doc.id); }}>
                {doc.title}<EditOutlined />
              </button>
            ) : <span>白板</span>}
            <div style={{ marginLeft: "auto" }}><AiAssistantButton key={id ?? "empty"} toolId="app.whiteboard" context={doc ? () => ({ title: doc.title, content: (currentBoard(doc.id)?.scene.elements ?? []).filter(e => !e.isDeleted && e.type === "text").map(e => "text" in e ? String(e.text) : "").join("\n") }) : undefined} /></div>
          </div>
          {error && (
            <div className="board-error">
              {error}
              <Button
                type="link"
                onClick={() => {
                  setError("");
                  void refreshBoards().catch((e) => setError(String(e)));
                }}
              >
                重试
              </Button>
            </div>
          )}
          {boardWarnings().length > 0 && (
            <div className="board-error" title={boardWarnings().join("\n")}>
              {boardWarnings().length} 份白板无法读取，原文件已保留。
            </div>
          )}
          {doc ? (
            <>
              <div className="board-canvas">
                <Canvas key={`${doc.id}:${remoteVersion(doc.id)}`} id={doc.id} />
                {busy && <div className="board-busy">正在打开白板…</div>}
              </div>
            </>
          ) : (
            <div className="board-empty">
              <div className="board-empty-icon">
                <WhiteboardIcon />
              </div>
              <h2>从一张空白画布开始</h2>
              <p>绘图、梳理流程，或随手记录灵感。</p>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                loading={busy}
                onClick={() => void create()}
              >
                创建白板
              </Button>
              <small>
                {native
                  ? "每份白板独立保存到工作目录"
                  : "预览数据保存在此浏览器，桌面版会保存为本地 JSON 文件"}
              </small>
            </div>
          )}
        </div>
      </div>
      <Modal
        title="重命名白板"
        open={!!renaming}
        onCancel={() => setRenaming(null)}
        onOk={() => void rename()}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !name.trim() }}
      >
        <Input
          aria-label="白板名称"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={() => void rename()}
          autoFocus
        />
      </Modal>
    </section>
  );
}
