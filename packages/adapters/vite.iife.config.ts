import { defineConfig } from 'vite';

// One script tag for the fixture pages and for sites without a bundler: exposes window.DiazomaAdapters.
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['iife'], name: 'DiazomaAdapters', fileName: () => 'adapters.iife.js' },
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
  },
});
