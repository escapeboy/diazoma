import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DomAdapter } from '../src/DomAdapter';
import { decodeCursor } from '../src/common';
import { doc, read, stubFetch } from './helpers';

const BASE = 'http://shop.test/';
const pages = () => stubFetch({
    'http://shop.test/page2.html': read('level1-listing/page2.html'),
    'http://shop.test/page3.html': read('level1-listing/page3.html'),
});

describe('DomAdapter on the level1 fixture', () => {
    it('reads 24 annotated items from the first page with all fields', async () => {
        const a = new DomAdapter({ root: doc(read('level1-listing/index.html')), baseUrl: BASE, fetch: pages() });
        const { items, next } = await a.page({});
        expect(items).toHaveLength(24);
        expect(items[0]).toEqual({
            id: 'print-001',
            link: 'http://shop.test/print/print-001',
            image: 'http://shop.test/images/01.png',
            image_focus: 'http://shop.test/images/01-large.png',
            aspect: 0.75,
            title: 'Fern frond',
            subtitle: 'Plate 1',
            badges: ['new'],
        });
        expect(decodeCursor(next!)).toEqual({ u: 'http://shop.test/page2.html' });
    });
    it('follows data-wall-next through all three pages and then stops', async () => {
        const f = pages();
        const a = new DomAdapter({ root: doc(read('level1-listing/index.html')), baseUrl: BASE, fetch: f });
        const all: string[] = [];
        let cursor: string | undefined;
        for (let guard = 0; guard < 10; guard++) {
            const page = await a.page({ cursor });
            all.push(...page.items.map((i) => i.id));
            cursor = page.next;
            if (!cursor) break;
        }
        expect(all).toHaveLength(72);
        expect(new Set(all).size).toBe(72);
        expect(f.calls.map((c) => c.url)).toEqual(['http://shop.test/page2.html', 'http://shop.test/page3.html']);
    });
    it('does not return an item twice when pages overlap', async () => {
        const a = new DomAdapter({ root: doc(read('level1-listing/index.html')), baseUrl: BASE, fetch: stubFetch({ 'http://shop.test/page2.html': read('level1-listing/index.html') }) });
        const p1 = await a.page({});
        const p2 = await a.page({ cursor: p1.next });
        expect(p2.items).toHaveLength(0);
    });
});

describe('DomAdapter fields', () => {
    const one = (inner: string, attrs = '') => doc(`<ul><li data-wall-item ${attrs}>${inner}</li></ul>`);
    const read1 = async (d: Document, opts = {}) => (await new DomAdapter({ root: d, baseUrl: BASE, ...opts }).page({})).items;

    it('falls back to the first <img> and the first <a href>, and the link as id', async () => {
        const [i] = await read1(one('<a href="/x"><img src="/x.png" width="200" height="100"></a>'));
        expect(i).toEqual({ id: 'http://shop.test/x', link: 'http://shop.test/x', image: 'http://shop.test/x.png', aspect: 2 });
    });
    it('prefers data-wall-aspect over the image size, and warns when it has neither', async () => {
        const warned: string[] = [];
        const [a] = await read1(one('<a href="/x"><img src="/x.png" width="200" height="100"></a>', 'data-wall-aspect="0.5"'));
        expect(a.aspect).toBe(0.5);
        const [b] = await read1(one('<a href="/x"><img src="/x.png"></a>'), { onWarning: (w: { code: string }) => warned.push(w.code) });
        expect(b.aspect).toBe(1.5);
        expect(warned).toEqual(['aspect-default']);
    });
    it('uses data-src, then the largest srcset candidate', async () => {
        const [a] = await read1(one('<a href="/x"><img data-wall-image data-src="/lazy.png"></a>', 'data-wall-aspect="1"'));
        expect(a.image).toBe('http://shop.test/lazy.png');
        const [b] = await read1(one('<a href="/x"><img srcset="/s.png 100w, /l.png 900w"></a>', 'data-wall-aspect="1"'));
        expect(b.image).toBe('http://shop.test/l.png');
    });
    it('skips items without an image or without a link, and reports them', async () => {
        const warned: string[] = [];
        const d = doc('<ul><li data-wall-item><a href="/a">no image</a></li><li data-wall-item><img src="/b.png"></li></ul>');
        expect(await read1(d, { onWarning: (w: { code: string }) => warned.push(w.code) })).toEqual([]);
        expect(warned).toEqual(['no-image', 'no-link']);
    });
    it('makes a text card of an annotated item with a title and no image', async () => {
        const [a] = await read1(one('<a href="/act/1">open</a><h3 data-wall-title>Закон за нещо</h3><p data-wall-subtitle>Парламент</p><p data-wall-excerpt>  Първо\n   второ  </p>', 'data-wall-id="1" data-wall-badges="Закон" data-wall-date="2026-10-10" data-wall-accent="#7a1f2b"'));
        expect(a).toEqual({ id: '1', link: 'http://shop.test/act/1', title: 'Закон за нещо', subtitle: 'Парламент', excerpt: 'Първо второ', date: '2026-10-10', accent: '#7a1f2b', badges: ['Закон'] });
    });
    it('reads data-wall-link from a nested element and video from the item', async () => {
        const [i] = await read1(one('<img src="/x.png"><a data-wall-link href="/real">x</a>', 'data-wall-id="7" data-wall-video="/v.mp4" data-wall-aspect="1"'));
        expect(i).toMatchObject({ id: '7', link: 'http://shop.test/real', video: 'http://shop.test/v.mp4' });
    });
    it('finds the next link with <link rel=next> when there is no data-wall-next', async () => {
        const d = doc('<html><head><link rel="next" href="/p2"></head><body><ul><li data-wall-item data-wall-aspect="1"><a href="/a"><img src="/a.png"></a></li></ul></body></html>');
        const { next } = await new DomAdapter({ root: d, baseUrl: BASE }).page({});
        expect(decodeCursor(next!)).toEqual({ u: 'http://shop.test/p2' });
    });
    it('runs annotated actions with the declared method and URL', async () => {
        const calls: { url: string; method?: string }[] = [];
        const fetchFn = async (url: string, init?: RequestInit) => { calls.push({ url, method: init?.method }); return new Response('', { status: 200 }); };
        const d = one('<a href="/a"><img src="/a.png"></a><button data-wall-action="like" data-wall-action-url="/api/like/9" data-wall-action-method="post">♥</button>', 'data-wall-id="9" data-wall-aspect="1"');
        const a = new DomAdapter({ root: d, baseUrl: BASE, fetch: fetchFn });
        const { items } = await a.page({});
        expect(a.capabilities().actions).toEqual(['like']);
        expect(await a.action('like', items[0])).toEqual({ ok: true });
        expect(calls).toEqual([{ url: 'http://shop.test/api/like/9', method: 'POST' }]);
        expect(await a.action('save', items[0])).toMatchObject({ ok: false });
    });
});

