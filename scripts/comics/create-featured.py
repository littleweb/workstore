"""Build six independent default stories; original creation templates stay unchanged."""
import json
from pathlib import Path
specs = [
 ('rain-umbrella','雨天的小善意','温暖治愈','一把伞，装下了两份温暖。',['书店避雨','遇见小狗','一起回家','温暖相伴'],['雨还没有停。','你也在等一个晴天吗？','我的伞，还能分你一半。','原来，家可以多一份温暖。'], [('小雨','character','黑色短发，黄色雨衣，蓝色长裤',0),('小白','character','白色卷毛小狗，柔软垂耳',1),('雨巷','scene','书店门口，灰蓝雨幕和暖色橱窗',0),('黄伞','prop','明黄色长柄雨伞',2)]),
 ('moon-delivery','月亮快递员','温暖治愈','小兔接到了一份送往月亮的快递。',['拾到星星','小心打包','走上云梯','送回夜空'],['是谁把星星落在这里？','别着急，我送你回家。','再高，也要送到。','晚安，愿你继续发光。'], [('小兔','character','白色兔子，青绿邮差帽和制服，棕色包',0),('星星','prop','柔和发光的金色五角星',1),('云梯','scene','紫蓝夜空，通向月亮的白色云阶',2)]),
 ('grandma-kitchen','奶奶的味道','温暖治愈','一顿饺子，藏着两代人的牵挂。',['来到厨房','一起擀皮','学习包饺子','共享晚餐'],['奶奶，我回来啦！','手把手，教你家的味道。','这个像不像一只小船？','最香的调味，是陪伴。'], [('奶奶','character','银灰短发，红色碎花围裙，米色上衣',0),('孙女','character','黑色丸子头，绿色毛衣，学做饭时穿白色围裙',1),('厨房','scene','木质餐桌，窗边阳光，旧式温暖厨房',0),('饺子','prop','手工包制的白色饺子',3)]),
 ('dog-travel','小狗的周末旅行','日常反转','背起小包，把周末交给远方。',['准备出发','窗外风景','湖畔野餐','带梦回家'],['今天，去地图上的蓝色那里。','原来风景会自己跑过来。','把烦恼留在山的另一边。','最好的纪念品，是一个好梦。'], [('柯基','character','黄白柯基，红色方巾，绿色小背包',0),('山间湖泊','scene','雪山，蓝色湖面，野花草地',2),('背包','prop','橄榄绿帆布包，棕色皮带扣',0)]),
 ('whale-song','大海的晚安曲','温暖治愈','鲸宝宝跟着妈妈的歌声，学会和夜晚相处。',['害怕黑暗','听见歌声','追随微光','安心入睡'],['海底的夜，好像有点深。','别怕，我的歌一直在。','原来，黑暗里也有小星星。','靠着你，就是最安静的海。'], [('鲸宝宝','character','圆润蓝色幼鲸，白色腹部，明亮大眼睛',0),('鲸妈妈','character','体型较大的蓝鲸，柔和眼神，白色腹部',1),('海洋','scene','深蓝海水，发光水母，月光穿过水面',2)]),
 ('little-sprout','一颗种子的春天','知识科普','从埋下一颗种子，到等来一朵花。',['播下一粒种子','照顾幼苗','观察生长','等到花开'],['把小小的期待，种进土里。','一点水，一点阳光。','每天，都比昨天长高一点。','慢慢来，也会有自己的春天。'], [('小禾','character','黑色齐刘海短发，橙色背带裤，米色上衣',0),('小猫','character','灰白虎斑猫，白色胸口',0),('花园','scene','乡间庭院，木架和陶盆，充足阳光',1),('向日葵','prop','陶盆中由幼芽逐渐长成金黄色向日葵',3)]),
]
items=[]
for tid,title,category,summary,beats,lines,assets in specs:
 def picture(i): return dict(src=f'/comics/{tid}.png',crop=[(i%2)/2,(i//2)/2,.5,.5])
 entities=[dict(id=f'{tid}-asset-{i}',name=name,kind=kind,description=description,locked=True,reference=picture(frame)) for i,(name,kind,description,frame) in enumerate(assets)]
 pages=[dict(id=f'{tid}-{i+1}',title=beat,action=beat,dialogue=lines[i],entityIds=[e['id'] for e in entities],state='延续前一画面的角色外观与情节状态',image=picture(i),status='ready') for i,beat in enumerate(beats)]
 items.append(dict(type='workstore.comic.template',schemaVersion=1,templateId=tid,revision=3,dialogueStyle=dict(shape="thought" if tid=="whale-song" else "speech",position="auto",rendering="integrated",lettering="对白与画风一体生成，顺应人物视线和画面留白，避开脸、手、关键道具与动作",fill="cream" if category=="温暖治愈" else "white"),title=title,summary=summary,category=category,style='暖色水彩手绘，清晰墨线，柔和光影',defaultPages=4,supportedCounts=[4,6,8],entities=entities,beats=beats,example=pages,cover=picture(0),continuity=['角色外貌与服装保持一致','时间和场景变化符合故事进程'],source=dict(kind='original',author='WorkStore',redistribution='WorkStore 原创策划与 AI 生成示例，可随应用分发'),publishingDirection='围绕真实故事内容组织标题与文案，突出情绪变化'))
Path('public/comics/featured.json').write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n')
