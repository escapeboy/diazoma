import { describe, expect, it } from 'vitest';
import type { FeedAdapter, FeedRequest, Item } from '@diazoma/wall';
import { MixAdapter, type MixWarning } from '../src/MixAdapter';
import { AdapterError } from '../src/common';

const item = (id: string): Item => ({ id, link: `https://x.example/${id}`, image: `https://x.example/${id}.jpg`, aspect: 1, title: id });

/** A source with `pages` pages of `per` items each: ids `<name><page>-<n>`; records every request it gets. */
function source(name: string, pages: number, per: number, calls: FeedRequest[] = []): FeedAdapter {
    return {
        id: name,
        capabilities: () => ({ search: true, filters: [], actions: ['like'] }),
        async page(req) {
            calls.push(req);
            const p = req.cursor ? Number(req.cursor) : 1;
            return { items: Array.from({ length: per }, (_, n) => item(`${name}${p}-${n}`)), ...(p < pages ? { next: String(p + 1) } : {}) };
        },
    };
}
const broken = (name: string): FeedAdapter => ({ id: name, capabilities: () => ({ search: false, filters: [], actions: [] }), page: async () => { throw new AdapterError('http', 'down', 500); } });

describe('MixAdapter', () => {
    it('interleaves two sources a, b, a, b and keeps ids unique', async () => {
        const mix = new MixAdapter({ id: 'm', sources: [source('a', 1, 2), source('a', 1, 2)] });
        const { items } = await mix.page({});
        expect(items.map((i) => i.id)).toEqual(['0:a1-0', '1:a1-0', '0:a1-1', '1:a1-1']);
        expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    });

    it('resumes every source from the packed cursor', async () => {
        const ca: FeedRequest[] = [];
        const cb: FeedRequest[] = [];
        const mix = new MixAdapter({ id: 'm', sources: [source('a', 3, 1, ca), source('b', 2, 1, cb)] });
        const p1 = await mix.page({});
        expect(p1.items.map((i) => i.id)).toEqual(['0:a1-0', '1:b1-0']);
        const p2 = await mix.page({ cursor: p1.next });
        expect(p2.items.map((i) => i.id)).toEqual(['0:a2-0', '1:b2-0']);
        expect(ca.map((r) => r.cursor)).toEqual([undefined, '2']);
        expect(cb.map((r) => r.cursor)).toEqual([undefined, '2']);
    });

    it('asks only the sources that are not finished, and ends when all are', async () => {
        const cb: FeedRequest[] = [];
        const mix = new MixAdapter({ id: 'm', sources: [source('a', 1, 1), source('b', 3, 1, cb)] });
        const p1 = await mix.page({});
        const p2 = await mix.page({ cursor: p1.next });
        expect(p2.items.map((i) => i.id)).toEqual(['1:b2-0']);
        const p3 = await mix.page({ cursor: p2.next });
        expect(p3.items.map((i) => i.id)).toEqual(['1:b3-0']);
        expect(p3.next).toBeUndefined();
        expect(cb).toHaveLength(3);
    });

    it('keeps going when one source throws and says so', async () => {
        const warnings: MixWarning[] = [];
        const mix = new MixAdapter({ id: 'm', sources: [broken('bad'), source('b', 2, 1)], onWarning: (w) => warnings.push(w) });
        const p1 = await mix.page({});
        expect(p1.items.map((i) => i.id)).toEqual(['1:b1-0']);
        expect(warnings).toMatchObject([{ code: 'source-failed', source: 'bad' }]);
        const p2 = await mix.page({ cursor: p1.next });
        expect(p2.items.map((i) => i.id)).toEqual(['1:b2-0']);
        expect(warnings).toHaveLength(1); // the failed source is not asked again
    });

    it('throws when every source throws', async () => {
        const mix = new MixAdapter({ id: 'm', sources: [broken('x'), broken('y')] });
        await expect(mix.page({})).rejects.toMatchObject({ code: 'http' });
    });

    it('passes the query on, offers no actions and searches only when all sources do', () => {
        expect(new MixAdapter({ id: 'm', sources: [source('a', 1, 1), source('b', 1, 1)] }).capabilities()).toEqual({ search: true, filters: [], actions: [] });
        expect(new MixAdapter({ id: 'm', sources: [source('a', 1, 1), broken('b')] }).capabilities().search).toBe(false);
    });

    it('refuses a cursor from another mix', async () => {
        const two = await new MixAdapter({ id: 'm', sources: [source('a', 2, 1), source('b', 2, 1)] }).page({});
        await expect(new MixAdapter({ id: 'm', sources: [source('a', 2, 1)] }).page({ cursor: two.next })).rejects.toMatchObject({ code: 'cursor' });
    });
});
