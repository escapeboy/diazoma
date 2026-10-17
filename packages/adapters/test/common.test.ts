import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, normalizeItem, normalizeList, getText, AdapterError } from '../src/common';

describe('cursors', () => {
    it('round-trips JSON, including non-ASCII, as base64url', () => {
        const c = encodeCursor({ u: 'http://x.test/page?q=шапка&n=1', p: 2 });
        expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeCursor(c)).toEqual({ u: 'http://x.test/page?q=шапка&n=1', p: 2 });
    });
    it('rejects garbage with a typed error', () => {
        expect(() => decodeCursor('***')).toThrow(AdapterError);
    });
});

describe('normalizeItem', () => {
    const ok = { id: 'a', link: '/l', image: 'i.png', aspect: 1.5 };
    it('resolves URL fields against the base and keeps unknown fields', () => {
        const item = normalizeItem({ ...ok, image_focus: '/f.png', extra: 1 }, 'http://x.test/feed/')!;
        expect(item.link).toBe('http://x.test/l');
        expect(item.image).toBe('http://x.test/feed/i.png');
        expect(item.image_focus).toBe('http://x.test/f.png');
        expect((item as unknown as { extra: number }).extra).toBe(1);
    });
    it('turns a numeric id into a string', () => {
        expect(normalizeItem({ ...ok, id: 7 })!.id).toBe('7');
    });
    it.each(['id', 'link', 'image', 'aspect'])('drops an item without %s', (k) => {
        const bad: Record<string, unknown> = { ...ok };
        delete bad[k];
        expect(normalizeItem(bad)).toBeNull();
    });
    it('drops a non-positive or non-numeric aspect', () => {
        expect(normalizeItem({ ...ok, aspect: 0 })).toBeNull();
        expect(normalizeItem({ ...ok, aspect: '1.5' })).toBeNull();
    });
});

describe('normalizeItem (text cards)', () => {
    const card = { id: 't', link: '/act/1', title: 'Act 1' };
    it('accepts an item with a title and no image or aspect', () => {
        expect(normalizeItem(card, 'http://x.test/')).toEqual({ id: 't', link: 'http://x.test/act/1', title: 'Act 1' });
    });
    it.each([
        ['no title', { id: 't', link: '/a' }],
        ['a blank title', { id: 't', link: '/a', title: '  ' }],
        ['only an excerpt', { id: 't', link: '/a', excerpt: 'x' }],
        ['an image without aspect', { id: 't', link: '/a', title: 'T', image: '/i.png' }],
        ['an image that is not a string', { id: 't', link: '/a', title: 'T', image: 5 }],
        ['an unsafe image URL', { id: 't', link: '/a', title: 'T', image: 'javascript:alert(1)', aspect: 1 }],
    ])('drops an item with %s', (_n, raw) => {
        expect(normalizeItem(raw)).toBeNull();
    });
    it('keeps a valid aspect on a text card and drops an invalid one', () => {
        expect(normalizeItem({ ...card, aspect: 0.5 })!.aspect).toBe(0.5);
        expect(normalizeItem({ ...card, aspect: -1 })).not.toHaveProperty('aspect');
    });
    it('trims the excerpt, cuts it to 500 characters and drops a non-string one', () => {
        expect(normalizeItem({ ...card, excerpt: '  hello  ' })!.excerpt).toBe('hello');
        const long = normalizeItem({ ...card, excerpt: 'a'.repeat(800) })!.excerpt!;
        expect(long).toHaveLength(500);
        expect(long.endsWith('…')).toBe(true);
        expect(normalizeItem({ ...card, excerpt: 5 })).not.toHaveProperty('excerpt');
        expect(normalizeItem({ ...card, excerpt: '   ' })).not.toHaveProperty('excerpt');
    });
    it('keeps a valid date and accent and drops malformed ones', () => {
        expect(normalizeItem({ ...card, date: '2026-10-10', accent: '#a1b2c3' })).toMatchObject({ date: '2026-10-10', accent: '#a1b2c3' });
        expect(normalizeItem({ ...card, date: '2026-10-10T10:00:00+03:00', accent: '#abc' })).toMatchObject({ date: '2026-10-10T10:00:00+03:00', accent: '#abc' });
        const bad = normalizeItem({ ...card, date: 'yesterday', accent: 'red' })!;
        expect(bad).not.toHaveProperty('date');
        expect(bad).not.toHaveProperty('accent');
    });
});

describe('normalizeList', () => {
    it('reports invalid items and duplicates and caps at 100', () => {
        const warnings: string[] = [];
        const many = Array.from({ length: 130 }, (_, i) => ({ id: `i${i}`, link: '/l', image: '/i', aspect: 1 }));
        const items = normalizeList([null, many[0], many[0], ...many], undefined, (w) => warnings.push(w.code));
        expect(items).toHaveLength(100);
        expect(warnings).toEqual(['invalid-item', 'dropped-duplicate', 'dropped-duplicate', 'too-many-items']);
    });
});

describe('getText errors', () => {
    const answer = (status: number, headers: Record<string, string>) => async () => new Response('', { status, headers });
    it('carries the status and Retry-After (seconds or date) of a 429 or 503', async () => {
        await expect(getText(answer(429, { 'Retry-After': '7' }), 'http://x.test/')).rejects.toMatchObject({ status: 429, retryAfter: 7 });
        const e = await getText(answer(503, { 'Retry-After': new Date(Date.now() + 30000).toUTCString() }), 'http://x.test/').catch((x) => x);
        expect(e.retryAfter).toBeGreaterThan(25);
        expect(e.retryAfter).toBeLessThanOrEqual(30);
    });
    it('has no retryAfter on other errors or an unreadable header', async () => {
        await expect(getText(answer(500, { 'Retry-After': '7' }), 'http://x.test/')).rejects.toMatchObject({ status: 500, retryAfter: undefined });
        await expect(getText(answer(429, { 'Retry-After': 'soon' }), 'http://x.test/')).rejects.toMatchObject({ retryAfter: undefined });
    });
});
