import { stopAiRequests } from "./ai/client";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { native, pauseSyncForUpdate } from "./workspace";
import { flushDocuments } from "./documentLifecycle";

export type UpdateState = {
  phase: "idle" | "checking" | "available" | "downloading" | "verifying" | "saving" | "installing" | "restart" | "current" | "error" | "unconfigured";
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
function interruptedDownload(error: unknown) {
  return /error decoding response body|error reading a body|error sending request|connection (?:reset|closed|aborted)|unexpected eof|incomplete message|timed? out|timeout|http2.*(?:error|reset)/i.test(String(error));
}
async function downloadUpdate(update: Update, version: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let total = 0, received = 0;
    const prefix = attempt === 1 ? "正在下载更新" : `正在重新下载更新（${attempt}/3）`;
    publish({ phase: "downloading", version, message: `${prefix}…` });
    try {
      await update.download(event => {
        if (event.event === "Started") { total = event.data.contentLength ?? 0; received = 0; }
        if (event.event === "Progress") received += event.data.chunkLength;
        if (event.event === "Finished") {
          publish({ phase: "verifying", version, message: "下载传输结束，正在校验更新包签名…" });
          return;
        }
        // Byte counts are estimates; 100% must not precede stream completion.
        const progress = total ? Math.min(99, Math.floor(received / total * 100)) : undefined;
        publish({ phase: "downloading", version, progress, message: progress === undefined ? `${prefix}…` : `${prefix} ${progress}%` });
      }, { timeout: 10 * 60 * 1000 });
      return;
    } catch (error) {
      // Retry transport interruptions only. Signature and installation failures
      // must not be hidden or bypassed. The plugin verifies every full download.
      if (attempt === 3 || !interruptedDownload(error)) throw error;
      publish({ phase: "downloading", version, message: `下载连接中断，正在重新连接（${attempt + 1}/3）…` });
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
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
      await downloadUpdate(candidate, version);
      downloaded = true;
    }
    publish({ phase: "saving", version, message: "更新包校验通过，正在保存文档…" });
    installing = true;
    resume = await pauseSyncForUpdate();
    root.inert = true;
    await stopAiRequests();
    await flushDocuments();
    // Download and installation are separate so Windows can never exit before
    // durable local saves finish. The updater verifies the package signature.
    publish({ phase: "installing", version, message: "正在安装更新，即将重启…" });
    downloaded = false;
    await candidate.install();
    candidate = null;
    publish({ phase: "restart", version, message: "更新已安装，点击重新启动" });
    await relaunch();
  } catch (error) {
    if (updateState().phase === "restart") publish({ ...state, message: `更新已安装，重启失败；点击重试或手动重新打开：${String(error)}` });
    else if (updateState().phase === "downloading" && interruptedDownload(error))
      publish({ phase: "error", version, message: "更新包下载中断，自动重试仍未成功。请检查网络或代理后点击重试；当前版本未更改。" });
    else {
      const stage = updateState().phase;
      const label = stage === "verifying" ? "更新包签名校验失败" : stage === "saving" ? "更新前保存失败，尚未安装" : stage === "installing" ? "安装更新失败" : "下载更新包失败";
      publish({ phase: "error", version, message: `${label}，点击重试：${String(error)}` });
    }
  } finally {
    installing = false;
    root.inert = wasInert;
    resume?.();
    busy = false;
  }
}
