import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { WellKnownAdapter } from '../src/WellKnownAdapter';
import { decodeCursor } from '../src/common';
import { FIXTURES, stubFetch } from './helpers';
// @ts-expect-error plain JS helper of the fixtures
import { serveFixture } from '../fixtures/lib/serve.mjs';

let site: Awaited<ReturnType<typeof serveFixture>>;
beforeAll(async () => {
    site = await serveFixture(path.join(FIXTURES, 'level2-feed'));
});
afterAll(() => site.close());

describe('WellKnownAdapter on the level2 fixture', () => {
    it('loads the manifest and exposes brand, policy and capabilities', async () => {
        const a = await new WellKnownAdapter({ origin: site.origin }).ready();
        expect(a.policy).toBe('allow');
        expect(a.brand).toMatchObject({ name: 'Botanical prints', accent: '#9b2335' });
        expect(a.brand.logo).toBe(`${site.origin}/images/01.png`);
        expect(a.capabilities()).toEqual({
            search: true,
            filters: [{ key: 'kind', values: [{ value: 'all', label: 'all' }, { value: 'leaf', label: 'leaf' }, { value: 'flower', label: 'flower' }] }],
            actions: ['like', 'cart'],
            projections: ['flat'],
            links: ['cart'],
        });
    });
    it('pages the first feed with opaque cursors that carry the feed id', async () => {
        const a = new WellKnownAdapter({ origin: site.origin });
        const p1 = await a.page({});
        expect(p1.items).toHaveLength(24);
        expect(p1.next).toBeTruthy();
        expect(p1.next).not.toBe('p2');
        expect(decodeCursor(p1.next!)).toMatchObject({ f: 'latest', c: 'p2' });
        const p2 = await a.page({ cursor: p1.next });
        expect(p2.items[0].id).toBe('print-025');
        const p3 = await a.page({ cursor: p2.next });
        expect(p3.next).toBeUndefined();
    });
    it('picks another feed by scope and the search feed by query, and keeps the query in the cursor', async () => {
        const a = new WellKnownAdapter({ origin: site.origin });
        const popular = await a.page({ scope: { kind: 'home', feed: 'popular' } });
        expect(popular.items).toHaveLength(12);
        expect(popular.next).toBeUndefined();
        const hit = await a.page({ query: 'fern' });
        expect(hit.items).toHaveLength(6);
    });
    it('rejects a cursor that is not its own', async () => {
        await expect(new WellKnownAdapter({ origin: site.origin }).page({ cursor: 'p2' })).rejects.toMatchObject({ code: 'cursor' });
    });
    it('finds the manifest through <link rel="wall-manifest"> when the well-known path is missing', async () => {
        const manifest = JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }] });
        const f = stubFetch({
            'http://x.test/': '<html><head><link rel="wall-manifest" href="/custom/wall.json"></head></html>',
            'http://x.test/custom/wall.json': manifest,
            'http://x.test/f.json': JSON.stringify({ items: [{ id: '1', link: '/1', image: '/1.png', aspect: 1 }] }),
        });
        const a = new WellKnownAdapter({ origin: 'http://x.test/', fetch: f });
        const page = await a.page({});
        expect(page.items[0].link).toBe('http://x.test/1');
        expect(f.calls.map((c) => c.url)).toContain('http://x.test/custom/wall.json');
    });
    it('fails with no-manifest when there is neither', async () => {
        const f = stubFetch({ 'http://x.test/': '<html></html>' });
        await expect(new WellKnownAdapter({ origin: 'http://x.test/', fetch: f }).ready()).rejects.toMatchObject({ code: 'no-manifest' });
    });
});

describe('policy and actions', () => {
    const manifest = (extra: object) => JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }], ...extra });
    const feed = JSON.stringify({ items: [{ id: 'a b', link: '/1', image: '/1.png', aspect: 1 }] });

    it('rejects page() with a typed error when policy is deny, but still reads the manifest', async () => {
        const f = stubFetch({ 'http://x.test/.well-known/wall.json': manifest({ policy: 'deny' }), 'http://x.test/f.json': feed });
        const a = new WellKnownAdapter({ origin: 'http://x.test', fetch: f });
        await expect(a.page({})).rejects.toMatchObject({ code: 'policy-denied' });
        expect(a.policy).toBe('deny');
        expect(f.calls.map((c) => c.url)).not.toContain('http://x.test/f.json');
    });
    it('keeps recipes-only readable (it restricts recipes, not the site feed)', async () => {
        const f = stubFetch({ 'http://x.test/.well-known/wall.json': manifest({ policy: 'recipes-only' }), 'http://x.test/f.json': feed });
        expect((await new WellKnownAdapter({ origin: 'http://x.test', fetch: f }).page({})).items).toHaveLength(1);
    });
    it('rejects an unsupported manifest version', async () => {
        const f = stubFetch({ 'http://x.test/.well-known/wall.json': JSON.stringify({ version: 2, feeds: [{ id: 'f', url: '/f' }] }) });
        await expect(new WellKnownAdapter({ origin: 'http://x.test', fetch: f }).ready()).rejects.toMatchObject({ code: 'unsupported' });
    });
    it('runs a session action with credentials, filling {id} URL-encoded, and flips a toggle', async () => {
        const f = stubFetch({
            'http://x.test/.well-known/wall.json': manifest({ actions: { like: { method: 'POST', url: '/api/{id}/like', auth: 'session', toggle: true } } }),
            'http://x.test/api/a%20b/like': '{}',
        });
        const a = await new WellKnownAdapter({ origin: 'http://x.test', fetch: f }).ready();
        const item = { id: 'a b', link: 'l', image: 'i', aspect: 1, state: { liked: false } };
        const r = await a.action('like', item);
        expect(r).toEqual({ ok: true, state: { liked: true } });
        const call = f.calls.at(-1)!;
        expect(call.init).toMatchObject({ method: 'POST', credentials: 'include' });
    });
    it('maps 401 to reason auth, bearer to auth, a deeplink to its URL, an unknown action to error', async () => {
        const f = stubFetch({});
        const fn = async (url: string) => (url.endsWith('/needs-login') ? new Response('', { status: 401 }) : f(url));
        const m = manifest({ actions: {
            save: { method: 'POST', url: '/needs-login', auth: 'session' },
            token: { method: 'POST', url: '/t', auth: 'bearer' },
            cart: { mode: 'deeplink', url: '/cart/add/{id}' },
        } });
        const table = stubFetch({ 'http://x.test/.well-known/wall.json': m });
        const a = await new WellKnownAdapter({ origin: 'http://x.test', fetch: (u, i) => (u.endsWith('wall.json') ? table(u, i) : fn(u)) }).ready();
        const item = { id: '9', link: 'l', image: 'i', aspect: 1 };
        expect(await a.action('save', item)).toMatchObject({ ok: false, reason: 'auth' });
        expect(await a.action('token', item)).toMatchObject({ ok: false, reason: 'auth' });
        expect(await a.action('cart', item)).toEqual({ ok: true, state: { deeplink: 'http://x.test/cart/add/9' } });
        expect(await a.action('nope', item)).toMatchObject({ ok: false, reason: 'error' });
    });
    it('resolves media variants with fallbacks', async () => {
        const a = new WellKnownAdapter({ origin: 'http://x.test' });
        const item = { id: '1', link: 'l', image: 'thumb', image_focus: 'focus', aspect: 1 };
        expect(await a.resolveMedia(item, 'thumb')).toBe('thumb');
        expect(await a.resolveMedia(item, 'full')).toBe('focus');
        expect(await a.resolveMedia(item, 'video')).toBeUndefined();
    });
});
