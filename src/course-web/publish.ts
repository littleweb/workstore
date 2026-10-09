import {invoke} from '@tauri-apps/api/core';import {native} from '../workspace';
export type PublishConfig={configured:boolean;tokenMask:string;teamId?:string;teamSlug?:string};
export type PublishResult={url:string;deploymentId:string;status:'ready'|'protected'|'link-delayed';statusMessage:string};
export function publishApi<T>(action:'config'|'save-config'|'publish',payload:Record<string,unknown>={}):Promise<T>{if(!native)return Promise.reject(Error('在线发布请在桌面版使用；浏览器版可下载HTML自行托管。'));return invoke<T>('course_web_publish',{action,payload});}
