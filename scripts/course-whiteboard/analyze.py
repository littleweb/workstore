"""Measure actual ink components; semantic slots were defined by the SRT plan.
No coordinates are guessed from the prose or normalized by the vision model.
"""
import sys,json
from pathlib import Path
import cv2,numpy as np
im=cv2.imread(sys.argv[1]);h,w=im.shape[:2]
if w<640 or h<360 or w*h>18000000 or abs(w/h-16/9)>.04:raise ValueError('源图须为16:9高清画面')
margin=max(4,min(w,h)//40);samples=np.concatenate([im[margin:margin*2,margin:margin*2].reshape(-1,3),im[h-margin*2:h-margin,w-margin*2:w-margin].reshape(-1,3)]);bg=np.median(samples,axis=0);ink=np.max(np.abs(im.astype(np.int16)-bg.astype(np.int16)),axis=2)>55
kernel=max(15,round(w/55));kernel+=1-kernel%2;cluster=cv2.dilate(ink.astype(np.uint8),np.ones((kernel,kernel),np.uint8));num,labels,stats,centroids=cv2.connectedComponentsWithStats(cluster,connectivity=8);boxes=[[] for _ in range(4)]
for k in range(1,num):
 x,y,bw,bh,area=stats[k]
 if area<kernel*kernel:continue
 # Use measured component center to associate a visible cluster with the semantic
 # slot. The vision stage separately verifies that each slot depicts its event.
 cx,cy=centroids[k];slot=(0 if cy<h/2 else 2)+(0 if cx<w/2 else 1);ys,xs=np.where((labels[y:y+bh,x:x+bw]==k)&ink[y:y+bh,x:x+bw]);
 if not len(xs):continue
 boxes[slot].append((x+int(xs.min()),y+int(ys.min()),x+int(xs.max())+1,y+int(ys.max())+1))
regions=[]
for group in boxes:
 if not group:raise ValueError('源图某个教学事件没有可见主体')
 x=max(0,min(b[0] for b in group)-8);y=max(0,min(b[1] for b in group)-8);x2=min(w,max(b[2] for b in group)+8);y2=min(h,max(b[3] for b in group)+8);regions.append({'x':int(x),'y':int(y),'width':int(x2-x),'height':int(y2-y)})
print(json.dumps({'width':w,'height':h,'regions':regions}))
