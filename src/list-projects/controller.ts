import { emptyProjects, validateProjects, type Operation, type ProjectData } from './model';
export function createProjectController(toolId: string, io: {read(): Promise<ProjectData>; mutate(operation: Operation): Promise<ProjectData>}) {
  let state = {data:emptyProjects(toolId),ready:false,busy:false,error:''};
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<()=>void>();
  const publish = (patch: Partial<typeof state>) => {state={...state,...patch};listeners.forEach(fn=>fn());};
  const enqueue = (job:()=>Promise<ProjectData>) => {
    const result = tail.then(async()=>{
      publish({busy:true});
      try { const data=validateProjects(await job(),toolId);publish({data,ready:true,error:''});return data; }
      catch(error) {publish({error:String(error)});throw error;}
      finally {publish({busy:false});}
    });
    tail=result.catch(()=>{});return result;
  };
  return {
    snapshot:()=>state,
    subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
    load:()=>enqueue(io.read),
    mutate:(operation:Operation)=>enqueue(()=>io.mutate(operation)),
    flush:async()=>{await tail;},
  };
}
