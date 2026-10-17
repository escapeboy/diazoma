/**
 * ESM build: the stream libraries are optional peer dependencies, imported only when a stream
 * is opened. The IIFE build replaces this file with libs.iife.js (vite.iife.config.ts).
 */
export function importLib(name) {
    if (name === 'hls') return import('hls.js/light').then((m) => m.default);
    return import('dashjs').then((m) => m.default || m);
}
