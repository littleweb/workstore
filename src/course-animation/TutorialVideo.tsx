import {AbsoluteFill,Sequence,useCurrentFrame,useVideoConfig,interpolate} from 'remotion';
import {Audio} from '@remotion/media';
import type {Scene,Tutorial} from './model';
import {captionsFor} from './model';
import Diagram from './Diagram';
import {BasicCaptions} from './BasicCaptions';
function LessonScene({scene,style,index,total}:{scene:Scene;style:string;index:number;total:number}){
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),dark=style==='chalk',color=style==='warm'?'#d58149':dark?'#e8d783':'#39847b',ink=dark?'#f1f4e9':'#243d37';
 return <AbsoluteFill style={{background:dark?'#142e27':style==='warm'?'#fbf4e7':'#f4f8f3',fontFamily:'PingFang SC, Microsoft YaHei, sans-serif',color:ink}}>
 <AbsoluteFill style={{backgroundImage:`radial-gradient(${dark?'#9dc7aa18':'#437d6420'} 1px,transparent 1px)`,backgroundSize:'24px 24px'}}/>
 <div style={{position:'absolute',left:64,top:48,display:'flex',gap:16,alignItems:'center',fontSize:20,letterSpacing:3,color:color}}><span style={{width:9,height:9,borderRadius:9,background:color}}/>动画教程<span style={{letterSpacing:0,opacity:.55}}>·</span>{index===0?'从一个问题开始':index===total-1?'回顾与练习':'理解 → 演示 → 应用'}</div>
 <div style={{position:'absolute',left:64,top:105,right:64,opacity:interpolate(frame,[0,.65*fps],[0,1],{extrapolateRight:'clamp'}),translate:`0 ${interpolate(frame,[0,.65*fps],[18,0],{extrapolateRight:'clamp'})}px`}}><h1 style={{fontSize:scene.title.length>20?40:52,lineHeight:1.25,fontWeight:750,margin:0,letterSpacing:-1}}>{scene.title}</h1></div>
 <div style={{position:'absolute',left:64,top:216,width:325}}>{scene.points.map((line,i)=><div key={i} style={{display:'flex',gap:15,marginBottom:27,opacity:interpolate(frame,[(i*.6+.4)*fps,(i*.6+1.05)*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}><span style={{width:5,flexShrink:0,background:color,borderRadius:10}}/><p style={{fontSize:27,lineHeight:1.5,margin:0}}>{line}</p></div>)}</div>
 <div style={{position:'absolute',left:424,right:56,top:206,height:365}}><Diagram visual={scene.visual} color={color} dark={dark}/></div>
 {scene.visual.note&&scene.visual.note.length<=24&&!/绘制|绘图|画面|粉笔风|绘画|镜头|风格/.test(scene.visual.note)&&<div style={{position:'absolute',left:440,right:70,top:569,fontSize:20,textAlign:'center',color:color}}>{scene.visual.note}</div>}
 <BasicCaptions combineTokensWithinMilliseconds={0} captions={scene.captions??captionsFor(scene)} width={2300} style={{position:'absolute',left:65,top:610,scale:.5,transformOrigin:'top left'}}/>
 {scene.audio&&<Audio src={scene.audio} premountFor={fps}/>}
 <div style={{position:'absolute',bottom:0,left:0,height:5,background:color,width:`${interpolate(frame,[0,scene.seconds*fps],[0,100],{extrapolateRight:'clamp'})}%`,opacity:.6}}/>
 </AbsoluteFill>;
}
export function TutorialVideo({tutorial}:{tutorial:Tutorial}){const {fps}=useVideoConfig();let from=0;return <AbsoluteFill>{tutorial.scenes.map((scene,index)=>{const start=from;from+=scene.seconds*fps;return <Sequence key={index} name={scene.title} from={start} durationInFrames={scene.seconds*fps} premountFor={fps}><LessonScene scene={scene} style={tutorial.style} index={index} total={tutorial.scenes.length}/></Sequence>;})}</AbsoluteFill>;}
