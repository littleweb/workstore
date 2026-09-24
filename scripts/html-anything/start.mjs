import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve('src-tauri/html-runtime');
const manifest = JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
const entry = path.join(root,manifest.entry);
const state = path.resolve('.html-anything-build/preview-state');
await mkdir(state,{recursive:true});
const child = spawn(path.join(root,manifest.node),['--require',path.join(root,'preload.cjs'),entry], {
 cwd:path.dirname(entry),stdio:'inherit',env:{...process.env,PORT:'43187',HOSTNAME:'127.0.0.1',NEXT_TELEMETRY_DISABLED:'1',WORKSTORE_PARENT_PID:String(process.pid),HTML_ANYTHING_USER_STATE_DIR:state,HTML_ANYTHING_USER_SKILLS_DIR:path.join(state,'skills')},
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??0));
