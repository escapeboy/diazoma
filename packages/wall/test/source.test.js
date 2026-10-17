import { describe, expect, it, vi } from 'vitest';
import {
    activeStreams, attachVideo, canUseAv1, capIndex, detectDevice, gifSource, heightCap, hoverSource, isDash, isHls, levelCap, loadLib,
    mediaTypeOf, pickFile, playableVideo, selectSource, sourcesOf, usableUrl, videoTypeOf,
} from '../src/scene/video/source.js';

const UA = {
    quest2: 'Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/34.1.0.4.52 SamsungBrowser/4.0 Chrome/126.0.6478.122 VR Safari/537.36',
    quest3: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.2.0.6.31 SamsungBrowser/4.0 Chrome/128.0.6613.137 VR Safari/537.36',
    quest3s: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3S) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/36.0.0.1.2 Chrome/130.0.0.0 VR Safari/537.36',
    questPro: 'Mozilla/5.0 (X11; Linux x86_64; Quest Pro) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.0.1 Chrome/124.0.0.0 VR Safari/537.36',
    desktopMode: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.2.0.6.31 Chrome/128.0.6613.137 Safari/537.36',
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

const mc = (info) => ({ decodingInfo: vi.fn().mockResolvedValue(info) });
const GOOD = { supported: true, smooth: true, powerEfficient: true };

describe('detectDevice', () => {
    it.each([
        ['quest2', 'meta', 'quest2'],
        ['quest3', 'meta', 'quest3'],
        ['quest3s', 'meta', 'quest3s'],
        ['questPro', 'meta', 'questpro'],
        ['desktopMode', 'meta', null],
        ['chrome', 'unknown', null],
    ])('%s', (key, vendor, model) => {
        expect(detectDevice(UA[key])).toEqual({ vendor, model });
    });

    it('Mobile VR without a Wolvic token is Wolvic', () => {
        expect(detectDevice('Mozilla/5.0 (Android 14; Mobile VR; rv:128.0) Gecko/128.0 Firefox/128.0')).toEqual({ vendor: 'wolvic', model: null });
    });
});

describe('canUseAv1', () => {
    it('allows AV1 on Quest 3 when decoding is smooth and power-efficient', async () => {
        expect(await canUseAv1(detectDevice(UA.quest3), undefined, mc(GOOD))).toBe(true);
    });

    it('allows AV1 on Quest 3S', async () => {
        expect(await canUseAv1(detectDevice(UA.quest3s), undefined, mc(GOOD))).toBe(true);
    });

    it.each(['quest2', 'questPro', 'desktopMode', 'chrome'])('never offers AV1 on %s, without even probing', async (key) => {
        const caps = mc(GOOD);
        expect(await canUseAv1(detectDevice(UA[key]), undefined, caps)).toBe(false);
        expect(caps.decodingInfo).not.toHaveBeenCalled();
    });

    it.each([
        [{ supported: true, smooth: true, powerEfficient: false }],
        [{ supported: true, smooth: false, powerEfficient: true }],
        [{ supported: false, smooth: false, powerEfficient: false }],
    ])('rejects AV1 on Quest 3 when MediaCapabilities says %o', async (info) => {
        expect(await canUseAv1(detectDevice(UA.quest3), undefined, mc(info))).toBe(false);
    });

    it('rejects AV1 when MediaCapabilities is missing or throws', async () => {
        const q3 = detectDevice(UA.quest3);
        expect(await canUseAv1(q3, undefined, undefined)).toBe(false);
        expect(await canUseAv1(q3, undefined, { decodingInfo: vi.fn().mockRejectedValue(new TypeError()) })).toBe(false);
    });

    it('probes a 2160p AV1 MSE configuration', async () => {
        const caps = mc(GOOD);
        await canUseAv1(detectDevice(UA.quest3), undefined, caps);
        const arg = caps.decodingInfo.mock.calls[0][0];
        expect(arg.type).toBe('media-source');
        expect(arg.video.contentType).toMatch(/av01/);
        expect(arg.video.height).toBe(2160);
    });
});