describe('DomAdapter modes', () => {
    it('reads JSON-LD ItemList, Product and ImageObject when nothing is annotated', async () => {
        const ld = JSON.stringify([
            { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@type': 'Product', name: 'Lamp', sku: 'L1', url: '/lamp', image: ['/lamp.png'] } }] },
            { '@type': 'ImageObject', contentUrl: '/photo.jpg', url: '/photo', width: 400, height: 200, name: 'Photo' },
        ]);
        const d = doc(`<html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`);
        const { items } = await new DomAdapter({ root: d, baseUrl: BASE }).page({});
        expect(items).toEqual([
            { id: 'L1', link: 'http://shop.test/lamp', image: 'http://shop.test/lamp.png', aspect: 1.5, title: 'Lamp' },
            { id: 'http://shop.test/photo', link: 'http://shop.test/photo', image: 'http://shop.test/photo.jpg', aspect: 2, title: 'Photo' },
        ]);
    });
    it('finds a cluster of at least six similar siblings with an image and a link', async () => {
        const cards = Array.from({ length: 8 }, (_, i) => `<div class="c"><a href="/p/${i}"><img src="/i/${i}.png" alt="Card ${i}" width="100" height="100"></a></div>`).join('');
        const d = doc(`<body><div class="nav"><a href="/"><img src="/logo.png"></a></div><section>${cards}</section></body>`);
        const { items } = await new DomAdapter({ root: d, baseUrl: BASE }).page({});
        expect(items).toHaveLength(8);
        expect(items[3]).toMatchObject({ link: 'http://shop.test/p/3', image: 'http://shop.test/i/3.png', title: 'Card 3', aspect: 1 });
    });
    it('does not treat five similar siblings as a list', async () => {
        const cards = Array.from({ length: 5 }, (_, i) => `<div class="c"><a href="/p/${i}"><img src="/i/${i}.png"></a></div>`).join('');
        expect((await new DomAdapter({ root: doc(`<body><section>${cards}</section></body>`), baseUrl: BASE }).page({})).items).toEqual([]);
    });
    it('keeps annotations first in auto mode and obeys a forced mode', async () => {
        const d = doc(read('level1-listing/index.html'));
        expect((await new DomAdapter({ root: d, baseUrl: BASE, mode: 'jsonld' }).page({})).items).toEqual([]);
        expect((await new DomAdapter({ root: d, baseUrl: BASE, mode: 'heuristic' }).page({})).items.length).toBeGreaterThanOrEqual(6);
    });
});

describe('DomAdapter infinite scroll', () => {
    it('waits for new items after scrolling the last one into view and ends when none arrive', async () => {
        const { document: d, window } = parseHTML('<html><body><ul data-wall-list><li data-wall-item data-wall-id="1" data-wall-aspect="1"><a href="/1"><img src="/1.png"></a></li></ul></body></html>');
        let observer: (() => void) | null = null;
        (window as any).MutationObserver = class { constructor(cb: () => void) { observer = cb; } observe() {} disconnect() { observer = null; } };
        (window as any).scrollTo = () => {};
        const list = d.querySelector('ul')!;
        let scrolled = 0;
        const last = d.querySelector('li') as any;
        last.scrollIntoView = () => {
            scrolled++;
            // the site loads one more item as soon as the last one is in view
            setTimeout(() => {
                list.insertAdjacentHTML('beforeend', '<li data-wall-item data-wall-id="2" data-wall-aspect="1"><a href="/2"><img src="/2.png"></a></li>');
                observer?.();
            }, 10);
        };
        const a = new DomAdapter({ root: d as unknown as Document, baseUrl: BASE, scrollWaitMs: 100 });
        const p1 = await a.page({});
        expect(p1.items).toHaveLength(1);
        expect(decodeCursor(p1.next!)).toEqual({ p: 1 });
        const p2 = await a.page({ cursor: p1.next });
        expect(scrolled).toBe(1);
        expect(p2.items.map((i) => i.id)).toEqual(['2']);
        const p3 = await a.page({ cursor: p2.next });
        expect(p3.items).toEqual([]);
        expect(p3.next).toBeUndefined();
    });
});
