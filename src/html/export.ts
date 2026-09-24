import { native } from '../workspace';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
export async function exportHtmlFile(title: string, content: string, backup = false) {
  const name = (title.replace(/[\\/:*?"<>|]/g, '_') || '未命名') + (backup ? '.html.json' : '.html');
  if (native) {
    const path = await save({ defaultPath: name, filters: [{ name: backup ? '作品备份' : 'HTML', extensions: [backup ? 'json' : 'html'] }] });
    if (path) await invoke('save_html_export', { path, content });
  } else {
    const url = URL.createObjectURL(new Blob([content], { type: backup ? 'application/json' : 'text/html;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
