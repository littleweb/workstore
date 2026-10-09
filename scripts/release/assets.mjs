import { readFileSync, readdirSync, statSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';

export function readManifest(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'src/release-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.nativeResources.length !== 0 || !Number.isSafeInteger(manifest.maxFrontendBytes)) throw Error('正式发布资源规则无效');
  return manifest;
}
function references(value, prefix, files) {
  if (typeof value === 'string' && value.startsWith(prefix)) files.add(value.slice(1));
  else if (Array.isArray(value)) value.forEach(item => references(item, prefix, files));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => references(item, prefix, files));
}
function tree(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = `${prefix}${entry.name}`;
    return entry.isDirectory() ? tree(resolve(root, entry.name), `${path}/`) : [path];
  });
}
export function publicAssets(root = process.cwd()) {
  const manifest = readManifest(root), files = new Set(manifest.publicFiles);
  references(JSON.parse(readFileSync(resolve(root, 'src/design-studio/catalog.json'), 'utf8')), '/design-studio/', files);
  const catalog = JSON.parse(readFileSync(resolve(root, 'src/covers/catalog.json'), 'utf8'));
  for (const group of ['styles', 'layouts', 'colors']) for (const item of catalog[group]) files.add(item.image.slice(1));
  const themes = JSON.parse(readFileSync(resolve(root, 'src/story-comic/coverThemes.json'), 'utf8'));
  for (const key of Object.keys(themes)) files.add(`story-comic/covers/${key}.jpg`);
  for (const directory of manifest.fontDirectories) {
    for (const file of tree(resolve(root, 'public', directory))) if (/\.(woff2?|ttf|otf)$/i.test(file) || /(?:license|copyright|ofl)/i.test(file)) files.add(`${directory}/${file}`);
  }
  return [...files].sort().map(path => {
    const absolute = resolve(root, 'public', path), publicRoot = resolve(root, 'public');
    const local = relative(publicRoot, absolute);
    if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep) || path.split(/[\\/]/).includes('..') || /^(comics|course)\//.test(path) || path.startsWith('handraw-style/covers/')) throw Error(`资源路径不允许：${path}`);
    const info = statSync(absolute);
    if (!info.isFile()) throw Error(`资源不是文件：${path}`);
    return { path, size: info.size };
  });
}
export function copyPublicAssets(root, output) {
  const files = publicAssets(root);
  for (const { path } of files) {
    mkdirSync(dirname(resolve(output, path)), { recursive: true });
    cpSync(resolve(root, 'public', path), resolve(output, path));
  }
  return files;
}
export function checkModules(root, bundle) {
  const manifest = readManifest(root);
  for (const item of Object.values(bundle)) {
    if (item.type !== 'chunk') continue;
    for (const [module, metadata] of Object.entries(item.modules)) {
      if (metadata.renderedLength === 0) continue;
      const name = relative(root, module).replaceAll('\\', '/');
      if (manifest.excludedModules.some(prefix => name === prefix || name.startsWith(prefix.endsWith('/') ? prefix : `${prefix}?`))) throw Error(`隐藏工具进入正式包：${name}`);
    }
  }
}
export function verifyFrontend(root, output) {
  const manifest = readManifest(root), expected = publicAssets(root), actual = tree(output);
  const allowed = new Set(expected.map(file => file.path));
  for (const path of actual) {
    if (path === 'index.html' || path === 'release-inventory.json' || path.startsWith('assets/')) continue;
    if (!allowed.has(path)) throw Error(`未声明的资源进入正式包：${path}`);
  }
  for (const file of expected) if (statSync(resolve(output, file.path)).size !== file.size) throw Error(`资源不完整：${file.path}`);
  const payloadBytes = actual.filter(file => file !== 'release-inventory.json').reduce((sum, file) => sum + statSync(resolve(output, file)).size, 0);
  let totalBytes = payloadBytes;
  const result = { schemaVersion: 1, tools: manifest.tools, nativeResources: manifest.nativeResources, totalBytes, publicBytes: expected.reduce((sum, file) => sum + file.size, 0), publicFileCount: expected.length };
  for (let attempt = 0; attempt < 4; attempt++) result.totalBytes = payloadBytes + Buffer.byteLength(JSON.stringify(result, null, 2) + '\n');
  if (result.totalBytes > manifest.maxFrontendBytes) throw Error(`前端资源超过体积预算：${result.totalBytes}`);
  writeFileSync(resolve(output, 'release-inventory.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

export function verifyMacBundle(bundle) {
  const files = tree(resolve(bundle, 'Contents/Resources'));
  if (files.some(path => path !== 'icon.icns')) throw Error('未开放工具的运行资源进入正式应用');
  const bytes = tree(bundle).reduce((sum, file) => sum + statSync(resolve(bundle, file)).size, 0);
  if (bytes > 260 * 1024 * 1024) throw Error('正式应用超过体积预算');
  return bytes;
}