describe('selectSource', () => {
    const h264 = { type: 'hls', url: '/v/h264.m3u8', codecs: ['avc1.640033'] };
    const av1 = { type: 'hls', url: '/v/av1.m3u8', codecs: ['av01.0.13M.08'] };

    it('prefers the AV1 variant when allowed', () => {
        expect(selectSource([h264, av1], true)).toBe(av1);
    });

    it('falls back to H.264 when AV1 is not allowed', () => {
        expect(selectSource([av1, h264], false)).toBe(h264);
    });

    it('uses H.264 when allowed but no AV1 variant exists', () => {
        expect(selectSource([h264], true)).toBe(h264);
    });

    it('returns null when only AV1 exists and it is not allowed, or input is empty', () => {
        expect(selectSource([av1], false)).toBeNull();
        expect(selectSource([], true)).toBeNull();
        expect(selectSource(undefined, true)).toBeNull();
    });

    it('reads `src` and a comma-separated codecs string (the item contract)', () => {
        const a = { src: '/a.m3u8', codecs: 'av01.0.08M.08,mp4a.40.2' };
        const b = { src: '/b.m3u8', codecs: 'avc1.64001f' };
        expect(selectSource([a, b], true)).toBe(a);
        expect(selectSource([a, b], false)).toBe(b);
    });
});

describe('levelCap', () => {
    const ladder = [{ height: 720 }, { height: 1080 }, { height: 1440 }, { height: 2160 }];

    it('does not cap a ladder that fits under 2160p', () => {
        expect(levelCap(ladder)).toBe(-1);
    });

    it('caps at the highest level at or below 2160p when an 8K rendition exists', () => {
        expect(levelCap([...ladder, { height: 4320 }])).toBe(3);
    });

    it('honours a lower cap and unordered levels', () => {
        expect(levelCap([{ height: 2160 }, { height: 720 }, { height: 1440 }], 1440)).toBe(2);
    });

    it('handles empty input', () => {
        expect(levelCap([])).toBe(-1);
    });

    it('capIndex: a cap below every level gives the lowest level, not "no cap"', () => {
        expect(levelCap([{ height: 720 }, { height: 480 }], 0)).toBe(-1);
        expect(capIndex([{ height: 720 }, { height: 480 }], 0)).toBe(1);
        expect(capIndex(ladder, 2160)).toBe(-1);
    });
});

describe('isHls / isDash / videoTypeOf', () => {
    it.each([
        ['https://cdn/x/master.m3u8', true],
        ['https://cdn/x/master.m3u8?token=1', true],
        ['https://cdn/x/video.mp4', false],
        ['', false],
    ])('isHls %s → %s', (url, expected) => {
        expect(isHls(url)).toBe(expected);
    });

    it('reads the path only, in any case: a query or fragment that looks like a stream is still a file', () => {
        expect(isHls('https://cdn/a.mp4?type=.m3u8')).toBe(false);
        expect(isHls('https://cdn/a.mp4#x.m3u8')).toBe(false);
        expect(isDash('https://cdn/a.mp4?manifest=.mpd')).toBe(false);
        expect(isHls('https://cdn/LIVE/MASTER.M3U8?token=a')).toBe(true);
        expect(isDash('/v/Manifest.MPD')).toBe(true);
        expect(videoTypeOf('https://cdn/a.mp4?type=.m3u8')).toBe('file');
    });

    it('isDash', () => {
        expect(isDash('https://cdn/x/manifest.mpd')).toBe(true);
        expect(isDash('https://cdn/x/manifest.mpd?sig=a')).toBe(true);
        expect(isDash('https://cdn/x/mpd.mp4')).toBe(false);
    });

    it('a declared type wins over the path', () => {
        expect(videoTypeOf('https://cdn/x/stream', 'hls')).toBe('hls');
        expect(videoTypeOf('https://cdn/x/a.m3u8', 'file')).toBe('file');
        expect(videoTypeOf('https://cdn/x/a.m3u8', 'bogus')).toBe('hls');
        expect(videoTypeOf('https://cdn/x/a.mpd')).toBe('dash');
        expect(videoTypeOf('https://cdn/x/a.webm')).toBe('file');
    });
});

