import { defineConfig } from 'vite';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/ela/' : '/',
  // Only the existing rules chunk is eagerly preloaded. AI and the verifier stay lazy;
  // the main chunk does not ship a modulepreload polyfill for old browsers.
  build: {
    modulePreload: { polyfill: false },
    // Keep the existing rules available even when the optional AI chunk cannot load.
    // A separate eager rules chunk keeps model/runtime code out of the main bundle.
    rolldownOptions: { output: { codeSplitting: { groups: [
      { name: 'rules', test: /[\\/]src[\\/]agent[\\/]lexicon\.ts$/ },
    ] } } },
  },
}));
