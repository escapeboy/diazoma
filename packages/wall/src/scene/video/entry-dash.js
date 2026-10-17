// Entry of dist/wall-dash.js (IIFE build only): the dash.js media player build as window.dashjs.
// vite.libs.config.ts aliases this specifier to the package's prebuilt mediaplayer ESM file.
import dashjs from 'dashjs-mediaplayer';

window.dashjs = dashjs;
