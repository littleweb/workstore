import {AbsoluteFill,Sequence,useCurrentFrame,useVideoConfig,interpolate,spring} from 'remotion';
import {Audio} from '@remotion/media';
import type {Scene,Tutorial} from './model';
import {captionsFor} from './model';
import Diagram from './Diagram';
import {BasicCaptions} from './BasicCaptions';
import {animationTheme} from './styles';
function LessonScene({scene,style,index,total}:{scene:Scene;style:string;index:number;total:number}){
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),theme=animationTheme(style),stage=theme.layout==='stage',editorial=theme.layout==='editorial',dark=theme.dark,color=theme.accent,ink=theme.ink;
 const entry=spring({frame,fps,config:{damping:theme.motion==='pop'?16:28,stiffness:100}});
 const pattern=theme.pattern==='grid'?{backgroundImage:`linear-gradient(${color}16 1px,transparent 1px),linear-gradient(90deg,${color}16 1px,transparent 1px)`,backgroundSize:style==='terminal'?'16px 16px':'32px 32px'}:theme.pattern==='dots'?{backgroundImage:`radial-gradient(${color}20 1px,transparent 1px)`,backgroundSize:'24px 24px'}:theme.pattern==='paper'?{backgroundImage:`repeating-linear-gradient(0deg,transparent,transparent 5px,${ink}04 6px)`}:theme.pattern==='glow'?{backgroundImage:`radial-gradient(ellipse at 20% 30%,${theme.secondary}18,transparent 60%),radial-gradient(ellipse at 85% 80%,${color}12,transparent 50%)`}:{};
 return <AbsoluteFill style={{background:theme.background,fontFamily:theme.font,color:ink}}>
 <AbsoluteFill style={pattern}/>
 {editorial&&<><div style={{position:'absolute',left:64,top:81,right:64,height:2,background:ink}}/><div style={{position:'absolute',left:64,top:196,width:74,height:6,background:color}}/></>}
 {style==='paper'&&<div style={{position:'absolute',left:424,top:211,right:54,height:365,background:theme.secondary,rotate:'-2deg',opacity:.13}}/>}
 {style==='neon'&&<div style={{position:'absolute',width:380,height:380,left:450,top:170,border:`1px solid ${theme.secondary}25`,borderRadius:'50%',scale:1+Math.sin(frame/fps)*.015}}/>}
 <div style={{position:'absolute',left:64,top:48,right:64,display:'flex',justifyContent:stage?'center':'flex-start',gap:16,alignItems:'center',fontSize:20,letterSpacing:3,color:color}}><span style={{width:9,height:9,borderRadius:theme.radius?9:0,background:color}}/>{theme.name}<span style={{letterSpacing:0,opacity:.55}}>·</span>{index===0?'从一个问题开始':index===total-1?'回顾与练习':'理解 → 演示 → 应用'}</div>
 <div style={{position:'absolute',left:64,top:105,right:64,opacity:interpolate(frame,[0,.65*fps],[0,1],{extrapolateRight:'clamp'}),translate:`0 ${theme.motion==='scan'?0:18*(1-entry)}px`,textAlign:stage?'center':'left'}}><h1 style={{fontSize:scene.title.length>20?40:52,lineHeight:1.25,fontWeight:editorial?900:750,margin:0,letterSpacing:editorial?-2:-1}}>{scene.title}</h1></div>
 <div style={{position:'absolute',left:64,top:stage?547:editorial?241:216,width:stage?1152:325,display:stage?'flex':'block',gap:16}}>{scene.points.map((line,i)=><div key={i} style={{display:'flex',gap:15,flex:stage?1:undefined,alignItems:'flex-start',marginBottom:stage?0:27,padding:stage?'8px 14px':undefined,borderRadius:theme.radius,background:stage&&style!=='minimal'?theme.surface:undefined,borderTop:style==='minimal'?`1px solid ${theme.secondary}`:undefined,opacity:interpolate(frame,[(i*.6+.4)*fps,(i*.6+1.05)*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}><span style={{width:stage?6:5,height:stage?6:undefined,alignSelf:stage?undefined:'stretch',marginTop:stage?8:0,flexShrink:0,background:i%2?theme.secondary:color,borderRadius:theme.radius?10:0}}/><p style={{fontSize:stage?21:27,lineHeight:stage?1.4:1.5,margin:0}}>{line}</p></div>)}</div>
 <div style={{position:'absolute',left:stage?112:424,right:stage?112:56,top:stage?190:206,height:stage?345:365,scale:theme.motion==='pop'?.94+.06*entry:1,clipPath:theme.motion==='scan'?`inset(0 ${100*(1-interpolate(frame,[0,.75*fps],[0,1],{extrapolateRight:'clamp'}))}% 0 0)`:'none'}}><Diagram visual={scene.visual} color={color} dark={dark} theme={theme}/></div>
 {scene.visual.note&&scene.visual.note.length<=24&&!/绘制|绘图|画面|粉笔风|绘画|镜头|风格/.test(scene.visual.note)&&<div style={{position:'absolute',left:stage?112:440,right:stage?112:70,top:stage?521:569,fontSize:stage?17:20,textAlign:'center',color:color}}>{scene.visual.note}</div>}
 <BasicCaptions combineTokensWithinMilliseconds={0} captions={scene.captions??captionsFor(scene)} width={2300} style={{position:'absolute',left:65,top:610,scale:.5,transformOrigin:'top left'}}/>
 {scene.audio&&<Audio src={scene.audio} premountFor={fps}/>}
 <div style={{position:'absolute',bottom:0,left:0,height:5,background:color,width:`${interpolate(frame,[0,scene.seconds*fps],[0,100],{extrapolateRight:'clamp'})}%`,opacity:.6}}/>
 </AbsoluteFill>;
}
export function TutorialVideo({tutorial}:{tutorial:Tutorial}){const {fps}=useVideoConfig();let from=0;return <AbsoluteFill>{tutorial.scenes.map((scene,index)=>{const start=from;from+=scene.seconds*fps;return <Sequence key={index} name={scene.title} from={start} durationInFrames={scene.seconds*fps} premountFor={fps}><LessonScene scene={scene} style={tutorial.style} index={index} total={tutorial.scenes.length}/></Sequence>;})}</AbsoluteFill>;}
