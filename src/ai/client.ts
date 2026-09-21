import { invoke } from "@tauri-apps/api/core";
import { native, scheduleAutosync } from "../workspace";
const running = new Map<AbortController, Promise<unknown>>();
// Canvas playback continues after model generation; shutdown/update must also
// abort and await that local work before flushing files and exiting.
export async function trackAiExecution<T>(controller: AbortController, task: Promise<T>): Promise<T> {
  running.set(controller, task);
  try { return await task; } finally { running.delete(controller); }
}
export async function stopAiRequests() {
  const tasks = [...running.entries()];
  tasks.forEach(([controller]) => controller.abort());
  await Promise.allSettled(tasks.map(([, task]) => task));
}
export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type AiSettings = {
  provider: "codex" | "openai-compatible";
  codexPath: string;
  model: string;
  baseUrl: string;
  proxyUrl: string;
  timeoutSeconds: number;
  hasApiKey: boolean;
  apiKey?: string;
};
export type AiResponse = {
  id: string;
  text: string;
  provider: string;
  model: string;
  saveError: string | null;
  images?: string[];
};
export type AiRecord = {
  id: string;
  toolId: string;
  prompt: string;
  text: string;
  provider: string;
  createdAt: number;
};
function requireDesktop() {
  if (!native) throw new Error("请在 WorkStore 桌面版中使用 AI 能力");
}
/** All tools use this gateway. Only explicitly supplied messages leave the device. */
export const ai = {
  capabilities: () => {
    requireDesktop();
    return invoke<{
      text: boolean;
      imageGenerate: boolean;
      referenceImages: boolean;
      maxReferences: number;
      provider: string;
    }>("ai_capabilities");
  },
  codexStatus: () => {
    requireDesktop();
    return invoke<string>("ai_codex_status");
  },
  settings: () => {
    requireDesktop();
    return invoke<AiSettings>("ai_settings");
  },
  saveSettings: (settings: AiSettings) => {
    requireDesktop();
    return invoke<AiSettings>("ai_save_settings", { settings });
  },
  history: (toolId: string) => {
    requireDesktop();
    return invoke<AiRecord[]>("ai_history", { toolId });
  },
  async generate(
    input: {
      toolId: string;
      messages: AiMessage[];
      record?: boolean;
      image?: boolean;
      references?: string[];
    },
    signal?: AbortSignal
  ): Promise<AiResponse> {
    requireDesktop();
    if (signal?.aborted) throw new Error("已停止生成");
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const cancel = () => {
      void invoke("ai_cancel", { id }).catch(() => {});
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    // Retry cancellation to cover abort arriving before the native command registers.
    const timer = setInterval(() => {
      if (controller.signal.aborted) cancel();
    }, 200);
    const task = invoke<AiResponse>("ai_generate", {
      request: { ...input, id },
    });
    running.set(controller, task);
    try {
      const response = await task;
      if (controller.signal.aborted) throw new Error("已停止生成");
      if ((input.record || input.image) && !response.saveError)
        scheduleAutosync();
      return response;
    } finally {
      clearInterval(timer);
      running.delete(controller);
      signal?.removeEventListener("abort", forwardAbort);
      controller.signal.removeEventListener("abort", cancel);
    }
  },
};
