export function pageWindow(left:number,width:number,count:number,stride:number) {
  const start=Math.max(0,Math.min(Math.max(0,count-1),Math.floor(left/stride)-1));
  const end=Math.max(start,Math.min(count,Math.ceil((left+width)/stride)+1));
  return {start,end};
}
export function anchoredScroll(left:number,oldZoom:number,newZoom:number,width:number) {
  return Math.max(0,((left+width/2)/oldZoom)*newZoom-width/2);
}
