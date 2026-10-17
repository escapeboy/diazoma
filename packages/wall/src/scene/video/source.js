/**
 * Video sources of an item: which file or stream to play, at which quality, through which
 * player (the element itself, hls.js, native HLS or dash.js), and how to tear it all down.
 *
 * Device rules (ported from an earlier headset player, with its tests):
 * - Quest 2 / Pro (XR2 Gen 1): H.264 only; AV1 decodes in software.
 * - Quest 3 / 3S (XR2 Gen 2): AV1 allowed when MediaCapabilities reports it smooth AND power-efficient.
 * - Headsets are capped at 2160p; elsewhere about the screen height in device pixels.
 * - Save-Data or a 2G/3G connection: the lowest rendition.
 *
 * Stream URLs are used verbatim: no cache-busting marker, which would break signed playlists.
 */
import { importLib } from './libs.js';
import { loadScript } from './script.js';

export const DEFAULT_MAX_HEIGHT = 2160;
export const DEFAULT_AV1_ALLOW = ['meta:quest3', 'meta:quest3s'];
export const MAX_SOURCES = 8;

// AV1 Main, level 5.1, 8-bit — what a 2160p60 rendition needs.
const AV1_PROBE = {
    type: 'media-source',
    video: {
        contentType: 'video/mp4; codecs="av01.0.13M.08"',
        width: 3840,
        height: 2160,
        bitrate: 14000000,
        framerate: 60,
    },
};

