import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
if (!config.plugins?.updater?.pubkey || !config.plugins.updater.endpoints?.length) throw new Error('请先配置发布仓库和更新公钥');
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('请设置 TAURI_SIGNING_PRIVATE_KEY，签名私钥不能提交到仓库');
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url)),
  'build', '--config', JSON.stringify({ bundle: { createUpdaterArtifacts: true } }), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
