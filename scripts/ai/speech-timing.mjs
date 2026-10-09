export const maxSpeechTempo=1.15;
/** Allocate whole seconds to speech, retaining the selected total video duration. */
export function fitSpeechScenes(scenes,durations,total){
 if(durations.length!==scenes.length||durations.some(n=>!Number.isFinite(n)||n<=0))throw Error('自然配音时长无效');
 const needs=(tempo)=>durations.map(n=>Math.max(3,Math.ceil(n/tempo+.5)));
 if(scenes.every((s,i)=>s.seconds>=needs(1)[i]))return scenes.map(s=>s.seconds);
 let minimum;
 for(const tempo of [1,1.05,1.1,maxSpeechTempo]){const candidate=needs(tempo);if(candidate.every(n=>n<=40)&&candidate.reduce((a,b)=>a+b,0)<=total){minimum=candidate;break;}}
 if(!minimum)throw Error('讲解内容过密，无法在自然语速下容纳；请精简旁白后重新制作');
 const result=[...minimum];let remaining=total-result.reduce((a,b)=>a+b,0);
 while(remaining>0){let best=-1,score=-Infinity;for(let i=0;i<result.length;i++){if(result[i]>=40)continue;const value=scenes[i].seconds-result[i];if(value>score){score=value;best=i;}}if(best<0)throw Error('教程时长无法分配');result[best]++;remaining--;}
 return result;
}
