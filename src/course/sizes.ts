export const videoSizes=[
 {value:'16:9',label:'横屏 · 16:9',width:1280,height:720},
 {value:'9:16',label:'竖屏 · 9:16',width:720,height:1280},
 {value:'1:1',label:'正方形 · 1:1',width:960,height:960},
 {value:'4:3',label:'横屏 · 4:3',width:1280,height:960},
 {value:'3:4',label:'竖屏 · 3:4',width:960,height:1280},
];
export const validVideoRatio=(ratio:unknown)=>ratio===undefined||videoSizes.some(s=>s.value===ratio);
export const videoSize=(ratio?:string)=>videoSizes.find(s=>s.value===ratio)??videoSizes[0];
export const coverSizes=[...videoSizes.map(({value,label})=>({value,label})),{value:'2:3',label:'竖屏 · 2:3'}];
export const validCoverRatio=(ratio:unknown)=>ratio===undefined||coverSizes.some(s=>s.value===ratio);
