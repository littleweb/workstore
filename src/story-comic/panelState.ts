type Panels = { controls: boolean; navigation: boolean };
const key = (id: string) => `workstore.story-comic.panels.${id}`;
export function readPanels(id?: string | null): Panels {
  try {
    const saved = id ? JSON.parse(window.localStorage.getItem(key(id)) || '{}') : {};
    return { controls: saved.controls === true, navigation: saved.navigation === true };
  } catch { return { controls: false, navigation: false }; }
}
export function savePanel(id: string | null | undefined, panel: keyof Panels, value: boolean) {
  if (!id) return;
  try { window.localStorage.setItem(key(id), JSON.stringify({ ...readPanels(id), [panel]: value })); }
  catch { /* Storage unavailable: keep the current session usable. */ }
}
