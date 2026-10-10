import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPlan } from './release/plan.mjs';
import { readManifest, verifyFrontend, verifyMacBundle } from './release/assets.mjs';
import { collectPreviews, validatePublished } from './covers/preview-assets.mjs';
import { collectDesignAssets, validateDesignPublished } from './design-studio/assets.mjs';
import { checkRelease, verifyUpdateSignature } from './release/check.mjs';
import { spawnSync } from 'node:child_process';

// Formal releases include only the tools and resources in the release manifest.
// Native JSON/storage support stays compatible with already saved course files.
const plan = buildPlan(process.argv.slice(2), process.env);
const env = { ...process.env, WORKSTORE_RELEASE: '1', TAURI_CONFIG: JSON.stringify({bundle:{resources:[]}}) };
const run = (file, args) => {
  const result = spawnSync(file, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
for (const script of ['prepare-excalidraw.mjs', 'story-comic/build-resources.mjs', 'course/build-resources.mjs', 'course-web/build-examples.mjs']) {
  run(process.execPath, ['scripts/' + script]);
}
if (plan.publishPreviews) {
  run(process.execPath, ['scripts/covers/publish.mjs']);
  run(process.execPath, ['scripts/design-studio/publish.mjs']);
  run(process.execPath, ['scripts/course-animation/build-runtime.mjs']);
  run(process.execPath, ['scripts/course-whiteboard/build-runtime.mjs']);
  run('python3', ['scripts/resources/pack.py']);
  run(process.execPath, ['scripts/resources/publish.mjs']);
}
validatePublished(JSON.parse(readFileSync('src/covers/remote-previews.json', 'utf8')), collectPreviews());
validateDesignPublished(JSON.parse(readFileSync('src/design-studio/remote-assets.json', 'utf8')), collectDesignAssets());
console.log('发布前必检：',checkRelease());
run(process.execPath, ['--test', ...((await import('node:fs')).readdirSync('tests').filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/'+f))]);
run('cargo',['test','--manifest-path','src-tauri/Cargo.toml','--','--test-threads=1']);
const frontend = resolve('.release-build/frontend');
rmSync(frontend, { recursive: true, force: true });
run(process.execPath, ['node_modules/typescript/bin/tsc', '-b']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', frontend]);
const inventory = verifyFrontend(process.cwd(), frontend);
console.log('正式版资源清单：', inventory);
const resources = readManifest().nativeResources;
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--config', JSON.stringify({
  build: { beforeBuildCommand: '', frontendDist: frontend },
  bundle: { resources, createUpdaterArtifacts: plan.createUpdaterArtifacts, ...(process.platform === 'darwin' ? { targets: ['app', 'dmg'] } : {}) },
}), ...plan.cliArgs]);

if (process.platform === 'darwin' && !plan.cliArgs.includes('--no-bundle')) {
  const targetAt = process.argv.indexOf('--target');
  const target = targetAt < 0 ? '' : process.argv[targetAt + 1];
  const profile = process.argv.includes('--debug') ? 'debug' : 'release';
  const bundle=resolve(process.env.CARGO_TARGET_DIR || 'src-tauri/target',target,profile,'bundle');
  const app=resolve(bundle,'macos/WorkStore.app');
  console.log('正式应用字节数：',verifyMacBundle(app));
  run('codesign',['--verify','--deep','--strict',app]);
  if(plan.createUpdaterArtifacts) await verifyUpdateSignature(resolve(bundle,'macos/WorkStore.app.tar.gz'),JSON.parse(readFileSync('src-tauri/tauri.conf.json')).plugins.updater.pubkey);
  const dmg=resolve(bundle,`dmg/WorkStore_${JSON.parse(readFileSync('package.json')).version}_${process.arch==='arm64'?'aarch64':'x64'}.dmg`);
  run('hdiutil',['verify',dmg]);
  run('python3',['scripts/release/verify-packages.py',app,dmg,...(plan.createUpdaterArtifacts?[resolve(bundle,'macos/WorkStore.app.tar.gz')]:[])]);
}
