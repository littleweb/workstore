import { cp, mkdir, readFile, writeFile, rm, symlink, access, readdir, lstat, realpath, chmod, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vendor = path.join(root, 'vendor/html-anything');
const staging = path.join(root, '.html-anything-build/next');
const output = path.join(root, 'src-tauri/html-runtime');
const origin = JSON.parse(await readFile(path.join(root, 'third-party/html-anything/upstream-manifest.json'), 'utf8'));
const digest = createHash('sha256').update(process.version).update(process.arch).update(process.platform);
for (const [name, expected] of Object.entries(origin.files)) {
  const bytes = await readFile(path.join(vendor, name));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Upstream file changed: ${name}`);
  digest.update(bytes);
}
for (const file of ['build.mjs', 'preload.cjs', 'WorkStoreBridge.tsx']) digest.update(await readFile(new URL(file, import.meta.url)));
const buildId = digest.digest('hex').slice(0, 24);
try {
  const previous = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  await access(path.join(output, 'app.tar')); await access(path.join(output, previous.node));
  if (previous.buildId === buildId) { console.log('HTML Anything runtime is up to date.'); process.exit(0); }
} catch {}
await access(path.join(vendor, 'next/node_modules/next/dist/bin/next')).catch(() => {
  throw new Error('Install upstream dependencies first: npm run html:install');
});
await mkdir(path.dirname(staging), { recursive: true });
await cp(path.join(vendor, 'next'), staging, { recursive: true, filter: source => !['node_modules', '.next'].includes(path.basename(source)) });
await rm(path.join(staging, 'node_modules'), { recursive: true, force: true });
await symlink(path.join(vendor, 'next/node_modules'), path.join(staging, 'node_modules'), 'dir');
// Packaging-only config and invisible lifecycle bridge; upstream files remain byte-identical.
await writeFile(path.join(staging, 'next.config.ts'), `export default {output:'standalone',outputFileTracingRoot:${JSON.stringify(root)},experimental:{cpus:2}};\n`);
await cp(new URL('WorkStoreBridge.tsx', import.meta.url), path.join(staging, 'src/components/workstore-bridge.tsx'));
// Explicit WorkStore default; keep the pinned source untouched.
const storePath = path.join(staging, 'src/lib/store.ts');
await writeFile(storePath, (await readFile(storePath, 'utf8')).replace('selectedAgent: undefined,', "selectedAgent: 'codex',"));
const layoutPath = path.join(staging, 'src/app/layout.tsx');
const layout = await readFile(layoutPath, 'utf8');
await writeFile(layoutPath, `import WorkStoreBridge from '@/components/workstore-bridge';\n` + layout.replace('{children}', '{children}<WorkStoreBridge />'));
const build = spawnSync(process.execPath, [path.join(vendor, 'next/node_modules/next/dist/bin/next'), 'build'], {
  cwd: staging, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
if (build.status !== 0) process.exit(build.status || 1);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(staging, '.next/standalone'), path.join(output, 'app'), { recursive: true, verbatimSymlinks: true });
const app = path.join(output, 'app/.html-anything-build/next');
await cp(path.join(staging, 'public'), path.join(app, 'public'), { recursive: true });
await cp(path.join(staging, '.next/static'), path.join(app, '.next/static'), { recursive: true });
await cp(path.join(staging, 'src/lib/templates/skills'), path.join(app, 'src/lib/templates/skills'), { recursive: true });
await cp(new URL('preload.cjs', import.meta.url), path.join(output, 'preload.cjs'));
const node = process.platform === 'win32' ? 'node.exe' : 'node';
await cp(process.execPath, path.join(output, node));
if (process.platform === 'darwin') {
  const thin = path.join(output, 'node-thin');
  const result = spawnSync('lipo', [path.join(output, node), '-thin', process.arch === 'arm64' ? 'arm64' : 'x86_64', '-output', thin]);
  if (result.status === 0) { await cp(thin, path.join(output, node)); await rm(thin); }
  spawnSync('codesign', ['--force', '--sign', '-', path.join(output, node)], { stdio: 'inherit' });
}
await chmod(path.join(output, node), 0o755);
await cp(path.join(vendor, 'LICENSE'), path.join(output, 'HTML-ANYTHING-LICENSE'));
await cp(path.join(root, 'third-party/html-anything/NODE-LICENSE'), path.join(output, 'NODE-LICENSE'));
async function checkLinks(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if ((await lstat(file)).isSymbolicLink()) {
      const link = await readlink(file);
      if (path.isAbsolute(link) && link.startsWith(root + path.sep)) {
        const mapped = path.join(output, 'app', path.relative(root, link));
        await rm(file); await symlink(path.relative(path.dirname(file), mapped), file, 'dir');
      }
      const target = await realpath(file);
      if (!target.startsWith(output + path.sep)) throw new Error('Bundled symlink escapes runtime: ' + file);
    } else if (item.isDirectory()) await checkLinks(file);
  }
}
await checkLinks(output);
const archive = spawnSync('tar', ['-cf', path.join(output, 'app.tar'), '-C', path.join(output, 'app'), '.'], {stdio:'inherit'});
if (archive.status !== 0) throw new Error('Runtime archive failed');
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ buildId, revision: origin.revision, node, entry: 'app/.html-anything-build/next/server.js', nodeVersion: process.version, platform: process.platform, arch: process.arch }, null, 2));
console.log('Bundled original HTML Anything with its Node runtime.');
