import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Tag } from "antd";
import { ArrowUpOutlined } from "@ant-design/icons";
import { Editor as TeaEditor } from "@teabook/teaeditor";
import { flushDocuments, remoteVersion, stageDocument } from "./store";

type Conversation = {
  type: "workstore.conversation";
  version: 1;
  entries: { id: string; html: string; createdAt?: number }[];
  draft: string;
};
export const emptyConversation = () => JSON.stringify({ type: "workstore.conversation", version: 1, entries: [], draft: "" });
export function conversationContent(content: string): Conversation | null {
  if (!content.startsWith('{"type":"workstore.conversation"')) return null;
  try {
    const value = JSON.parse(content);
    if (value.version !== 1 || typeof value.draft !== "string" || !Array.isArray(value.entries) ||
      !value.entries.every((entry: { id?: unknown; html?: unknown }) => entry && typeof entry.id === "string" && typeof entry.html === "string")) return null;
    return value;
  } catch { return null; }
}
const editorOptions = { hideToolbar: true, showTreeView: false, showNestedEditorTreeView: false,
  showTableOfContents: false, shouldAllowHighlightingWithBrackets: false };

function entryTime(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return "时间未知";
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function ConversationNote({ id, content }: { id: string; content: string }) {
  const { message } = App.useApp();
  const [initial] = useState(() => conversationContent(content)!);
  const state = useRef(initial);
  const version = useRef(remoteVersion(id));
  const [entries, setEntries] = useState(initial.entries);
  const [input, setInput] = useState({ key: 0, html: initial.draft });
  const [recording, setRecording] = useState(false);
  const composing = useRef(false);
  const pending = useRef(false);
  const inputGeneration = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [entries.length]);
  const onChange = useCallback((html: string) => {
    if (version.current !== remoteVersion(id) || input.key !== inputGeneration.current) return;
    state.current = { ...state.current, draft: html };
    stageDocument(id, { content: JSON.stringify(state.current) });
  }, [id, input.key]);
  const record = async () => {
    if (pending.current || composing.current || version.current !== remoteVersion(id)) return;
    const html = state.current.draft;
    const body = new DOMParser().parseFromString(html, "text/html").body;
    if (!body.textContent?.replace(/[\s\u200b]/g, "") && !body.querySelector("img,video,audio,iframe,table,hr,svg")) return;
    pending.current = true;
    setRecording(true);
    try {
      const next = { ...state.current, draft: "", entries: [...state.current.entries, { id: globalThis.crypto.randomUUID(), html, createdAt: Date.now() }] };
      stageDocument(id, { content: JSON.stringify(next) });
      state.current = next;
      setEntries(next.entries);
      inputGeneration.current++;
      setInput({ key: inputGeneration.current, html: "" });
      await flushDocuments();
    } catch (error) {
      message.error("记录保存失败，请通过标题栏重试：" + String(error));
    } finally {
      pending.current = false;
      setRecording(false);
    }
  };
  return (
    <div className="conversation-note">
      <div className="conversation-cards" ref={list} role="list" aria-label="对话笔记记录">
        {entries.map(entry => (
          <div className="conversation-entry" role="listitem" key={entry.id}>
            <div className="conversation-time"><Tag>{entryTime(entry.createdAt)}</Tag></div>
            <article className="conversation-card">
              <TeaEditor {...editorOptions} readOnly htmlContent={entry.html} />
            </article>
          </div>
        ))}
      </div>
      <div className="conversation-composer"
        onKeyDownCapture={(event) => {
          if (event.key !== "Enter" || !event.metaKey || event.shiftKey || event.altKey ||
            event.repeat || event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
          event.preventDefault();
          event.stopPropagation();
          void record();
        }}
        onCompositionStartCapture={() => { composing.current = true; }}
        onCompositionEndCapture={() => { composing.current = false; }}>
        <div className="conversation-input-box">
        <div className="document-editor-root">
          <TeaEditor {...editorOptions} key={input.key} htmlContent={input.html}
            onHtmlChange={onChange} placeholder="写下一条笔记…" />
        </div>
        <div className="conversation-submit">
          <span className="conversation-shortcut">⌘ Enter 记录</span>
          <Button type="primary" shape="circle" icon={<ArrowUpOutlined />} aria-label="记录笔记"
            title="记录笔记（⌘ Enter）" loading={recording} onClick={() => void record()} />
        </div>
        </div>
      </div>
    </div>
  );
}
