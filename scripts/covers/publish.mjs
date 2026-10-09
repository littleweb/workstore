import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { repository, branch, collectPreviews } from './preview-assets.mjs';

// Publish only public preview assets. Never stage the workspace or access user files.
const api = (path, method = 'GET', payload) => {
  const result = spawnSync('gh', ['api', `repos/${repository}/${path}`, '--method', method, ...(payload ? ['--input', '-'] : [])], { input: payload ? JSON.stringify(payload) : undefined, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw Error(result.stderr || 'GitHub素材发布失败');
  return JSON.parse(result.stdout);
};
const entries = collectPreviews();
const remote = api('git/matching-refs/heads/assets/covers');
const old = remote.find(ref => ref.ref === `refs/heads/${branch}`)?.object.sha;
const catalog = { schemaVersion: 1, repository, entries };
let commit;
if (old) {
  const content = api(`contents/manifest.json?ref=${old}`);
  if (Buffer.from(content.content, 'base64').toString() === JSON.stringify(catalog, null, 2) + '\n') commit = old;
}
if (!commit) {
  const main = api('git/ref/heads/main').object.sha;
  const known = api(`git/trees/${main}?recursive=1`);
  if (known.truncated) throw Error('远端树不完整，停止素材发布');
  const blobs = new Set(known.tree.filter(item => item.type === 'blob').map(item => item.sha));
  const tree = [];
  for (const [key, entry] of Object.entries(entries)) {
    if (!blobs.has(entry.blob)) {
      const blob = api('git/blobs', 'POST', { encoding: 'base64', content: readFileSync(`public${key}`).toString('base64') });
      if (blob.sha !== entry.blob) throw Error('远端素材校验失败');
    }
    tree.push({ path: entry.path, mode: '100644', type: 'blob', sha: entry.blob });
  }
  const manifest = api('git/blobs', 'POST', { encoding: 'utf-8', content: JSON.stringify(catalog, null, 2) + '\n' });
  tree.push({ path: 'manifest.json', mode: '100644', type: 'blob', sha: manifest.sha });
  const existingCovers = known.tree.find(item => item.path === 'public/handraw-style/covers' && item.type === 'tree');
  let coversTree;
  if (existingCovers && Object.entries(entries).every(([key, entry]) => known.tree.some(item => item.path === `public${key}` && item.sha === entry.blob))) coversTree = existingCovers.sha;
  else {
    const groups = [...new Set(Object.values(entries).map(entry => entry.path.split('/')[1]))];
    const groupsTree = groups.map(group => ({ path: group, mode: '040000', type: 'tree', sha: api('git/trees', 'POST', { tree: tree.filter(item => item.path.startsWith(`covers/${group}/`)).map(item => ({...item, path: item.path.split('/').at(-1)})) }).sha }));
    coversTree = api('git/trees', 'POST', { tree: groupsTree }).sha;
  }
  const assetTree = api('git/trees', 'POST', { tree: [{path:'covers',mode:'040000',type:'tree',sha:coversTree}, tree.at(-1)] });
  commit = api('git/commits', 'POST', { message: 'Publish verified cover preview assets', tree: assetTree.sha, parents: old ? [old] : [] }).sha;
  if (old) api(`git/refs/heads/${branch}`, 'PATCH', { sha: commit, force: false });
  else api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: commit });
}
// Verify the immutable revision before producing an index used by the installer.
const published = api(`git/trees/${commit}?recursive=1`);
if (published.truncated || Object.values(entries).some(entry => !published.tree.some(item => item.path === entry.path && item.sha === entry.blob && item.size === entry.size))) throw Error('GitHub预览素材不完整');
writeFileSync('src/covers/remote-previews.json', JSON.stringify({ ...catalog, commit }, null, 2) + '\n');
console.log(`封面预览已发布：${Object.keys(entries).length}张，版本 ${commit}`);
