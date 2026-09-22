import { DocumentAiSidebar } from "../ai/AiSidebar";
import { App as AntApp, Button, Dropdown, Input, Modal, Tooltip } from "antd";
import {
  MessageOutlined,
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  MoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Editor as TeaEditor } from "@teabook/teaeditor";
import {
  createDocument,
  currentDocument,
  documentList,
  documentStatus,
  documentWarnings,
  ensureDocument,
  exportDocument,
  flushDocuments,
  lastDocumentId,
  loadDocument,
  activateDocument,
  refreshDocuments,
  stageDocument,
  subscribe,
  remoteVersion,
} from "./store";
import { documentAiTarget } from "./aiTarget";
import { native } from "../workspace";
import { registerSyncActivationBlocker } from "../documentLifecycle";
import "./documents.css";
import ClickDiagnostics from "./DocumentClickDiagnostics";
import { recordDocumentClickStage } from "./clickDiagnostics";

function getRenameError(message?: string) {
  if (!message?.trim()) return "文档名称不能为空";
  if ([...message].length > 120) return "文档名称不能超过 120 个字符";
  return "";
}

function DocumentEditor({ id, content }: { id: string; content: string }) {
  // TeaEditor imports htmlContent on change; local edits must not feed back into it.
  // The parent's key starts a new session for another document or remote version.
  const [initialContent] = useState(content);
  const editorVersion = useRef(remoteVersion(id));
  const handleHtmlChange = useCallback((html: string) => {
    if (editorVersion.current !== remoteVersion(id)) return;
    stageDocument(id, { content: html });
  }, [id]);

  return (
    <TeaEditor
      showTreeView={false}
      showNestedEditorTreeView={false}
      showTableOfContents={false}
      shouldAllowHighlightingWithBrackets={false}
      htmlContent={initialContent}
      placeholder="写下正文，支持富文本、表格、列表和嵌入"
      onHtmlChange={handleHtmlChange}
    />
  );
}

