import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
const [repository, ...pairs] = process.argv.slice(2);
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !pairs.length || pairs.length % 2) {
  throw new Error('用法：node scripts/create-update-manifest.mjs owner/repo darwin-aarch64 path/to/WorkStore.app.tar.gz [windows-x86_64 path/to/setup.exe ...]');
}
const { version } = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
const dir = resolve('release-assets');
const manifest = { version, notes: process.env.WORKSTORE_RELEASE_NOTES || '', pub_date: new Date().toISOString(), platforms: {} };
const artifacts = [];
for (let i = 0; i < pairs.length; i += 2) {
  const [target, source] = pairs.slice(i, i + 2);
  if (!/^(darwin|windows|linux)-(aarch64|x86_64|i686|armv7)$/.test(target) || manifest.platforms[target]) throw new Error(`无效或重复的平台：${target}`);
  if (!/\.(app\.tar\.gz|exe|msi|AppImage)$/.test(source)) throw new Error('必须使用 Tauri 生成的更新包，不能使用 DMG');
  const signature = readFileSync(source + '.sig', 'utf8').trim();
  if (!signature || !Buffer.from(signature, 'base64').toString().startsWith('untrusted comment:')) throw new Error('无效的更新包签名');
  const filename = target + '-' + basename(source);
  manifest.platforms[target] = { signature, url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(filename)}` };
  artifacts.push({ source, filename });
}
mkdirSync(dir, { recursive: true });
for (const { source, filename } of artifacts) {
  copyFileSync(source, resolve(dir, filename));
  copyFileSync(source + '.sig', resolve(dir, filename + '.sig'));
}
writeFileSync(resolve(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`已生成 ${dir}。把 latest.json 和此次各平台更新包上传到同一个 v${version} Release，再发布该版本。`);
