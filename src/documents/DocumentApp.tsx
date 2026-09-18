import { AiAssistantButton } from "../ai/AiAssistant";
import { App as AntApp, Button, Dropdown, Input, Modal, Tooltip } from "antd";
import {
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
import { useCallback, useEffect, useState } from "react";
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
  openDocument,
  refreshDocuments,
  stageDocument,
  subscribe,
  remoteVersion,
} from "./store";
import { native } from "../workspace";
import "./documents.css";

function getRenameError(message?: string) {
  if (!message?.trim()) return "文档名称不能为空";
  if ([...message].length > 120) return "文档名称不能超过 120 个字符";
  return "";
}

function DocumentEditor({ id, content }: { id: string; content: string }) {
  // TeaEditor imports htmlContent on change; local edits must not feed back into it.
  // The parent's key starts a new session for another document or remote version.
  const [initialContent] = useState(content);
  const handleHtmlChange = useCallback((html: string) => {
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
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribe(() => rerender((x) => x + 1));
    return unsubscribe;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refreshDocuments();
        if (!alive) return;
        const items = documentList();
        const selected = items.some((x) => x.id === lastDocumentId)
          ? lastDocumentId
          : [...items].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]?.id;

        if (selected) {
          await openDocument(selected);
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
      void flushDocuments().catch(() => {});
    };
  }, []);

  const select = async (next: string) => {
    if (next === id) return;
    setBusy(true);
    try {
      await flushDocuments();
      await openDocument(next);
      setId(next);
      setError("");
    } catch (e) {
      message.error("切换失败：" + String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      await flushDocuments();
      const document = await createDocument();
      setId(document.id);
      setError("");
    } catch (e) {
      message.error("创建失败：" + String(e));
    } finally {
      setBusy(false);
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
        disabled={busy}
        onClick={() => void select(doc.id)}
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
    <section className="document-app">
      <div className="document-body">
        <aside className="document-sidebar" id="document-navigation" hidden={sidebarCollapsed}>
          <header className="document-heading">
            <div>
              <FileTextOutlined />
              <h2>文档</h2>
              <span className="document-description" title="列表 + 右侧编辑区">
                你的长文与灵感记录场。
              </span>
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
                <AiAssistantButton key={item.id} toolId="app.doc" context={() => ({ title: item.title, content: new DOMParser().parseFromString(currentDocument(item.id)?.content ?? "", "text/html").body.textContent ?? "" })} />
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
              <small>
                {native
                  ? "每篇文档独立保存到工作目录"
                  : "预览数据保存在此浏览器，桌面版会同步到本地文件"}
              </small>
            </div>
            </>
          )}
        </div>
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
