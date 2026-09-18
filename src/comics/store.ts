import { download } from "./export";
import type { ComicContent } from "./types";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { native } from "../workspace";
import { scheduleAutosync, registerSyncRefresher } from "../workspace";
import { registerDocumentFlusher } from "../documentLifecycle";

export type ComicInfo = {
  id: string;
  title: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  revision: number;
};
export type Comic = ComicInfo & {
  type: "workstore.comic";
  schemaVersion: 1;
  content: ComicContent;
};
export type LoadedComic = {
  comic: Comic;
  token: string;
};
type Cached = LoadedComic & {
  generation: number;
  saved: number;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  error?: string;
};
type PersistedComic = LoadedComic;

const cache = new Map<string, Cached>();
const subscribers = new Set<() => void>();
let summaries: ComicInfo[] = [];
let warnings: string[] = [];
let dbPromise: Promise<IDBDatabase> | undefined;

export let lastComicId: string | null = null;

const notify = () => subscribers.forEach((fn) => fn());
export const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
export const comicList = () => [...summaries].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
export const comicWarnings = () => warnings;
export const currentComic = (id: string) => cache.get(id)?.comic;

export const comicStatus = (id: string) => {
  const c = cache.get(id);
  return c?.error
    ? c.error
    : c && c.generation > c.saved
    ? "正在保存…"
    : native
    ? "已保存到本地"
    : "已保存到浏览器";
};

function publish(c: Cached) {
  summaries = [...summaries.filter((x) => x.id !== c.comic.id), c.comic];
  notify();
}

