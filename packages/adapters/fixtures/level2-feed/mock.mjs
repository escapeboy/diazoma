/**
 * Harness backend for level2-feed: the manifest is the static file with the harness origins filled
 * in; the feeds are cut from the harness dataset (233 cards, 50 per page) with images on the
 * harness image host. The cursor is the dataset's opaque cursor, passed through untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillPlaceholders } from '../lib/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default function createMock(ctx) {
    const { dataset, sendJson } = ctx.lib;
    const liked = new Set();
    const itemOf = (c) => ({
        id: c.id,
        link: `/item/${c.id}`,
        title: c.title,
        image: `${ctx.cdn}/img/${c.n}/thumb.png`,
        image_focus: `${ctx.cdn}/img/${c.n}/focus.png`,
        image_full: `${ctx.cdn}/img/${c.n}/full.png`,
        aspect: c.aspect,
        media_type: c.type === 'photo' ? 'photo' : c.type === 'gif' ? 'gif' : 'video',
        tags: c.tags,
        likes: c.likes,
        state: { liked: liked.has(c.id) },
    });

    return {
        reset() {
            liked.clear();
        },
        async handle(req, res, url) {
            const p = url.pathname;
            if (p === '/.well-known/wall.json') {
                const text = fillPlaceholders(fs.readFileSync(path.join(HERE, '.well-known/wall.json'), 'utf8'), { origin: ctx.origin, cdnOrigin: ctx.cdn });
                const manifest = JSON.parse(text);
                manifest.feeds[0].url = '/wall/feed';
                manifest.feeds[1].url = '/wall/feed?sort=popular';
                manifest.feeds[2].url = '/wall/feed?q={query}';
                sendJson(res, manifest);
                return true;
            }
            if (p === '/wall/feed') {
                const q = url.searchParams.get('q');
                if (q !== null) {
                    const items = dataset.cards.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()) && !c.embed).slice(0, 20).map(itemOf);
                    sendJson(res, { items });
                    return true;
                }
                const page = ctx.lib.feedPage(url.searchParams.get('cursor'));
                sendJson(res, { items: page.items.map(itemOf), ...(page.next ? { next: page.next } : {}) });
                return true;
            }
            if (p.startsWith('/api/items/') && p.endsWith('/like')) {
                const id = p.split('/')[3];
                if (liked.has(id)) liked.delete(id);
                else liked.add(id);
                sendJson(res, { ok: true, state: { liked: liked.has(id) } });
                return true;
            }
            if (p === '/adapters.iife.js') {
                res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(fs.readFileSync(path.join(HERE, '../../dist/adapters.iife.js')));
                return true;
            }
            if (p.startsWith('/item/')) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<!doctype html><title>item</title><h1>Item page ${p}</h1>`);
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
