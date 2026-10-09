import {useEffect,useRef,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {designImageSource,forgetDesignImage} from './remoteSource';
export default function RemoteImage({src,alt,onClick,loading='lazy',command='design_asset'}:{src:string;alt:string;onClick?:()=>void;loading?:'lazy'|'eager';command?:string}) {
 const host=useRef<HTMLSpanElement>(null);
 const [revision,retry]=useState(0),[state,setState]=useState({key:src,url:isTauri()?'':src,status:isTauri()?'waiting':'ready'});
 const current=state.key===src?state:{key:src,url:isTauri()?'':src,status:isTauri()?'waiting':'ready'};
 useEffect(()=>{
  let live=true,running=false,visible=loading==='eager';
  setState({key:src,url:isTauri()?'':src,status:isTauri()?'waiting':'ready'});
  if(!isTauri())return;
  const load=()=>{
   if(!live||!visible||running)return;running=true;
   setState({key:src,url:'',status:'loading'});
   void designImageSource(src,command).then(url=>{if(live)setState({key:src,url,status:'ready'});}).catch(()=>{if(live)setState({key:src,url:'',status:'unavailable'});}).finally(()=>{running=false;});
  };
  const observer=typeof IntersectionObserver==='undefined'?undefined:new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting)){visible=true;observer?.disconnect();load();}
  },{rootMargin:'100px'});
  if(visible||!observer){visible=true;load();}else if(host.current)observer.observe(host.current);
  window.addEventListener('online',load);
  return()=>{live=false;observer?.disconnect();window.removeEventListener('online',load);};
 },[src,loading,command,revision]);
 return <span ref={host} className="ds-remote-image" data-asset-state={current.status}>
  {current.url?<img src={current.url} alt={alt} loading={loading} onClick={onClick} onError={()=>{forgetDesignImage(src,command);setState({key:src,url:'',status:'unavailable'});}}/>:
   <span className="ds-asset-placeholder" role="img" aria-label={alt}>{current.status==='unavailable'?<span role="button" tabIndex={0} aria-label={'重新加载'+alt} onClick={e=>{e.stopPropagation();retry(n=>n+1);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();retry(n=>n+1);}}}>图片暂不可用 · 点击重试</span>:<span>正在加载图片…</span>}</span>}
 </span>;
}