function database() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("workstore-comics", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("comics", { keyPath: "comic.id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

async function browserList(): Promise<Cached[]> {
  const db = await database();
  return new Promise<Cached[]>((resolve, reject) => {
    const tx = db.transaction("comics", "readonly");
    const req = tx.objectStore("comics").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function browserLoad(id: string): Promise<Cached> {
  const db = await database();
  return new Promise<Cached>((resolve, reject) => {
    const request = db
      .transaction("comics", "readonly")
      .objectStore("comics")
      .get(id);
    request.onsuccess = () =>
      request.result
        ? resolve(request.result)
        : reject(new Error("漫画不存在"));
    request.onerror = () => reject(request.error);
  });
}

async function browserWrite(
  comic: Comic,
  expected?: string
): Promise<PersistedComic> {
  if (new Blob([JSON.stringify(comic)]).size > 64 * 1024 * 1024)
    throw new Error("漫画超过 64 MB");

  const db = await database();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("comics", "readwrite");
    const store = tx.objectStore("comics");
    const request = store.get(comic.id);
    let result: PersistedComic;
    let failure: string | undefined;

    request.onsuccess = () => {
      const previous = request.result as Cached | undefined;
      if (
        (expected && previous?.token !== expected) ||
        (!expected && previous)
      ) {
        failure = "漫画已在其他窗口修改，请先导出备份再重新打开";
        tx.abort();
        return;
      }
      result = {
        comic: {
          ...comic,
          revision: (previous?.comic.revision ?? 0) + 1,
          updatedAt: Date.now(),
        },
        token: crypto.randomUUID(),
      };
      store.put({ ...result, token: result.token });
    };

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("浏览器存储失败"));
    tx.onabort = () => reject(new Error(failure || "浏览器存储失败"));
  });
}

export async function refreshComics() {
  const result = native
    ? await invoke<{ comics: ComicInfo[]; warnings: string[] }>("list_comics")
    : {
        comics: (await browserList()).map((x) => x.comic),
        warnings: [],
      };

  summaries = result.comics;
  warnings = result.warnings;

  for (const c of cache.values()) {
    if (c.generation > c.saved)
      summaries = [...summaries.filter((x) => x.id !== c.comic.id), c.comic];
  }

  notify();
}

function sanitizeTitle(value: string): string {
  return value.trim().slice(0, 120) || "未命名漫画";
}

export async function createComic(content: ComicContent) {
  const now = Date.now();
  const loaded = native
    ? await invoke<LoadedComic>("create_comic", { content })
    : await browserWrite({
        id: crypto.randomUUID(),
        type: "workstore.comic",
        schemaVersion: 1,
        title: "未命名漫画",
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        revision: 1,
        content,
      });

  cache.set(loaded.comic.id, { ...loaded, generation: 0, saved: 0 });
  stageComic(loaded.comic.id, { content });
  lastComicId = loaded.comic.id;
  publish(cache.get(lastComicId)!);
  scheduleAutosync();
  return cache.get(loaded.comic.id)!.comic;
}

export async function openComic(id: string) {
  let c = cache.get(id);
  if (!c || c.generation === c.saved) {
    const loaded = native
      ? await invoke<LoadedComic>("load_comic", { id })
      : await browserLoad(id);
    c = { ...loaded, generation: 0, saved: 0 };
    cache.set(id, c);
  }

  lastComicId = id;
  if (!c.comic.lastOpenedAt) stageComic(id, { lastOpenedAt: Date.now() });
  return c.comic;
}

export async function ensureComic(id: string) {
  if (!cache.has(id)) {
    const loaded = native
      ? await invoke<LoadedComic>("load_comic", { id })
      : await browserLoad(id);
    cache.set(id, { ...loaded, generation: 0, saved: 0 });
  }
  return cache.get(id)!.comic;
}

export function stageComic(
  id: string,
  patch: Partial<Pick<Comic, "content" | "title" | "favorite" | "lastOpenedAt">>
) {
  const c = cache.get(id);
  if (!c) throw new Error("漫画尚未载入");
  if (
    Object.entries(patch).every(
      ([key, value]) =>
        JSON.stringify(c.comic[key as keyof typeof c.comic]) ===
        JSON.stringify(value)
    )
  )
    return;

  const next = { ...c.comic, ...patch, updatedAt: Date.now() };
  if (patch.title !== undefined) next.title = sanitizeTitle(patch.title);

  c.comic = next;
  c.generation++;
  c.error = undefined;

  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    void flushComic(id).catch(() => {});
  }, 650);

  publish(c);
}

export async function flushComic(id: string): Promise<void> {
  const c = cache.get(id);
  if (!c) return;

  if (c.timer) {
    clearTimeout(c.timer);
    c.timer = undefined;
  }

  if (c.saving) {
    await c.saving;
    if (c.generation > c.saved) return flushComic(id);
    return;
  }

  if (c.generation === c.saved) return;

  c.saving = (async () => {
    try {
      while (c.generation > c.saved) {
        const generation = c.generation;
        const comic = c.comic;
        const result = native
          ? await invoke<LoadedComic>("save_comic", {
              comic,
              expectedToken: c.token,
            })
          : await browserWrite(comic, c.token);

        c.token = result.token;
        c.saved = generation;
        c.error = undefined;
        c.comic =
          generation === c.generation
            ? result.comic
            : { ...c.comic, revision: result.comic.revision };
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

export async function flushComics() {
  for (const id of cache.keys()) await flushComic(id);
}

registerDocumentFlusher(flushComics);

export function exportComic(id: string) {
  const doc = currentComic(id);
  if (!doc) return;

  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  return download(
    blob,
    `${doc.title.replace(/[\\/:*?"<>|]/g, "_")}.comic.json`
  );
}

if (!native)
  window.addEventListener("beforeunload", (event) => {
    if ([...cache.values()].some((c) => c.generation > c.saved)) {
      void flushComics().catch(() => {});
      event.preventDefault();
      event.returnValue = "";
    }
  });

const remoteVersions = new Map<string, number>();
export const remoteVersion = (id: string) => remoteVersions.get(id) ?? 0;
registerSyncRefresher(async (paths) => {
  await refreshComics();
  for (const [id, cached] of cache) {
    if (!paths.includes(`data/app.comic/${id}.comic.json`)) continue;
    if (cached.generation !== cached.saved || cached.saving) continue;
    try {
      const loaded = await invoke<LoadedComic>("load_comic", { id });
      if (
        JSON.stringify(loaded.comic.content) !==
        JSON.stringify(cached.comic.content)
      ) {
        remoteVersions.set(id, (remoteVersions.get(id) ?? 0) + 1);
      }
      cache.set(id, { ...loaded, generation: 0, saved: 0 });
    } catch (error) {
      const exists = comicList().some((item) => item.id === id);
      if (exists) throw error;
      cache.delete(id);
    }
  }
  flushSync(() => notify());
});
