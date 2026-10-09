
const C=window.COURSE_DATA, canvas=document.getElementById('scene'), state=Object.fromEntries(C.controls.map(c=>[c[0],c[4]]));let running=true,phase=0,step=0,sum=0,tosses=0,heads=0,layer='organs',selected='heart',closed=true,angle=0,drag=null,loopTimer=null;
const out=document.getElementById('feedback'), detail=document.getElementById('detail');
function report(s){out.textContent=s;}function info(s){detail.textContent=s;}
for(const [id,label,min,max,value] of C.controls){const el=document.getElementById(id);el.addEventListener('input',()=>{state[id]=+el.value;document.getElementById(id+'-value').textContent=el.value;if(id==='rotation')angle=state[id]*Math.PI/180;if(id==='limit'){step=0;sum=0;}update();});}
function update(){if(C.id==='electric-motor')report('磁场速度 '+state.speed+'% · '+(state.direction<0?'反向':'正向')+' · 永磁转子跟随旋转磁场');
else if(C.id==='human-layers')report('当前结构层：'+({organs:'器官',skeleton:'骨骼',skin:'外形'})[layer]+' · 外层透明度 '+state.opacity+'%');
else if(C.id==='ink-water')report('蒸发强度 '+state.sun+'% · 降水强度 '+state.rain+'% · 水在各环节不断迁移');
else if(C.id==='leaf-lab'){let rate=Math.min(state.light,state.co2);report('光合作用相对速率 '+rate+'% · 限制因素：'+(state.light<state.co2?'光照':state.light>state.co2?'二氧化碳':'两项相当'));}
else if(C.id==='circuit-lab'){let i=closed?state.voltage/state.resistance:0;report('I = '+i.toFixed(3)+' A · P = '+(i*state.voltage).toFixed(2)+' W · '+(closed?'通路':'断路'));}
else if(C.id==='solar-orbits')report('已选择：'+(selected==='mars'?'火星':'地球')+' · 拖动场景旋转 · 时间速度 '+state.speed+'%');
else if(C.id==='gear-workshop')report('从动轮 / 主动轮转速 = −'+(state.teethA/state.teethB).toFixed(2)+' · 外啮合转向相反');
else if(C.id==='fraction-pieces'){state.numerator=Math.min(state.numerator,state.denominator);document.getElementById('numerator').value=state.numerator;document.getElementById('numerator-value').textContent=state.numerator;report(state.numerator+' / '+state.denominator+' = '+(state.numerator/state.denominator).toFixed(3));}
else if(C.id==='loop-playground')report('i = '+step+' · sum = '+sum+' · '+(step>=state.limit?'执行结束':'下一次累加 '+(step+1)));
else if(C.id==='wave-spectrum')report('频率 '+state.frequency+' Hz · 周期 '+(1000/state.frequency).toFixed(2)+' ms · 振幅 '+state.amplitude+'%');
else if(C.id==='growth-chart')report('r = '+(state.rate/100).toFixed(2)+' / 步 · K = '+state.capacity+' · 初始数量 20');
else report('试验 '+tosses+' 次 · 正面 '+heads+' 次 · 经验频率 '+(tosses?(heads/tosses*100).toFixed(1):'0')+'% · 理论概率 '+state.probability+'%');}
function advance(){if(!running)return;if(step<state.limit){step++;sum+=step;}update();}
for(const el of document.querySelectorAll('[data-action]'))el.addEventListener('click',()=>{const a=el.dataset.action;if(['skin','organs','skeleton'].includes(a)){layer=a;}else if(['earth','mars'].includes(a)){selected=a;info(a==='earth'?'地球：绕太阳公转，轨道半径在示意图中被压缩。':'火星：轨道在地球外侧，在相同模拟时间内公转较慢。');}else if(a==='switch'){closed=!closed;el.textContent='开关：'+(closed?'闭合':'断开');}else if(a==='step')advance();else if(a==='run'){if(loopTimer)clearInterval(loopTimer);loopTimer=setInterval(()=>{advance();if(step>=state.limit){clearInterval(loopTimer);loopTimer=null;}},350);}else if(a==='once'||a==='hundred'){for(let i=0;i<(a==='once'?1:100);i++){tosses++;if(Math.random()<state.probability/100)heads++;}}update();});
for(const el of document.querySelectorAll('[data-organ]'))el.addEventListener('click',()=>{selected=el.dataset.organ;info({heart:'心脏：通过收缩推动血液循环，位于胸腔中部偏左。',lungs:'肺：位于胸腔两侧，参与氧气与二氧化碳的交换。',liver:'肝：位于右上腹，参与代谢等多种功能。',stomach:'胃：位于左上腹，参与食物的储存和初步消化。'}[selected]);});
document.getElementById('pause').addEventListener('click',e=>{running=!running;e.target.textContent=running?'暂停演示':'继续演示';});
document.getElementById('reset').addEventListener('click',()=>{for(const c of C.controls){state[c[0]]=c[4];document.getElementById(c[0]).value=c[4];document.getElementById(c[0]+'-value').textContent=c[4];}if(loopTimer){clearInterval(loopTimer);loopTimer=null;}step=sum=tosses=heads=phase=angle=0;layer='organs';closed=true;selected=C.id==='solar-orbits'?'earth':'heart';const s=document.querySelector('[data-action="switch"]');if(s)s.textContent='开关：闭合';info(C.summary);update();});
canvas.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')angle-=.12;if(e.key==='ArrowRight')angle+=.12;});

update();
createExperience({canvas,C,state,get:()=>({phase,angle,step,sum,tosses,heads,layer,selected,closed}),setAngle:v=>angle=v});