describe('items', () => {
    it('mediaTypeOf infers video from video or video_sources, photo from image', () => {
        expect(mediaTypeOf({ video: '/v.mp4', image: '/p.jpg' })).toBe('video');
        expect(mediaTypeOf({ video_sources: [{ src: '/v.mp4' }] })).toBe('video');
        expect(mediaTypeOf({ image: '/p.jpg' })).toBe('photo');
        expect(mediaTypeOf({ video: '/v.mp4', media_type: 'gif' })).toBe('gif');
        expect(mediaTypeOf({ title: 'text' })).toBeUndefined();
    });

    it('usableUrl: http(s) and relative only; control characters and spaces cannot hide a scheme', () => {
        for (const ok of ['https://cdn/a.mp4', 'http://cdn/a.mp4', '/v/a.mp4', 'v/a.mp4', '//cdn/a.mp4', '/v/my file.mp4']) expect(usableUrl(ok), ok).toBe(true);
        for (const bad of [' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:video/mp4;base64,AA', 'blob:https://x/1', 'file:///etc/passwd', 'ftp://cdn/a.mp4', 'vbscript:x', '', '   ', null, 42]) {
            expect(usableUrl(bad), JSON.stringify(bad)).toBe(false);
        }
        expect(playableVideo({ video: ' javascript:alert(1)' })).toBe(false);
        expect(sourcesOf({ video_sources: [{ src: 'java\tscript:alert(1)' }, { src: '/ok.mp4' }] }).map((x) => x.src)).toEqual(['/ok.mp4']);
    });

    it('playableVideo needs a usable source', () => {
        expect(playableVideo({ video: '/v.mp4' })).toBe(true);
        expect(playableVideo({ video: 'javascript:alert(1)' })).toBe(false);
        expect(playableVideo({ video: '/v.mp4', media_type: 'photo' })).toBe(false);
    });

    it('sourcesOf: sources in order, then video; de-duplicated, unsafe URLs dropped, at most 8', () => {
        const item = {
            video: 'https://cdn/a/720.mp4',
            video_sources: [
                { src: 'https://cdn/a/1080.mp4', height: 1080 },
                { src: 'https://cdn/a/720.mp4', height: 720 },
                { src: 'data:video/mp4;base64,AAAA', height: 480 },
                { src: 'https://cdn/a/master.m3u8', codecs: 'avc1.64001f' },
            ],
        };
        expect(sourcesOf(item)).toEqual([
            { src: 'https://cdn/a/1080.mp4', type: 'file', height: 1080, codecs: '', bitrate: 0 },
            { src: 'https://cdn/a/720.mp4', type: 'file', height: 720, codecs: '', bitrate: 0 },
            { src: 'https://cdn/a/master.m3u8', type: 'hls', height: 0, codecs: 'avc1.64001f', bitrate: 0 },
        ]);
        const many = { video_sources: Array.from({ length: 12 }, (_, i) => ({ src: `/v${i}.mp4` })) };
        expect(sourcesOf(many)).toHaveLength(8);
    });

    it('hoverSource: the smallest file; streams keep the poster', () => {
        expect(hoverSource({ video: '/v.mp4' })).toBe('/v.mp4');
        expect(hoverSource({ video_sources: [{ src: '/1080.mp4', height: 1080 }, { src: '/360.mp4', height: 360 }] })).toBe('/360.mp4');
        expect(hoverSource({ video: '/m.m3u8' })).toBeNull();
        expect(hoverSource({ video: '/m.mpd' })).toBeNull();
        expect(hoverSource({ video: '/g.mp4', media_type: 'gif' })).toBe('/g.mp4');
    });

    it('hoverSource: a photo (or any non-video type) never plays, even with a video', () => {
        expect(hoverSource({ video: '/v.mp4', media_type: 'photo' })).toBeNull();
        expect(hoverSource({ video: '/v.mp4', image: '/p.jpg', media_type: 'photo' })).toBeNull();
    });

    it('gifSource: video, else the first source (a GIF given as video_sources only)', () => {
        expect(gifSource({ media_type: 'gif', video: '/g.mp4', video_sources: [{ src: '/s.mp4' }] })).toBe('/g.mp4');
        expect(gifSource({ media_type: 'gif', video_sources: [{ src: '/s.mp4' }, { src: '/t.mp4' }] })).toBe('/s.mp4');
        expect(hoverSource({ media_type: 'gif', video_sources: [{ src: '/s.mp4' }] })).toBe('/s.mp4');
        expect(gifSource({ media_type: 'gif' })).toBeNull();
    });
});

