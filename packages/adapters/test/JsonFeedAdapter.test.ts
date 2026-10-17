import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JsonFeedAdapter } from '../src/JsonFeedAdapter';
import { AdapterError } from '../src/common';
import { stubFetch } from './helpers';
// @ts-expect-error plain JS helper of the fixtures
import { serveFixture } from '../fixtures/lib/serve.mjs';
import { FIXTURES } from './helpers';
import path from 'node:path';

let level2: Awaited<ReturnType<typeof serveFixture>>;
let broken: Awaited<ReturnType<typeof serveFixture>>;
beforeAll(async () => {
    level2 = await serveFixture(path.join(FIXTURES, 'level2-feed'));
    broken = await serveFixture(path.join(FIXTURES, 'broken'));
});
afterAll(async () => {
    await level2.close();
    await broken.close();
});

describe('JsonFeedAdapter on the level2 fixture', () => {
    it('pages through the feed with the server cursor passed back verbatim', async () => {
        const a = new JsonFeedAdapter({ url: `${level2.origin}/wall/feed.json` });
        const p1 = await a.page({});
        expect(p1.items).toHaveLength(24);
        expect(p1.next).toBe('p2');
        const p2 = await a.page({ cursor: p1.next });
        expect(p2.items[0].id).toBe('print-025');
        expect(p2.next).toBe('p3');
        const p3 = await a.page({ cursor: p2.next });
        expect(p3.items).toHaveLength(24);
        expect(p3.next).toBeUndefined();
    });
    it('resolves relative links against the feed URL and keeps optional fields', async () => {
        const [first] = (await new JsonFeedAdapter({ url: `${level2.origin}/wall/feed.json` }).page({})).items;
        expect(first.link).toBe(`${level2.origin}/print/print-001`);
        expect(first.image).toMatch(/\/images\/01\.png$/);
        expect(first.media_type).toBe('photo');
        expect(first.badges).toEqual(['new']);
    });
    it('drops the invalid item of the broken fixture and reports it', async () => {
        const warnings: string[] = [];
        const a = new JsonFeedAdapter({ url: `${broken.origin}/wall/feed.json`, onWarning: (w) => warnings.push(w.code) });
        const page = await a.page({});
        expect(page.items.map((i) => i.id)).toEqual(['print-001', 'print-002']);
        expect(warnings).toEqual(['invalid-item']);
    });
    it('rejects with a typed error on HTTP failure and on a body without items', async () => {
        await expect(new JsonFeedAdapter({ url: `${level2.origin}/nope.json` }).page({})).rejects.toMatchObject({ code: 'http', status: 404 });
        const f = stubFetch({ 'http://x.test/f': '{"nothing":1}' });
        await expect(new JsonFeedAdapter({ url: 'http://x.test/f', fetch: f }).page({})).rejects.toBeInstanceOf(AdapterError);
    });
});

describe('JsonFeedAdapter requests', () => {
    const body = JSON.stringify({ items: [] });
    it('URL-encodes {query} and appends filters as param=value, skipping "all"', async () => {
        const f = stubFetch({});
        const calls: string[] = [];
        const fn = async (u: string) => { calls.push(u); return new Response(body); };
        const a = new JsonFeedAdapter({
            url: 'http://x.test/feed', search: 'http://x.test/feed?q={query}', fetch: fn,
            filters: [{ key: 'type', param: 't', values: [{ value: 'all' }, { value: 'photo' }] }],
        });
        await a.page({ query: 'fern & moss/ü', filter: { type: 'photo' } });
        await a.page({ filter: { type: 'all' }, cursor: 'a b+c' });
        await a.page({ scope: { kind: 'search', q: 'x y' } });
        expect(calls[0]).toBe('http://x.test/feed?q=fern+%26+moss%2F%C3%BC&t=photo');
        expect(calls[1]).toBe('http://x.test/feed?cursor=a+b%2Bc');
        expect(calls[2]).toBe('http://x.test/feed?q=x%20y');
        expect(f.calls).toHaveLength(0);
    });
    it('reports capabilities from its options', () => {
        const a = new JsonFeedAdapter({ url: 'http://x.test/feed', search: 'http://x.test/s?q={query}', filters: [{ key: 'type', param: 't', values: [{ value: 'photo' }] }] });
        expect(a.capabilities()).toEqual({ search: true, filters: [{ key: 'type', values: [{ value: 'photo' }] }], actions: [] });
        expect(a.id).toBe('x.test');
    });
});
