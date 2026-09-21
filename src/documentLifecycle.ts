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

// Editors can keep a text-editing session alive while a toolbar temporarily has
// focus. Sync must not make that session inert or remount it during activation.
const syncActivationBlockers = new Set<() => boolean>();
export function registerSyncActivationBlocker(blocked: () => boolean) {
  syncActivationBlockers.add(blocked);
  return () => { syncActivationBlockers.delete(blocked); };
}
export function isSyncActivationBlocked() {
  return [...syncActivationBlockers].some(blocked => blocked());
}
