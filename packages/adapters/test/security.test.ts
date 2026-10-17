import { describe, expect, it } from 'vitest';
import { WellKnownAdapter } from '../src/WellKnownAdapter';
import { JsonFeedAdapter } from '../src/JsonFeedAdapter';
import { DomAdapter } from '../src/DomAdapter';
import { RssAdapter } from '../src/RssAdapter';
import { RecipeAdapter, type Recipe } from '../src/RecipeAdapter';
import { isSameOrigin, isWebUrl, normalizeItem, normalizeList } from '../src/common';
import { doc, read, stubFetch } from './helpers';

const item = { id: '9', link: 'l', image: 'i', aspect: 1 };
const core = { id: 'a', link: '/a', image: '/a.png', aspect: 1 };

describe('isWebUrl and isSameOrigin', () => {
    it.each([
        ['https://x.test/a', true], ['http://x.test/a', true], ['/a/b', true], ['a.png', true], ['//cdn.test/a.png', true],
        ['javascript:alert(1)', false], ['JaVaScRiPt:alert(1)', false], ['java\nscript:alert(1)', false], [' javascript:alert(1)', false],
        ['data:text/html,<script>1</script>', false], ['data:image/png;base64,AAAA', false], ['file:///etc/passwd', false],
        ['blob:https://x.test/uuid', false], ['vbscript:x', false], ['ftp://x.test/a', false],
    ])('isWebUrl(%j) is %s', (u, want) => expect(isWebUrl(u)).toBe(want));
    it('compares origins and treats a missing base as relative-only', () => {
        expect(isSameOrigin('/a', 'https://x.test/p')).toBe(true);
        expect(isSameOrigin('https://x.test:443/a', 'https://x.test/p')).toBe(true);
        expect(isSameOrigin('https://evil.test/a', 'https://x.test/p')).toBe(false);
        expect(isSameOrigin('http://x.test/a', 'https://x.test/p')).toBe(false);
        expect(isSameOrigin('/a', undefined)).toBe(true);
        expect(isSameOrigin('https://x.test/a', undefined)).toBe(false);
    });
});