describe('quality choice', () => {
    it('headsets: maxHeight, default 2160', () => {
        expect(heightCap({ headset: true })).toBe(2160);
        expect(heightCap({ headset: true, maxHeight: 1440 })).toBe(1440);
    });

    it('pages: innerHeight × DPR, never above maxHeight', () => {
        expect(heightCap({ innerHeight: 800, dpr: 2 })).toBe(1600);
        expect(heightCap({ innerHeight: 2000, dpr: 2 })).toBe(2160);
        expect(heightCap({ innerHeight: 800, dpr: 2, maxHeight: 720 })).toBe(720);
    });

    it('Save-Data, 2G and 3G: the lowest', () => {
        expect(heightCap({ headset: true, connection: { saveData: true } })).toBe(0);
        expect(heightCap({ innerHeight: 800, connection: { effectiveType: '3g' } })).toBe(0);
        expect(heightCap({ innerHeight: 800, connection: { effectiveType: 'slow-2g' } })).toBe(0);
        expect(heightCap({ innerHeight: 800, connection: { effectiveType: '4g' } })).toBe(800);
    });

    it('pickFile: highest at or below the cap, else the lowest', () => {
        const files = [{ src: 'a', height: 1080 }, { src: 'b', height: 480 }, { src: 'c', height: 720 }];
        expect(pickFile(files, 800).src).toBe('c');
        expect(pickFile(files, 2160).src).toBe('a');
        expect(pickFile(files, 300).src).toBe('b');
        expect(pickFile(files, 0).src).toBe('b');
        expect(pickFile([{ src: 'x', height: 0 }], 720).src).toBe('x');
    });
});

/** A <video> stand-in with the parts attachVideo touches. */
function fakeVideo({ nativeHls = false } = {}) {
    const listeners = {};
    const v = {
        attrs: {},
        currentTime: 0,
        paused: true,
        duration: 10,
        played: 0,
        loads: 0,
        set src(u) { this.attrs.src = u; this.paused = true; },
        get src() { return this.attrs.src || ''; },
        removeAttribute(k) { delete this.attrs[k]; },
        getAttribute(k) { return this.attrs[k] ?? null; },
        load() { this.loads++; },
        pause() { this.paused = true; },
        play() { this.paused = false; this.played++; return Promise.resolve(); },
        canPlayType: (t) => (nativeHls && t === 'application/vnd.apple.mpegurl' ? 'maybe' : ''),
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        fire(type) { const fns = listeners[type] || []; listeners[type] = []; fns.forEach((f) => f()); },
    };
    return v;
}

function fakeHls({ supported = true } = {}) {
    const created = [];
    class Hls {
        static isSupported() { return supported; }
        constructor(config) { this.config = config; this.handlers = {}; this.levels = []; this.currentLevel = -1; this.destroyed = false; created.push(this); }
        on(ev, fn) { this.handlers[ev] = fn; }
        loadSource(u) { this.url = u; }
        attachMedia(m) { this.media = m; }
        destroy() { this.destroyed = true; }
        emit(ev, data) { this.handlers[ev](ev, data); }
    }
    Hls.Events = { MANIFEST_PARSED: 'parsed', LEVEL_LOADED: 'level', ERROR: 'error' };
    return { Hls, created };
}

const page = { userAgent: UA.chrome };
const win = { innerHeight: 400, devicePixelRatio: 2 };
const noAv1 = async () => false;

