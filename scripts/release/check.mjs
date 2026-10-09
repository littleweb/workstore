import {readFileSync} from 'node:fs';
import {readManifest,publicAssets} from './assets.mjs';
import {collectPreviews,validatePublished} from '../covers/preview-assets.mjs';
import {collectDesignAssets,validateDesignPublished} from '../design-studio/assets.mjs';
import {validateResources} from '../resources/catalog.mjs';
export function checkRelease(root=process.cwd()){
 const read=file=>readFileSync(root+'/'+file,'utf8'),json=file=>JSON.parse(read(file));
 const manifest=readManifest(root);
 if(manifest.nativeResources.length||manifest.maxFrontendBytes>80*1024*1024||manifest.maxMacBytes>90*1024*1024)throw Error('发布规则禁止放宽资源范围或体积预算');
 if(!manifest.tools.includes('app.course'))throw Error('当前发布必须包含做课程');
 validatePublished(json('src/covers/remote-previews.json'),collectPreviews(root));
 validateDesignPublished(json('src/design-studio/remote-assets.json'),collectDesignAssets(root));
 validateResources(root);
 const versions=[json('package.json').version,json('package-lock.json').version,json('package-lock.json').packages[''].version,json('src-tauri/tauri.conf.json').version,read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1],read('src-tauri/Cargo.lock').match(/name = "workstore"\nversion = "([^"]+)"/)?.[1]];
 if(!versions.every(v=>v===versions[0]))throw Error('发布版本不一致');
 if(json('src-tauri/tauri.conf.json').plugins.updater.pubkey!==manifest.updaterPublicKey)throw Error('发布更新公钥不能变更');
 const files=publicAssets(root);
 if(files.some(f=>/^(course|design-studio|comics)\//.test(f.path)||f.path.startsWith('handraw-style/covers/')))throw Error('大型/隐藏资源混入安装包');
 return {version:versions[0],tools:manifest.tools,publicFiles:files.length,maxFrontendBytes:manifest.maxFrontendBytes,maxMacBytes:manifest.maxMacBytes};
}
if(process.argv[1]?.endsWith('/check.mjs'))console.log('发布前规则通过',checkRelease());

export async function verifyUpdateSignature(artifact,pubkey){
 const {createPublicKey,verify,createHash}=await import('node:crypto');
 const publicLines=Buffer.from(pubkey,'base64').toString().trim().split('\n');
 const signatureLines=Buffer.from(readFileSync(artifact+'.sig','utf8').trim(),'base64').toString().trim().split('\n');
 const pk=Buffer.from(publicLines[1],'base64'),sig=Buffer.from(signatureLines[1],'base64');
 if(!pk.subarray(2,10).equals(sig.subarray(2,10)))throw Error('更新签名密钥不一致');
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),pk.subarray(10)]),type:'spki',format:'der'});
 const bytes=readFileSync(artifact),message=sig.subarray(0,2).toString()==='ED'?createHash('blake2b512').update(bytes).digest():bytes;
 if(!verify(null,message,key,sig.subarray(10))||!verify(null,Buffer.concat([sig.subarray(10),Buffer.from(signatureLines[2].replace('trusted comment: ',''))]),key,Buffer.from(signatureLines[3],'base64')))throw Error('更新包签名或可信注释校验失败');
 return true;
}
