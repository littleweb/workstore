import { createContext, useContext, useEffect, useState, Suspense, type ComponentType } from 'react';
const Visibility = createContext(true);
export const useToolVisible = () => useContext(Visibility);
/** Stable, lazily opened tool hosts. Hiding a tool must not unmount its workers,
 * canvas executor or unsaved AI draft. Inactive hosts cannot receive input. */
export default function ToolSessions({active, tools}: {active: string; tools: Record<string, ComponentType>}) {
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => { setOpened(previous => previous.includes(active) ? previous : [...previous, active]); }, [active]);
  return Object.entries(tools).map(([id, Tool]) => opened.includes(id) || id === active ?
    <div className="tool-session" key={id} hidden={id !== active} inert={id !== active} aria-hidden={id !== active}>
      <Visibility.Provider value={id === active}><Suspense fallback={<div className="startup">正在加载工具…</div>}><Tool /></Suspense></Visibility.Provider>
    </div> : null);
}
