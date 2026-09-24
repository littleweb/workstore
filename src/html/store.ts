import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { native } from "../workspace";
import { scheduleAutosync, registerSyncRefresher } from "../workspace";
import { registerDocumentFlusher } from "../documentLifecycle";

export type DocumentInfo = {
  id: string;
  title: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  revision: number;
};
export type Document = DocumentInfo & {
  type: "workstore.html";
  schemaVersion: 1;
  content: string;
};
export type LoadedDocument = {
  document: Document;
  token: string;
};
type Cached = LoadedDocument & {
  generation: number;
  saved: number;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  error?: string;
};
type PersistedDocument = LoadedDocument;

const cache = new Map<string, Cached>();
const subscribers = new Set<() => void>();
let summaries: DocumentInfo[] = [];
let warnings: string[] = [];
let dbPromise: Promise<IDBDatabase> | undefined;

export let lastDocumentId: string | null = null;

const notify = () => subscribers.forEach((fn) => fn());
export const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
export const documentList = () => summaries;
export const documentWarnings = () => warnings;
export const currentDocument = (id: string) => cache.get(id)?.document;

export const documentStatus = (id: string) => {
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
  summaries = [
    ...summaries.filter((x) => x.id !== c.document.id),
    c.document,
  ];
  notify();
}

