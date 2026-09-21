import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { native } from "../workspace";
import { scheduleAutosync, registerSyncRefresher } from "../workspace";
import { registerDocumentFlusher } from "../documentLifecycle";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
export type Scene = ExcalidrawInitialDataState & {
  type: "excalidraw";
  version: 2;
  source: string;
};
export type BoardInfo = {
  id: string;
  title: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  revision: number;
};
export type Board = BoardInfo & {
  type: "workstore.whiteboard";
  schemaVersion: 1;
  scene: Scene;
};
type Loaded = { document: Board; token: string };
type Cache = Loaded & {
  generation: number;
  saved: number;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  error?: string;
};
const cache = new Map<string, Cache>();
const subscribers = new Set<() => void>();
let summaries: BoardInfo[] = [];
let warnings: string[] = [];
export let lastBoardId: string | null = null;
const notify = () => subscribers.forEach((fn) => fn());
export const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
export const boardList = () => summaries;
export const boardWarnings = () => warnings;
export const currentBoard = (id: string) => cache.get(id)?.document;
export const boardStatus = (id: string) => {
  const c = cache.get(id);
  return c?.error
    ? c.error
    : c && c.generation > c.saved
      ? "正在保存…"
      : native
        ? "已保存到本地"
        : "已保存到浏览器";
};
function info(doc: Board): BoardInfo {
  const { scene, type, schemaVersion, ...meta } = doc;
  return meta;
}
function publish(c: Cache) {
  summaries = [
    ...summaries.filter((x) => x.id !== c.document.id),
    info(c.document),
  ];
  notify();
}
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("workstore-whiteboards", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("documents", { keyPath: "document.id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function browserList() {
  const db = await database();
  return new Promise<Loaded[]>((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function browserLoad(id: string) {
  const db = await database();
  return new Promise<Loaded>((resolve, reject) => {
    const req = db
      .transaction("documents", "readonly")
      .objectStore("documents")
      .get(id);
    req.onsuccess = () =>
      req.result ? resolve(req.result) : reject(new Error("白板不存在"));
    req.onerror = () => reject(req.error);
  });
}
async function browserWrite(doc: Board, expected?: string): Promise<Loaded> {
  if (new Blob([JSON.stringify(doc)]).size > 64 * 1024 * 1024)
    throw new Error("白板超过 64 MB");
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    const store = tx.objectStore("documents");
    const request = store.get(doc.id);
    let result: Loaded;
    let failure: string | undefined;
    request.onsuccess = () => {
      const previous = request.result as Loaded | undefined;
      if (
        (expected && previous?.token !== expected) ||
        (!expected && previous)
      ) {
        failure = "白板已在其他窗口修改，请先导出备份再重新打开";
        tx.abort();
        return;
      }
      result = {
        document: {
          ...doc,
          revision: (previous?.document.revision ?? 0) + 1,
          updatedAt: Date.now(),
        },
        token: crypto.randomUUID(),
      };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("浏览器存储失败"));
    tx.onabort = () => reject(new Error(failure || "浏览器存储失败"));
  });
}
export async function refreshBoards() {
  const result = native
    ? await invoke<{ documents: BoardInfo[]; warnings: string[] }>(
        "list_whiteboards",
      )
    : {
        documents: (await browserList()).map((x) => info(x.document)),
        warnings: [],
      };
  summaries = result.documents;
  warnings = result.warnings;
  for (const c of cache.values()) {
    if (c.generation > c.saved)
      summaries = [
        ...summaries.filter((x) => x.id !== c.document.id),
        info(c.document),
      ];
  }
  notify();
}
export async function createBoard() {
  const now = Date.now();
  const loaded = native
    ? await invoke<Loaded>("create_whiteboard")
    : await browserWrite({
        id: crypto.randomUUID(),
        type: "workstore.whiteboard",
        schemaVersion: 1,
        title: "未命名白板",
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        revision: 1,
        scene: {
          type: "excalidraw",
          version: 2,
          source: "WorkStore",
          elements: [],
          appState: { viewBackgroundColor: "#ffffff" },
          files: {},
        },
      });
  cache.set(loaded.document.id, { ...loaded, generation: 0, saved: 0 });
  lastBoardId = loaded.document.id;
  publish(cache.get(lastBoardId)!);
        scheduleAutosync();
  return loaded.document;
}
export async function openBoard(id: string) {
  let c = cache.get(id);
  // Re-read clean documents so external edits are reflected on reopen.
  if (!c || c.generation === c.saved) {
    const loaded = native
      ? await invoke<Loaded>("load_whiteboard", { id })
      : await browserLoad(id);
    c = { ...loaded, generation: 0, saved: 0 };
    cache.set(id, c);
  }
  lastBoardId = id;
  if (!c.document.lastOpenedAt) stageBoard(id, { lastOpenedAt: Date.now() });
  return c.document;
}
export async function ensureBoard(id: string) {
  if (!cache.has(id)) {
    const loaded = native
      ? await invoke<Loaded>("load_whiteboard", { id })
      : await browserLoad(id);
    cache.set(id, { ...loaded, generation: 0, saved: 0 });
  }
  return cache.get(id)!.document;
}
export function stageBoard(
  id: string,
  patch: Partial<Pick<Board, "scene" | "title" | "favorite" | "lastOpenedAt">>,
) {
  const c = cache.get(id);
  if (!c) throw new Error("白板尚未载入");
  if (Object.entries(patch).every(([key, value]) => JSON.stringify(c.document[key as keyof typeof c.document]) === JSON.stringify(value))) return;
  c.document = { ...c.document, ...patch, updatedAt: Date.now() };
  c.generation++;
  c.error = undefined;
  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    void flushBoard(id).catch(() => {});
  }, 650);
  publish(c);
}
export async function flushBoard(id: string): Promise<void> {
  const c = cache.get(id);
  if (!c) return;
  if (c.timer) {
    clearTimeout(c.timer);
    c.timer = undefined;
  }
  if (c.saving) {
    await c.saving;
    if (c.generation > c.saved) return flushBoard(id);
    return;
  }
  if (c.generation === c.saved) return;
  c.saving = (async () => {
    try {
      while (c.generation > c.saved) {
        const generation = c.generation;
        const doc = c.document;
        const result = native
          ? await invoke<Loaded>("save_whiteboard", {
              document: doc,
              expectedToken: c.token,
            })
          : await browserWrite(doc, c.token);
        c.token = result.token;
        c.saved = generation;
        c.error = undefined;
        c.document =
          generation === c.generation
            ? result.document
            : { ...c.document, revision: result.document.revision };
        publish(c);
        scheduleAutosync();
      }
    } catch (e) {
      c.error = "保存失败：" + String(e);
      notify();
      throw e;
    }
  })();
  try {
    await c.saving;
  } finally {
    c.saving = undefined;
  }
}
export async function flushWhiteboards() {
  for (const id of cache.keys()) await flushBoard(id);
}
registerDocumentFlusher(flushWhiteboards);
export function exportBoard(id: string) {
  const doc = currentBoard(id);
  if (!doc) return;
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${doc.title.replace(/[\\/:*?"<>|]/g, "_")}.whiteboard.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

if (!native)
  window.addEventListener("beforeunload", (event) => {
    if ([...cache.values()].some((c) => c.generation > c.saved)) {
      void flushWhiteboards().catch(() => {});
      event.preventDefault();
      event.returnValue = "";
    }
  });

const remoteVersions = new Map<string, number>();
export const remoteVersion = (id: string) => remoteVersions.get(id) ?? 0;
registerSyncRefresher(async (paths) => {
  await refreshBoards();
  for (const [id, cached] of cache) {
    if (!paths.includes(`data/app.whiteboard/${id}.whiteboard.json`)) continue;
    if (cached.generation !== cached.saved || cached.saving) continue;
    try {
      const loaded = await invoke<Loaded>("load_whiteboard", { id });
      if (JSON.stringify(loaded.document.scene) !== JSON.stringify(cached.document.scene)) {
        remoteVersions.set(id, (remoteVersions.get(id) ?? 0) + 1);
      }
      cache.set(id, { ...loaded, generation: 0, saved: 0 });
    } catch (error) {
      const exists = boardList().some((item) => item.id === id);
      if (exists) throw error;
      cache.delete(id);
    }
  }
  flushSync(() => notify());
});

export function applyBoardScene(id: string, scene: Scene) {
  if (!cache.has(id)) throw new Error("白板尚未载入");
  flushSync(() => {
    remoteVersions.set(id, remoteVersion(id) + 1);
    stageBoard(id, { scene });
    notify();
  });
}
