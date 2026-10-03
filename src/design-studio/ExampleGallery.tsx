import type {ReactNode} from 'react';
import {CopyOutlined} from '@ant-design/icons';
import {Tooltip} from 'antd';
import type {ExampleAsset,ExampleGroup} from './model';

type Props={title:string;groups:ExampleGroup[];renderImage:(asset:ExampleAsset,alt:string)=>ReactNode;onPreview:(src:string,title:string)=>void;onCopyPrompt:(prompt:string)=>void};
export function ExampleGallery({title,groups,renderImage,onPreview,onCopyPrompt}:Props){
 return <div className="ds-gallery">{groups.map((group,index)=><article className="ds-example-group" key={group.id} aria-label={`${title} 示例第${index+1}组`}>
  <div className={group.kind==='comparison'?'ds-example-pair':'ds-example-single'}>{group.items.map((asset,n)=>{
   const label=`${title} 示例第${index+1}组 ${asset.label||'作品示例'}`;
   return <button className="ds-example-pane" key={asset.src+n} aria-label={label} onClick={()=>onPreview(asset.src,label)}>{renderImage(asset,label)}{asset.label&&<span className={'ds-example-badge'+(asset.label.includes('AI')?' ds-example-ai':'')}>{asset.label}</span>}</button>;
  })}</div>
  {group.prompt&&<div className="ds-example-prompt"><div><span>创作提示词</span><Tooltip title="复制提示词"><button aria-label={`复制示例第${index+1}组提示词`} onClick={()=>onCopyPrompt(group.prompt!)}><CopyOutlined/></button></Tooltip></div><p title={group.prompt}>{group.prompt}</p></div>}
 </article>)}</div>;
}
