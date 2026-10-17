import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { allowedEmbed, hostedVideo, normalizeItem, videoKindOf } from '../src/common';

const ok = { id: 'a', link: '/l', image: 'https://x.test/i.png', aspect: 1.5 };
const norm = (extra: Record<string, unknown>, base = 'https://x.test/feed') => normalizeItem({ ...ok, ...extra }, base) as unknown as Record<string, unknown> | null;
const ID = 'dQw4w9WgXcQ';
const YT_EMBED = `https://www.youtube-nocookie.com/embed/${ID}`;

describe('media_type, video_type, video_sources, duration', () => {
    it('infers media_type video from video, keeps an explicit one, and leaves items without video alone', () => {
        expect(norm({ video: '/a.mp4' })!.media_type).toBe('video');
        expect(norm({ video: '/a.mp4', media_type: 'gif' })!.media_type).toBe('gif');
        expect(norm({})!.media_type).toBeUndefined();
    });
    it('does not infer video from a video URL that was removed as unsafe', () => {
        const item = norm({ video: 'javascript:alert(1)' })!;
        expect(item.video).toBeUndefined();
        expect(item.media_type).toBeUndefined();
    });
    it.each([
        ['/a.m3u8', 'hls'], ['/a.M3U8?token=1', 'hls'], ['/a.mpd', 'dash'], ['/a.mp4', 'file'], ['/a.webm', 'file'], ['/stream', 'file'], ['/a.m3u8/x.mp4', 'file'],
    ])('infers video_type of %s as %s', (video, kind) => {
        expect(norm({ video })!.video_type).toBe(kind);
        expect(videoKindOf(`https://x.test${video}`)).toBe(kind);
    });
    it('keeps a valid video_type and replaces an invalid one; drops it without video', () => {
        expect(norm({ video: '/a', video_type: 'hls' })!.video_type).toBe('hls');
        expect(norm({ video: '/a.mpd', video_type: 'mp4' })!.video_type).toBe('dash');
        expect(norm({ video_type: 'hls' })!.video_type).toBeUndefined();
    });
    it('clamps video_sources to 8', () => {
        const video_sources = Array.from({ length: 12 }, (_, i) => ({ src: `/${i}.mp4` }));
        const item = norm({ video_sources })!;
        expect((item.video_sources as unknown[]).length).toBe(8);
        expect((item.video_sources as { src: string }[])[7].src).toBe('https://x.test/7.mp4');
    });
    it('drops sources with an unsafe or missing src and keeps the item', () => {
        const warnings: string[] = [];
        const item = normalizeItem({ ...ok, video_sources: [{ src: 'javascript:alert(1)' }, { src: 'data:video/mp4;base64,AA' }, { height: 720 }, 'x', null, { src: '/b.mp4', height: 720 }] }, 'https://x.test/', (w) => warnings.push(w.code)) as unknown as Record<string, unknown>;
        expect(item.video_sources).toEqual([{ src: 'https://x.test/b.mp4', height: 720 }]);
        expect(warnings).toEqual(['unsafe-url', 'unsafe-url']);
    });
    it('removes video_sources that is not an array or ends up empty', () => {
        expect('video_sources' in norm({ video_sources: 'a.mp4' })!).toBe(false);
        expect('video_sources' in norm({ video_sources: [{ src: 'ftp://x/a.mp4' }] })!).toBe(false);
    });
    it('drops bad height, bitrate, codecs and type inside a source', () => {
        const item = norm({ video_sources: [{ src: '/a.mp4', height: 0, bitrate: -5, codecs: 3, type: 'mp4' }, { src: '/b.mp4', height: 7.5, bitrate: '9' }, { src: '/c.m3u8', type: 'hls', height: 1080, bitrate: 5000000, codecs: 'avc1.640028' }] })!;
        expect(item.video_sources).toEqual([
            { src: 'https://x.test/a.mp4' },
            { src: 'https://x.test/b.mp4' },
            { src: 'https://x.test/c.m3u8', type: 'hls', height: 1080, bitrate: 5000000, codecs: 'avc1.640028' },
        ]);
    });
    it('sets video to the first source when video is absent, and leaves video when present', () => {
        const sources = [{ src: '/hi.m3u8' }, { src: '/lo.mp4' }];
        const a = norm({ video_sources: sources })!;
        expect(a.video).toBe('https://x.test/hi.m3u8');
        expect(a.video_type).toBe('hls');
        expect(a.media_type).toBe('video');
        expect(norm({ video: '/main.mp4', video_sources: sources })!.video).toBe('https://x.test/main.mp4');
    });
    it('keeps a duration of 0 or more and drops the rest', () => {
        expect(norm({ duration: 0 })!.duration).toBe(0);
        expect(norm({ duration: 61.5 })!.duration).toBe(61.5);
        for (const duration of [-1, Number.NaN, Infinity, '10', null, {}]) expect('duration' in norm({ duration })!, String(duration)).toBe(false);
    });
});

