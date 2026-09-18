import { stopAiRequests } from "./ai/client";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { native, pauseSyncForUpdate } from "./workspace";
import { flushDocuments } from "./documentLifecycle";

export type UpdateState = {
  phase: "idle" | "checking" | "available" | "downloading" | "installing" | "restart" | "current" | "error" | "unconfigured";
  version?: string;
  progress?: number;
  message: string;
};
let state: UpdateState = { phase: "idle", message: "检查更新" };
const listeners = new Set<() => void>();
let candidate: Update | null = null;
let downloaded = false;
let busy = false;
let installing = false;
export const isInstallingUpdate = () => installing;
export const updateState = () => state;
export function subscribeUpdates(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function publish(next: UpdateState) { state = next; listeners.forEach(fn => fn()); }
export async function checkUpdates() {
  if (busy || candidate || state.phase === "restart") return;
  if (!native) { publish({ phase: "unconfigured", message: "请在桌面客户端中检查更新" }); return; }
  busy = true;
  publish({ phase: "checking", message: "正在检查更新…" });
  try {
    if (!await invoke<boolean>("updater_configured")) {
      publish({ phase: "unconfigured", message: "此构建尚未配置版本发布地址" }); return;
    }
    candidate = await check({ timeout: 20_000 });
    publish(candidate
      ? { phase: "available", version: candidate.version, message: `发现新版本 ${candidate.version}，点击下载并更新` }
      : { phase: "current", message: "当前已是最新版本" });
  } catch (error) {
    const detail = String(error);
    const message = detail.includes("valid release JSON")
      ? "暂时无法读取更新清单，请稍后重试；若持续出现，请确认发布版本包含 latest.json"
      : `检查失败，点击重试：${detail}`;
    publish({ phase: "error", message });
  }
  finally { busy = false; }
}
export async function installUpdate() {
  if (busy) return;
  if (state.phase === "restart") {
    busy = true;
    try { await relaunch(); } catch (error) { publish({ ...state, message: `重启失败，请重新打开应用：${String(error)}` }); }
    finally { busy = false; }
    return;
  }
  if (!candidate) { await checkUpdates(); return; }
  busy = true;
  const version = candidate.version;
  let resume: (() => void) | undefined;
  const root = document.body;
  const wasInert = root.inert;
  try {
    if (!downloaded) {
      publish({ phase: "downloading", version, message: "正在下载更新…" });
      let total = 0, received = 0;
      await candidate.download(event => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") received += event.data.chunkLength;
        const progress = total ? Math.min(100, Math.round(received / total * 100)) : undefined;
        publish({ phase: "downloading", version, progress, message: progress === undefined ? "正在下载更新…" : `正在下载更新 ${progress}%` });
      }, { timeout: 10 * 60 * 1000 });
      downloaded = true;
    }
    publish({ phase: "installing", version, message: "正在保存文档并安装，即将重启…" });
    installing = true;
    resume = await pauseSyncForUpdate();
    root.inert = true;
    await stopAiRequests();
    await flushDocuments();
    // Download and installation are separate so Windows can never exit before
    // durable local saves finish. The updater verifies the package signature.
    downloaded = false;
    await candidate.install();
    candidate = null;
    publish({ phase: "restart", version, message: "更新已安装，点击重新启动" });
    await relaunch();
  } catch (error) {
    if (updateState().phase === "restart") publish({ ...state, message: `更新已安装，重启失败；点击重试或手动重新打开：${String(error)}` });
    else publish({ phase: "error", version, message: `更新未完成，点击重试：${String(error)}` });
  } finally {
    installing = false;
    root.inert = wasInert;
    resume?.();
    busy = false;
  }
}
