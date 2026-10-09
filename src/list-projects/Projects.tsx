import { NavigationSection } from './NavigationSection';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { App, Button, Dropdown, Input, type MenuProps } from 'antd';
import { FolderOpenOutlined, FolderOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import { projectFor } from './model';
import { projectStore } from './store';
import './projects.css';
export function useProjects(toolId: string) {
  const store=projectStore(toolId);
  const state=useSyncExternalStore(store.subscribe,store.snapshot);
  const {modal,message}=App.useApp();
  useEffect(()=>{void store.load().catch(()=>{});},[store]);
  const run=(operation: Parameters<typeof store.mutate>[0])=>{void store.mutate(operation).catch(error=>message.error(String(error)));};
  const edit=(id?:string,documentId?:string)=>{
    let name=id ? state.data.projects[id].name : '';
    let created:string|undefined;
    modal.confirm({title:id?'重命名项目':'创建项目',icon:null,okText:'保存',cancelText:'取消',
      content:<Input aria-label="项目名称" maxLength={80} defaultValue={name} placeholder="项目名称" autoFocus onChange={event=>{name=event.target.value;}}/>,
      onOk:async()=>{
        try {
          if(!name.trim())throw Error('请输入项目名称');
          if(id)await store.mutate({action:'rename',id,name});
          else {
            // Retrying a failed move must not create a second project.
            if(!created){const key=crypto.randomUUID();await store.mutate({action:'create',id:key,name});created=key;}
            if(documentId)await store.mutate({action:'move',documentId,projectId:created});
          }
        }catch(error){message.error(String(error));throw error;}
      },
    });
  };
  const projects=Object.entries(state.data.projects).filter(([,p])=>!p.deleted).sort((a,b)=>a[1].createdAt-b[1].createdAt || a[0].localeCompare(b[0]));
  return {
    ...state,projects,
    projectOf:(id:string)=>projectFor(state.data,id),
    move:(documentId:string,projectId:string)=>store.mutate({action:'move',documentId,projectId}),
    create:()=>edit(),
    rename:(id:string)=>edit(id),
    remove:(id:string)=>modal.confirm({title:`移除项目“${state.data.projects[id].name}”？`,content:'项目中的条目会回到常用或最近打开，文件内容会保留。',okText:'移除项目',cancelText:'取消',onOk:()=>store.mutate({action:'remove',id}).catch(error=>{message.error(String(error));throw error;})}),
    retry:()=>{void store.load().catch(()=>{});},
    menu:(id:string): NonNullable<MenuProps['items']>=>[{key:'list-project',label:'移入项目',disabled:!state.ready || !!state.error,children:[
      ...projects.map(([key,project])=>({key:`list-project:move:${key}`,label:project.name,disabled:projectFor(state.data,id)===key})),
      {key:'list-project:new',label:'新建项目并移入…'},
      ...(projectFor(state.data,id)?[{key:'list-project:root',label:'移出项目'}]:[]),
    ]}],
    handle:(key:string,id:string)=>{
      if(!key.startsWith('list-project:'))return false;
      if(key==='list-project:new')edit(undefined,id);
      else run({action:'move',documentId:id,projectId:key==='list-project:root'?null:key.slice('list-project:move:'.length)});
      return true;
    },
  };
}
export function ProjectSection<T extends {id:string}>({navigation,items,renderItem,activeId,onCreate}: {navigation:ReturnType<typeof useProjects>;items:T[];renderItem:(item:T)=>ReactNode;activeId?:string|null;onCreate?:(projectId:string)=>void}) {
  const [closed,setClosed]=useState<Set<string>>(new Set());
  const current=activeId ? navigation.projectOf(activeId) : null;
  useEffect(()=>{if(current)setClosed(previous=>{const next=new Set(previous);next.delete(current);return next;});},[current]);
  return <NavigationSection className="list-project-section" title="项目" action={<button aria-label="创建项目" title="创建项目" disabled={!navigation.ready || !!navigation.error || navigation.busy} onClick={navigation.create}><PlusOutlined/></button>}>
    {navigation.error ? <div className="list-project-error" role="alert">项目加载或保存失败 <Button type="link" size="small" onClick={navigation.retry}>重试</Button><span>{navigation.error}</span></div> : !navigation.ready ? <p>正在加载…</p> : !navigation.projects.length ? <p>暂无</p> : null}
    {navigation.projects.map(([id,project])=>{
      const children=items.filter(item=>navigation.projectOf(item.id)===id), expanded=!closed.has(id);
      return <div className="list-project" key={id}>
        <div className="list-project-heading"><button className="list-project-open" aria-expanded={expanded} onClick={()=>setClosed(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;})}>
          {expanded?<FolderOpenOutlined/>:<FolderOutlined/>}<span>{project.name}</span></button>
          {onCreate&&<button className="list-project-create" aria-label={`在${project.name}中创建内容`} title="创建内容" disabled={!navigation.ready||!!navigation.error||navigation.busy} onClick={()=>{setClosed(previous=>{const next=new Set(previous);next.delete(id);return next;});onCreate(id);}}><PlusOutlined/></button>}
          <Dropdown trigger={['click']} menu={{items:[{key:'rename',label:'重命名项目'},{key:'remove',label:'移除项目（保留条目）'}],onClick:({key})=>key==='rename'?navigation.rename(id):navigation.remove(id)}}><button className="list-project-more" aria-label={`${project.name}项目更多操作`}><MoreOutlined/></button></Dropdown>
        </div>
        {expanded && <div className="list-project-children">{children.length?children.map(renderItem):<p>暂无</p>}</div>}
      </div>;
    })}
  </NavigationSection>;
}
