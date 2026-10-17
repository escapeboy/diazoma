import { describe, expect, it } from 'vitest';
import { RssAdapter } from '../src/RssAdapter';
import { decodeCursor } from '../src/common';
import { read, stubFetch } from './helpers';

describe('RssAdapter (RSS 2.0)', () => {
    const warnings: string[] = [];
    const f = stubFetch({
        'https://notes.example/feed.xml': read('rss/feed.xml'),
        'https://notes.example/feed.xml?page=2': read('rss/atom.xml'),
    });
    const a = new RssAdapter({ url: 'https://notes.example/feed.xml', fetch: f, onWarning: (w) => warnings.push(`${w.code}`) });

    it('takes the image from enclosure, media:content, media:thumbnail or the description, in that order', async () => {
        const { items } = await a.page({});
        expect(items.map((i) => [i.id, i.image])).toEqual([
            ['a', 'https://notes.example/a.jpg'],
            ['b', 'https://notes.example/b.jpg'],
            ['c', 'https://notes.example/c.jpg'],
            ['d', 'https://notes.example/d.jpg'],
            ['e', undefined],
            ['f', 'https://notes.example/f.jpg'],
        ]);
    });
    it('reads the aspect from media or img sizes and flags the 1.5 default', async () => {
        const flagged: string[] = [];
        const fresh = new RssAdapter({ url: 'https://notes.example/feed.xml', fetch: f, onWarning: (w) => w.code === 'aspect-default' && flagged.push(w.message) });
        const { items } = await fresh.page({});
        const aspect = Object.fromEntries(items.map((i) => [i.id, i.aspect]));
        expect(aspect).toMatchObject({ a: 1.5, b: 2, c: 0.75, d: 2, f: 1.5 });
        expect(flagged).toHaveLength(2); // a (enclosure has no size) and f
    });
    it('keeps an entry with a title and no image as a text card', async () => {
        const { items } = await new RssAdapter({ url: 'https://notes.example/feed.xml', fetch: f }).page({});
        expect(items.find((i) => i.id === 'e')).toEqual({ id: 'e', link: 'https://notes.example/e', title: 'A video enclosure and no image' });
    });
    it('skips an entry with neither image nor title, with a warning', async () => {
        const w: string[] = [];
        const { items } = await new RssAdapter({ url: 'https://notes.example/feed.xml', fetch: f, onWarning: (x) => w.push(x.code) }).page({});
        expect(items.find((i) => i.id === 'g')).toBeUndefined();
        expect(w).toContain('no-image');
    });
    it('carries title, author and link', async () => {
        const [first] = (await a.page({})).items;
        expect(first).toMatchObject({ title: 'Enclosure image', subtitle: 'Ana', link: 'https://notes.example/a' });
    });
    it('follows atom:link rel=next through an opaque cursor', async () => {
        const p1 = await a.page({});
        expect(p1.next).toBeTruthy();
        expect(decodeCursor(p1.next!)).toEqual({ u: 'https://notes.example/feed.xml?page=2' });
        const p2 = await a.page({ cursor: p1.next });
        expect(p2.items.map((i) => i.id)).toEqual(['urn:uuid:1', 'urn:uuid:2']);
        expect(p2.next).toBeUndefined();
    });
});

describe('RssAdapter (Atom)', () => {
    it('reads entries, alternate links, authors, thumbnails and html content', async () => {
        const f = stubFetch({ 'https://notes.example/atom.xml': read('rss/atom.xml') });
        const { items, next } = await new RssAdapter({ url: 'https://notes.example/atom.xml', fetch: f }).page({});
        expect(next).toBeUndefined();
        expect(items).toEqual([
            { id: 'urn:uuid:1', link: 'https://notes.example/1', image: 'https://notes.example/1.jpg', aspect: 0.5, title: 'First', subtitle: 'Ana' },
            { id: 'urn:uuid:2', link: 'https://notes.example/2', image: 'https://notes.example/2.jpg', aspect: 1.5, title: 'Second' },
        ]);
    });
    it('rejects something that is not a feed', async () => {
        const f = stubFetch({ 'https://x.test/f': '<html><body>hi</body></html>' });
        await expect(new RssAdapter({ url: 'https://x.test/f', fetch: f }).page({})).rejects.toMatchObject({ code: 'parse' });
    });
});

describe('RssAdapter sizes', () => {
    const f = stubFetch({ 'https://notes.example/feed.xml': read('rss/feed.xml') });

    it('takes the thumbnail, focus and full sizes the site serves, and keeps the feed URL for the rest', async () => {
        const seen: string[] = [];
        const a = new RssAdapter({
            url: 'https://notes.example/feed.xml',
            fetch: f,
            sizes: (url) => {
                seen.push(url);
                return url.endsWith('b.jpg') ? { image: url + '?w=512' } : { image: url + '?w=512', image_focus: url + '?w=1024', image_full: url };
            },
        });
        const { items } = await a.page({});
        expect(seen[0]).toBe('https://notes.example/a.jpg'); // absolute, after resolving against the feed
        expect(items[0]).toMatchObject({ image: 'https://notes.example/a.jpg?w=512', image_focus: 'https://notes.example/a.jpg?w=1024', image_full: 'https://notes.example/a.jpg' });
        expect(items[1].image).toBe('https://notes.example/b.jpg?w=512');
        expect(items[1]).not.toHaveProperty('image_focus');
    });

    it('drops a returned size that is not an http(s) URL', async () => {
        const a = new RssAdapter({ url: 'https://notes.example/feed.xml', fetch: f, sizes: (url) => ({ image_focus: 'javascript:alert(1)', image_full: url }) });
        const { items } = await a.page({});
        expect(items[0]).not.toHaveProperty('image_focus');
        expect(items[0].image_full).toBe('https://notes.example/a.jpg');
    });
});


describe('RssAdapter (text cards)', () => {
    const f = stubFetch({ 'https://council.example/feed.xml': read('rss/text-feed.xml') });
    const a = new RssAdapter({ url: 'https://council.example/feed.xml', fetch: f });

    it('makes a text card of an imageless entry: excerpt from the description, date, author as subtitle', async () => {
        const { items } = await a.page({});
        expect(items[0]).toEqual({
            id: '41',
            link: 'https://council.example/resheniya/41',
            title: 'Решение № 41 за бюджета на общината',
            subtitle: 'Общински съвет',
            excerpt: 'Общинският съвет приема бюджета за 2027 г. Приложение: таблици.',
            date: '2026-10-09T10:30:00.000Z',
        });
    });
    it('leaves out a date that does not parse and an excerpt that is not there', async () => {
        const { items } = await a.page({});
        expect(items[1]).toEqual({ id: '42', link: 'https://council.example/resheniya/42', title: 'Решение № 42' });
    });
    it('still gives an entry with an image an image card, without text card fields', async () => {
        const { items } = await a.page({});
        expect(items[2]).toMatchObject({ id: '43', image: 'https://council.example/43.jpg', aspect: 1.5 });
        expect(items[2]).not.toHaveProperty('excerpt');
    });
});
