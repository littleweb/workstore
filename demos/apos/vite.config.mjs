import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
