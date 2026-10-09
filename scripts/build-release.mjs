import { readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Formal releases exclude the unfinished course UI, examples and native runtimes.
// Native JSON/storage support stays compatible with already saved course files.
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('需要现有更新签名私钥，请勿生成替代密钥');
const env = { ...process.env, WORKSTORE_RELEASE: '1' };
const run = (file, args) => {
  const result = spawnSync(file, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
for (const script of ['prepare-excalidraw.mjs', 'comics/build-validator.mjs', 'html-anything/build.mjs', 'story-comic/build-resources.mjs']) {
  run(process.execPath, ['scripts/' + script]);
}
const frontend = resolve('.release-build/frontend');
rmSync(frontend, { recursive: true, force: true });
run(process.execPath, ['node_modules/typescript/bin/tsc', '-b']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', frontend]);
if (existsSync(resolve(frontend, 'course')) || readdirSync(resolve(frontend, 'assets')).some(name => name.startsWith('CourseApp-'))) {
  throw new Error('课程资源意外进入正式包');
}
const base = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const resources = Object.keys(base.bundle.resources).filter(path => !/^(course-runtime|whiteboard-runtime)\//.test(path));
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--config', JSON.stringify({
  build: { beforeBuildCommand: '', frontendDist: frontend },
  bundle: { resources, createUpdaterArtifacts: true },
}), ...process.argv.slice(2)]);
