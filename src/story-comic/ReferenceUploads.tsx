import { useEffect, useRef, useState } from 'react';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import { previewImageSource } from './previewImages';
function Thumbnail({src}:{src:string}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{let live=true;void previewImageSource(src).then(value=>{if(live)setUrl(value);}).catch(()=>{});return()=>{live=false;};},[src]);
  return url?<img src={url} alt="参考图" decoding="async"/>:<span>读取中…</span>;
}
export default function ReferenceUploads({label,images,disabled,add,remove}:{label:string;images:string[];disabled:boolean;add:(files:File[])=>Promise<void>;remove:(index:number)=>void}) {
  const input=useRef<HTMLInputElement>(null);
  return <div className="story-reference-group"><div className="story-reference-label">{label}<small>{images.length}/3</small></div>
    <input ref={input} type="file" accept="image/png,image/jpeg" multiple hidden aria-label={`上传${label}`} disabled={disabled}
      onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';if(files.length)void add(files);}} />
    <div className="story-reference-grid">{Array.from({length:3},(_,i)=>images[i]?<div className="story-reference-tile" key={i}><Thumbnail src={images[i]}/><button className="story-reference-remove" disabled={disabled} aria-label={`移除${label}${i+1}`} onClick={()=>remove(i)}><CloseOutlined/></button></div>:<button type="button" key={i} className="story-reference-tile story-reference-add" disabled={disabled} aria-label={`添加${label}${i+1}`} onClick={()=>input.current?.click()}><PlusOutlined/><span>上传图片</span></button>)}</div>
  </div>;
}
