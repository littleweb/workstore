/** In-memory execution state. Content/results stay in each tool's local files.
 * Never persist live controllers or pretend a process survives application exit. */
export type TaskState = 'running' | 'stopping' | 'done' | 'error' | 'cancelled';
export type TaskInfo = { id: string; toolId: string; title: string; stage: string; state: TaskState; startedAt: number; endedAt?: number; done?: number; total?: number; error?: string };
const listeners = new Set<() => void>();
const controls = new Map<string, AbortController>();
const signals = new WeakMap<AbortSignal, string>();
let tasks: TaskInfo[] = [];
const emit = () => { for (const listener of listeners) listener(); };
export const subscribeTasks = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const taskSnapshot = () => tasks;
export const isRunning = (task: TaskInfo) => task.state === 'running' || task.state === 'stopping';
export function updateTask(signal: AbortSignal, patch: Partial<Pick<TaskInfo, 'title' | 'stage' | 'done' | 'total'>>) {
  const id = signals.get(signal);
  tasks = tasks.map(task => task.id === id && isRunning(task) ? {...task, ...patch} : task);
  emit();
}
export function failTask(signal: AbortSignal, error: unknown) {
  const id = signals.get(signal);
  tasks = tasks.map(task => task.id === id && isRunning(task) ? {...task, error: String(error)} : task);
  emit();
}
export function beginTask(controller: AbortController, meta: { toolId: string; title: string; stage?: string }) {
  const existing = signals.get(controller.signal);
  // Nested stages share their parent's card and cancellation.
  if (existing && controls.has(existing)) return { finish() {} };
  const id = crypto.randomUUID();
  signals.set(controller.signal, id); controls.set(id, controller);
  const abort = () => {
    tasks = tasks.map(task => task.id === id ? {...task, state: 'stopping', stage: '正在停止并保存已完成内容…'} : task); emit();
  };
  tasks = [{...meta, id, stage: meta.stage ?? '正在准备…', state: 'running', startedAt: Date.now()}, ...tasks];
  controller.signal.addEventListener('abort', abort, {once:true});
  if (controller.signal.aborted) abort(); else emit();
  let finished = false;
  return { finish(error?: unknown) {
    if (finished) return; finished = true;
    controller.signal.removeEventListener('abort', abort);
    controls.delete(id); signals.delete(controller.signal);
    tasks = tasks.map(task => task.id !== id ? task : {...task, endedAt: Date.now(), error: error === undefined ? task.error : String(error),
      state: controller.signal.aborted ? 'cancelled' : error !== undefined || task.error ? 'error' : 'done'});
    // Bound history without ever evicting a running task.
    let completed = 0;
    tasks = tasks.filter(task => isRunning(task) || ++completed <= 100);
    emit();
  }};
}
export const hasTask = (signal?: AbortSignal) => !!signal && controls.has(signals.get(signal) ?? '');
export function cancelTask(id: string) { controls.get(id)?.abort(); }
export function clearFinishedTasks() { tasks = tasks.filter(isRunning); emit(); }

export function cancelAllTasks() { for (const controller of controls.values()) controller.abort(); }
