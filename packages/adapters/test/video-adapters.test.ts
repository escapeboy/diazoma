import { describe, expect, it } from 'vitest';
import { RssAdapter } from '../src/RssAdapter';
import { DomAdapter } from '../src/DomAdapter';
import { JsonFeedAdapter } from '../src/JsonFeedAdapter';
import { RecipeAdapter, type Recipe } from '../src/RecipeAdapter';
import { doc, stubFetch } from './helpers';

type Rec = Record<string, unknown>;
const ID = 'dQw4w9WgXcQ';

const rss = (entries: string) => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>t</title>${entries}</channel></rss>`;
const rssItems = async (entries: string) => {
    const a = new RssAdapter({ url: 'https://notes.example/feed.xml', fetch: stubFetch({ 'https://notes.example/feed.xml': rss(entries) }) });
    return (await a.page({})).items as unknown as Rec[];
};

describe('RssAdapter video', () => {
    it('reads a video enclosure with a media:thumbnail and itunes:duration', async () => {
        const [i] = await rssItems(`<item><guid>1</guid><link>/p/1</link><title>A</title>
            <enclosure url="/v/1.mp4" type="video/mp4" length="1"/><media:thumbnail url="/t/1.jpg" width="640" height="360"/><itunes:duration>1:02:03</itunes:duration></item>`);
        expect(i).toMatchObject({ video: 'https://notes.example/v/1.mp4', media_type: 'video', video_type: 'file', image: 'https://notes.example/t/1.jpg', duration: 3723 });
        expect(i.video_sources).toBeUndefined();
    });
    it('reads media:content type video/* and medium=video, with duration in seconds', async () => {
        const [a, b] = await rssItems(`
            <item><guid>1</guid><link>/p/1</link><media:content url="/v/1.webm" type="video/webm" duration="95"/><media:thumbnail url="/t/1.jpg"/></item>
            <item><guid>2</guid><link>/p/2</link><media:content url="/v/2.m3u8" medium="video"/><media:thumbnail url="/t/2.jpg"/><itunes:duration>45</itunes:duration></item>`);
        expect(a).toMatchObject({ video: 'https://notes.example/v/1.webm', duration: 95 });
        expect(b).toMatchObject({ video: 'https://notes.example/v/2.m3u8', video_type: 'hls', duration: 45 });
    });
    it('turns several media:content in a media:group into video_sources with height and bitrate', async () => {
        const [i] = await rssItems(`<item><guid>1</guid><link>/p/1</link><media:group>
            <media:content url="/v/480.mp4" type="video/mp4" height="480" bitrate="800"/>
            <media:content url="/v/1080.mp4" type="video/mp4" height="1080"/>
            <media:thumbnail url="/t.jpg"/></media:group></item>`);
        expect(i.video).toBe('https://notes.example/v/480.mp4');
        expect(i.video_sources).toEqual([
            { src: 'https://notes.example/v/480.mp4', height: 480, bitrate: 800000 },
            { src: 'https://notes.example/v/1080.mp4', height: 1080 },
        ]);
    });
    it('dedupes an enclosure repeated as media:content', async () => {
        const [i] = await rssItems(`<item><guid>1</guid><link>/p/1</link><enclosure url="/v/1.mp4" type="video/mp4"/><media:content url="/v/1.mp4" type="video/mp4" height="720"/><media:thumbnail url="/t.jpg"/></item>`);
        expect(i.video).toBe('https://notes.example/v/1.mp4');
        expect(i.video_sources).toBeUndefined();
    });
    it('recognises HLS and DASH mime types, case-insensitively', async () => {
        const [a, b, c] = await rssItems(`
            <item><guid>1</guid><link>/p/1</link><enclosure url="/v/stream" type="application/vnd.apple.mpegurl"/><media:thumbnail url="/t.jpg"/></item>
            <item><guid>2</guid><link>/p/2</link><media:content url="/v/live" type="Application/x-mpegURL"/><media:thumbnail url="/t.jpg"/></item>
            <item><guid>3</guid><link>/p/3</link><media:content url="/v/manifest" type="application/dash+xml"/><media:thumbnail url="/t.jpg"/></item>`);
        expect([a.video_type, b.video_type, c.video_type]).toEqual(['hls', 'hls', 'dash']);
        expect(a.media_type).toBe('video');
    });
    it('ignores an image media:content as video and a bad duration', async () => {
        const [i] = await rssItems(`<item><guid>1</guid><link>/p/1</link><media:content url="/i.jpg" type="image/jpeg"/><itunes:duration>soon</itunes:duration></item>`);
        expect(i.video).toBeUndefined();
        expect(i.media_type).toBeUndefined();
        expect(i.duration).toBeUndefined();
    });
    it('turns an entry whose link is a YouTube watch page into an embed card with the YouTube poster', async () => {
        const [i] = await rssItems(`<item><guid>y</guid><link>https://www.youtube.com/watch?v=${ID}</link><title>Clip</title></item>`);
        expect(i).toMatchObject({ media_type: 'video', unplayable: { provider: 'YouTube' }, image: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg` });
    });
});

const page = (inner: string, head = '') => `<html><head>${head}</head><body>${inner}</body></html>`;
const domItems = async (html: string) => (await new DomAdapter({ root: doc(html), baseUrl: 'http://shop.test/' }).page({})).items as unknown as Rec[];
const card = (attrs: string, inner = '') => `<div data-wall-item ${attrs}><a href="/p/1">x</a><img src="/i.png" width="300" height="200">${inner}</div>`;

describe('DomAdapter video', () => {
    it('reads data-wall-video-sources, -duration and -video-type', async () => {
        const sources = JSON.stringify([{ src: '/v/720.mp4', height: 720 }, { src: '/v/1080.mp4', height: 1080 }]).replace(/"/g, '&quot;');
        const [i] = await domItems(page(card(`data-wall-video="/v/main.m3u8" data-wall-video-type="hls" data-wall-duration="12.5" data-wall-video-sources="${sources}"`)));
        expect(i).toMatchObject({
            video: 'http://shop.test/v/main.m3u8', video_type: 'hls', duration: 12.5, media_type: 'video',
            video_sources: [{ src: 'http://shop.test/v/720.mp4', height: 720 }, { src: 'http://shop.test/v/1080.mp4', height: 1080 }],
        });
    });
    it('ignores malformed sources JSON, a non-array and a bad duration, and keeps the item', async () => {
        const [a, b] = await domItems(page(card('data-wall-video-sources="{nope" data-wall-duration="abc"') + card('data-wall-video-sources="{}" data-wall-duration="-4"').replace('/p/1', '/p/2')));
        for (const i of [a, b]) {
            expect(i.video_sources).toBeUndefined();
            expect(i.duration).toBeUndefined();
        }
    });
    it('sets video from the first sources entry when data-wall-video is absent', async () => {
        const [i] = await domItems(page(card('data-wall-video-sources="[{&quot;src&quot;:&quot;/v/a.mp4&quot;}]"')));
        expect(i.video).toBe('http://shop.test/v/a.mp4');
    });
    it('falls back to <video src>, then <video><source>, and an attribute wins', async () => {
        const [a] = await domItems(page(card('', '<video src="/v/inline.mp4"></video>')));
        expect(a.video).toBe('http://shop.test/v/inline.mp4');
        const [b] = await domItems(page(card('', '<video><source src="/v/s.webm" type="video/webm"></video>')));
        expect(b.video).toBe('http://shop.test/v/s.webm');
        const [c] = await domItems(page(card('data-wall-video="/v/attr.mp4"', '<video src="/v/inline.mp4"></video>')));
        expect(c.video).toBe('http://shop.test/v/attr.mp4');
    });
    it('falls back to og:video:secure_url, then og:video, when the page holds one item', async () => {
        const [a] = await domItems(page(card(''), '<meta property="og:video" content="/v/og.mp4"><meta property="og:video:secure_url" content="https://shop.test/v/secure.mp4">'));
        expect(a.video).toBe('https://shop.test/v/secure.mp4');
        const [b] = await domItems(page(card(''), '<meta property="og:video" content="/v/og.mp4">'));
        expect(b.video).toBe('http://shop.test/v/og.mp4');
    });
    it('does not use og:video for a page with several items', async () => {
        const items = await domItems(page(card('') + card('').replace('/p/1', '/p/2'), '<meta property="og:video" content="/v/og.mp4">'));
        expect(items).toHaveLength(2);
        expect(items.every((i) => i.video === undefined)).toBe(true);
    });
    it('drops a javascript: video and a non-web source', async () => {
        const [i] = await domItems(page(card('data-wall-video="javascript:alert(1)" data-wall-video-sources="[{&quot;src&quot;:&quot;data:video/mp4;base64,AA&quot;}]"')));
        expect(i.video).toBeUndefined();
        expect(i.video_sources).toBeUndefined();
        expect(i.media_type).toBeUndefined();
    });
});

describe('JsonFeedAdapter video', () => {
    it('passes the video fields through the normaliser', async () => {
        const body = JSON.stringify({ items: [{ id: '1', link: '/1', image: '/1.jpg', aspect: 1.5, video_sources: [{ src: '/a.mpd', height: 720 }], duration: 30 }, { id: '2', link: '/2', video: `https://youtu.be/${ID}`, title: 'T' }] });
        const a = new JsonFeedAdapter({ url: 'https://s.example/feed.json', fetch: stubFetch({ 'https://s.example/feed.json': body }) });
        const [one, two] = (await a.page({})).items as unknown as Rec[];
        expect(one).toMatchObject({ video: 'https://s.example/a.mpd', video_type: 'dash', media_type: 'video', duration: 30 });
        expect(two).toMatchObject({ media_type: 'video', unplayable: { provider: 'YouTube' }, image: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg` });
        expect(two.video).toBeUndefined();
    });
});

describe('RecipeAdapter video', () => {
    it('maps video fields of an api source', async () => {
        const recipe: Recipe = {
            id: 'v.example', version: 1, match: ['https://v.example/*'],
            api: { source: 'api', url: 'https://v.example/api', items: '$.rows[*]', fields: { id: '$.id', link: '$.url', image: '$.thumb', aspect: '$.ratio', video: '$.mp4', video_sources: '$.renditions', duration: '$.secs', projection: '$.proj' } },
        } as Recipe;
        const body = JSON.stringify({ rows: [{ id: 1, url: '/w/1', thumb: '/t.jpg', ratio: 1.78, mp4: '/v.mp4', renditions: [{ src: '/v480.mp4', height: 480 }], secs: 90, proj: 'equirect360' }] });
        const a = new RecipeAdapter({ recipe, url: 'https://v.example/', fetch: stubFetch({ 'https://v.example/api': body }) });
        const [i] = (await a.page({})).items as unknown as Rec[];
        expect(i).toMatchObject({ video: 'https://v.example/v.mp4', media_type: 'video', projection: 'equirect360', duration: 90, video_sources: [{ src: 'https://v.example/v480.mp4', height: 480 }] });
    });
    it('maps video fields of a dom source and coerces the duration to a number', async () => {
        const recipe: Recipe = {
            id: 'v.example', version: 1, match: ['https://v.example/*'],
            list: { source: 'dom', item: 'li', fields: { id: { sel: 'a', attr: 'href' }, link: { sel: 'a', attr: 'href' }, image: { sel: 'img', attr: 'src' }, aspect: { const: 1.5 }, video: { sel: 'video', attr: 'src' }, duration: { sel: '.len', attr: 'data-s' }, video_type: { const: 'hls' } } },
        } as Recipe;
        const html = '<ul><li><a href="/w/1">x</a><img src="/t.jpg"><video src="/v.m3u8"></video><span class="len" data-s="75"></span></li></ul>';
        const [i] = (await new RecipeAdapter({ recipe, document: doc(html), url: 'https://v.example/' }).page({})).items as unknown as Rec[];
        expect(i).toMatchObject({ video: 'https://v.example/v.m3u8', video_type: 'hls', media_type: 'video', duration: 75 });
    });
});
