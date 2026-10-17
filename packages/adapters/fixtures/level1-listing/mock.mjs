/**
 * Harness backend for level1-listing: the same annotated listing as the static pages, but cut from
 * the harness dataset (233 cards, 50 per page) with images on the harness image host. The images
 * are written as data-src, the lazy-loading pattern, so only the wall requests them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderListing, stage, loader } from '../lib/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default function createMock(ctx) {
    const view = (c) => ({ id: c.id, title: c.title, subtitle: `by ${c.author}`, aspect: c.aspect, badges: [], n: c.n });
    const image = (p, kind) => `${ctx.cdn}/img/${p.n}/${kind === 'large' ? 'focus' : 'thumb'}.png`;
    const link = (p) => `/item/${p.id}`;

    const listing = (cursor, extraBody = '') => {
        const page = ctx.lib.feedPage(cursor || null);
        return renderListing({
            title: 'Fixture listing',
            items: page.items.map(view),
            image,
            link,
            next: page.next ? `/listing?cursor=${page.next}` : null,
            lazy: true,
            extraBody,
        });
    };
    const html = (res, body) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(body);
    };

    return {
        async handle(req, res, url) {
            const p = url.pathname;
            if (p === '/xr.html') {
                const mount = `${stage}<script src="/adapters.iife.js"></script>
<script>window.diazoma = { options: { adapter: new DiazomaAdapters.DomAdapter(), brand: { name: 'Fixture', accent: '#4f8cff' }, telemetry: { endpoint: '/api/events', prefix: 'xr_' }, inputProfile: 'meta-quest' } };</script>
${loader()}
`;
                html(res, listing(null, mount));
                return true;
            }
            if (p === '/listing') {
                html(res, listing(url.searchParams.get('cursor')));
                return true;
            }
            if (p === '/adapters.iife.js') {
                const file = path.join(HERE, '../../dist/adapters.iife.js');
                res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(fs.readFileSync(file));
                return true;
            }
            if (p.startsWith('/item/')) {
                html(res, `<!doctype html><title>item</title><h1>Item page ${p}</h1>`);
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
