import { useEffect, useRef, useState } from "react";
import { refreshDocumentClickDiagnostics, startDocumentClickDiagnostics, type ClickDiagnosticSnapshot } from "./clickDiagnostics";

function displaySnapshot(panel: HTMLElement, snapshot: ClickDiagnosticSnapshot) {
  const doc = panel.ownerDocument;
  const fragment = doc.createDocumentFragment();
  const text = (tag: string, value: string, parent: Node = fragment) => {
    const element = doc.createElement(tag);
    element.textContent = value;
    parent.appendChild(element);
    return element;
  };
  text("strong", "文档点击诊断 v3 · ⌥⇧D 关闭");
  text("div", `JS 记录通道：${snapshot.channelReady ? "自检通过" : "自检未通过"}`);
  text("div", `窗口：${snapshot.focused ? "已激活" : "未激活"} · 输入保护：${snapshot.inert ? "开启" : "关闭"}`);
  text("div", `事件记录：${snapshot.capturedEvents} · 选择请求：${snapshot.selectionRequests} · 手动快照：${snapshot.manualSnapshots}`);
  text("div", `按住标记：${snapshot.pressed ? "保留（未见终止事件）" : "无"}`);
  text("p", "点击问题项后点下方“读取记录”，再截图。无需刷新快捷键；最新记录在上。");
  const list = text("ol", "");
  for (const entry of [...snapshot.entries].reverse()) {
    const item = text("li", "", list);
    text("b", `${entry.sequence}. ${entry.label}`, item);
    if (entry.detail) text("span", entry.detail, item);
  }
  // Updating this isolated, pointer-transparent panel must not flush pending
  // React selection updates or rerender the editor we are trying to observe.
  panel.replaceChildren(fragment);
}

export default function ClickDiagnostics() {
  const [enabled, setEnabled] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.isComposing) return;
      if (event.code !== "KeyD" && !(event.code === "KeyS" && enabled)) return;
      event.preventDefault();
      // Only these diagnostic shortcuts are consumed, never pointer/click events.
      // A snapshot must not enter the editor's keyboard handlers or force React
      // to flush its pending selection as a side effect of taking the snapshot.
      event.stopPropagation();
      if (event.repeat) return;
      if (event.code === "KeyD") setEnabled(value => !value);
      else refreshDocumentClickDiagnostics();
    };
    window.addEventListener("keydown", toggle, true);
    return () => window.removeEventListener("keydown", toggle, true);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const host = panel.current;
    if (!host) return;
    const doc = host.ownerDocument;
    const view = doc.createElement("div");
    const controls = doc.createElement("div");
    controls.className = "document-click-diagnostics-controls";
    const read = doc.createElement("button");
    read.type = "button";
    read.textContent = "读取记录";
    read.setAttribute("aria-label", "读取点击诊断记录");
    const readStatus = doc.createElement("span");
    readStatus.className = "document-click-read-status";
    readStatus.textContent = "按钮响应：0";
    let readRequests = 0;
    // A stable native DOM control bypasses both the refresh hotkey and React's
    // delegated click handler. Keep the editor's focus and selection untouched.
    for (const type of ["pointerdown", "pointerup", "mouseup"]) {
      read.addEventListener(type, event => event.stopPropagation());
    }
    read.addEventListener("mousedown", event => {
      event.preventDefault();
      event.stopPropagation();
    });
    read.addEventListener("click", event => {
      event.stopPropagation();
      // Independent feedback distinguishes an unreceived button click from an
      // expired recording session or a snapshot rendering failure.
      readStatus.textContent = `按钮响应：${++readRequests}`;
      try {
        if (!refreshDocumentClickDiagnostics()) readStatus.textContent += "（记录会话未启用）";
      } catch {
        readStatus.textContent += "（快照读取失败）";
      }
    });
    controls.append(read, readStatus);
    host.replaceChildren(view, controls);
    const stop = startDocumentClickDiagnostics(doc, snapshot => displaySnapshot(view, snapshot));
    return () => { stop(); host.replaceChildren(); };
  }, [enabled]);
  if (!enabled) return null;
  return <aside ref={panel} className="document-click-diagnostics" aria-label="文档点击诊断" aria-live="off" />;
}