export default function DocumentApp() {
  const { message } = AntApp.useApp();
  const [, rerender] = useState(0);
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const selectionPending = useRef(true);
  const handledMousePress = useRef<HTMLButtonElement | null>(null);
  const composing = useRef(false);
  const compositionChoice = useRef<string | null>(null);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentRequest = (request: number) => mounted.current && requestVersion.current === request;
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  useEffect(() => { setAiApplying(false); }, [id]);
  const activeId = useRef(id); activeId.current = id;
  const aiTarget = documentAiTarget(() => activeId.current, next => {
    if (!mounted.current) return;
    requestVersion.current++;
    activateDocument(next); setId(next); setError("");
    selectionPending.current = false; setBusy(false); setOpeningId(null);
  });

  useEffect(() => {
    if (id) recordDocumentClickStage("rendered");
  }, [id]);

  // A pending selection is also an editing transition: background activation
  // must not refresh/remount its files while the requested document is loading.
  useEffect(() => registerSyncActivationBlocker(() =>
    selectionPending.current || composing.current || compositionChoice.current !== null,
  ), []);

  useEffect(() => {
    const unsubscribe = subscribe(() => rerender((x) => x + 1));
    return unsubscribe;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const request = ++requestVersion.current;
    (async () => {
      try {
        await refreshDocuments();
        if (!isCurrentRequest(request)) return;
        const items = documentList();
        const selected = items.some((x) => x.id === lastDocumentId)
          ? lastDocumentId
          : [...items].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]?.id;

        if (selected) {
          setOpeningId(selected);
          await loadDocument(selected);
          if (!isCurrentRequest(request)) return;
          activateDocument(selected);
          setId(selected);
        }
      } catch (e) {
        if (isCurrentRequest(request)) setError(String(e));
      } finally {
        if (isCurrentRequest(request)) {
          selectionPending.current = false;
          setOpeningId(null);
          setBusy(false);
        }
      }
    })();

    return () => {
      mounted.current = false;
      requestVersion.current++;
      if (compositionTimer.current) clearTimeout(compositionTimer.current);
      compositionTimer.current = null;
      compositionChoice.current = null;
      void flushDocuments().catch(() => {});
    };
  }, []);

  const select = async (next: string) => {
    // A click is an intent, even during loading. In particular clicking the
    // current document must supersede an in-flight switch to another one.
    recordDocumentClickStage("selected");
    if (next === id && !selectionPending.current) { recordDocumentClickStage("ignored"); return; }
    const request = ++requestVersion.current;
    selectionPending.current = true;
    setOpeningId(next);
    setBusy(true);
    try {
      recordDocumentClickStage("saving");
      await flushDocuments();
      recordDocumentClickStage("saved");
      if (!isCurrentRequest(request)) { recordDocumentClickStage("superseded"); return; }
      // Cancelling back to the current editor must not reload its live cache
      // beneath an already mounted TeaEditor session.
      recordDocumentClickStage("loading");
      if (next !== id || !currentDocument(next)) await loadDocument(next);
      recordDocumentClickStage("loaded");
      if (!isCurrentRequest(request)) { recordDocumentClickStage("superseded"); return; }
      activateDocument(next);
      setId(next);
      setError("");
      recordDocumentClickStage("applied");
    } catch (e) {
      recordDocumentClickStage("failed");
      if (isCurrentRequest(request)) message.error("切换失败：" + String(e));
    } finally {
      if (isCurrentRequest(request)) {
        selectionPending.current = false;
        setOpeningId(null);
        setBusy(false);
      }
    }
  };

  const requestSelection = (next: string) => {
    // Never unmount an IME session before its last input has reached TeaEditor.
    if (composing.current || compositionTimer.current) {
      compositionChoice.current = next;
      recordDocumentClickStage("compositionPending");
      return;
    }
    void select(next);
  };
  const finishComposition = () => {
    composing.current = false;
    if (compositionTimer.current) clearTimeout(compositionTimer.current);
    // compositionend precedes the final input/editor update. Wait one task,
    // keeping selection requests queued until that update is staged for saving.
    compositionTimer.current = setTimeout(() => {
      compositionTimer.current = null;
      const next = compositionChoice.current;
      compositionChoice.current = null;
      if (mounted.current && next) void select(next);
    }, 0);
  };

  const create = async () => {
    const request = ++requestVersion.current;
    selectionPending.current = true;
    setOpeningId(null);
    setBusy(true);
    try {
      await flushDocuments();
      if (!isCurrentRequest(request)) return;
      const document = await createDocument();
      if (!isCurrentRequest(request)) return;
      activateDocument(document.id);
      setId(document.id);
      setError("");
    } catch (e) {
      if (isCurrentRequest(request)) message.error("创建失败：" + String(e));
    } finally {
      if (isCurrentRequest(request)) {
        selectionPending.current = false;
        setOpeningId(null);
        setBusy(false);
      }
    }
  };

  const pin = async (item: ReturnType<typeof documentList>[number]) => {
    try {
      await ensureDocument(item.id);
      stageDocument(item.id, { favorite: !item.favorite });
      await flushDocuments();
    } catch (e) {
      message.error("保存失败：" + String(e));
    }
  };

  const rename = async () => {
    const title = name.trim();
    const err = getRenameError(title);
    if (!renaming || err) {
      if (err) message.warning(err);
      return;
    }
    try {
      await ensureDocument(renaming);
      stageDocument(renaming, { title });
      await flushDocuments();
      setRenaming(null);
    } catch (e) {
      message.error("重命名失败：" + String(e));
    }
  };

  const documents = documentList();
  const favorites = documents
    .filter((x) => x.favorite)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const recent = documents
    .filter((x) => !x.favorite)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const item = id ? currentDocument(id) : undefined;
  const status = id ? documentStatus(id) : "";

  const row = (doc: ReturnType<typeof documentList>[number]) => (
    <div
      className={`document-row ${doc.id === id ? "active" : ""}`}
      key={doc.id}
    >
      <button
        className="document-open"
        aria-busy={openingId === doc.id}
        aria-current={doc.id === id ? "page" : undefined}
        type="button"
        onPointerDownCapture={(event) => {
          handledMousePress.current = null;
          const target = event.target as Element;
          if (event.pointerType !== "mouse" || !event.isPrimary || event.button !== 0 ||
            event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
            target.closest('[draggable="true"]')) return;
          // Native evidence: mouse press reaches this row, then the editor blurs
          // and no mouseup/click follows. Like a desktop list, select on primary
          // mouse-down instead of depending on that missing click. Keep default
          // focus changes from tearing down the editor before its save completes.
          handledMousePress.current = event.currentTarget;
          if (!composing.current) event.preventDefault();
          recordDocumentClickStage("mouseSelection");
          requestSelection(doc.id);
        }}
        onClick={(event) => {
          const handled = handledMousePress.current === event.currentTarget;
          handledMousePress.current = null;
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
          // Keyboard/assistive clicks (detail=0), touch taps, and drag-handle
          // clicks use normal click activation. Never execute a mouse press twice.
          if (event.detail > 0 && handled) return;
          requestSelection(doc.id);
        }}
        title={doc.title}
      >
        <span className="nav-drag-handle"
      draggable={!doc.favorite && !busy}
      onDragStart={(event) =>
        event.dataTransfer.setData("application/workstore-document", doc.id)
      }
        >
          <FileTextOutlined />
        </span>
        <span>{doc.title}</span>
      </button>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            {
              key: "favorite",
              icon: doc.favorite ? <StarFilled /> : <StarOutlined />,
              label: doc.favorite ? "取消常用" : "设为常用",
            },
            {
              key: "rename",
              icon: <EditOutlined />,
              label: "重命名",
            },
            {
              key: "export",
              icon: <ExportOutlined />,
              label: "导出 JSON",
            },
          ],
          onClick: ({ key }) => {
            if (key === "favorite") void pin(doc);
            if (key === "rename") {
              setName(doc.title);
              setRenaming(doc.id);
            }
            if (key === "export") {
              void ensureDocument(doc.id)
                .then(() => exportDocument(doc.id))
                .catch((e) => message.error(String(e)));
            }
          },
        }}
      >
        <button className="document-more" aria-label={`${doc.title}更多操作`}>
          <MoreOutlined />
        </button>
      </Dropdown>
    </div>
  );

  return (
    <section className="document-app"
      onCompositionStartCapture={(event) => {
        if ((event.target as Element).closest(".document-editor-root")) {
          if (compositionTimer.current) clearTimeout(compositionTimer.current);
          compositionTimer.current = null;
          composing.current = true;
        }
      }}
      onCompositionEndCapture={(event) => {
        if ((event.target as Element).closest(".document-editor-root")) finishComposition();
      }}
    >
      <ClickDiagnostics />
      <div className={`document-body ${aiOpen ? "has-ai-sidebar" : ""}`}>
        <aside className="document-sidebar" id="document-navigation" hidden={sidebarCollapsed}>
          <header className="document-heading">
            <div>
              <FileTextOutlined />
              <h2>文档</h2>

            </div>
            <Button
              type="text"
              icon={<MenuFoldOutlined />}
              aria-label="折叠文档导航"
              title="折叠文档导航"
              aria-expanded={!sidebarCollapsed}
              aria-controls="document-navigation"
              onClick={() => setSidebarCollapsed(true)}
            />
          </header>
          <div
            className="document-navigation"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = documentList().find(
                (x) =>
                  x.id ===
                  event.dataTransfer.getData("application/workstore-document"),
              );
              if (dropped && !dropped.favorite) void pin(dropped);
            }}
          >
            <div className="document-section">
              <div className="document-section-label">常用</div>
              {favorites.map(row)}
              {!favorites.length && <p>暂无</p>}
            </div>
            <div className="document-section">
              <div className="document-section-label">最近打开</div>
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
              创建文档
            </Button>
          </div>
        </aside>

        <div className="document-workspace">
          {error && (
            <div className="document-error">
              {error}
              <Button
                type="link"
                onClick={() => {
                  setError("");
                  void refreshDocuments().catch((e) => setError(String(e)));
                }}
              >
                重试
              </Button>
            </div>
          )}

          {documentWarnings().length > 0 && (
            <div
              className="document-error"
              title={documentWarnings().join("\n")}
            >
              {documentWarnings().length} 份文档无法读取，原文件已保留。
            </div>
          )}

          {item ? (
            <>
              <div className="document-document-bar">
                {sidebarCollapsed && (
                  <Button
                    type="text"
                    icon={<MenuUnfoldOutlined />}
                    aria-label="展开文档导航"
                    title="展开文档导航"
                    aria-expanded={false}
                    aria-controls="document-navigation"
                    onClick={() => setSidebarCollapsed(false)}
                  />
                )}
                <button
                  className="document-title-edit"
                  onClick={() => {
                    setName(item.title);
                    setRenaming(item.id);
                  }}
                  title="重命名文档"
                >
                  {item.title}
                  <EditOutlined />
                </button>
                <div
                  className={`document-save-status ${status.startsWith("保存失败") ? "failed" : ""}`}
                  role="status"
                >
                  {status}
                  {status.startsWith("保存失败") && (
                    <>
                      <Button
                        type="link"
                        size="small"
                        onClick={() =>
                          void flushDocuments().catch((e) => message.error(String(e)))
                        }
                      >
                        重试
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => exportDocument(item.id)}
                      >
                        导出备份
                      </Button>
                    </>
                  )}
                </div>
                <Button size="small" type="text" icon={<MessageOutlined />} aria-expanded={aiOpen} disabled={aiApplying} onClick={() => setAiOpen(value => !value)}>AI 助手</Button>
                <Tooltip title="导出文档 JSON">
                  <Button
                    type="text"
                    size="small"
                    icon={<ExportOutlined />}
                    aria-label="导出文档 JSON"
                    onClick={() => exportDocument(item.id)}
                  />
                </Tooltip>
              </div>
              <div className="document-editor-wrap">
                <div className="document-editor-root">
                  <DocumentEditor
                    key={`${item.id}:${remoteVersion(item.id)}`}
                    id={item.id}
                    content={item.content}
                  />
                </div>
              </div>
              {busy && <div className="document-busy">正在切换文档…</div>}
            </>
          ) : (
            <>
              {sidebarCollapsed && (
                <div className="document-document-bar">
                  <Button
                    type="text"
                    icon={<MenuUnfoldOutlined />}
                    aria-label="展开文档导航"
                    title="展开文档导航"
                    aria-expanded={false}
                    aria-controls="document-navigation"
                    onClick={() => setSidebarCollapsed(false)}
                  />
                </div>
              )}
            <div className="document-empty">
              <FileTextOutlined />
              <h2>创建第一篇文档</h2>
              <p>这里放列表 + 编辑区的文档体验，支持收藏与自动保存。</p>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                loading={busy}
                onClick={() => void create()}
              >
                创建文档
              </Button>
              <Button icon={<MessageOutlined />} onClick={() => setAiOpen(true)}>AI 助手</Button>
              <small>
                {native
                  ? "每篇文档独立保存到工作目录"
                  : "预览数据保存在此浏览器，桌面版会同步到本地文件"}
              </small>
            </div>
            </>
          )}
        </div>
        {aiOpen && <DocumentAiSidebar key={id ?? "empty"} target={aiTarget} onClose={() => setAiOpen(false)} onWriteState={setAiApplying} context={item ? () => ({ title: item.title, content: new DOMParser().parseFromString(currentDocument(item.id)?.content ?? "", "text/html").body.textContent ?? "" }) : undefined} />}
      </div>

      <Modal
        title="重命名文档"
        open={!!renaming}
        onCancel={() => setRenaming(null)}
        onOk={() => void rename()}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !name.trim() || getRenameError(name).length > 0 }}
      >
        <Input
          aria-label="文档名称"
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