function database() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("workstore-html", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("documents", { keyPath: "document.id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

async function browserList(): Promise<Cached[]> {
  const db = await database();
  return new Promise<Cached[]>((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function browserLoad(id: string): Promise<Cached> {
  const db = await database();
  return new Promise<Cached>((resolve, reject) => {
    const request = db
      .transaction("documents", "readonly")
      .objectStore("documents")
      .get(id);
    request.onsuccess = () =>
      request.result
        ? resolve(request.result)
        : reject(new Error("文档不存在"));
    request.onerror = () => reject(request.error);
  });
}

async function browserWrite(document: Document, expected?: string): Promise<PersistedDocument> {
  if (new Blob([JSON.stringify(document)]).size > 64 * 1024 * 1024)
    throw new Error("文档超过 64 MB");

  const db = await database();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    const store = tx.objectStore("documents");
    const request = store.get(document.id);
    let result: PersistedDocument;
    let failure: string | undefined;

    request.onsuccess = () => {
      const previous = request.result as Cached | undefined;
      if ((expected && previous?.token !== expected) || (!expected && previous)) {
        failure = "文档已在其他窗口修改，请先导出备份再重新打开";
        tx.abort();
        return;
      }
      result = {
        document: {
          ...document,
          revision: (previous?.document.revision ?? 0) + 1,
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

export async function refreshDocuments() {
  const result = native
    ? await invoke<{ documents: DocumentInfo[]; warnings: string[] }>("list_html_documents")
    : {
        documents: (await browserList()).map((x) => x.document),
        warnings: [],
      };

  summaries = result.documents;
  warnings = result.warnings;

  for (const c of cache.values()) {
    if (c.generation > c.saved)
      summaries = [...summaries.filter((x) => x.id !== c.document.id), c.document];
  }

  notify();
}

function sanitizeTitle(value: string): string {
  return value.trim().slice(0, 120) || "未命名 HTML";
}

export async function createDocument() {
  const now = Date.now();
  const loaded = native
    ? await invoke<LoadedDocument>("create_html_document")
    : await browserWrite({
        id: crypto.randomUUID(),
        type: "workstore.html",
        schemaVersion: 1,
        title: "未命名 HTML",
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        revision: 1,
        content: "",
      });

  cache.set(loaded.document.id, { ...loaded, generation: 0, saved: 0 });
  // Creating/loading a file must not change selection: a newer click may have
  // superseded the request while I/O was in flight.
  publish(cache.get(loaded.document.id)!);
  scheduleAutosync();
  return loaded.document;
}

export async function loadDocument(id: string) {
  let cached = cache.get(id);
  if (!cached || (cached.generation === cached.saved && !cached.saving)) {
    const beforeRead = cached;
    const generation = cached?.generation;
    const token = cached?.token;
    const loaded = native
      ? await invoke<LoadedDocument>("load_html_document", { id })
      : await browserLoad(id);
    const current = cache.get(id);
    // A late read must not replace edits, an in-flight save, or a newer cache
    // installed by another load/sync while this request was awaiting disk I/O.
    if (!current || (current === beforeRead && current.generation === generation &&
      current.token === token && current.generation === current.saved && !current.saving)) {
      cached = { ...loaded, generation: 0, saved: 0 };
      cache.set(id, cached);
    } else {
      cached = current;
    }
  }
  return cached.document;
}

export function activateDocument(id: string) {
  const cached = cache.get(id);
  if (!cached) throw new Error("文档尚未载入");
  lastDocumentId = id;
  if (!cached.document.lastOpenedAt) stageDocument(id, { lastOpenedAt: Date.now() });
  return cached.document;
}

export async function openDocument(id: string) {
  await loadDocument(id);
  return activateDocument(id);
}

export async function ensureDocument(id: string) {
  return cache.get(id)?.document ?? loadDocument(id);
}

export function stageDocument(
  id: string,
  patch: Partial<Pick<Document, "content" | "title" | "favorite" | "lastOpenedAt">>,
) {
  const c = cache.get(id);
  if (!c) throw new Error("文档尚未载入");
  if (Object.entries(patch).every(([key, value]) => JSON.stringify(c.document[key as keyof typeof c.document]) === JSON.stringify(value))) return;

  const next = { ...c.document, ...patch, updatedAt: Date.now() };
  if (patch.title !== undefined) next.title = sanitizeTitle(patch.title);

  c.document = next;
  c.generation++;
  c.error = undefined;

  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    void flushDocument(id).catch(() => {});
  }, 650);

  publish(c);
}

export async function flushDocument(id: string): Promise<void> {
  const c = cache.get(id);
  if (!c) return;

  if (c.timer) {
    clearTimeout(c.timer);
    c.timer = undefined;
  }

  if (c.saving) {
    await c.saving;
    if (c.generation > c.saved) return flushDocument(id);
    return;
  }

  if (c.generation === c.saved) return;

  c.saving = (async () => {
    try {
      while (c.generation > c.saved) {
        const generation = c.generation;
        const document = c.document;
        const result = native
          ? await invoke<LoadedDocument>("save_html_document", {
              document,
              expectedToken: c.token,
            })
          : await browserWrite(document, c.token);

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

export async function flushDocuments() {
  for (const id of cache.keys()) await flushDocument(id);
}

registerDocumentFlusher(flushDocuments);

export function exportDocument(id: string) {
  const doc = currentDocument(id);
  if (!doc) return;

  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${doc.title.replace(/[\\/:*?\"<>|]/g, "_")}.html.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

if (!native)
  window.addEventListener("beforeunload", (event) => {
    if ([...cache.values()].some((c) => c.generation > c.saved)) {
      void flushDocuments().catch(() => {});
      event.preventDefault();
      event.returnValue = "";
    }
  });

const remoteVersions = new Map<string, number>();
export const remoteVersion = (id: string) => remoteVersions.get(id) ?? 0;
registerSyncRefresher(async (paths) => {
  await refreshDocuments();
  for (const [id, cached] of cache) {
    if (!paths.includes(`data/app.html/${id}.html.json`)) continue;
    if (cached.generation !== cached.saved || cached.saving) continue;
    try {
      const loaded = await invoke<LoadedDocument>("load_html_document", { id });
      if (JSON.stringify(loaded.document.content) !== JSON.stringify(cached.document.content)) {
        remoteVersions.set(id, (remoteVersions.get(id) ?? 0) + 1);
      }
      cache.set(id, { ...loaded, generation: 0, saved: 0 });
    } catch (error) {
      const exists = documentList().some((item) => item.id === id);
      if (exists) throw error;
      cache.delete(id);
    }
  }
  flushSync(() => notify());
});

// AI/imported content deliberately starts a new editor session. Local typing
// still uses stageDocument and never feeds htmlContent back into TeaEditor.
export function applyDocumentContent(id: string, content: string) {
  if (!cache.has(id)) throw new Error("文档尚未载入");
  flushSync(() => {
    remoteVersions.set(id, remoteVersion(id) + 1);
    stageDocument(id, { content });
    notify();
  });
}
