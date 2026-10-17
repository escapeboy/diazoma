/**
 * Harness backend for level2-actions: a shop whose manifest declares its own actions and view.
 * favourite toggles (session + CSRF), cart opens a page, compare answers 401 (not signed in),
 * enquire answers 500, follow answers 200 without a state. Every action call is recorded with its CSRF header and cookie and can be
 * read back from /__actions. Items 1, 6, 11, … have no actions; 2, 7, 12, … only the cart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillPlaceholders } from '../lib/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default function createMock(ctx) {
    const { dataset, sendJson } = ctx.lib;
    const favourites = new Set();
    const calls = [];
    const itemOf = (c, i) => ({
        id: c.id,
        link: `/item/${c.id}`,
        title: c.title,
        subtitle: 'Fixture maker',
        description: 'A sample item of the fixture shop.',
        image: `${ctx.cdn}/img/${c.n}/thumb.png`,
        image_focus: `${ctx.cdn}/img/${c.n}/focus.png`,
        image_full: `${ctx.cdn}/img/${c.n}/full.png`,
        aspect: c.aspect,
        media_type: 'photo',
        badges: i % 3 === 0 ? ['New'] : [],
        meta: { price: `${10 + (c.n % 90)} €`, size: '30 × 40 cm' },
        state: { favourite: favourites.has(c.id) },
        ...(i % 5 === 1 ? { actions: [] } : i % 5 === 2 ? { actions: ['cart'] } : {}),
    });
    const photos = () => dataset.cards.filter((c) => c.type === 'photo' && !c.embed);

    return {
        reset() {
            favourites.clear();
            calls.length = 0;
        },
        async handle(req, res, url) {
            const p = url.pathname;
            if (p === '/.well-known/wall.json') {
                sendJson(res, JSON.parse(fillPlaceholders(fs.readFileSync(path.join(HERE, '.well-known/wall.json'), 'utf8'), { origin: ctx.origin, cdnOrigin: ctx.cdn })));
                return true;
            }
            if (p === '/wall/feed') {
                const all = photos();
                const start = Number(url.searchParams.get('cursor') || 0);
                const items = all.slice(start, start + 50).map((c, k) => itemOf(c, start + k));
                sendJson(res, { items, ...(start + 50 < all.length ? { next: String(start + 50) } : {}) });
                return true;
            }
            const m = /^\/api\/items\/([^/]+)\/(favourite|compare|enquire|follow)$/.exec(p);
            if (m && req.method === 'POST') {
                const [, id, action] = m;
                calls.push({ action, id, method: req.method, csrf: req.headers['x-csrf-token'] || null, cookie: req.headers.cookie || null });
                if (action === 'compare') sendJson(res, { message: 'sign in' }, 401);
                else if (action === 'enquire') sendJson(res, { message: 'down' }, 500);
                // A toggle answered without a state: the wall flips it itself.
                else if (action === 'follow') sendJson(res, { ok: true });
                else {
                    if (favourites.has(id)) favourites.delete(id);
                    else favourites.add(id);
                    sendJson(res, { ok: true, state: { favourite: favourites.has(id) } });
                }
                return true;
            }
            if (p === '/__actions') {
                sendJson(res, calls);
                return true;
            }
            if (p === '/adapters.iife.js') {
                res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(fs.readFileSync(path.join(HERE, '../../dist/adapters.iife.js')));
                return true;
            }
            if (p.startsWith('/item/') || p.startsWith('/cart/add/') || p === '/login') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<!doctype html><title>page</title><h1>${p}</h1>`);
                return true;
            }
            if (p === '/favicon.ico') {
                res.writeHead(204);
                res.end();
                return true;
            }
            return false;
        },
    };
}
