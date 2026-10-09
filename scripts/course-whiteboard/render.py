"""Product adapter: original geeklee RegionStreamRenderer, subtitle encoding only.
The pinned vendor files are never modified. AI annotations are data, not code.
"""
import json,sys,os,time,threading
from pathlib import Path
from fractions import Fraction
import numpy as np,cv2,av
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'skill/scripts'))
from render_stream_whiteboard import RegionStreamRenderer
import stream_render as sr
from parse_srt import parse_srt
job=Path(sys.argv[1]);data=json.loads((job/'input.json').read_text());plan=data['tutorial']
FONT=ROOT/'font.ttf'
font=ImageFont.truetype(str(FONT),30)
def report(p,label):print(json.dumps({'progress':p,'stage':label},ensure_ascii=False),flush=True)
class Encoder:
 def __init__(self,path,width,height,captions):
  self.container=av.open(str(path),'w');self.stream=self.container.add_stream('libx264',rate=24);self.stream.width=width;self.stream.height=height;self.stream.pix_fmt='yuv420p';self.stream.options={'crf':'24','preset':'veryfast'};self.frame=0;self.captions=captions;self.caption_cache={};self.width=width;self.height=height
 def isOpened(self):return True
 def write(self,pixels):
  background=pixels[0,0].copy();drawing=cv2.resize(pixels,(int(self.width*.82),int(self.height*.82)));canvas=np.empty_like(pixels);canvas[:]=background;x=(self.width-drawing.shape[1])//2;canvas[10:10+drawing.shape[0],x:x+drawing.shape[1]]=drawing;pixels=canvas
  ms=self.frame*1000/24;cue=next((c for c in self.captions if c['startMs']<=ms<c['endMs']),None)
  if cue:
   text=cue['text'];key=(text,self.width,self.height)
   if key not in self.caption_cache:
    img=Image.new('RGBA',(self.width,90),(0,0,0,0));draw=ImageDraw.Draw(img);bbox=draw.textbbox((0,0),text,font=font);tw=bbox[2]-bbox[0];x=(self.width-tw)/2;draw.rounded_rectangle((x-18,5,x+tw+18,69),radius=10,fill=(45,47,44,205));draw.text((x,17),text,font=font,fill=(255,255,255,255));self.caption_cache[key]=np.asarray(img)
   over=self.caption_cache[key];h=90;y=self.height-h-14;alpha=over[:,:,3:4].astype(np.float32)/255;rgb=over[:,:,:3][:,:,::-1];pixels=pixels.copy();pixels[y:y+h]=(pixels[y:y+h]*(1-alpha)+rgb*alpha).astype(np.uint8)
  frame=av.VideoFrame.from_ndarray(pixels,format='bgr24');frame.pts=self.frame;frame.time_base=Fraction(1,24)
  for packet in self.stream.encode(frame):self.container.mux(packet)
  self.frame+=1
 def release(self):
  for packet in self.stream.encode(None):self.container.mux(packet)
  self.container.close()
# Original script expects a cv2 writer; the adapter encodes the exact same generated
# frames directly as H.264 and adds product subtitles, avoiding intermediate MPEG4.
original_writer=cv2.VideoWriter
inputs=[]
for i,s in enumerate(plan['scenes']):
 image=sr._imread_any(str(job/f'{i+1:02}.png'));a=s['annotation'];h,w=image.shape[:2]
 if a['canvas']!={'width':w,'height':h}:raise ValueError('源图尺寸与标注不一致')
 if a['sceneDurationMs']!=30000:raise ValueError('单幕时长无效')
 ms=0
 for k,e in enumerate(a['elements']):
  r=e['region'];v=e['reveal'];assert e['sequence']==k+1 and e['subtitle']==s['events'][k]['text'];assert all(isinstance(r[n],int) for n in ('x','y','width','height'));assert r['x']>=0 and r['y']>=0 and r['x']+r['width']<=w and r['y']+r['height']<=h;assert v['startMs']>=ms and v['startMs']+v['durationMs']<=29500;ms=v['startMs']+v['durationMs']
 corners=np.concatenate([image[8:20,8:20].reshape(-1,3),image[h-20:h-8,w-20:w-8].reshape(-1,3)])
 bg=np.median(corners,axis=0);canvas_hex='#'+''.join(f'{int(v):02x}' for v in bg[::-1]);cfg=sr.Config(fps=24,cap_long_edge=1280,grid_edge=8,canvas_hex=canvas_hex,ink_path_mode='grid',color_fill='contour-wipe',target_hand_height=190)
 renderer=RegionStreamRenderer(image,a,cfg,ROOT/'drawing-hand.png',False);output=job/f'{i+1:02}-draw.mp4';captions=s.get('captions',[])
 cv2.VideoWriter=lambda path,fourcc,fps,size:Encoder(path,*size,captions)
 renderer.render_to(output,30000);inputs.append(str(output));cv2.VideoWriter=original_writer;report((i+1)/len(plan['scenes'])*.9,f'正在逐笔绘制 {i+1}/{len(plan["scenes"])}')
(job/'rendered.json').write_text(json.dumps({'inputs':inputs},ensure_ascii=False))