/** Headset vendor/model from the user agent. */
export function detectDevice(ua) {
    ua = ua || '';
    if (/OculusBrowser\//.test(ua)) {
        const m = ua.match(/\bQuest(?: (3S|3|2|Pro))?\b/);
        return { vendor: 'meta', model: m ? 'quest' + (m[1] || '').toLowerCase() : null };
    }
    if (/PicoBrowser\//.test(ua)) return { vendor: 'pico', model: null };
    if (/Wolvic\/|Mobile VR/.test(ua)) return { vendor: 'wolvic', model: null };
    return { vendor: 'unknown', model: null };
}

export function deviceKey(device) {
    return device.vendor + ':' + (device.model || 'unknown');
}

export async function canUseAv1(device, allowList = DEFAULT_AV1_ALLOW, mediaCapabilities = globalThis.navigator?.mediaCapabilities) {
    if (!allowList.includes(deviceKey(device))) return false;
    if (!mediaCapabilities || typeof mediaCapabilities.decodingInfo !== 'function') return false;
    try {
        const info = await mediaCapabilities.decodingInfo(AV1_PROBE);
        return !!(info && info.supported && info.smooth && info.powerEfficient);
    } catch (e) {
        return false;
    }
}

export function isAv1Codec(codec) {
    return /^av01/i.test(codec || '');
}

const codecList = (s) => (Array.isArray(s.codecs) ? s.codecs : String(s.codecs || '').split(',').map((c) => c.trim()).filter(Boolean));
const hasAv1 = (s) => codecList(s).some(isAv1Codec);

/**
 * Pick one source from `[{ url | src, codecs }]`: the AV1 one when allowed, otherwise the first
 * non-AV1 source.
 */
export function selectSource(sources, av1Allowed) {
    const list = Array.isArray(sources) ? sources.filter((s) => s && (s.url || s.src)) : [];
    if (av1Allowed) {
        const av1 = list.find(hasAv1);
        if (av1) return av1;
    }
    return list.find((s) => !hasAv1(s)) || null;
}

/** Index of the highest level at or below maxHeight; -1 (no cap) when all fit. */
export function levelCap(levels, maxHeight = DEFAULT_MAX_HEIGHT) {
    let best = -1;
    let allFit = true;
    (levels || []).forEach((level, i) => {
        const h = (level && level.height) || 0;
        if (h > maxHeight) {
            allFit = false;
        } else if (best === -1 || h > levels[best].height) {
            best = i;
        }
    });
    return allFit ? -1 : best;
}

/** Like levelCap, but a cap below every level gives the lowest level instead of no cap. */
export function capIndex(levels, maxHeight) {
    const cap = levelCap(levels, maxHeight);
    if (cap !== -1 || !(levels || []).some((l) => (l && l.height) > maxHeight)) return cap;
    return lowestIndex(levels);
}

function lowestIndex(levels) {
    let best = -1;
    (levels || []).forEach((l, i) => {
        if (best === -1 || ((l && l.height) || 0) < ((levels[best] && levels[best].height) || 0)) best = i;
    });
    return best;
}

/** The path of a URL (absolute or relative), without query and fragment: `a.mp4?type=.m3u8` is a file. */
function pathOf(url) {
    try {
        return new URL(String(url || ''), 'http://relative.invalid/').pathname;
    } catch (e) {
        return String(url || '').split(/[?#]/)[0];
    }
}

export function isHls(url) {
    return /\.m3u8$/i.test(pathOf(url));
}

export function isDash(url) {
    return /\.mpd$/i.test(pathOf(url));
}

/** `file`, `hls` or `dash`: the declared type, else from the path. */
export function videoTypeOf(src, type) {
    if (type === 'file' || type === 'hls' || type === 'dash') return type;
    return isHls(src) ? 'hls' : isDash(src) ? 'dash' : 'file';
}

function absoluteUrl(src) {
    try {
        return new URL(src, globalThis.location ? globalThis.location.href : undefined).href;
    } catch (e) {
        return src;
    }
}

/**
 * http(s), absolute or relative to the page; never javascript:, data: and the like. As on the PHP side
 * (VideoUrl::isWebUrl), ASCII control characters and spaces are dropped before looking for a scheme,
 * since a browser ignores them there (' javascript:…', 'java\tscript:…'); then the URL, parsed against
 * a base the way a browser would, must come out http or https. A space inside a path stays allowed.
 */
export function usableUrl(u) {
    if (typeof u !== 'string') return false;
    const bare = u.replace(/[\u0000- \u007f]/g, '');
    if (!bare || (/^[a-z][a-z0-9+.-]*:/i.test(bare) && !/^https?:/i.test(bare))) return false;
    try {
        const base = globalThis.location && /^https?:$/.test(globalThis.location.protocol) ? globalThis.location.href : 'https://relative.invalid/';
        const p = new URL(u, base).protocol;
        return p === 'http:' || p === 'https:';
    } catch (e) {
        return false;
    }
}

/**
 * The item's sources as `{ src, type, height, codecs, bitrate }`: `video_sources` in order, then
 * `video` when it is not one of them. At most MAX_SOURCES; unusable URLs are dropped.
 */
export function sourcesOf(item) {
    const out = [];
    const seen = new Set();
    const add = (s) => {
        if (!s || !usableUrl(s.src) || seen.has(s.src) || out.length >= MAX_SOURCES) return;
        seen.add(s.src);
        out.push({
            src: s.src,
            type: videoTypeOf(s.src, s.type),
            height: Number.isFinite(s.height) && s.height > 0 ? Math.round(s.height) : 0,
            codecs: typeof s.codecs === 'string' ? s.codecs : '',
            bitrate: Number.isFinite(s.bitrate) && s.bitrate > 0 ? s.bitrate : 0,
        });
    };
    if (item && Array.isArray(item.video_sources)) item.video_sources.forEach(add);
    if (item && item.video) add({ src: item.video, type: item.video_type });
    return out;
}

/** The item's media type: as given, else `video` when it has a video, `photo` when it has an image. */
export function mediaTypeOf(item) {
    if (!item) return undefined;
    if (item.media_type) return item.media_type;
    if (item.video || (Array.isArray(item.video_sources) && item.video_sources.length)) return 'video';
    return item.image ? 'photo' : undefined;
}

/** True when the wall can try to play this item itself. */
export function playableVideo(item) {
    const t = mediaTypeOf(item);
    return (t === 'video' || t === 'gif') && sourcesOf(item).length > 0;
}

/** A GIF's MP4: `video`, else its first usable source. */
export function gifSource(item) {
    if (item && usableUrl(item.video)) return item.video;
    const first = sourcesOf(item)[0];
    return first ? first.src : null;
}

/** The file a card plays while pointed at: the smallest known file; streams keep their poster; photos never play. */
export function hoverSource(item) {
    const type = mediaTypeOf(item);
    if (type === 'gif') return gifSource(item);
    if (type !== 'video') return null;
    const files = sourcesOf(item).filter((s) => s.type === 'file' && !hasAv1(s));
    if (!files.length) return null;
    const sized = files.filter((s) => s.height).sort((a, b) => a.height - b.height);
    return (sized[0] || files[0]).src;
}

/**
 * Height the automatic choice aims at. 0 means "the lowest" (Save-Data, 2G, 3G). Headsets get
 * maxHeight (default 2160); a page about its height in device pixels, never above maxHeight.
 */
export function heightCap({ headset = false, maxHeight, connection, innerHeight = 0, dpr = 1 } = {}) {
    if (connection && (connection.saveData || /(^|-)(2g|3g)$/.test(connection.effectiveType || ''))) return 0;
    const limit = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : DEFAULT_MAX_HEIGHT;
    if (headset) return limit;
    const screen = Math.round((innerHeight || 1080) * (dpr || 1));
    return Math.min(limit, screen);
}

/** The file rendition for a cap: the highest at or below it, else the lowest; unknown heights only when nothing is sized. */
export function pickFile(files, cap) {
    const sized = files.filter((f) => f.height).sort((a, b) => b.height - a.height);
    if (!sized.length) return files[0] || null;
    if (cap <= 0) return sized[sized.length - 1];
    return sized.find((f) => f.height <= cap) || sized[sized.length - 1];
}

const libCache = new Map();

/**
 * hls.js (`hls`) or dash.js (`dash`), loaded on first use. `libs[name]`: a script URL that sets
 * window.Hls / window.dashjs, or false to never load it (resolves null).
 */
export function loadLib(name, libs = {}) {
    const url = libs ? libs[name] : undefined;
    if (url === false) return Promise.resolve(null);
    // A loader of the host's own, e.g. an extension content script importing a module from its package
    // (a script tag would run in the page's world, where the content script cannot see window.Hls).
    if (typeof url === 'function') return Promise.resolve().then(url);
    const key = name + '|' + (url || '');
    if (!libCache.has(key)) {
        const p = typeof url === 'string' ? loadScript(url, name === 'hls' ? 'Hls' : 'dashjs') : importLib(name);
        p.catch(() => libCache.delete(key));
        libCache.set(key, p);
    }
    return libCache.get(key);
}

// Stream players (hls.js / dash.js instances) not yet destroyed: the harness checks it drops to 0.
const liveInstances = new Set();
export function activeStreams() {
    return liveInstances.size;
}

const levelLabel = (h) => (h ? h + 'p' : '?');

/**
 * dash.js error codes that do not stop playback, so the item is not marked failed:
 * - 16 TIME_SYNC_FAILED: no clock source answered (e.g. the manifest host's Date header is not exposed to
 *   CORS); dash.js still completes the sync on the device clock and plays on.
 * - 33 TIMED_TEXT_ERROR_ID_PARSE: one subtitle fragment did not parse; the video is not affected.
 * Download, append, manifest and capability errors stay failures.
 */
export const DASH_NON_FATAL = new Set([16, 33]);

/**
 * Attaches the item's best source to `video` and returns its controller at once; `ready` settles
 * when the source is attached (it rejects when nothing can play it).
 *
 * Controller: `kind` (file | hls | hls-native | dash), `levels()` → `[{ id, height, label }]`
 * highest first (empty when there is no choice), `level()` → id or 'auto', `setLevel(id | 'auto')`
 * (keeps time and play state), `live`, `destroy()`.
 *
 * Options: `inXr`, `maxHeight`, `libs` (see loadLib), `fileUrl(url)` (applied to files only),
 * `onLevels()` (levels or live changed), `onError(message)` (a fatal stream error after attach).
 */
export function attachVideo(video, item, opts = {}) {
    const nav = opts.navigator || globalThis.navigator || {};
    const win = opts.window || globalThis;
    const load = opts.loadLib || loadLib;
    const av1Check = opts.canUseAv1 || ((device) => canUseAv1(device));
    const fileUrl = opts.fileUrl || ((u) => u);
    const notify = () => { if (!ctl.destroyed && opts.onLevels) opts.onLevels(); };
    const fail = (message) => { if (!ctl.destroyed && opts.onError) opts.onError(message); };

    const device = detectDevice(nav.userAgent);
    const cap = heightCap({ headset: !!opts.inXr || device.vendor !== 'unknown', maxHeight: opts.maxHeight, connection: nav.connection, innerHeight: win.innerHeight, dpr: win.devicePixelRatio });
    const sources = sourcesOf(item);
    const streams = sources.filter((s) => s.type !== 'file');

    let impl = { levels: () => [], level: () => 'auto', setLevel: () => {}, destroy: () => {} };
    const ctl = {
        kind: streams.length ? streams[0].type : 'file',
        live: false,
        destroyed: false,
        attached: false,
        ignoredErrors: [], // non-fatal stream errors (codes), for diagnostics
        cap,
        ready: null,
        levels: () => impl.levels(),
        level: () => impl.level(),
        setLevel: (id) => { if (!ctl.destroyed) impl.setLevel(id); },
        destroy() {
            if (ctl.destroyed) return;
            ctl.destroyed = true;
            try { impl.destroy(); } catch (e) { /* a broken player must not keep the element alive */ }
            video.pause();
            video.removeAttribute('src');
            video.load();
        },
    };

    // Plain files with no AV1 choice attach at once, so the caller's play() stays inside the
    // press that opened the item (sound allowed); everything else waits for the AV1 probe.
    if (!streams.length && !sources.some(hasAv1)) {
        try {
            attachFiles(sources, false);
            ctl.attached = true;
            ctl.ready = Promise.resolve(ctl);
        } catch (e) {
            ctl.ready = Promise.reject(e);
        }
        return ctl;
    }

    ctl.ready = av1Check(device).catch(() => false).then((av1) => {
        if (ctl.destroyed) return ctl;
        if (streams.length) {
            const pick = selectSource(streams, av1) || streams[0];
            ctl.kind = pick.type;
            return (pick.type === 'hls' ? attachHls : attachDash)(pick.src).then(() => ctl);
        }
        attachFiles(sources, av1);
        return ctl;
    });

    function attachFiles(files, av1) {
        const av1Files = files.filter(hasAv1);
        const plain = files.filter((f) => !hasAv1(f));
        const list = av1 && av1Files.length ? av1Files : plain.length ? plain : files;
        if (!list.length) throw new Error('no playable source');
        let mode = 'auto';
        let current = pickFile(list, cap);
        const byHeight = new Map();
        list.filter((f) => f.height).sort((a, b) => b.height - a.height).forEach((f) => { if (!byHeight.has(f.height)) byHeight.set(f.height, f); });
        video.src = fileUrl(current.src);
        const switchTo = (f) => {
            if (!f || f === current) return;
            current = f;
            const at = video.currentTime;
            const paused = video.paused;
            video.addEventListener('loadedmetadata', () => {
                if (ctl.destroyed) return;
                if (at > 0) video.currentTime = at;
                if (!paused) video.play().catch(() => {});
            }, { once: true });
            video.src = fileUrl(f.src);
        };
        impl = {
            levels: () => (byHeight.size > 1 ? [...byHeight.values()].map((f) => ({ id: f.height, height: f.height, label: levelLabel(f.height) })) : []),
            level: () => (mode === 'auto' ? 'auto' : current.height),
            setLevel: (id) => {
                mode = id === 'auto' ? 'auto' : 'manual';
                switchTo(id === 'auto' ? pickFile(list, cap) : byHeight.get(id));
                notify();
            },
            destroy: () => {},
        };
    }

    async function attachHls(src) {
        let Hls = null;
        try {
            Hls = await load('hls', opts.libs);
        } catch (e) {
            Hls = null;
        }
        if (ctl.destroyed) return;
        // MSE first: native HLS in desktop Chrome has had playback bugs; it is only the fallback (Safari, iOS).
        if (Hls && Hls.isSupported()) {
            const hls = new Hls(opts.inXr ? { maxBufferLength: 30, maxMaxBufferLength: 60 } : {});
            liveInstances.add(hls);
            let mode = 'auto';
            hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
                hls.autoLevelCapping = capIndex(data.levels, cap);
                notify();
            });
            hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
                const live = !!(data && data.details && data.details.live);
                if (live !== ctl.live) {
                    ctl.live = live;
                    notify();
                }
            });
            hls.on(Hls.Events.ERROR, (_e, data) => { if (data && data.fatal) fail('hls:' + data.details); });
            hls.loadSource(src);
            hls.attachMedia(video);
            impl = {
                levels: () => {
                    const seen = new Set();
                    return hls.levels
                        .map((l, i) => ({ id: i, height: l.height || 0, label: levelLabel(l.height) }))
                        .sort((a, b) => b.height - a.height)
                        .filter((l) => (seen.has(l.height) ? false : seen.add(l.height)))
                        .filter((_l, _i, all) => all.length > 1);
                },
                level: () => (mode === 'auto' ? 'auto' : hls.currentLevel),
                setLevel: (id) => {
                    mode = id === 'auto' ? 'auto' : 'manual';
                    hls.currentLevel = id === 'auto' ? -1 : id;
                    notify();
                },
                destroy: () => {
                    liveInstances.delete(hls);
                    hls.destroy();
                },
            };
            return;
        }
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            ctl.kind = 'hls-native';
            video.addEventListener('loadedmetadata', () => {
                ctl.live = video.duration === Infinity;
                notify();
            }, { once: true });
            video.src = src;
            return;
        }
        throw new Error('HLS cannot play here');
    }

    async function attachDash(src) {
        let dashjs = null;
        try {
            dashjs = await load('dash', opts.libs);
        } catch (e) {
            dashjs = null;
        }
        if (ctl.destroyed) return;
        if (!dashjs || typeof dashjs.MediaPlayer !== 'function') throw new Error('DASH cannot play here');
        const player = dashjs.MediaPlayer().create();
        liveInstances.add(player);
        let mode = 'auto';
        const reps = () => (player.getRepresentationsByType ? player.getRepresentationsByType('video') || [] : []);
        player.updateSettings({
            streaming: {
                abr: { autoSwitchBitrate: { video: true } },
                // Live clock sync never asks a third party. dash.js tries the manifest's own UTCTiming
                // first, then its default source (time.akamai.com unless replaced; initialize() reads
                // this setting), then the Date header of the manifest response. The default becomes
                // an HTTP HEAD on the manifest itself: its host's Date header.
                utcSynchronization: {
                    useManifestDateHeaderTimeSource: true,
                    defaultTimingSource: { scheme: 'urn:mpeg:dash:utc:http-head:2014', value: absoluteUrl(src) },
                },
                ...(opts.inXr ? { buffer: { bufferTimeAtTopQuality: 30, bufferTimeAtTopQualityLongForm: 60 } } : {}),
            },
        });
        player.on('streamInitialized', () => {
            ctl.live = !!(player.isDynamic && player.isDynamic());
            // Cap automatic switching at the highest representation that fits the height cap.
            const list = reps();
            const i = capIndex(list, cap);
            if (i >= 0 && list[i].bitrateInKbit) player.updateSettings({ streaming: { abr: { maxBitrate: { video: list[i].bitrateInKbit } } } });
            notify();
        });
        player.on('error', (e) => {
            const code = e && e.error && e.error.code;
            // Errors that do not stop playback (read in dash.js 5.2.1's source) are noted, not failures.
            if (DASH_NON_FATAL.has(code)) {
                ctl.ignoredErrors.push(code);
                return;
            }
            fail('dash:' + String((e && e.error && (e.error.message || e.error.code)) || 'error'));
        });
        player.initialize(video, src, false);
        impl = {
            levels: () => {
                const seen = new Set();
                const list = reps()
                    .map((r) => ({ id: r.id, height: r.height || 0, label: levelLabel(r.height) }))
                    .sort((a, b) => b.height - a.height)
                    .filter((l) => (seen.has(l.height) ? false : seen.add(l.height)));
                return list.length > 1 ? list : [];
            },
            level: () => {
                if (mode === 'auto') return 'auto';
                const r = player.getCurrentRepresentationForType && player.getCurrentRepresentationForType('video');
                return r ? r.id : 'auto';
            },
            setLevel: (id) => {
                mode = id === 'auto' ? 'auto' : 'manual';
                player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: id === 'auto' } } } });
                if (id !== 'auto') player.setRepresentationForTypeById('video', id, true);
                notify();
            },
            destroy: () => {
                liveInstances.delete(player);
                player.destroy();
            },
        };
    }

    return ctl;
}
