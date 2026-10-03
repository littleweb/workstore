export type Project = {name: string; createdAt: number; deleted: boolean};
export type ProjectData = {type: 'workstore.list-projects'; schemaVersion: 1; toolId: string; projects: Record<string, Project>; memberships: Record<string, string | null>};
export type Operation = {action:'create';id:string;name:string} | {action:'rename';id:string;name:string} | {action:'remove';id:string} | {action:'move';documentId:string;projectId:string|null};
export const emptyProjects = (toolId: string): ProjectData => ({type:'workstore.list-projects',schemaVersion:1,toolId,projects:{},memberships:{}});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validateProjects(value: unknown, tool: string): ProjectData {
  if (!object(value) || value.type !== 'workstore.list-projects' || value.schemaVersion !== 1 || value.toolId !== tool || !object(value.projects) || !object(value.memberships)) throw Error('项目数据格式不兼容');
  if (Object.keys(value.projects).length > 2000 || Object.keys(value.memberships).length > 100000) throw Error('项目数据超过容量限制');
  for (const [id, p] of Object.entries(value.projects)) if (!uuid.test(id) || !object(p) || typeof p.name !== 'string' || !p.name.trim() || [...p.name].length > 80 || typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt) || p.createdAt < 0 || typeof p.deleted !== 'boolean') throw Error('项目数据无效');
  for (const [id, p] of Object.entries(value.memberships)) if (!uuid.test(id) || (p !== null && (typeof p !== 'string' || !uuid.test(p)))) throw Error('项目归属无效');
  return value as ProjectData;
}
export function projectFor(data: ProjectData, documentId: string): string | null {
  const id = data.memberships[documentId];
  return id && data.projects[id] && !data.projects[id].deleted ? id : null;
}
export function applyOperation(source: ProjectData, operation: Operation): ProjectData {
  const id = operation.action === "move" ? operation.documentId : operation.id;
  if (!uuid.test(id)) throw Error("项目或条目 ID 无效");
  const data = structuredClone(source);
  if (operation.action === 'create') {
    if (data.projects[operation.id]) throw Error('项目已存在');
    data.projects[operation.id] = {name:operation.name.trim(),createdAt:Date.now(),deleted:false};
  } else if (operation.action === 'move') {
    if (operation.projectId && (!data.projects[operation.projectId] || data.projects[operation.projectId].deleted)) throw Error('项目已移除，请刷新后重试');
    data.memberships[operation.documentId] = operation.projectId;
  } else {
    const project = data.projects[operation.id];
    if (!project || project.deleted) throw Error('项目已移除，请刷新后重试');
    if (operation.action === 'rename') project.name = operation.name.trim(); else project.deleted = true;
  }
  return validateProjects(data, data.toolId);
}
