export const whiteboardStyles = [
 {id:'graphite',name:'铅笔课堂',description:'石墨铅笔细线、轻柔排线阴影，白色纸底，少量浅蓝点缀'},
 {id:'ink',name:'钢笔手记',description:'黑色钢笔轮廓、细密交叉排线，浅奶白纸底，克制的朱红点缀'},
 {id:'marker',name:'彩笔图解',description:'圆润粗马克笔轮廓，红橙蓝平涂色块，白色纸底，活泼清晰'},
 {id:'watercolor',name:'水彩故事',description:'柔和钢笔轮廓与透明水彩晕染，浅米白纸底，雾蓝与淡橙配色'},
 {id:'charcoal',name:'炭笔速写',description:'粗细富于变化的炭笔线条与局部擦染，暖灰白纸底，黑白高对比'},
 {id:'woodcut',name:'版画课堂',description:'木刻版画的粗黑轮廓与刻痕排线，乳白纸底，局部赭红和蓝色'},
 {id:'sepia',name:'复古手稿',description:'棕褐色技术手稿线描与工整排线，淡羊皮纸底，古典科学插图质感'},
 {id:'crayon',name:'蜡笔童趣',description:'粗颗粒蜡笔线条、拙趣轮廓与可见笔触，米白纸底，柔和红蓝橙配色'},
 {id:'paper',name:'几何纸绘',description:'剪纸式清晰几何轮廓、少量纸片叠层与细描边，奶白纸底，红橙蓝简洁色块'},
 {id:'fineline',name:'细线留白',description:'极细深灰连续线、清晰留白与少量蓝灰平涂，白纸底，安静现代的手绘图解'},
] as const;
export type WhiteboardStyle = typeof whiteboardStyles[number]['id'];
export const whiteboardStyle = (config:{style?:string}) => whiteboardStyles.find(s=>s.id===config.style) ?? whiteboardStyles[0];
