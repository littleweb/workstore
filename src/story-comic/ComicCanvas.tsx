import { PlusOutlined, MinusOutlined, ColumnHeightOutlined } from '@ant-design/icons';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { pageWindow, anchoredScroll } from './scrollWindow';
const heightZoom=(height:number)=>Math.max(.2,Math.min(1.5,(height-48)/640));
/** Native scrolling avoids a transformed tree of all full-resolution comic pages. */
export default function ComicCanvas({children,ratio=3/4}:{children:ReactNode[];ratio?:number}) {
  const host=useRef<HTMLDivElement>(null), scroller=useRef<HTMLDivElement>(null);
  const frame=useRef(0), initial=useRef(false), lastHeight=useRef(0);
  const drag=useRef<{x:number;y:number;left:number;top:number;pointer:number;moved:boolean}|null>(null);
  const suppressClick=useRef(false);
  const [size,setSize]=useState({width:0,height:0});
  const [zoom,setZoom]=useState(1), [left,setLeft]=useState(0);
  const zoomRef=useRef(zoom);zoomRef.current=zoom;
  const count=children.length, pageWidth=560*ratio*zoom, stride=pageWidth+28;
  const visible=pageWindow(left,size.width,count,stride);
  const syncScroll=()=>{
    if(frame.current)return;
    frame.current=requestAnimationFrame(()=>{frame.current=0;setLeft(scroller.current?.scrollLeft??0);});
  };
  useLayoutEffect(()=>{
    const measure=()=>{
      const el=host.current;if(!el?.clientWidth||!el.clientHeight)return;
      setSize(old=>old.width===el.clientWidth&&old.height===el.clientHeight?old:{width:el.clientWidth,height:el.clientHeight});
      if(!initial.current || lastHeight.current!==el.clientHeight){
        const next=heightZoom(el.clientHeight),scroll=scroller.current;
        if(scroll)scroll.scrollLeft=anchoredScroll(scroll.scrollLeft,zoomRef.current,next,el.clientWidth);
        setZoom(next);initial.current=true;lastHeight.current=el.clientHeight;
      }
    };
    measure();const observer=new ResizeObserver(measure);if(host.current)observer.observe(host.current);
    window.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);cancelAnimationFrame(frame.current);};
  },[]);
  useLayoutEffect(()=>{syncScroll();},[zoom,size.width,count]);
  const changeZoom=(next:number)=>{
    const value=Math.max(.2,Math.min(2,next));
    const scroll=scroller.current;
    const position=anchoredScroll(scroll?.scrollLeft??0,zoom,value,size.width);
    setZoom(value);
    requestAnimationFrame(()=>{if(scroller.current){scroller.current.scrollLeft=position;syncScroll();}});
  };
  useLayoutEffect(()=>{
    const el=scroller.current;if(!el)return;
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey){event.preventDefault();changeZoom(zoom*Math.exp(-event.deltaY*.01));}
      else if(Math.abs(event.deltaY)>Math.abs(event.deltaX)&&el.scrollHeight<=el.clientHeight+1){
        event.preventDefault();el.scrollLeft+=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?size.width:1);
      }
    };
    el.addEventListener('wheel',wheel,{passive:false});
    return()=>el.removeEventListener('wheel',wheel);
  },[zoom,size.width]);
  const stopDrag=(pointer:number)=>{
    const state=drag.current;if(!state)return;
    suppressClick.current=state.moved;
    if(scroller.current?.hasPointerCapture(pointer))scroller.current.releasePointerCapture(pointer);
    drag.current=null;
  };
  return <div className="story-pages story-canvas story-native-canvas" ref={host}>
    <div className="story-native-scroll" ref={scroller} onScroll={syncScroll}
      onPointerDown={e=>{
        if(e.button!==0||e.pointerType==='touch'||(e.target as HTMLElement).closest('footer,input,textarea'))return;
        suppressClick.current=false;
        drag.current={x:e.clientX,y:e.clientY,left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop,pointer:e.pointerId,moved:false};
      }}
      onPointerMove={e=>{
        const state=drag.current;if(!state||state.pointer!==e.pointerId)return;
        if(!state.moved && Math.hypot(e.clientX-state.x,e.clientY-state.y)<6)return;
        state.moved=true;e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.scrollLeft=state.left-(e.clientX-state.x);e.currentTarget.scrollTop=state.top-(e.clientY-state.y);e.preventDefault();
      }}
      onPointerUp={e=>stopDrag(e.pointerId)} onPointerCancel={e=>stopDrag(e.pointerId)} onLostPointerCapture={()=>{drag.current=null;}}
      onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}}>
      <div className="story-native-strip" style={{width:Math.max(size.width,24+count*stride),height:Math.max(size.height,640*zoom+48)}}>
        {children.slice(visible.start,visible.end).map((child,offset)=><div key={visible.start+offset} className="story-native-page" style={{left:24+(visible.start+offset)*stride,width:pageWidth,top:24}}>{child}</div>)}
      </div>
    </div>
    <div className="story-canvas-tools story-native-tools">
      <button aria-label="放大" title="放大" onClick={()=>changeZoom(zoom*1.2)}><PlusOutlined/></button>
      <button aria-label="缩小" title="缩小" onClick={()=>changeZoom(zoom/1.2)}><MinusOutlined/></button>
      <button aria-label="适应高度" title="适应高度" onClick={()=>changeZoom(heightZoom(size.height))}><ColumnHeightOutlined/></button>
    </div>
  </div>;
}
