import {AbsoluteFill,Sequence,useVideoConfig} from 'remotion';
import {TutorialVideo} from './TutorialVideo';
import type {Tutorial} from './model';
import {animationTheme} from './styles';
export function SizedTutorialVideo({tutorial}:{tutorial:Tutorial}){
 const {width,height}=useVideoConfig(),scale=Math.min(width/1280,height/720);
 return <AbsoluteFill style={{background:animationTheme(tutorial.style).background,overflow:'hidden'}}><div style={{position:'absolute',width:1280,height:720,left:(width-1280*scale)/2,top:(height-720*scale)/2,transform:`scale(${scale})`,transformOrigin:'top left'}}><Sequence width={1280} height={720}><TutorialVideo tutorial={tutorial}/></Sequence></div></AbsoluteFill>;
}
