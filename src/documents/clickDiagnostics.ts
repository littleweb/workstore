// Opt-in, in-memory diagnostics only. Never retain document IDs/titles/content,
// file paths, event targets, key text, or exception strings.
export type ClickDiagnosticEntry = {
  sequence: number;
  label: string;
  detail: string;
};
export type ClickDiagnosticSnapshot = {
  entries: ClickDiagnosticEntry[];
  focused: boolean;
  inert: boolean;
  pressed: boolean;
  capturedEvents: number;
  selectionRequests: number;
  manualSnapshots: number;
  channelReady: boolean;
};
type Session = {
  document: Document;
  entries: ClickDiagnosticEntry[];
  sequence: number;
  pressed: boolean;
  capturedEvents: number;
  selectionRequests: number;
  manualSnapshots: number;
  channelReady: boolean;
  lastHoverRole?: string;
  notify: (snapshot: ClickDiagnosticSnapshot) => void;
};
let session: Session | undefined;
const PROBE_EVENT = "workstore-diagnostic-probe";

function snapshot(current: Session): ClickDiagnosticSnapshot {
  return {
    entries: current.entries.map(entry => ({ ...entry })),
    focused: current.document.hasFocus(),
    inert: !!current.document.body.inert || current.document.body.hasAttribute("inert"),
    pressed: current.pressed,
    capturedEvents: current.capturedEvents,
    selectionRequests: current.selectionRequests,
    manualSnapshots: current.manualSnapshots,
    channelReady: current.channelReady,
  };
}
function append(current: Session, label: string, detail = "") {
  const entry = { sequence: ++current.sequence, label, detail };
  current.entries = [...current.entries.slice(-23), entry];
  return entry;
}
const stages = {
  mouseSelection: "鼠标按下已接受选择",
  compositionPending: "等待输入法提交后切换",
  selected: "选择请求已收到",
  saving: "开始保存当前内容",
  saved: "保存完成",
  loading: "开始载入目标",
  loaded: "目标载入完成",
  applied: "提交选中状态",
  rendered: "选中视图已提交",
  ignored: "已在当前文档，无需切换",
  superseded: "请求被后续选择取代",
  failed: "切换失败（原内容保留）",
} as const;
export function recordDocumentClickStage(stage: keyof typeof stages) {
  if (session) {
    if (stage === "selected") session.selectionRequests++;
    append(session, stages[stage]);
  }
}

// Mouse/hover/input observations never repaint the UI: doing so could change
// WebView hit testing while investigating it. Only an explicit snapshot
// publishes the buffer, including when a terminal mouse event was never seen.
export function refreshDocumentClickDiagnostics(): boolean {
  if (!session) return false;
  const current = session;
  current.manualSnapshots++;
  append(current, "手动快照", current.pressed ? "仍未观察到松开或 click" : "当前无按住标记");
  current.notify(snapshot(current));
  return true;
}

