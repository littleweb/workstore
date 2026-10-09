import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const cache='.course-tts-build',models=path.join(cache,'models');
const provenance=JSON.parse(await readFile('vendor/course-tts/UPSTREAM.json','utf8'));
await mkdir(models,{recursive:true});
for(const file of provenance.files){
 const target=path.join(models,file.name);
 let bytes;try{bytes=await readFile(target);}catch{}
 if(!bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256){
  const response=await fetch(file.url);if(!response.ok)throw Error('Speech model download failed');
  bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Speech model SHA-256 mismatch');
  await writeFile(target,bytes);
 }
}
const lock=await readFile('scripts/ai/speech-requirements.txt'),digest=createHash('sha256').update(lock).digest('hex');
const python=path.resolve('.course-whiteboard-build/python',process.platform==='win32'?'python.exe':'bin/python3');
await access(python);
const marker=path.join('.course-whiteboard-build','speech-dependencies.json');
let installed;try{installed=JSON.parse(await readFile(marker,'utf8'));}catch{}
if(installed?.sha256!==digest){
 const child=spawnSync(python,['-m','pip','install','--quiet','-r','scripts/ai/speech-requirements.txt'],{stdio:'inherit'});
 if(child.status)throw Error('Speech runtime installation failed');
 await writeFile(marker,JSON.stringify({sha256:digest,requirements:lock.toString()},null,2));
}
console.log('Natural Chinese speech runtime is ready.');