describe('YouTube and Vimeo', () => {
    it.each([
        `https://www.youtube.com/watch?v=${ID}`,
        `https://youtube.com/watch?v=${ID}&t=42s&list=PL1`,
        `https://m.youtube.com/watch?v=${ID}`,
        `https://youtu.be/${ID}`,
        `https://youtu.be/${ID}?si=abc`,
        `https://www.youtube.com/shorts/${ID}`,
        `https://youtube.com/shorts/${ID}/`,
        `https://www.youtube.com/embed/${ID}`,
        `https://www.youtube-nocookie.com/embed/${ID}`,
        `http://youtube.com/watch?v=${ID}`,
    ])('recognises %s', (url) => {
        expect(hostedVideo(url)).toEqual({ provider: 'YouTube', embed: YT_EMBED, poster: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg` });
    });
    it.each([
        ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
        ['https://www.vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
        ['https://vimeo.com/76979871/abcdef1234', 'https://player.vimeo.com/video/76979871?h=abcdef1234'],
        ['https://player.vimeo.com/video/76979871', 'https://player.vimeo.com/video/76979871'],
        ['https://player.vimeo.com/video/76979871?h=abcdef1234&autoplay=1', 'https://player.vimeo.com/video/76979871?h=abcdef1234'],
    ])('recognises %s', (url, embed) => {
        expect(hostedVideo(url)).toEqual({ provider: 'Vimeo', embed });
    });
    it.each([
        `https://youtube.com.evil.example/watch?v=${ID}`,
        `https://evilyoutube.com/watch?v=${ID}`,
        `https://www.youtube.com.evil.example/embed/${ID}`,
        `https://youtu.be.evil.example/${ID}`,
        `https://youtube.com@evil.example/watch?v=${ID}`,
        `https://evil.example/youtube.com/watch?v=${ID}`,
        `https://evil.example/?u=https://youtu.be/${ID}`,
        `https://vimeo.com.evil.example/76979871`,
        `https://notvimeo.com/76979871`,
        `https://player.vimeo.com.evil.example/video/76979871`,
        `https://music.youtube.com/watch?v=${ID}`,
        `https://m.youtube.com/shorts/${ID}`,
        `javascript:alert(1)//youtube.com/watch?v=${ID}`,
        `ftp://youtube.com/watch?v=${ID}`,
        'https://www.youtube.com/watch?v=short',
        `https://www.youtube.com/watch?v=${ID}x`,
        `https://www.youtube.com/watch`,
        `https://www.youtube.com/@channel`,
        `https://www.youtube.com/playlist?list=PL12345678901`,
        `https://youtu.be/${ID}/extra`,
        `https://vimeo.com/channels/staffpicks`,
        `https://vimeo.com/76979871/hash/extra`,
        `https://player.vimeo.com/video/abc`,
        `/relative/watch?v=${ID}`,
        '',
    ])('does not recognise %s', (url) => {
        expect(hostedVideo(url)).toBeNull();
    });

    it('turns a YouTube video into media_type video + unplayable and removes video', () => {
        const item = norm({ video: `https://youtu.be/${ID}`, title: 'T' })!;
        expect(item.video).toBeUndefined();
        expect(item.video_type).toBeUndefined();
        expect(item.media_type).toBe('video');
        expect(item.unplayable).toEqual({ provider: 'YouTube', embed: YT_EMBED });
        expect(item.image).toBe('https://x.test/i.png');
    });
    it('gives a YouTube item without an image the hqdefault poster and aspect 16/9', () => {
        const item = normalizeItem({ id: 'y', link: '/y', video: `https://www.youtube.com/watch?v=${ID}` }, 'https://x.test/') as unknown as Record<string, unknown>;
        expect(item.image).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
        expect(item.aspect).toBeCloseTo(16 / 9);
        expect(item.media_type).toBe('video');
    });
    it('recognises the link when the item has neither video nor media_type', () => {
        const item = normalizeItem({ id: 'y', link: `https://www.youtube.com/watch?v=${ID}`, title: 'T' }, 'https://x.test/') as unknown as Record<string, unknown>;
        expect(item.link).toBe(`https://www.youtube.com/watch?v=${ID}`);
        expect(item.unplayable).toEqual({ provider: 'YouTube', embed: YT_EMBED });
        expect(item.image).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    });
    it('leaves a link alone when the item has a real video or a media_type', () => {
        const a = normalizeItem({ ...ok, link: `https://youtu.be/${ID}`, video: '/a.mp4' }, 'https://x.test/') as unknown as Record<string, unknown>;
        expect(a.unplayable).toBeUndefined();
        expect(a.video).toBe('https://x.test/a.mp4');
        const b = normalizeItem({ ...ok, link: `https://youtu.be/${ID}`, media_type: 'photo' }, 'https://x.test/') as unknown as Record<string, unknown>;
        expect(b.unplayable).toBeUndefined();
    });
    it('does not touch a lookalike', () => {
        const item = norm({ video: `https://youtube.com.evil.example/watch?v=${ID}` })!;
        expect(item.video).toBe(`https://youtube.com.evil.example/watch?v=${ID}`);
        expect(item.unplayable).toBeUndefined();
        expect(item.image).toBe('https://x.test/i.png');
    });
    it('Vimeo without an image is a text card with a title and dropped without one', () => {
        const withTitle = normalizeItem({ id: 'v', link: '/v', title: 'T', video: 'https://vimeo.com/76979871' }, 'https://x.test/') as unknown as Record<string, unknown>;
        expect(withTitle.image).toBeUndefined();
        expect(withTitle.unplayable).toEqual({ provider: 'Vimeo', embed: 'https://player.vimeo.com/video/76979871' });
        expect(normalizeItem({ id: 'v', link: '/v', video: 'https://vimeo.com/76979871' }, 'https://x.test/')).toBeNull();
    });
    it('keeps the h= hash of a Vimeo player URL', () => {
        const item = norm({ video: 'https://player.vimeo.com/video/76979871?h=abcdef1234' })!;
        expect((item.unplayable as { embed: string }).embed).toBe('https://player.vimeo.com/video/76979871?h=abcdef1234');
    });
});

describe('unplayable.embed allowlist', () => {
    it.each([
        [YT_EMBED, YT_EMBED],
        [`https://www.youtube.com/embed/${ID}`, YT_EMBED],
        [`https://www.youtube.com/embed/${ID}?autoplay=1`, YT_EMBED],
        ['https://player.vimeo.com/video/76979871?h=abcdef1234', 'https://player.vimeo.com/video/76979871?h=abcdef1234'],
        ['https://player.vimeo.com/video/76979871', 'https://player.vimeo.com/video/76979871'],
    ])('allows %s', (embed, canonical) => {
        expect(allowedEmbed(embed)).toBe(canonical);
    });
    it.each([
        `http://www.youtube-nocookie.com/embed/${ID}`,
        `https://youtube.com/embed/${ID}`,
        `https://www.youtube.com.evil.example/embed/${ID}`,
        `https://evil.example/embed/${ID}`,
        `https://www.youtube.com/watch?v=${ID}`,
        'https://vimeo.com/76979871',
        'https://player.vimeo.com/video/abc',
        'javascript:alert(1)',
        '/embed/x',
        42,
        undefined,
    ])('refuses %s', (embed) => {
        expect(allowedEmbed(embed)).toBeUndefined();
    });
    it('removes a disallowed embed but keeps provider and the item', () => {
        const item = norm({ media_type: 'video', unplayable: { provider: 'ExampleTube', embed: 'https://evil.example/player' } })!;
        expect(item.unplayable).toEqual({ provider: 'ExampleTube' });
    });
    it('rewrites a youtube.com embed to the nocookie host', () => {
        const item = norm({ media_type: 'video', unplayable: { provider: 'YouTube', embed: `https://www.youtube.com/embed/${ID}` } })!;
        expect(item.unplayable).toEqual({ provider: 'YouTube', embed: YT_EMBED });
    });
});

describe('review fixes', () => {
    it('takes video_type from the first source when video comes from it', () => {
        expect(norm({ video_sources: [{ src: 'https://cdn.example.com/x/master', type: 'hls' }] })!.video_type).toBe('hls');
        expect(norm({ video_sources: [{ src: 'https://cdn.example.com/x/master.mpd', type: 'file' }] })!.video_type).toBe('file');
        expect(norm({ video_sources: [{ src: 'https://cdn.example.com/x/a.m3u8' }] })!.video_type).toBe('hls');
        expect(norm({ video: '/v', video_sources: [{ src: '/x', type: 'hls' }] })!.video_type).toBe('file');
    });
    it('drops unplayable without a provider and an invalid media_type', () => {
        for (const unplayable of [{}, { embed: 'https://player.vimeo.com/video/1' }, { provider: '' }, 'x', null, []]) expect('unplayable' in norm({ unplayable })!, JSON.stringify(unplayable)).toBe(false);
        expect('media_type' in norm({ media_type: 'audio' })!).toBe(false);
        expect(norm({ media_type: 'audio', video: '/a.mp4' })!.media_type).toBe('video');
    });
    it.each([
        [`https://www.youtube.com/watch?v=${ID}&v=${ID}`],
        [`https://www.youtube.com/watch?v=${ID}&v=aaaaaaaaaaa`],
        ['https://player.vimeo.com/video/76979871?h=abcdef1234&h=zzzz'],
        [`https://evil.example\\@www.youtube.com/watch?v=${ID}`],
        [`https://www.youtube.com\\watch?v=${ID}`],
    ])('does not recognise %s', (url) => {
        expect(hostedVideo(url)).toBeNull();
        expect(norm({ video: url })!.unplayable).toBeUndefined();
    });
    it('trims whitespace around a URL', () => {
        expect(hostedVideo(`  https://youtu.be/${ID}\n`)?.provider).toBe('YouTube');
        expect(allowedEmbed(` ${YT_EMBED} `)).toBe(YT_EMBED);
        expect(allowedEmbed('https://player.vimeo.com/video/1?h=a&h=b')).toBeUndefined();
        expect(allowedEmbed(`https://evil.example\\@www.youtube.com/embed/${ID}`)).toBeUndefined();
    });
    it('normaliser output validates against item.schema.json', () => {
        const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
        const validate = ajv.compile(JSON.parse(readFileSync(new URL('../../spec/schemas/item.schema.json', import.meta.url), 'utf8')));
        const inputs: Record<string, unknown>[] = [
            { video: '/a.mp4', duration: 3 }, { video_sources: [{ src: '/a', type: 'hls', height: 5 }, { src: 'javascript:x' }, { src: '/b', bitrate: 0 }] },
            { video: `https://youtu.be/${ID}` }, { video: 'https://vimeo.com/76979871/abcdef1234', title: 'T' },
            { media_type: 'audio', unplayable: { embed: 'https://evil.example/x' } }, { unplayable: { provider: 'X', embed: `https://www.youtube.com/embed/${ID}` }, duration: -1, video_type: 'zip' },
            { video: '/a.mp4', video_sources: Array.from({ length: 12 }, (_, i) => ({ src: `/${i}.mp4` })) },
        ];
        for (const input of inputs) {
            const out = normalizeItem({ id: 'a', link: '/l', image: '/i.png', aspect: 1.5, ...input }, 'https://x.test/');
            expect(validate(out), JSON.stringify([input, validate.errors])).toBe(true);
        }
    });
});
