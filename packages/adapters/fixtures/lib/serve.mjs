#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Built bundles, so a fixture's xr.html can be tried by hand: `pnpm build` in @diazoma/adapters and @diazoma/wall first. */
const BUNDLES = { '/adapters.iife.js': path.join(HERE, '../../dist/adapters.iife.js'), '/diazoma-embed.js': path.join(HERE, '../../dist/diazoma-embed.js') };
for (const f of ['loader.js', 'wall.iife.js', 'wall-hls.js', 'wall-dash.js']) BUNDLES['/bundle/' + f] = path.join(HERE, '../../../wall/dist', f);

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.xml': 'application/xml', '.css': 'text/css' };
const TEXT = new Set(['.html', '.json', '.xml', '.js']);

/** The fixtures are templates: these placeholders become the real origins when a file is served. */
export function fillPlaceholders(text, { origin, cdnOrigin }) {
    return text
        .replaceAll('{{ORIGIN}}', origin)
        .replaceAll('{{HOST}}', new URL(origin).host)
        .replaceAll('{{CDN_ORIGIN}}', cdnOrigin)
        .replaceAll('{{CDN_HOST}}', new URL(cdnOrigin).host);
}

function listen(server) {
    return new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', () => ok(server.address().port));
    });
}

/**
 * Serves a fixture dir on two ports: the site, and an image host that sends
 * Access-Control-Allow-Origin: * unless the dir's fixture.json says { "cdnCors": false }.
 * A request with ?cursor=X for /a/b.json is answered from /a/b.X.json when that file exists.
 */
export async function serveFixture(dir) {
    const cfgFile = path.join(dir, 'fixture.json');
    const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
    const ctx = { origin: '', cdnOrigin: '' };

    const send = (req, res, file, headers = {}) => {
        const ext = path.extname(file);
        let body = fs.readFileSync(file);
        if (TEXT.has(ext)) body = Buffer.from(fillPlaceholders(body.toString('utf8'), ctx));
        res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
        res.end(req.method === 'HEAD' ? undefined : body);
    };
    const resolve = (url) => {
        let rel = decodeURIComponent(url.pathname);
        if (rel.endsWith('/')) rel += 'index.html';
        const cursor = url.searchParams.get('cursor');
        if (cursor && rel.endsWith('.json')) {
            const withCursor = rel.replace(/\.json$/, `.${cursor}.json`);
            if (fs.existsSync(path.join(dir, withCursor))) rel = withCursor;
        }
        const file = path.join(dir, rel);
        return file.startsWith(dir) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
    };

    const site = http.createServer((req, res) => {
        const url = new URL(req.url, ctx.origin);
        const file = BUNDLES[url.pathname] && fs.existsSync(BUNDLES[url.pathname]) ? BUNDLES[url.pathname] : resolve(url);
        if (!file) {
            res.writeHead(404);
            res.end('not found');
            return;
        }
        send(req, res, file);
    });
    const cdn = http.createServer((req, res) => {
        const url = new URL(req.url, ctx.cdnOrigin);
        const file = url.pathname.startsWith('/images/') ? resolve(url) : null;
        const cors = cfg.cdnCors === false ? {} : { 'Access-Control-Allow-Origin': '*' };
        if (!file) {
            res.writeHead(404, cors);
            res.end();
            return;
        }
        send(req, res, file, cors);
    });
    ctx.origin = `http://127.0.0.1:${await listen(site)}`;
    ctx.cdnOrigin = `http://127.0.0.1:${await listen(cdn)}`;
    return {
        origin: ctx.origin,
        cdnOrigin: ctx.cdnOrigin,
        async close() {
            site.closeAllConnections?.();
            cdn.closeAllConnections?.();
            await Promise.all([new Promise((ok) => site.close(ok)), new Promise((ok) => cdn.close(ok))]);
        },
    };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const dir = path.resolve(process.argv[2] ?? '.');
    const s = await serveFixture(dir);
    console.log(`site ${s.origin}/\nimages ${s.cdnOrigin}/ (CORS ${fs.existsSync(path.join(dir, 'fixture.json')) && JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8')).cdnCors === false ? 'off' : 'on'})\nCtrl-C to stop`);
}
