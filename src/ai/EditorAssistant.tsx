import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Select } from "antd";
import { ai } from "./client";
import { native } from "../workspace";
import { registerSyncActivationBlocker } from "../documentLifecycle";
import { diagramConnection, editorMessages, parseEditorDraft, type ApplyMode, type EditorDraft, type EditorSnapshot, type EditorTarget } from "./editing";

export function DraftPreview({ draft }: { draft: EditorDraft }) {
  const marker = useId().replace(/:/g, "");
  if (draft.kind === "document") return <div className="ai-document-preview">
    {draft.blocks.map((block, index) => {
      if (block.type === "heading") return block.level === 1 ? <h2 key={index}>{block.text}</h2> : <h3 key={index}>{block.text}</h3>;
      if (block.type === "paragraph") return <p key={index}>{block.text}</p>;
      if (block.type === "table") return <div className="ai-preview-table" key={index}><table><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div>;
      const Tag = block.type === "bullets" ? "ul" : "ol";
      return <Tag key={index}>{block.items.map((item, i) => <li key={i}>{item}</li>)}</Tag>;
    })}
  </div>;
  const minX = Math.min(...draft.nodes.map(n => n.x)) - 50, minY = Math.min(...draft.nodes.map(n => n.y)) - 50;
  const maxX = Math.max(...draft.nodes.map(n => n.x + n.width)) + 50, maxY = Math.max(...draft.nodes.map(n => n.y + n.height)) + 50;
  return <div className="ai-diagram-preview"><svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="img" aria-label={`${draft.title}白板预览`}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#647b71" /></marker></defs>
    {draft.edges.map((edge, i) => {
      const a = draft.nodes.find(n => n.id === edge.from)!, b = draft.nodes.find(n => n.id === edge.to)!;
      const { start, end } = diagramConnection(a, b);
      return <g key={i}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#647b71" strokeWidth="2" markerEnd={`url(#${marker})`} />{edge.label && <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 8} textAnchor="middle" fontSize="14" fill="#345347">{edge.label}</text>}</g>;
    })}
    {draft.nodes.map(node => <g key={node.id}>
      {node.shape === "ellipse" ? <ellipse cx={node.x + node.width / 2} cy={node.y + node.height / 2} rx={node.width / 2} ry={node.height / 2} fill="#edf4f0" stroke="#376c58" /> : node.shape === "diamond" ? <polygon points={`${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y + node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y + node.height / 2}`} fill="#edf4f0" stroke="#376c58" /> : <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="6" fill="#edf4f0" stroke="#376c58" />}
      <foreignObject x={node.x + node.width * .16} y={node.y + node.height * .12} width={node.width * .68} height={node.height * .76}><div className="ai-diagram-label">{node.label}</div></foreignObject>
    </g>)}
  </svg><small>预览为布局示意；应用后生成可编辑图形、文字与连线。</small></div>;
}

type Proposal = { draft: EditorDraft; source: EditorSnapshot };
export default function EditorAssistant({ toolId, target, onApplying }: { toolId: string; target: EditorTarget; onApplying: (value: boolean) => void }) {
  const label = target.kind === "document" ? "文档" : "白板";
  const [prompt, setPrompt] = useState("");
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [mode, setMode] = useState<ApplyMode>(target.capture().id ? "append" : "create");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [applied, setApplied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const applyLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const unblock = registerSyncActivationBlocker(() => applyLock.current);
    return () => { alive.current = false; controller.current?.abort(); unblock(); };
  }, []);
  async function generate() {
    if (!prompt.trim() || controller.current || applyLock.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setNotice(""); setProposal(null); setApplied(false);
    try {
      const source = target.capture();
      const result = await ai.generate({ toolId, messages: editorMessages(target.kind, prompt, source, attach), record: true }, abort.signal);
      if (!alive.current || abort.signal.aborted) return;
      const draft = parseEditorDraft(result.text, target.kind);
      setProposal({ draft, source });
      if (result.saveError) setNotice("草稿已生成，但 AI 历史记录保存失败；草稿尚未应用到文件。");
    } catch (e) { if (alive.current) setError(abort.signal.aborted ? "已停止生成，未修改任何文件。" : String(e)); }
    finally { controller.current = null; if (alive.current) setBusy(false); }
  }
  async function apply() {
    if (!proposal || applied || applyLock.current || controller.current) return;
    applyLock.current = true; setApplying(true); onApplying(true); setError("");
    try {
      const result = await target.apply(proposal.draft, proposal.source, mode);
      if (!alive.current) return;
      // Even an unsaved local application consumes the proposal, avoiding a
      // duplicate append on retry. Existing editor save retry handles disk errors.
      setApplied(true); setNotice(result.message);
      if (!result.saved) setError(result.message);
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { applyLock.current = false; if (alive.current) setApplying(false); onApplying(false); }
  }
  return <div className="ai-editor-panel">
    <div className="ai-editor-intro"><strong>生成可编辑{label}，应用到当前文件</strong><p>不会只返回操作说明。先生成草稿并预览，再由你确认写入。</p></div>
    <Input.TextArea aria-label={`描述要生成的${label}`} value={prompt} disabled={busy || applying} onChange={e => setPrompt(e.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} placeholder={target.kind === "document" ? "例如：整理当前文档，补充实施计划和验收清单；或生成一份项目周报。" : "例如：绘制需求评审 → 开发 → 测试 → 发布的流程图，标出测试不通过的返回路径。"} />
    <div className="ai-compose-actions"><Checkbox checked={attach} disabled={busy || applying || !target.capture().id} onChange={e => setAttach(e.target.checked)}>附带当前内容（发送给所选模型）</Checkbox>{busy ? <Button onClick={() => controller.current?.abort()}>停止生成</Button> : <Button type="primary" disabled={!native || !prompt.trim() || applying} onClick={() => void generate()}>生成{label}草稿</Button>}</div>
    {!attach && <small>未附带当前内容；如需基于现有{label}改写，请勾选上方选项。</small>}
    {busy && <p role="status">正在生成草稿，当前文件不会被改动…</p>}
    {error && <Alert type="warning" title={error} />}
    {notice && !error && <Alert type={applied ? "success" : "info"} title={notice} />}
    {proposal && <section className="ai-draft-card" aria-label="AI 草稿预览">
      <header><strong>{proposal.draft.title}</strong><small>{applied ? "已应用" : "草稿预览 · 尚未写入文件"}</small></header>
      <DraftPreview draft={proposal.draft} />
      <div className="ai-draft-actions"><Select aria-label="应用草稿方式" value={mode} disabled={applying || applied} options={[
        { value: "append", label: `追加到当前${label}`, disabled: !proposal.source.id },
        { value: "replace", label: `替换当前${label}${target.kind === "document" ? "正文" : ""}`, disabled: !proposal.source.id },
        { value: "create", label: `另存为新${label}` },
      ]} onChange={setMode} /><Button type="primary" loading={applying} disabled={applied} onClick={() => void apply()}>{applied ? "已应用" : mode === "create" ? `创建新${label}` : mode === "replace" ? "确认替换当前内容" : `应用到当前${label}`}</Button></div>
      <small>{mode === "replace" ? "将替换当前内容；生成后已有新编辑时会拒绝覆盖。写入前会先保存当前版本，请确认替换范围。" : mode === "append" ? "保留已有内容并追加；不会更改当前文件名称。" : "保留当前文件，使用草稿标题创建新的独立文件。"}</small>
    </section>}
    {!native && <Alert type="info" title="模型调用需要在桌面版中使用。" />}
  </div>;
}
