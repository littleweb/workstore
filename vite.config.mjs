import { defineConfig } from 'vite';
import { copyPublicAssets, checkModules, verifyFrontend } from './scripts/release/assets.mjs';
import { collectPreviews, validatePublished } from './scripts/covers/preview-assets.mjs';
import { collectDesignAssets, validateDesignPublished } from './scripts/design-studio/assets.mjs';
import { validateResources } from './scripts/resources/catalog.mjs';
import { cpSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let output, root;
const release = process.env.WORKSTORE_RELEASE === '1';
export default defineConfig(({ command }) => ({
  define: { __WORKSTORE_RELEASE__: JSON.stringify(release) },
  publicDir: command === 'build' ? false : 'public',
  plugins: command === 'build' ? [{
    name: 'workstore-release-public-assets',
    apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir); root = config.root; },
    generateBundle(_, bundle) { if (release) checkModules(root, bundle); },
    writeBundle() {
      validatePublished(JSON.parse(readFileSync(resolve(root, "src/covers/remote-previews.json"), "utf8")), collectPreviews(root));
      validateDesignPublished(JSON.parse(readFileSync(resolve(root, "src/design-studio/remote-assets.json"), "utf8")), collectDesignAssets(root));
      if(release) validateResources(root);
      if (release) { copyPublicAssets(root, output); verifyFrontend(root, output); return; }
      for (const entry of readdirSync(resolve(root, 'public'))) {
        if (release && entry === 'course') continue;
        cpSync(resolve(root, 'public', entry), resolve(output, entry), { recursive: true, dereference: true, filter: path => !path.startsWith(resolve(root, "public/handraw-style/covers")) && !path.startsWith(resolve(root, "public/design-studio")) && (entry !== "course" || !release) });
      }
    },
  }] : [],
}));
