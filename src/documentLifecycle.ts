// Tools register durable saves here so closing or relocating a workspace cannot
// abandon a pending document write, including after its editor is unmounted.
const flushers = new Map<() => Promise<void>, string | undefined>();
export function registerDocumentFlusher(flush: () => Promise<void>, toolId?: string) {
  flushers.set(flush, toolId);
  return () => { flushers.delete(flush); };
}
export async function flushDocuments() {
  for (const flush of flushers.keys()) await flush();
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

// Switching these file-backed tools only needs their pending content writes.
// Closing, relocating and sync still use the complete registry above.
export async function flushBeforeToolSwitch(toolId: string) {
  if (toolId !== "app.doc" && toolId !== "app.story-comic") return flushDocuments();
  for (const [flush, owner] of flushers) {
    if (owner === toolId) await flush();
  }
}
