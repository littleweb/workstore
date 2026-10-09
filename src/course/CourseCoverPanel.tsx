import {useState} from 'react';
import {Button,Card,Input,Modal,Steps,Tabs} from 'antd';
import CoverPreview from '../covers/Preview';
import {groups,styles} from '../covers/model';
import {coverVersion,courseReady} from './cover';
import type {Content} from './model';
import {CardImage} from './CourseApp';
import {exportCover} from './export';
export default function CourseCoverPanel({content,disabled,onGenerate,onError}:{content:Content;disabled:boolean;onGenerate:(style?:string,instruction?:string)=>void;onError:(e:unknown)=>void}){
 const [open,setOpen]=useState(false),[step,setStep]=useState(1),[style,setStyle]=useState<string>(),[instruction,setInstruction]=useState(''),[group,setGroup]=useState('全部');const version=coverVersion(content),chosen=styles.find(s=>s.number===style);
 const selectStyle=(next?:string)=>{setStyle(next);setStep(2);};
 const groupLabels=['社论幽默','绘本叙事','艺术人物','日式插画','中式插画','媒介与地域','当代插画','其他'];
 const start=()=>{setStep(1);setGroup('全部');setInstruction('');setOpen(true);};
 return <Card className="course-cover-panel" title="作品封面" extra={<div className="course-publication-actions"><Button size="small" disabled={!version||disabled} onClick={()=>void exportCover(content).catch(onError)}>下载封面</Button><Button size="small" disabled={disabled||!courseReady(content)} onClick={start}>选择风格 · {chosen?.displayName??'随机风格'}</Button><Button size="small" disabled={disabled||!courseReady(content)} onClick={start}>{version?'重新生成封面':'生成封面'}</Button></div>}>{version&&<CardImage src={version.image} alt="作品封面"/>}{content.cover?.error&&<p role="alert">{content.cover.error}</p>}
 <Modal open={open} title={<Steps className="course-cover-steps" current={step-1} onChange={index=>setStep(index+1)} items={[{title:"选择风格"},{title:"输入修改意见"}]}/>} className="course-cover-dialog" width="100vw" style={{top:0,paddingBottom:0,maxWidth:'100vw'}} footer={null} onCancel={()=>setOpen(false)} destroyOnHidden><div className="course-cover-wizard">
 {step===1?<><Tabs className="course-cover-categories" activeKey={group} onChange={setGroup} items={[{key:"全部",label:"全部"},...groups.map((key,index)=>({key,label:groupLabels[index]}))]}/><p>共 {styles.filter(s=>group==='全部'||s.group===group).length} 种风格</p><div className="course-cover-style-grid">{group==='全部'&&<button className={!style?'selected':''} aria-pressed={!style} onClick={()=>selectStyle()}><div className="course-cover-random">随机风格</div><strong>让灵感决定</strong></button>}{styles.filter(s=>group==='全部'||s.group===group).map(s=><button key={s.number} className={style===s.number?'selected':''} aria-pressed={style===s.number} onClick={()=>selectStyle(s.number)}><CoverPreview src={s.preview} fallback={s.image} alt={s.displayName}/><strong>{s.number} · {s.displayName}</strong></button>)}</div></>:<div className="course-cover-revision"><h3>{chosen?.displayName??'随机风格'}</h3>{chosen&&<CoverPreview src={chosen.preview} fallback={chosen.image} alt="已选封面风格" loading="eager"/>}<label>修改意见<Input.TextArea rows={5} maxLength={4000} aria-label="封面修改意见" placeholder="例如：主标题更醒目，画面简洁一些，使用暖色。也可以留空直接生成。" value={instruction} onChange={e=>setInstruction(e.target.value)}/></label><div className="course-cover-submit"><Button type="primary" disabled={disabled} onClick={()=>{setOpen(false);onGenerate(style,instruction.trim());}}>生成封面</Button></div></div>}</div></Modal></Card>;
}
