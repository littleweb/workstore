import {courseAssetText} from '../course/assets';
import {extractHtml} from './model';
let runtime:Promise<string>|undefined;
export async function withRenderer(html:string){
 if(!html.includes('Course3D')||html.includes('data-course-renderer'))return html;
 runtime??=courseAssetText('/course/web/engine.js').then(code=>{if(!code.includes('Course3D')||/<(?:html|script)[\s>]/i.test(code))throw Error('三维渲染资源无效');return code;}).catch(e=>{runtime=undefined;throw e;});
 const code=(await runtime).replace(/<\/script/gi,'<\\/script');
 return extractHtml(html.replace(/<script\b/i,'<script data-course-renderer>'+code+'</script><script'));
}
