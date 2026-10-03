import { invoke } from '@tauri-apps/api/core';
import { native, registerSyncRefresher, scheduleAutosync } from '../workspace';
import { registerDocumentFlusher } from '../documentLifecycle';
import { applyOperation, emptyProjects, validateProjects, type ProjectData } from './model';
import { createProjectController } from './controller';
const stores = new Map<string, ReturnType<typeof createProjectController>>();
export function projectStore(toolId: string) {
  const found=stores.get(toolId);if(found)return found;
  const read = async () => {
    if(native)return invoke<ProjectData>('list_projects',{toolId});
    const raw=localStorage.getItem(`workstore.projects.${toolId}`);
    return raw ? validateProjects(JSON.parse(raw),toolId) : emptyProjects(toolId);
  };
  const store=createProjectController(toolId, {read,mutate:async operation=>{
    const data=native ? await invoke<ProjectData>('update_list_project',{toolId,operation}) : applyOperation(await read(),operation);
    if(!native)localStorage.setItem(`workstore.projects.${toolId}`,JSON.stringify(data));
    scheduleAutosync();return data;
  }});
  stores.set(toolId,store);
  registerDocumentFlusher(store.flush,toolId);
  registerSyncRefresher(async()=>{await store.load();});
  return store;
}
