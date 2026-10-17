import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// IIFE build for the one-script-tag case: three.js and qrcode bundled, exposes window.Diazoma.
// The stream libraries are not bundled: libs.js is swapped for libs.iife.js, which loads
// wall-hls.js / wall-dash.js (vite.libs.config.ts) from the same folder when a stream opens.
export default defineConfig({
  resolve: {
    alias: [{ find: /^\.\/libs\.js$/, replacement: fileURLToPath(new URL('./src/scene/video/libs.iife.js', import.meta.url)) }],
  },
  build: {
    lib: { entry: 'src/index.ts', formats: ['iife'], name: 'Diazoma', fileName: () => 'wall.iife.js' },
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
  },
});
