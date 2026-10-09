// Tools register durable saves here so closing or relocating a workspace cannot
// abandon a pending document write, including after its editor is unmounted.
const flushers = new Map<() => Promise<void>, string | undefined>();
let activation: Promise<void> | null = null;
// Only editor hosts are protected during apply. Navigation can queue its latest
// intent, but must not mount a new editor until all refreshed data is coherent.
export function beginSyncActivation() {
  if (activation) throw new Error("同步结果正在应用");
  let finish!: () => void;
  activation = new Promise<void>(resolve => { finish = resolve; });
  return () => { activation = null; finish(); };
}
export async function runAfterSyncActivation(action: () => void) {
  while (activation) await activation;
  action();
}
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

// Every switch drains only the departing tool, never unrelated background jobs.
// Closing, relocating and sync still use the complete registry above.
export async function flushBeforeToolSwitch(toolId: string) {
  while (activation) await activation;
  for (const [flush, owner] of flushers) {
    if (owner === toolId) await flush();
  }
}
