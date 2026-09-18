import { flushDocuments } from "./documentLifecycle";
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
export async function pauseSyncForUpdate() {
  syncPaused = true;
  try { await activeSync; } catch { /* Local saves remain authoritative. */ }
  return () => { syncPaused = false; };
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
  if (autosyncTimer) clearTimeout(autosyncTimer);
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
      // The network phase allows editing. Only the short local activation is
      // protected from new input, so editors cannot save an obsolete snapshot.
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
