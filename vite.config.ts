import { defineConfig } from 'vite';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/ela/' : '/',
  // index.html declares no <link rel="modulepreload"> (the post-quantum panel is a lazily imported
  // chunk), so the main chunk does not ship Vite's modulepreload polyfill for old browsers.
  build: { modulePreload: { polyfill: false } },
}));
