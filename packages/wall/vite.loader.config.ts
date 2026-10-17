import { defineConfig } from 'vite';

// The loader holds no three.js: it shows the Enter VR card and loads the core on demand.
export default defineConfig({
  build: {
    lib: { entry: 'src/loader/loader.ts', formats: ['iife'], name: 'DiazomaLoader', fileName: () => 'loader.js' },
    emptyOutDir: false,
    minify: true,
    target: 'es2020',
    sourcemap: false,
  },
});
