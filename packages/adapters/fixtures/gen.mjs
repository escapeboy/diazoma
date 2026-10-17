#!/usr/bin/env node
/**
 * Writes the generated parts of the fixture sites: images (gradients, no third-party content),
 * the annotated pages of level1-listing, and the feed and manifest of level2-feed and broken.
 * Run: node packages/adapters/fixtures/gen.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { png } from './lib/png.mjs';
import { IMAGES, NAMES, pad, print, prints } from './lib/items.mjs';
import { renderListing, stage, loader } from './lib/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = (rel, text) => {
    const file = path.join(HERE, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
};

// ---- images: soft green and ochre gradients, one per print, two sizes ----
function image(i, width) {
    const p = print(i);
    const h = Math.round(width / p.aspect);
    const hue = 70 + ((i * 37) % 110); // greens to ochres
    const hsl = (hh, s, l) => {
        const k = (n) => (n + hh / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
        return [f(0), f(8), f(4)];
    };
    return png(width, h, (x, y) => {
        const t = y / h;
        const edge = x < 4 || y < 4 || x >= width - 4 || y >= h - 4 ? 0.8 : 1;
        const [r, g, b] = hsl(hue + t * 40, 0.45, 0.35 + 0.3 * (1 - t));
        return [Math.round(r * edge), Math.round(g * edge), Math.round(b * edge)];
    });
}
const imageDirs = ['level1-listing/images', 'level2-feed/images'];
for (const dir of imageDirs) {
    for (let i = 0; i < IMAGES; i++) {
        out(`${dir}/${pad(i)}.png`, image(i, 192));
        out(`${dir}/${pad(i)}-large.png`, image(i, 480));
    }
}
for (let i = 0; i < 2; i++) out(`broken/images/${pad(i)}.png`, image(i, 192));

// ---- level 1: three annotated pages, 24 prints each ----
const l1Image = (p, kind) => `/images/${pad(p.image)}${kind === 'large' ? '-large' : ''}.png`;
const l1Link = (p) => `/print/${p.id}`;
const l1Pages = [['index.html', 0, 'page2.html'], ['page2.html', 24, 'page3.html'], ['page3.html', 48, null]];
for (const [file, from, next] of l1Pages) {
    out(`level1-listing/${file}`, renderListing({ title: 'Botanical prints', items: prints(from, 24), image: l1Image, link: l1Link, next }));
}
out('level1-listing/xr.html', renderListing({
    title: 'Botanical prints',
    items: prints(0, 24),
    image: l1Image,
    link: l1Link,
    next: 'page2.html',
    extraBody: `${stage}<script src="/adapters.iife.js"></script>
<script>
  window.diazoma = { options: { adapter: new DiazomaAdapters.DomAdapter(), brand: { name: 'Botanical prints', accent: '#9b2335' } } };
</script>
${loader()}
`,
}));
out('level1-listing/site.json', JSON.stringify({
    name: 'level1-listing', path: '/xr.html', hook: '__diazoma', eventsPath: '/api/events', feedPath: '/listing',
    feed: { cursorParam: 'cursor', nextKey: 'next', itemsKey: 'items' },
    selectors: { introRoot: '#diazoma-intro', introCard: '#diazoma-intro-card', enter: '#diazoma-enter', browse: '#diazoma-browse', stage: '#diazoma' },
}, null, 2) + '\n');

// ---- level 2: feed pages, popular, search, manifest ----
const feedItem = (p) => ({
    id: p.id,
    link: `/print/${p.id}`,
    title: p.title,
    subtitle: p.subtitle,
    image: `{{CDN_ORIGIN}}/images/${pad(p.image)}.png`,
    image_focus: `{{CDN_ORIGIN}}/images/${pad(p.image)}-large.png`,
    aspect: p.aspect,
    ...(p.badges.length ? { badges: p.badges } : {}),
    media_type: 'photo',
    width: 192,
    height: Math.round(192 / p.aspect),
    tags: ['botanical', p.n % 2 ? 'leaf' : 'flower'],
    likes: p.n % 13,
});
const feedPage = (from, count, next) => JSON.stringify({ items: prints(from, count).map(feedItem), ...(next ? { next } : {}) }, null, 2) + '\n';
out('level2-feed/wall/feed.json', feedPage(0, 24, 'p2'));
out('level2-feed/wall/feed.p2.json', feedPage(24, 24, 'p3'));
out('level2-feed/wall/feed.p3.json', feedPage(48, 24));
out('level2-feed/wall/popular.json', JSON.stringify({ items: prints(0, 12).reverse().map(feedItem) }, null, 2) + '\n');
out('level2-feed/wall/search.json', feedPage(0, 6));
out('level2-feed/.well-known/wall.json', JSON.stringify({
    version: 1,
    policy: 'allow',
    name: 'Botanical prints',
    brand: { accent: '#9b2335', logo: '/images/01.png' },
    feeds: [
        { id: 'latest', title: 'Latest', url: '/wall/feed.json', cursor: true },
        { id: 'popular', title: 'Popular', url: '/wall/popular.json' },
        { id: 'search', type: 'search', url: '/wall/search.json?q={query}' },
    ],
    filters: [{ id: 'kind', title: 'Kind', values: ['all', 'leaf', 'flower'], param: 'kind' }],
    media: { hosts: ['{{CDN_HOST}}'], variants: { thumb: 192, focus: 480 }, projections: ['flat'] },
    actions: {
        like: { method: 'POST', url: '/api/items/{id}/like', auth: 'session', toggle: true },
        cart: { mode: 'deeplink', url: '/cart/add/{id}' },
    },
}, null, 2) + '\n');
const l2Page = (body = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Botanical prints</title>
<link rel="wall-manifest" href="/.well-known/wall.json">
</head>
<body>
<h1>Botanical prints</h1>
<p>A shop of printed plates. The wall reads <a href="/.well-known/wall.json">its manifest</a>.</p>
${body}</body>
</html>
`;
out('level2-feed/index.html', l2Page());
out('level2-feed/xr.html', l2Page(`${stage}<script src="/adapters.iife.js"></script>
<script>
  (async () => {
    const adapter = await new DiazomaAdapters.WellKnownAdapter({ origin: location.origin }).ready();
    window.diazoma = { options: { adapter, brand: adapter.brand } };
    const s = document.createElement('script');
    s.src = '/bundle/loader.js';
    s.setAttribute('data-core', '/bundle/wall.iife.js');
    s.setAttribute('data-mount', '#diazoma');
    s.setAttribute('data-title', 'Step inside the prints');
    s.setAttribute('data-body', 'Botanical prints, all around you in VR.');
    document.body.appendChild(s);
  })();
</script>
`));
out('level2-feed/site.json', JSON.stringify({
    name: 'level2-feed', path: '/xr.html', hook: '__diazoma', eventsPath: '/api/events', feedPath: '/wall/feed',
    feed: { cursorParam: 'cursor', nextKey: 'next', itemsKey: 'items' },
    selectors: { introRoot: '#diazoma-intro', introCard: '#diazoma-intro-card', enter: '#diazoma-enter', browse: '#diazoma-browse', stage: '#diazoma' },
}, null, 2) + '\n');

// ---- broken: a manifest that fails three checks ----
out('broken/fixture.json', JSON.stringify({ cdnCors: false }, null, 2) + '\n');
out('broken/index.html', l2Page().replace('Botanical prints</h1>', 'Botanical prints (broken on purpose)</h1>'));
out('broken/.well-known/wall.json', JSON.stringify({
    version: 1,
    name: 'Broken prints',
    brand: { accent: '#f2c94c' }, // pale yellow: about 1.6:1 against white
    feeds: [{ id: 'latest', url: '/wall/feed.json' }],
    media: { hosts: ['{{CDN_HOST}}'] }, // this image host sends no Access-Control-Allow-Origin
}, null, 2) + '\n');
const good = prints(0, 2).map(feedItem);
const { image: _dropped, ...noImage } = feedItem(print(2));
out('broken/wall/feed.json', JSON.stringify({ items: [good[0], noImage, good[1]] }, null, 2) + '\n');
console.log(`fixtures written (${NAMES.length} prints)`);
