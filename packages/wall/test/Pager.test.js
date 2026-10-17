import { describe, expect, it, vi } from 'vitest';
import { Pager } from '../src/feed/Pager.js';

const page = (ids, next) => ({ items: ids.map((id) => ({ id })), next });
const adapterOf = (page) => ({ page });

describe('Pager', () => {
    it('follows the cursor, dedupes, and stops at the end', async () => {
        const pageFn = vi.fn()
            .mockResolvedValueOnce(page(['a', 'b'], 'c1'))
            .mockResolvedValueOnce(page(['b', 'c'], undefined));
        const feed = new Pager(adapterOf(pageFn), { filter: { type: 'photo' } });

        expect((await feed.next()).map((i) => i.id)).toEqual(['a', 'b']);
        expect((await feed.next()).map((i) => i.id)).toEqual(['c']);
        expect(feed.done).toBe(true);
        expect(await feed.next()).toEqual([]);
        expect(pageFn).toHaveBeenCalledTimes(2);

        expect(pageFn.mock.calls[0][0].cursor).toBeUndefined();
        expect(pageFn.mock.calls[1][0].cursor).toBe('c1');
        expect(pageFn.mock.calls[1][0].filter).toEqual({ type: 'photo' });
        expect(feed.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('passes the cursor back verbatim, whatever it looks like', async () => {
        const odd = 'eyJhZnRlciI6WzEuNSwiw6kiXX0=/+?&=';
        const pageFn = vi.fn()
            .mockResolvedValueOnce(page(['a'], odd))
            .mockResolvedValueOnce(page(['b'], undefined));
        const feed = new Pager(adapterOf(pageFn));
        await feed.next();
        await feed.next();
        expect(pageFn.mock.calls[1][0].cursor).toBe(odd);
    });

    it('switches request on reset and starts again without a cursor', async () => {
        const pageFn = vi.fn().mockResolvedValue(page(['a'], 'n'));
        const feed = new Pager(adapterOf(pageFn));
        feed.reset({ scope: { kind: 'user', id: 'u1' } });
        await feed.next();
        await feed.next();
        feed.reset({ scope: { kind: 'board', id: 'b1' } });
        await feed.next();
        const calls = pageFn.mock.calls.map((c) => c[0]);
        expect(calls[0].scope).toEqual({ kind: 'user', id: 'u1' });
        expect(calls[1].cursor).toBe('n');
        expect(calls[2].scope).toEqual({ kind: 'board', id: 'b1' });
        expect(calls[2].cursor).toBeUndefined();
    });

    it('shares one request while a page is loading', async () => {
        const pageFn = vi.fn().mockResolvedValue(page(['a'], 'n'));
        const feed = new Pager(adapterOf(pageFn));
        const [x, y] = await Promise.all([feed.next(), feed.next()]);
        expect(x).toBe(y);
        expect(pageFn).toHaveBeenCalledOnce();
    });

    it('drops a stale response after reset (filter change mid-flight)', async () => {
        let resolve;
        const pageFn = vi.fn()
            .mockReturnValueOnce(new Promise((r) => { resolve = r; }))
            .mockResolvedValueOnce(page(['fresh'], undefined));
        const feed = new Pager(adapterOf(pageFn));
        const stale = feed.next();
        feed.reset({ filter: { type: 'video' } });
        const fresh = await feed.next();
        resolve(page(['stale'], 'x'));
        expect(await stale).toEqual([]);
        expect(fresh.map((i) => i.id)).toEqual(['fresh']);
        expect(feed.items.map((i) => i.id)).toEqual(['fresh']);
    });

    it('rejects when the adapter fails so the caller can show a message', async () => {
        const feed = new Pager(adapterOf(vi.fn().mockRejectedValue(new Error('feed 503'))));
        await expect(feed.next()).rejects.toThrow('feed 503');
        expect(feed.loading).toBeNull();
    });

    describe('runaway feeds', () => {
        it('stops when the cursor repeats', async () => {
            const pageFn = vi.fn().mockResolvedValue(page([], '0'));
            const feed = new Pager(adapterOf(pageFn));
            await feed.next();
            expect(feed.done).toBe(false);
            await feed.next();
            expect(feed.done).toBe(true);
            expect(feed.stopped).toBe('cursor_repeat');
            expect(pageFn).toHaveBeenCalledTimes(2);
        });

        it('stops after 3 pages in a row that add no cards', async () => {
            let n = 0;
            const pageFn = vi.fn(() => Promise.resolve(page([], 'c' + ++n)));
            const feed = new Pager(adapterOf(pageFn));
            await feed.next();
            await feed.next();
            expect(feed.done).toBe(false);
            await feed.next();
            expect(feed.done).toBe(true);
            expect(feed.stopped).toBe('no_new_cards');
            expect(pageFn).toHaveBeenCalledTimes(3);
        });

        it('counts duplicate-only pages as empty and resets the run on a page with cards', async () => {
            const pages = [page(['a'], 'c1'), page(['a'], 'c2'), page(['a'], 'c3'), page(['b'], 'c4'), page(['b'], 'c5'), page(['b'], 'c6'), page(['b'], 'c7')];
            const pageFn = vi.fn(() => Promise.resolve(pages.shift()));
            const feed = new Pager(adapterOf(pageFn));
            for (let i = 0; i < 7 && !feed.done; i++) await feed.next();
            expect(feed.items.map((x) => x.id)).toEqual(['a', 'b']);
            expect(feed.stopped).toBe('no_new_cards');
            expect(pageFn).toHaveBeenCalledTimes(7);
        });

        it('backs off after an empty page but not after a page with cards', async () => {
            const pageFn = vi.fn()
                .mockResolvedValueOnce(page(['a'], 'c1'))
                .mockResolvedValueOnce(page([], 'c2'));
            const feed = new Pager(adapterOf(pageFn));
            await feed.next();
            expect(feed.canFetch()).toBe(true);
            await feed.next();
            expect(feed.canFetch()).toBe(false);
            expect(feed.canFetch(Date.now() + 10000)).toBe(true);
        });

        it('a long normal feed never trips the guards', async () => {
            let n = 0;
            const pageFn = vi.fn(() => Promise.resolve(page(['x' + n, 'y' + n], ++n < 50 ? 'c' + n : undefined)));
            const feed = new Pager(adapterOf(pageFn));
            while (!feed.done) await feed.next();
            expect(feed.items).toHaveLength(100);
            expect(feed.stopped).toBe(null);
        });
    });

    describe('failed pages', () => {
        it('backs off exponentially after a failed page and rethrows', async () => {
            const pageFn = vi.fn().mockRejectedValue(new Error('HTTP 500'));
            const feed = new Pager(adapterOf(pageFn));
            await expect(feed.next()).rejects.toThrow('HTTP 500');
            const t = Date.now();
            expect(feed.canFetch(t)).toBe(false);
            expect(feed.canFetch(t + 1300)).toBe(true);
            await expect(feed.next()).rejects.toThrow();
            expect(feed.canFetch(Date.now() + 1900)).toBe(false);
            expect(feed.canFetch(Date.now() + 2600)).toBe(true);
            expect(feed.done).toBe(false);
        });

        it('honours Retry-After and caps the back-off', async () => {
            const err = Object.assign(new Error('HTTP 429'), { retryAfter: 20 });
            const feed = new Pager(adapterOf(vi.fn().mockRejectedValue(err)));
            await expect(feed.next()).rejects.toThrow();
            expect(feed.canFetch(Date.now() + 19000)).toBe(false);
            expect(feed.canFetch(Date.now() + 21000)).toBe(true);
        });

        it('resets the failure count on a good page and stops after 6 failures in a row', async () => {
            const pageFn = vi.fn()
                .mockRejectedValueOnce(new Error('x'))
                .mockResolvedValueOnce(page(['a'], 'c1'))
                .mockRejectedValue(new Error('x'));
            const feed = new Pager(adapterOf(pageFn));
            await expect(feed.next()).rejects.toThrow();
            await feed.next();
            expect(feed.failures).toBe(0);
            for (let i = 0; i < 6; i++) await expect(feed.next()).rejects.toThrow();
            expect(feed.done).toBe(true);
            expect(feed.stopped).toBe('errors');
            expect(pageFn).toHaveBeenCalledTimes(8);
        });
    });
});
