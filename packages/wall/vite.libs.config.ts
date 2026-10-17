import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The two stream libraries of the IIFE build, as their own files next to wall.iife.js:
//   vite build --config vite.libs.config.ts --mode hls   → dist/wall-hls.js  (hls.js light, window.Hls)
//   vite build --config vite.libs.config.ts --mode dash  → dist/wall-dash.js (dash.js media player, window.dashjs)
// dashjs exports only its "all" build; the smaller media player build is taken from its dist folder.
const DASH_MEDIAPLAYER = fileURLToPath(new URL('./node_modules/dashjs/dist/modern/esm/dash.mediaplayer.min.js', import.meta.url));

export default defineConfig(({ mode }) => {
  const lib = mode === 'dash' ? 'dash' : 'hls';
  return {
    resolve: { alias: [{ find: /^dashjs-mediaplayer$/, replacement: DASH_MEDIAPLAYER }] },
    build: {
      lib: { entry: `src/scene/video/entry-${lib}.js`, formats: ['iife'], name: lib === 'hls' ? 'DiazomaHls' : 'DiazomaDash', fileName: () => `wall-${lib}.js` },
      emptyOutDir: false,
      target: 'es2020',
      sourcemap: false,
    },
  };
});
