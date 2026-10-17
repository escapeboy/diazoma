import { defineConfig } from 'vite';

// ESM build: three.js stays external (a peer dependency), so an app shares one copy. The stream
// libraries (optional peers) stay external too and are imported only when a stream is opened.
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'wall.esm.js' },
    rolldownOptions: { external: ['three', /^three\//, 'qrcode', /^hls\.js(\/|$)/, 'dashjs'] },
    target: 'es2020',
    sourcemap: false,
  },
});
