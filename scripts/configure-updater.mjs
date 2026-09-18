import { readFileSync, writeFileSync } from 'node:fs';
const [repository, publicKeyFile] = process.argv.slice(2);
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !publicKeyFile) {
  throw new Error('用法：node scripts/configure-updater.mjs owner/repository /path/to/updater.key.pub');
}
const pubkey = readFileSync(publicKeyFile, 'utf8').trim();
const decoded = Buffer.from(pubkey, 'base64').toString();
if (!decoded.startsWith('untrusted comment:') || decoded.includes('secret key')) throw new Error('请提供 Tauri 生成的 .pub 公钥文件');
const path = new URL('../src-tauri/tauri.conf.json', import.meta.url);
const config = JSON.parse(readFileSync(path, 'utf8'));
config.plugins ??= {};
config.plugins.updater = {
  pubkey,
  endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`],
  windows: { installMode: 'passive' },
};
writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
console.log('已配置更新源。请重新构建首次安装包；私钥应独立备份，不能放入发布仓库。');
