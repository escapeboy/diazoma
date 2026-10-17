import { defineConfig } from 'vite';

// The one-tag embed: reads data-manifest, builds a WellKnownAdapter, injects the wall loader.
export default defineConfig({
  build: {
    lib: { entry: 'src/embed-entry.ts', formats: ['iife'], name: 'DiazomaEmbed', fileName: () => 'diazoma-embed.js' },
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
  },
});
