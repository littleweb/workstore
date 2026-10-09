import { defineConfig } from 'vite';
import { cpSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

let output, root;
const release = process.env.WORKSTORE_RELEASE === '1';
export default defineConfig({
  define: { __WORKSTORE_RELEASE__: JSON.stringify(release) },
  publicDir: release ? false : 'public',
  plugins: release ? [{
    name: 'workstore-release-public-assets',
    apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir); root = config.root; },
    writeBundle() {
      for (const entry of readdirSync(resolve(root, 'public'))) {
        if (entry === 'course') continue;
        cpSync(resolve(root, 'public', entry), resolve(output, entry), { recursive: true, dereference: true });
      }
    },
  }] : [],
});