describe('loadLib', () => {
    it('false never loads; a function is the loader (once per call), and its result is the library', async () => {
        expect(await loadLib('hls', { hls: false })).toBeNull();
        const lib = { isSupported: () => true };
        const loader = vi.fn().mockResolvedValue(lib);
        expect(await loadLib('hls', { hls: loader })).toBe(lib);
        expect(loader).toHaveBeenCalledTimes(1);
    });
});

describe('attachVideo', () => {
    it('files: picks the rendition for the cap, through fileUrl; streams never get it', async () => {
        const v = fakeVideo();
        const item = { video_sources: [{ src: 'https://cdn/1080.mp4', height: 1080 }, { src: 'https://cdn/720.mp4', height: 720 }, { src: 'https://cdn/480.mp4', height: 480 }] };
        const ctl = attachVideo(v, item, { navigator: page, window: win, canUseAv1: noAv1, fileUrl: (u) => u + '?xr=1' });
        await ctl.ready;
        expect(ctl.kind).toBe('file');
        expect(v.src).toBe('https://cdn/720.mp4?xr=1');
        expect(ctl.levels().map((l) => l.label)).toEqual(['1080p', '720p', '480p']);
        expect(ctl.level()).toBe('auto');
    });

    it('files: a manual switch keeps the time and the play state', async () => {
        const v = fakeVideo();
        const item = { video_sources: [{ src: '/a.mp4', height: 720 }, { src: '/b.mp4', height: 360 }] };
        const ctl = attachVideo(v, item, { navigator: page, window: win, canUseAv1: noAv1 });
        await ctl.ready;
        v.play();
        v.currentTime = 3.2;
        ctl.setLevel(360);
        expect(v.src).toBe('/b.mp4');
        v.fire('loadedmetadata');
        expect(v.currentTime).toBe(3.2);
        expect(v.paused).toBe(false);
        expect(ctl.level()).toBe(360);

        v.pause();
        v.currentTime = 1.5;
        ctl.setLevel('auto');
        v.fire('loadedmetadata');
        expect(v.src).toBe('/a.mp4');
        expect(v.currentTime).toBe(1.5);
        expect(v.paused).toBe(true);
        expect(ctl.level()).toBe('auto');
    });

    it('HLS: MSE through hls.js, URL verbatim, capped levels, destroy', async () => {
        const v = fakeVideo({ nativeHls: true });
        const { Hls, created } = fakeHls();
        const before = activeStreams();
        const ctl = attachVideo(v, { video: 'https://cdn/master.m3u8?sig=abc' }, { navigator: { userAgent: UA.quest3 }, window: win, canUseAv1: noAv1, loadLib: async () => Hls, fileUrl: (u) => u + '&xr=1', inXr: true });
        await ctl.ready;
        const hls = created[0];
        expect(ctl.kind).toBe('hls');
        expect(hls.url).toBe('https://cdn/master.m3u8?sig=abc');
        expect(hls.media).toBe(v);
        expect(hls.config.maxBufferLength).toBe(30);
        expect(activeStreams()).toBe(before + 1);
        hls.levels = [{ height: 4320 }, { height: 2160 }, { height: 1080 }];
        hls.emit('parsed', { levels: hls.levels });
        expect(hls.autoLevelCapping).toBe(1);
        expect(ctl.levels().map((l) => l.id)).toEqual([0, 1, 2]);
        ctl.setLevel(2);
        expect(hls.currentLevel).toBe(2);
        expect(ctl.level()).toBe(2);
        hls.emit('level', { details: { live: true } });
        expect(ctl.live).toBe(true);
        ctl.destroy();
        expect(hls.destroyed).toBe(true);
        expect(activeStreams()).toBe(before);
        expect(v.getAttribute('src')).toBeNull();
    });

    it('HLS: native playback only when MSE is missing', async () => {
        const v = fakeVideo({ nativeHls: true });
        const { Hls, created } = fakeHls({ supported: false });
        const ctl = attachVideo(v, { video: '/m.m3u8' }, { navigator: page, window: win, canUseAv1: noAv1, loadLib: async () => Hls });
        await ctl.ready;
        expect(created).toHaveLength(0);
        expect(ctl.kind).toBe('hls-native');
        expect(v.src).toBe('/m.m3u8');
    });

    it('HLS: library refused and no native HLS → ready rejects', async () => {
        const v = fakeVideo();
        const ctl = attachVideo(v, { video: '/m.m3u8' }, { navigator: page, window: win, canUseAv1: noAv1, libs: { hls: false } });
        await expect(ctl.ready).rejects.toThrow(/HLS/);
    });

    it('DASH: dash.js player, levels, manual switch, destroy', async () => {
        const v = fakeVideo();
        const calls = [];
        let handlers = {};
        const player = {
            updateSettings: (s) => calls.push(['settings', JSON.stringify(s)]),
            on: (ev, fn) => { handlers[ev] = fn; },
            initialize: (el, url, auto) => calls.push(['init', el === v, url, auto]),
            getRepresentationsByType: () => [{ id: 'v1', height: 360, bitrateInKbit: 400 }, { id: 'v0', height: 720, bitrateInKbit: 1200 }],
            getCurrentRepresentationForType: () => ({ id: 'v1' }),
            setRepresentationForTypeById: (t, id, force) => calls.push(['rep', t, id, force]),
            isDynamic: () => false,
            destroy: () => calls.push(['destroy']),
        };
        const dashjs = { MediaPlayer: () => ({ create: () => player }) };
        const errors = [];
        const ctl = attachVideo(v, { video: 'https://cdn/manifest.mpd' }, { navigator: page, window: win, canUseAv1: noAv1, loadLib: async () => dashjs, onError: (m) => errors.push(m) });
        await ctl.ready;
        expect(ctl.kind).toBe('dash');
        expect(calls).toContainEqual(['init', true, 'https://cdn/manifest.mpd', false]);
        // Live clock sync: no third party. The default source (time.akamai.com in dash.js) becomes an HTTP HEAD on
        // the manifest itself, set before initialize() (which reads it); the manifest's Date header is the fallback.
        const first = JSON.parse(calls.find((c) => c[0] === 'settings')[1]);
        expect(first.streaming.utcSynchronization).toEqual({
            useManifestDateHeaderTimeSource: true,
            defaultTimingSource: { scheme: 'urn:mpeg:dash:utc:http-head:2014', value: 'https://cdn/manifest.mpd' },
        });
        expect(calls.findIndex((c) => c[0] === 'settings')).toBeLessThan(calls.findIndex((c) => c[0] === 'init'));
        expect(JSON.stringify(calls)).not.toMatch(/akamai/);
        handlers.streamInitialized();
        expect(ctl.levels().map((l) => l.label)).toEqual(['720p', '360p']);
        // Time sync (16) and a subtitle parse error (33) do not stop playback: noted, not failures.
        handlers.error({ error: { code: 16, message: 'Failed to synchronize client and server time' } });
        handlers.error({ error: { code: 33, message: 'parse' } });
        expect(errors).toEqual([]);
        expect(ctl.ignoredErrors).toEqual([16, 33]);
        handlers.error({ error: { code: 27, message: 'content download failed' } });
        expect(errors).toEqual(['dash:content download failed']);
        ctl.setLevel('v1');
        expect(calls).toContainEqual(['rep', 'video', 'v1', true]);
        expect(ctl.level()).toBe('v1');
        ctl.destroy();
        expect(calls.at(-1)).toEqual(['destroy']);
    });

    it('destroy before the library arrives creates no player', async () => {
        const v = fakeVideo();
        const { Hls, created } = fakeHls();
        let release;
        const ctl = attachVideo(v, { video: '/m.m3u8' }, { navigator: page, window: win, canUseAv1: noAv1, loadLib: () => new Promise((ok) => { release = () => ok(Hls); }) });
        await new Promise((ok) => setTimeout(ok, 0));
        expect(typeof release).toBe('function');
        ctl.destroy();
        release();
        await ctl.ready;
        expect(created).toHaveLength(0);
    });
});