export function startDocumentClickDiagnostics(
  doc: Document,
  notify: (snapshot: ClickDiagnosticSnapshot) => void,
) {
  const current: Session = {
    document: doc, entries: [], sequence: 0, pressed: false,
    capturedEvents: 0, selectionRequests: 0, manualSnapshots: 0, channelReady: false, notify,
  };
  session = current;
  const propagationChecks = new Set<ReturnType<typeof setTimeout>>();
  const pending = new WeakMap<Event, { entry: ClickDiagnosticEntry; bubbled: boolean; role: string }>();
  const role = (event: Event) => {
    const target = event.target as Element | null;
    const element = typeof target?.closest === "function" ? target : null;
    const row = element?.closest(".document-row");
    const index = row ? [...doc.querySelectorAll(".document-row")].indexOf(row) + 1 : 0;
    const prefix = index ? `列表第 ${index} 行 / ` : "";
    if (element?.closest(".document-more")) return prefix + "更多按钮";
    if (element?.closest('.nav-drag-handle[draggable="true"]')) return prefix + "拖拽图标";
    if (element?.closest(".document-open")) return prefix + "文档按钮";
    if (element?.closest(".document-sidebar")) return "文档侧栏空白";
    if (element?.closest(".document-workspace")) return "正文区域";
    return "其他区域";
  };
  const labels: Record<string, string> = {
    pointerdown: "指针按下", mousedown: "鼠标按下", pointerup: "指针松开",
    mouseup: "鼠标松开", click: "原生 click", dragstart: "开始原生拖拽",
    pointercancel: "指针取消", dragend: "拖拽结束",
    pointerover: "指针进入", mouseover: "鼠标进入", contextmenu: "上下文菜单",
    focusin: "控件获得焦点", focusout: "控件失去焦点",
    compositionstart: "输入法组合开始", compositionend: "输入法组合结束",
    beforeinput: "即将输入（不记录文字）", input: "输入事件（不记录文字）",
  };
  const capture = (event: Event) => {
    if (event.type === PROBE_EVENT) {
      current.channelReady = true;
      append(current, "JS 记录通道自检通过", "仅验证监听与快照通道，不代表鼠标已收到");
      return;
    }
    const target = event.target as Element | null;
    // Reading the panel must not pollute the evidence for the document click.
    if (typeof target?.closest === "function" && target.closest(".document-click-diagnostics")) return;
    if (event.type === "pointerdown" || event.type === "mousedown") current.pressed = true;
    if (["pointerup", "mouseup", "pointercancel", "dragend", "click", "contextmenu"].includes(event.type)) current.pressed = false;
    const targetRole = role(event);
    if (event.type === "pointerover" || event.type === "mouseover") {
      if (current.lastHoverRole === targetRole) return;
      current.lastHoverRole = targetRole;
    }
    current.capturedEvents++;
    const entry = append(current, labels[event.type], targetRole);
    const observed = { entry, role: targetRole, bubbled: false };
    pending.set(event, observed);
    // Browser-dispatched events may run microtasks between capture and bubble
    // listeners. Only check in the next task, otherwise normal propagation can
    // be misreported as intercepted (dispatchEvent-based tests hide that gap).
    const check = setTimeout(() => {
      propagationChecks.delete(check);
      if (session !== current) return;
      entry.detail = `${targetRole} · ${observed.bubbled ? "冒泡到达" : "冒泡未到达"}${event.defaultPrevented ? " · 默认动作被取消" : ""}`;
    }, 0);
    propagationChecks.add(check);
  };
  const bubble = (event: Event) => {
    const observed = pending.get(event);
    if (observed) observed.bubbled = true;
  };
  const focus = (event: Event) => {
    if (event.type === "blur") current.pressed = false;
    append(current, event.type === "focus" ? "窗口已激活" : "窗口失去焦点");
  };
  // Window capture runs before document/React/editor event handlers. Listening
  // on document alone can mistake an intercepted event for an absent event.
  const boundary = doc.defaultView ?? doc;
  for (const type of Object.keys(labels)) {
    boundary.addEventListener(type, capture, { capture: true, passive: true });
    boundary.addEventListener(type, bubble, { passive: true });
  }
  const recoverRelease = (event: Event) => {
    if (current.pressed && (event as PointerEvent).buttons === 0) {
      current.pressed = false;
      append(current, "按住标记已解除", "移动事件确认按钮已松开");
    }
  };
  boundary.addEventListener("pointermove", recoverRelease, { capture: true, passive: true });
  doc.defaultView?.addEventListener("focus", focus);
  doc.defaultView?.addEventListener("blur", focus);
  const observer = new MutationObserver(records => {
    // Keep both transitions even if a short activation sets and clears inert
    // before the observer callback runs.
    records.forEach((_, index) => {
      const value = index + 1 < records.length ? records[index + 1].oldValue : doc.body.getAttribute("inert");
      append(current, value === null ? "页面退出输入保护" : "页面进入输入保护");
    });
  });
  observer.observe(doc.body, { attributes: true, attributeFilter: ["inert"], attributeOldValue: true });
  append(current, "诊断已开启", "点击目标后使用面板下方的“读取记录”按钮");
  boundary.addEventListener(PROBE_EVENT, capture, true);
  const probe = doc.createEvent("Event");
  probe.initEvent(PROBE_EVENT, false, false);
  boundary.dispatchEvent(probe);
  boundary.removeEventListener(PROBE_EVENT, capture, true);
  if (!current.channelReady) append(current, "JS 记录通道自检未通过");
  notify(snapshot(current));
  return () => {
    for (const check of propagationChecks) clearTimeout(check);
    propagationChecks.clear();
    for (const type of Object.keys(labels)) {
      boundary.removeEventListener(type, capture, true);
      boundary.removeEventListener(type, bubble);
    }
    boundary.removeEventListener("pointermove", recoverRelease, true);
    doc.defaultView?.removeEventListener("focus", focus);
    doc.defaultView?.removeEventListener("blur", focus);
    observer.disconnect();
    current.entries = [];
    if (session === current) session = undefined;
  };
}
