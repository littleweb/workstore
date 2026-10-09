import {useEffect,useState,type ComponentProps} from 'react';
import {courseAssetSource,forgetCourseAsset} from './assets';
type Props=ComponentProps<'video'>&{audio?:boolean};
export default function AssetMedia({src,poster,audio=false,...props}:Props){
 const [revision,retry]=useState(0),[state,setState]=useState({key:src,url:'',poster:'',error:''});
 useEffect(()=>{let live=true;setState({key:src,url:'',poster:'',error:''});if(!src)return;
  const load=()=>{void Promise.all([courseAssetSource(src),poster?courseAssetSource(poster).catch(()=>''):Promise.resolve('')]).then(([url,p])=>{if(live)setState({key:src,url,poster:p,error:''});}).catch(()=>{if(live)setState({key:src,url:'',poster:'',error:'资源暂不可用，请重试'});});};
  load();window.addEventListener('online',load);return()=>{live=false;window.removeEventListener('online',load);};
 },[src,poster,revision]);
 const current=state.key===src?state:{key:src,url:'',poster:'',error:''};
 const failed=()=>{if(src)forgetCourseAsset(src);setState({key:src,url:'',poster:'',error:'资源暂不可用，请重试'});};
 if(!current.url)return <div className="course-asset-status" role="status">{current.error?<button onClick={()=>retry(n=>n+1)}>资源暂不可用 · 点击重试</button>:'正在准备课程资源…'}</div>;
 return audio?<audio {...props} src={current.url} onError={failed}/>:<video {...props} src={current.url} poster={current.poster||undefined} onError={failed}/>;
}