describe('item URLs at the adapter boundary', () => {
    it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'java\tscript:alert(1)'])('drops an item whose link is %j', (link) => {
        const warned: string[] = [];
        expect(normalizeItem({ ...core, link }, 'https://x.test/', (w) => warned.push(w.code))).toBeNull();
        expect(warned).toEqual(['unsafe-url']);
    });
    it('drops an item whose image is not http(s), including a data: image', () => {
        expect(normalizeItem({ ...core, image: 'data:image/png;base64,AAAA' }, 'https://x.test/')).toBeNull();
    });
    it('removes an unsafe optional media URL and keeps the item', () => {
        const i = normalizeItem({ ...core, image_focus: 'javascript:1', image_full: 'data:x', video: 'file:///v.mp4' }, 'https://x.test/')!;
        expect(i).not.toHaveProperty('image_focus');
        expect(i).not.toHaveProperty('image_full');
        expect(i).not.toHaveProperty('video');
        expect(i.link).toBe('https://x.test/a');
    });
    it('keeps http, https and relative URLs', () => {
        const i = normalizeItem({ ...core, link: 'http://other.test/x', video: '/v.mp4' }, 'https://x.test/')!;
        expect(i.link).toBe('http://other.test/x');
        expect(i.video).toBe('https://x.test/v.mp4');
    });
    it('JsonFeedAdapter drops the javascript: link and reports it', async () => {
        const feed = JSON.stringify({ items: [core, { ...core, id: 'b', link: 'javascript:alert(1)' }] });
        const codes: string[] = [];
        const a = new JsonFeedAdapter({ url: 'https://x.test/f', fetch: stubFetch({ 'https://x.test/f': feed }), onWarning: (w) => codes.push(w.code) });
        expect((await a.page({})).items.map((i) => i.id)).toEqual(['a']);
        expect(codes).toContain('unsafe-url');
    });
    it('RssAdapter drops an entry whose link is javascript: and one whose image is data:', async () => {
        const xml = `<rss version="2.0"><channel>
          <item><guid>a</guid><link>https://n.test/a</link><enclosure url="https://n.test/a.jpg" type="image/jpeg"/></item>
          <item><guid>b</guid><link>javascript:alert(1)</link><enclosure url="https://n.test/b.jpg" type="image/jpeg"/></item>
          <item><guid>c</guid><link>https://n.test/c</link><enclosure url="data:image/png;base64,AAAA" type="image/png"/></item>
        </channel></rss>`;
        const a = new RssAdapter({ url: 'https://n.test/f.xml', fetch: stubFetch({ 'https://n.test/f.xml': xml }) });
        expect((await a.page({})).items.map((i) => i.id)).toEqual(['a']);
    });
    it('RecipeAdapter (api) drops a javascript: link', async () => {
        const recipe: Recipe = { id: 'r', version: 1, match: ['https://p.test/*'], api: { url: 'https://p.test/api?p={page}', items: '$.d[*]', fields: { id: '$.id', link: '$.u', image: '$.i', aspect: '$.a' } } };
        const body = JSON.stringify({ d: [{ id: 1, u: '/ok', i: '/i.png', a: 1 }, { id: 2, u: 'javascript:alert(1)', i: '/i.png', a: 1 }] });
        const a = new RecipeAdapter({ recipe, url: 'https://p.test/', fetch: stubFetch({ 'https://p.test/api?p=1': body }) });
        expect((await a.page({})).items.map((i) => i.id)).toEqual(['1']);
    });
    it('DomAdapter drops a javascript: data-wall-link and a data: image in annotated, JSON-LD and cluster modes', async () => {
        const annotated = doc('<ul><li data-wall-item data-wall-aspect="1" data-wall-link="javascript:alert(1)"><img src="/a.png"></li><li data-wall-item data-wall-aspect="1"><a href="/ok"><img src="data:image/png;base64,AAAA"></a></li><li data-wall-item data-wall-aspect="1"><a href="/fine"><img src="/f.png"></a></li></ul>');
        const codes: string[] = [];
        const { items } = await new DomAdapter({ root: annotated, baseUrl: 'https://x.test/', onWarning: (w) => codes.push(w.code) }).page({});
        expect(items.map((i) => i.link)).toEqual(['https://x.test/fine']);
        expect(codes.filter((c) => c === 'unsafe-url')).toHaveLength(2);

        const ld = doc(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'x', url: 'javascript:alert(1)', image: '/x.png' })}</script>`);
        expect((await new DomAdapter({ root: ld, baseUrl: 'https://x.test/' }).page({})).items).toEqual([]);

        const cards = Array.from({ length: 7 }, (_, i) => `<div class="c"><a href="${i === 3 ? 'javascript:alert(1)' : '/p/' + i}"><img src="/i/${i}.png" width="1" height="1"></a></div>`).join('');
        const { items: cl } = await new DomAdapter({ root: doc(`<body><section>${cards}</section></body>`), baseUrl: 'https://x.test/' }).page({});
        expect(cl).toHaveLength(6);
        expect(cl.every((i) => i.link.startsWith('https://x.test/p/'))).toBe(true);
    });
    it('normalizeList also gates the list', () => {
        expect(normalizeList([core, { ...core, id: 'b', link: 'javascript:1' }], 'https://x.test/')).toHaveLength(1);
    });
});

describe('WellKnownAdapter actions', () => {
    const manifest = (actions: object, extra: object = {}) => JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }], actions, ...extra });
    const open = async (actions: object, seen: { url: string; init?: RequestInit }[] = []) => {
        const f = async (url: string, init?: RequestInit) => {
            seen.push({ url, init });
            return url.endsWith('wall.json') ? new Response(manifest(actions)) : new Response('{}');
        };
        return new WellKnownAdapter({ origin: 'https://shop.test', fetch: f }).ready();
    };

    it('rejects a session action that points at another origin and sends nothing', async () => {
        const seen: { url: string; init?: RequestInit }[] = [];
        const a = await open({ like: { method: 'POST', url: 'https://evil.test/steal', auth: 'session' } }, seen);
        const n = seen.length;
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
        expect(seen).toHaveLength(n);
    });
    it('rejects a session action on another port, another scheme, and via a protocol-relative URL', async () => {
        const a = await open({
            port: { method: 'POST', url: 'https://shop.test:8443/x', auth: 'session' },
            scheme: { method: 'POST', url: 'http://shop.test/x', auth: 'session' },
            rel: { method: 'POST', url: '//evil.test/x', auth: 'session' },
        });
        for (const id of ['port', 'scheme', 'rel']) expect(await a.action(id, item), id).toMatchObject({ ok: false, reason: 'error' });
    });
    it('allows a session action on the manifest origin, relative or absolute', async () => {
        const seen: { url: string; init?: RequestInit }[] = [];
        const a = await open({ one: { method: 'POST', url: '/api/{id}/one', auth: 'session' }, two: { method: 'POST', url: 'https://shop.test/api/two', auth: 'session' } }, seen);
        expect(await a.action('one', item)).toMatchObject({ ok: true });
        expect(await a.action('two', item)).toMatchObject({ ok: true });
        expect(seen.at(-2)!.init).toMatchObject({ credentials: 'include' });
    });
    it('sends a cross-origin auth none action without credentials', async () => {
        const seen: { url: string; init?: RequestInit }[] = [];
        const a = await open({ ping: { method: 'POST', url: 'https://metrics.test/hit', auth: 'none' } }, seen);
        expect(await a.action('ping', item)).toMatchObject({ ok: true });
        expect(seen.at(-1)!.init).toMatchObject({ credentials: 'omit' });
    });
    it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x'])('rejects a deeplink to %s', async (url) => {
        const a = await open({ cart: { mode: 'deeplink', url } });
        expect(await a.action('cart', item)).toMatchObject({ ok: false, reason: 'error' });
    });
    it('returns an http(s) deeplink, absolute or relative', async () => {
        const a = await open({ cart: { mode: 'deeplink', url: '/cart/add/{id}' }, ext: { mode: 'deeplink', url: 'https://pay.test/c' } });
        expect(await a.action('cart', item)).toEqual({ ok: true, state: { deeplink: 'https://shop.test/cart/add/9' } });
        expect(await a.action('ext', item)).toEqual({ ok: true, state: { deeplink: 'https://pay.test/c' } });
    });
    it('refuses non-http(s) manifest and feed URLs and drops a javascript: brand.logo', async () => {
        await expect(new WellKnownAdapter({ origin: 'https://shop.test', manifestUrl: 'data:application/json,{}', fetch: stubFetch({}) }).ready()).rejects.toMatchObject({ code: 'unsafe-url' });
        const f = stubFetch({ 'https://shop.test/.well-known/wall.json': manifest({}, { brand: { logo: 'javascript:alert(1)' }, feeds: [{ id: 'f', url: 'data:application/json,{"items":[]}' }] }) });
        const a = new WellKnownAdapter({ origin: 'https://shop.test', fetch: f });
        await a.ready();
        expect(a.brand.logo).toBeUndefined();
        await expect(a.page({})).rejects.toMatchObject({ code: 'unsafe-url' });
    });
});

describe('RecipeAdapter actions', () => {
    const recipe = (url: string, auth: 'none' | 'session' = 'session'): Recipe => ({
        id: 'r', version: 1, match: ['https://p.test/*', 'https://api.p.test/*'],
        api: { url: 'https://p.test/api', items: '$.d[*]', fields: { id: '$.id', link: '$.u', image: '$.i' } },
        actions: { like: { method: 'POST', url, auth } },
    });
    it('rejects a URL outside the match patterns (already enforced) before any request', async () => {
        const f = stubFetch({});
        const a = new RecipeAdapter({ recipe: recipe('https://evil.test/like'), url: 'https://p.test/', fetch: f });
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
        expect(f.calls).toHaveLength(0);
    });
    it('rejects a session action on a matched origin that is not the page origin', async () => {
        const f = stubFetch({ 'https://api.p.test/like': '' });
        const a = new RecipeAdapter({ recipe: recipe('https://api.p.test/like'), url: 'https://p.test/', fetch: f });
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
        expect(f.calls).toHaveLength(0);
    });
    it('sends that same call without credentials when auth is none, and allows the page origin with a session', async () => {
        const f = stubFetch({ 'https://api.p.test/like': '', 'https://p.test/like': '' });
        const none = new RecipeAdapter({ recipe: recipe('https://api.p.test/like', 'none'), url: 'https://p.test/', fetch: f });
        expect(await none.action('like', item)).toEqual({ ok: true });
        expect(f.calls[0].init).toMatchObject({ credentials: 'omit' });
        const same = new RecipeAdapter({ recipe: recipe('https://p.test/like'), url: 'https://p.test/', fetch: f });
        expect(await same.action('like', item)).toEqual({ ok: true });
        expect(f.calls[1].init).toMatchObject({ credentials: 'include' });
    });
    it('rejects a javascript: action URL (outside every match pattern)', async () => {
        const a = new RecipeAdapter({ recipe: recipe('javascript:alert(1)'), url: 'https://p.test/', fetch: stubFetch({}) });
        expect(await a.action('like', item)).toMatchObject({ ok: false });
    });
});

describe('DomAdapter annotated actions and next pages', () => {
    const page = (actions: string) => doc(`<ul><li data-wall-item data-wall-id="9" data-wall-aspect="1"><a href="/a"><img src="/a.png"></a>${actions}</li></ul>`);
    const open = async (actions: string, fetchFn = stubFetch({})) => {
        const a = new DomAdapter({ root: page(actions), baseUrl: 'https://x.test/', fetch: fetchFn });
        const { items } = await a.page({});
        return { a, item: items[0], fetchFn };
    };
    it.each(['https://evil.test/like', '//evil.test/like', 'javascript:alert(1)', 'data:text/html,x', 'http://x.test/like'])('ignores data-wall-action-url %s', async (url) => {
        const { a, item, fetchFn } = await open(`<button data-wall-action="like" data-wall-action-url="${url}">x</button>`);
        expect(a.capabilities().actions).toEqual([]);
        expect(await a.action('like', item)).toMatchObject({ ok: false });
        expect(fetchFn.calls).toHaveLength(0);
    });
    it('keeps a same-origin action, relative or absolute, and rejects an odd method', async () => {
        const { a, item, fetchFn } = await open('<button data-wall-action="like" data-wall-action-url="/api/like">x</button><button data-wall-action="save" data-wall-action-url="https://x.test/api/save">y</button><button data-wall-action="bad" data-wall-action-url="/api/bad" data-wall-action-method="TRACE">z</button>', stubFetch({ 'https://x.test/api/like': '', 'https://x.test/api/save': '' }));
        expect(a.capabilities().actions).toEqual(['like', 'save']);
        expect(await a.action('like', item)).toEqual({ ok: true });
        expect(await a.action('save', item)).toEqual({ ok: true });
        expect(fetchFn.calls).toHaveLength(2);
    });
    it('refuses to follow a next link to another origin or scheme', async () => {
        const d = doc(read('level1-listing/index.html').replace('page2.html', 'https://evil.test/page2.html'));
        const f = stubFetch({ 'https://evil.test/page2.html': read('level1-listing/page2.html') });
        const a = new DomAdapter({ root: d, baseUrl: 'https://x.test/', fetch: f });
        const p1 = await a.page({});
        await expect(a.page({ cursor: p1.next })).rejects.toMatchObject({ code: 'origin' });
        expect(f.calls).toHaveLength(0);
    });
});
