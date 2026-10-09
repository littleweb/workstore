import examples from './examples.json';
import {engine,signature,type Content,type Config,type Page} from './model';
export {examples};
export function exampleContent(id:string):Content{
 const x=examples.find(e=>e.id===id);if(!x)throw Error('示例不存在');
 const config:Config={topic:x.topic,style:x.style,layout:x.layout,palette:x.palette,audience:x.audience,count:x.pages.length,ratio:'3:4'};
 return {version:1,engine,config,plannedConfig:signature(config),plannedConfigData:{...config},plan:{title:x.title,analysis:`信息密集策略B：${x.topic}`,summary:x.topic,pages:structuredClone(x.pages) as Page[]},history:[],job:{status:'done',stage:'全部卡片已完成'}};
}
