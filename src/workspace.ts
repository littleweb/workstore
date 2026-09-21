import { flushDocuments, isSyncActivationBlocked } from "./documentLifecycle";
import { invoke, isTauri } from "@tauri-apps/api/core";
export const native = isTauri();
export type WorkspaceData = {
  schemaVersion: number;
  entries: {
    id: string;
    favorite: boolean;
    rank: number;
    lastOpened: number | null;
  }[];
  json: string;
  color: string;
  stamp: string;
  collapsed: boolean;
};
export type Snapshot = { path: string; data: WorkspaceData };
let queue: Promise<unknown> = Promise.resolve();
let activeSync: Promise<string> | null = null;
let syncPaused = false;
let syncAgain = false;
let wakeActivationWait: (() => void) | undefined;

// Observe gestures from their beginning, not only when a network request ends.
// focusout runs between pointerdown and click; locking then discards the click.
const pressedPointers = new Set<number>();
const pressedKeys = new Set<string>();
const INTERACTION_IDLE_MS = 500;
let interactionUntil = 0;
const touchInteraction = () => { interactionUntil = Date.now() + INTERACTION_IDLE_MS; };
const releaseInteractions = () => {
  pressedPointers.clear();
  pressedKeys.clear();
  touchInteraction();
};
if (native) {
  document.addEventListener("pointerdown", event => {
    pressedPointers.add(event.pointerId);
    touchInteraction();
  }, true);
  for (const name of ["pointerup", "pointercancel"] as const) {
    document.addEventListener(name, event => {
      pressedPointers.delete(event.pointerId);
      touchInteraction();
    }, true);
  }
  document.addEventListener("pointermove", event => {
    // Recover a release outside the webview without treating ordinary hover as
    // continuous editing or keeping other fingers from finishing their gestures.
    if (event.buttons === 0 && pressedPointers.delete(event.pointerId)) touchInteraction();
  }, true);
  document.addEventListener("keydown", event => {
    pressedKeys.add(event.code || event.key);
    touchInteraction();
  }, true);
  document.addEventListener("keyup", event => {
    pressedKeys.delete(event.code || event.key);
    touchInteraction();
  }, true);
  for (const name of ["click", "dblclick", "contextmenu", "wheel"] as const) {
    document.addEventListener(name, touchInteraction, { capture: true, passive: true });
  }
  document.addEventListener("dragend", releaseInteractions, true);
  window.addEventListener("blur", releaseInteractions);
}

function isEditingText() {
  if (isSyncActivationBlocked()) return true;
  const focused = document.activeElement as HTMLElement | null;
  if (focused?.isContentEditable || focused?.tagName === "TEXTAREA") return true;
  return focused?.tagName === "INPUT" &&
    ["text", "search", "url", "tel", "email", "password", "number"].includes((focused as HTMLInputElement).type);
}

function isActivationBlocked() {
  return isEditingText() || pressedPointers.size > 0 || pressedKeys.size > 0 ||
    Date.now() < interactionUntil;
}

async function waitForInteraction() {
  while (!syncPaused && isActivationBlocked()) {
    await new Promise<void>(resolve => {
      const wake = () => {
        clearTimeout(timer);
        document.removeEventListener("focusout", wake);
        wakeActivationWait = undefined;
        resolve();
      };
      // Focusout only requests a recheck: a pointer/key gesture may still be in
      // flight. Also wait for click/dblclick and their handlers to settle. The
      // timer notices editor unmounts and the end of the interaction quiet period.
      const timer = setTimeout(wake, 100);
      wakeActivationWait = wake;
      document.addEventListener("focusout", wake);
    });
  }
}
export async function pauseSyncForUpdate() {
  syncPaused = true;
  if (autosyncTimer) {
    clearTimeout(autosyncTimer);
    autosyncTimer = null;
    syncAgain = true;
  }
  wakeActivationWait?.();
  try { await activeSync; } catch { /* Local saves remain authoritative. */ }
  return () => {
    syncPaused = false;
    if (syncAgain) { syncAgain = false; scheduleAutosync(); }
  };
}
let failures = 0;
let nextAttempt = 0;
let lastSyncStatus = "尚未同步";
const statusListeners = new Set<(message: string) => void>();
function reportSyncStatus(message: string) {
  lastSyncStatus = message;
  statusListeners.forEach((listener) => listener(message));
}
const pendingRefresh = new Set<string>();
const refreshers = new Set<(paths: string[]) => Promise<void>>();
export function registerSyncRefresher(fn: (paths: string[]) => Promise<void>) {
  refreshers.add(fn);
  return () => { refreshers.delete(fn); };
}
export function startBackgroundSync(onStatus: (message: string) => void) {
  statusListeners.add(onStatus);
  onStatus(lastSyncStatus);
  const run = () => { void syncWorkspace().catch(() => {}); };
  const resume = () => { if (document.visibilityState === "visible") run(); };
  const online = () => { nextAttempt = 0; run(); };
  const timer = setInterval(run, 60_000 + Math.floor(Math.random() * 10_000));
  window.addEventListener("focus", resume);
  window.addEventListener("online", online);
  document.addEventListener("visibilitychange", resume);
  run();
  return () => {
    statusListeners.delete(onStatus);
    clearInterval(timer);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", resume);
  };
}
let autosyncTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSYNC_DEBOUNCE_MS = 3000;

