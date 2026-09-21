import { useState, type ReactNode } from "react";
import { Button, Tabs } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { AiPanel, type AiContext } from "./AiAssistant";
import EditorAssistant from "./EditorAssistant";
import type { EditorTarget } from "./editing";
import "./ai.css";

export function AiSidebar({ children, onClose, busy = false }: { children: ReactNode; onClose(): void; busy?: boolean }) {
  return <aside className="ai-sidebar" aria-label="AI 助手侧栏">
    <header className="ai-sidebar-header"><strong>AI 助手</strong><Button type="text" size="small" aria-label="关闭 AI 助手" icon={<CloseOutlined />} disabled={busy} onClick={onClose} /></header>
    <div className="ai-sidebar-content">{children}</div>
  </aside>;
}
export function DocumentAiSidebar({ target, context, onClose, onWriteState }: { target: EditorTarget; context?: () => AiContext; onClose(): void; onWriteState(value: boolean): void }) {
  const [applying, setApplying] = useState(false);
  return <AiSidebar onClose={onClose} busy={applying}><Tabs defaultActiveKey="edit" destroyOnHidden items={[
    { key: "edit", label: "生成 / 改写", children: <EditorAssistant toolId="app.doc" target={target} onApplying={value => { setApplying(value); onWriteState(value); }} /> },
    { key: "chat", label: "对话", disabled: applying, children: <AiPanel toolId="app.doc" context={context} /> },
  ]} /></AiSidebar>;
}
