// Tools register durable saves here so closing or relocating a workspace cannot
// abandon a pending document write, including after its editor is unmounted.
const flushers = new Set<() => Promise<void>>();
export function registerDocumentFlusher(flush: () => Promise<void>) {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}
export async function flushDocuments() {
  for (const flush of flushers) await flush();
}