export function scheduleAutosync() {
  if (!native) return;
  if (autosyncTimer) { clearTimeout(autosyncTimer); autosyncTimer = null; }
  if (activeSync || syncPaused) { syncAgain = true; return; }
  autosyncTimer = setTimeout(() => {
    autosyncTimer = null;
    void syncWorkspace().catch(() => {});
  }, AUTOSYNC_DEBOUNCE_MS);
}
export function saveWorkspace(data: WorkspaceData): Promise<void> {
  const task = queue
    .catch(() => {})
    .then(() => invoke<boolean>("save_workspace", { data }))
    .then((changed) => {
      if (native && changed) {
        scheduleAutosync();
      }
    });
  queue = task;
  return task;
}
export function syncWorkspace(mode: "auto" | "manual" = "auto"): Promise<string> {
  if (!native) return Promise.resolve("浏览器预览不执行 GitHub 同步");
  if (syncPaused) return Promise.resolve("安装更新期间暂停同步");
  if (activeSync) return activeSync;
  if (mode === "auto" && Date.now() < nextAttempt) return Promise.resolve(lastSyncStatus);
  activeSync = (async () => {
    reportSyncStatus("正在检查其他设备的更新…");
    try {
      await flushDocuments();
      await queue;
      const id = await invoke<string | null>("sync_workspace");
      if (!id) { reportSyncStatus("未开启 GitHub 同步"); return lastSyncStatus; }
      // Making the page inert blurs inputs. Excalidraw submits and removes its
      // textarea on blur, so never do this in the middle of a text-editing session
      // (including an unchanged pull or an upload of our own local edits).
      while (!syncPaused && isActivationBlocked()) {
        reportSyncStatus("本地保存不受影响，编辑和当前操作结束后继续应用同步结果…");
        await waitForInteraction();
      }
      if (syncPaused) { syncAgain = true; return "安装更新期间暂停同步"; }
      // No workspace lock is held while waiting. Acquire the short activation
      // barrier only after editing AND the click/key gesture end, then flush the
      // latest local edits again. Never cancel, synthesize or replay user clicks.
      const root = document.body;
      const wasInert = root?.inert ?? false;
      if (root) root.inert = true;
      try {
        await flushDocuments();
        await queue;
        const result = id === "unchanged"
          ? { changed: [] as string[], message: "已与其他设备保持同步" }
          : await invoke<{ changed: string[]; message: string }>("finish_sync", { id });
        result.changed.forEach(path => pendingRefresh.add(path));
        // Reconcile lists even on a no-change pull. One broken tool must not prevent
        // the other tools from seeing their files, and failed refreshes must retry.
        const changed = [...pendingRefresh];
        const refreshErrors: string[] = [];
        for (const refresh of refreshers) {
          try { await refresh(changed); } catch (error) { refreshErrors.push(String(error)); }
        }
        if (refreshErrors.length) throw new Error("文件已同步，列表刷新未完成：" + refreshErrors.join("；"));
        pendingRefresh.clear();
        failures = 0;
        nextAttempt = Date.now() + 2000;
        reportSyncStatus(result.message);
        return result.message;
      } finally {
        if (root) root.inert = wasInert;
      }
    } catch (error) {
      failures++;
      nextAttempt = Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(failures - 1, 6));
      reportSyncStatus("同步暂未完成，将自动重试：" + String(error));
      throw error;
    } finally {
      activeSync = null;
      // Saves made during networking or a long editing session need another
      // pass; a debounced timer firing against activeSync would otherwise be lost.
      if (syncAgain && !syncPaused) { syncAgain = false; scheduleAutosync(); }
    }
  })();
  return activeSync;
}
export async function loadWorkspace() {
  return invoke<Snapshot>("load_workspace");
}
export async function relocateWorkspace(target: string) {
  await queue;
  return invoke<Snapshot>("relocate_workspace", { target });
}
