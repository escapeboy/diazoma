import { loadScript } from './script.js';

// The one-script-tag build cannot hold the stream libraries (about 120 KB and 220 KB gzipped):
// they ship as wall-hls.js and wall-dash.js next to wall.iife.js and load from the same folder.
const SELF = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : '';

export function importLib(name) {
    const file = name === 'hls' ? 'wall-hls.js' : 'wall-dash.js';
    return loadScript(new URL(file, SELF || location.href).href, name === 'hls' ? 'Hls' : 'dashjs');
}
