import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input } from "antd";
import { AiSidebar } from "../ai/AiSidebar";
import { ai, trackAiExecution, type AiMessage } from "../ai/client";
import { native } from "../workspace";
import { registerSyncActivationBlocker } from "../documentLifecycle";
import { canvasConversationMessages, parseCanvasPlan, type CanvasConversationTarget, type CanvasProgress } from "./conversationPlan";
import type { SelectionSnapshot } from "./selectionEditing";

export function CanvasConversation({ boardId, attachment, target, onAttach, onDetach, onWriteState }: {
  boardId: string | null; attachment: SelectionSnapshot | null; target: CanvasConversationTarget;
  onAttach(): void; onDetach(): void; onWriteState(value: boolean): void;
}) {
  const [source, setSource] = useState(attachment);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [includeCanvas, setIncludeCanvas] = useState(true);
  const [phase, setPhase] = useState<"idle" | "planning" | "executing" | "stopping">("idle");
  const [progress, setProgress] = useState<CanvasProgress | null>(null);
  const [error, setError] = useState("");
  const [needsSave, setNeedsSave] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const alive = useRef(true);
  const writing = useRef(false);
  const previousBoard = useRef(boardId);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    const unblock = registerSyncActivationBlocker(() => writing.current);
    return () => { alive.current = false; requestId.current++; controller.current?.abort(); unblock(); onWriteState(false); };
  }, [onWriteState]);
  useEffect(() => {
    // Attachment changes only happen while idle through the parent controls.
    // Invalidate a late planning result if the file/scope is changed externally.
    requestId.current++; controller.current?.abort();
    setSource(attachment); setError(""); setNeedsSave(false); setPhase(controller.current ? "stopping" : "idle"); setProgress(null);
  }, [attachment]);
  useEffect(() => {
    const was = previousBoard.current;
    previousBoard.current = boardId;
    if (was === boardId || (was === null && writing.current)) return;
    requestId.current++; controller.current?.abort();
    setSource(null); setMessages([]); setError(""); setNeedsSave(false); setProgress(null);
    setPhase(controller.current ? "stopping" : "idle");
  }, [boardId]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [messages, phase]);
  async function send() {
    if (!prompt.trim() || controller.current || writing.current || needsSave) return;
    const abort = new AbortController(); controller.current = abort;
    const request = ++requestId.current;
    const instruction = prompt.trim(), previous = messages;
    setMessages([...previous, { role: "user", content: instruction }]);
    setPrompt(""); setPhase("planning"); setError(""); setProgress(null);
    const current = () => alive.current && requestId.current === request;
    let ownsExecution = false;
    try {
      const context = target.capture(source, includeCanvas);
      const response = await ai.generate({ toolId: "app.whiteboard", messages: canvasConversationMessages(instruction, context, previous), record: true }, abort.signal);
      if (!current() || abort.signal.aborted) {
        if (current()) setError("已停止规划，未执行新的白板操作。");
        return;
      }
      const plan = parseCanvasPlan(response.text, context);
      if (!plan.diagram && !plan.layout && !plan.changes.changes.length) {
        setMessages([...previous, { role: "user", content: instruction }, { role: "assistant", content: `${plan.message}

（本次为对话回复，未修改白板。）` }]);
        return;
      }
      ownsExecution = true; writing.current = true; onWriteState(true); setPhase("executing");
      const result = await trackAiExecution(abort, target.execute(context, plan, abort.signal, value => {
        if (current()) setProgress(value);
      }));
      if (!current()) return;
      if (source && result.region) setSource(result.region);
      setNeedsSave(!result.saved);
      const status = result.stopped ? `已停止，完成 ${result.done}/${result.total} 步。${result.done ? "已执行的内容保留在画布中，可撤销。" : "未绘制新内容。"}`
        : `已在白板完成 ${result.done} 步操作，可继续提出修改，也可在画布中逐步撤销。`;
      setMessages([...previous, { role: "user", content: instruction }, { role: "assistant", content: `${plan.message}\n\n${status}` }]);
      if (!result.saved) setError("已执行的内容还没有保存成功，请先在白板中重试保存，再继续对话。不要重复执行相同要求。");
      else if (result.reason) setError(result.reason);
      else if (response.saveError) setError("白板操作已保存，但对话历史保存失败。");
    } catch (failure) {
      if (current()) setError(abort.signal.aborted ? "已停止本次请求。" : String(failure));
    } finally {
      if (ownsExecution) { writing.current = false; onWriteState(false); }
      if (controller.current === abort) {
        controller.current = null;
        if (alive.current) setPhase("idle");
      }
    }
  }
  function stop() {
    controller.current?.abort();
    setPhase("stopping");
  }
  const busy = phase !== "idle";
  return <div className="ai-canvas-chat">
    <div className="ai-canvas-scope">
      {source ? <div className="ai-canvas-scope-chip">{source.containerId ? "框内绘制区域" : "已限定选区"} · {source.elements.length} 个元素<Button size="small" type="text" disabled={busy} onClick={onDetach}>移除范围限制</Button></div>
        : <Checkbox checked={includeCanvas} disabled={busy} onChange={event => setIncludeCanvas(event.target.checked)}>读取当前白板的文字与图形信息</Checkbox>}
      <Button type="text" size="small" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={onAttach}>使用画布选区</Button>
    </div>
    <div className="ai-canvas-messages">
      {!messages.length && <div className="ai-canvas-welcome"><h3>说出想法，我来画。</h3><p>直接描述要生成或修改的内容，我会在白板上执行。不需要先选模式或点应用。</p>
        {["画一个需求评审到上线的流程图", "把白板里的英文改成中文，保留样式"].map(text => <button className="ai-canvas-suggestion" key={text} onClick={() => setPrompt(text)}>{text}</button>)}
      </div>}
      {messages.map((message, i) => <article className={`ai-message ${message.role}`} key={i}><strong>{message.role === "user" ? "你" : "AI"}</strong><div>{message.content}</div></article>)}
      {busy && <div className="ai-canvas-progress" role="status">
        <span className="ai-working-dot" />{phase === "planning" ? "正在理解需求、规划白板操作…" : phase === "stopping" ? "正在停止并保存已执行内容…" : `${progress?.label ?? "准备绘制"} ${progress ? `${progress.done}/${progress.total}` : ""}`}
      </div>}
      {error && <Alert type="warning" title={error} />}
      <div ref={end} />
    </div>
    <div className="ai-canvas-composer">
      {needsSave && <Button onClick={() => {
        void target.retrySave().then(() => { if (alive.current) { setNeedsSave(false); setError(""); } })
          .catch(failure => { if (alive.current) setError(String(failure)); });
      }}>重试保存已执行内容</Button>}
      <Input.TextArea aria-label="与白板 AI 对话" value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy || needsSave} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="描述你想画什么，或哪里需要修改…" onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
      }} />
      <div className="ai-canvas-send"><small>发送后直接操作白板 · ⌘/Ctrl + Enter</small>{busy ? <Button disabled={phase === "stopping"} onClick={stop}>停止</Button> : <Button type="primary" disabled={!native || !prompt.trim() || needsSave} onClick={() => void send()}>发送</Button>}</div>
      <small className="ai-canvas-disclosure">勾选时，仅当前白板的文字与图形结构发给所选模型，不含图片文件。规划后分步绘制；已有内容不被整板覆盖。</small>
    </div>
  </div>;
}

export default function WhiteboardAiSidebar({ boardId, attachment, target, onAttach, onDetach, onClose, onWriteState }: {
  boardId: string | null; attachment: SelectionSnapshot | null; target: CanvasConversationTarget; onAttach(): void;
  onDetach(): void; onClose(): void; onWriteState(value: boolean): void;
}) {
  return <AiSidebar onClose={onClose}>
    <CanvasConversation boardId={boardId} attachment={attachment} target={target} onAttach={onAttach} onDetach={onDetach} onWriteState={onWriteState} />
  </AiSidebar>;
}
