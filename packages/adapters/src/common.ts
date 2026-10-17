import type { Item, ViewConfig } from '@diazoma/wall';
import { sizesFor, type Resizer } from './sizes.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Warning {
    code: 'invalid-item' | 'unsafe-url' | 'too-many-items' | 'aspect-default' | 'no-image' | 'no-link' | 'dropped-duplicate' | 'invalid-view' | 'bad-resize' | 'bad-recipe';
    message: string;
    item?: unknown;
}

export type OnWarning = (w: Warning) => void;

export type AdapterErrorCode = 'http' | 'parse' | 'schema' | 'policy-denied' | 'no-manifest' | 'cursor' | 'origin' | 'unsafe-url' | 'recipe-no-match' | 'unsupported';

/** What went wrong, as a code a caller can switch on. */
export class AdapterError extends Error {
    constructor(public code: AdapterErrorCode, message: string, public status?: number, public retryAfter?: number) {
        super(message);
        this.name = 'AdapterError';
    }
}

export const MAX_ITEMS = 100;
export const DEFAULT_ASPECT = 1.5;

export function defaultFetch(): FetchLike {
    return (input, init) => globalThis.fetch(input, init);
}

/** Cursors are opaque to the wall; adapters that need structure put JSON in base64url. */
export function encodeCursor(value: unknown): string {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string): T {
    try {
        const bin = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
        throw new AdapterError('cursor', 'unreadable cursor');
    }
}

export function parseHtml(text: string): Document {
    return new DOMParser().parseFromString(text, 'text/html');
}

export function parseXml(text: string): Document {
    return new DOMParser().parseFromString(text, 'text/xml');
}

export function resolveUrl(value: string, base: string | undefined): string {
    if (!base) return value;
    try {
        return new URL(value, base).href;
    } catch {
        return value;
    }
}

/**
 * A declared view as the adapters hand it on: only an object counts, and a panorama stays only
 * as an absolute http(s) URL (a relative one is resolved against `base` first).
 */
export function cleanView(raw: unknown, base?: string): ViewConfig | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const view = raw as ViewConfig;
    const env = view.theme?.environment;
    if (!env || typeof env !== 'object' || !('panorama' in env)) return view;
    let panorama: string | undefined;
    if (typeof env.panorama === 'string') {
        try {
            const u = new URL(env.panorama, base);
            if (u.protocol === 'http:' || u.protocol === 'https:') panorama = u.href;
        } catch {
            // not a URL: dropped
        }
    }
    const { panorama: _dropped, ...rest } = env;
    return { ...view, theme: { ...view.theme, environment: { ...rest, ...(panorama ? { panorama } : {}) } } };
}

const URL_FIELDS = ['link', 'image', 'image_focus', 'image_full', 'video'] as const;

/**
 * True for an http(s) URL, or for a relative reference (one that has no scheme). Everything else
 * (javascript:, data:, file:, blob:, ...) is false: the scene sets `location.href = item.link` and
 * fetches media, so a scheme must not come through from a feed or a page.
 */
export function isWebUrl(value: string): boolean {
    try {
        const u = new URL(value);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return !/^[a-z][a-z0-9+.-]*:/i.test(value.replace(/[\u0000-\u0020]/g, ''));
    }
}

/** True when `url` resolves, against `base`, to the origin of `base`. Without a base only a relative URL qualifies. */
export function isSameOrigin(url: string, base: string | undefined): boolean {
    if (!isWebUrl(url)) return false;
    if (!base) return !/^[a-z][a-z0-9+.-]*:/i.test(url);
    try {
        return new URL(url, base).origin === new URL(base).origin;
    } catch {
        return false;
    }
}

export const EXCERPT_MAX = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?)?$/;
const HEX_COLOUR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Keeps `excerpt` (cut to 500 characters), `date` and `accent` only when they have the spec's shape. */
function cleanTextFields(item: Record<string, unknown>): void {
    if (typeof item.excerpt === 'string') {
        const text = item.excerpt.trim();
        if (!text) delete item.excerpt;
        else item.excerpt = text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX - 1).trimEnd() + '…' : text;
    } else delete item.excerpt;
    if (typeof item.date !== 'string' || !ISO_DATE.test(item.date)) delete item.date;
    if (typeof item.accent !== 'string' || !HEX_COLOUR.test(item.accent)) delete item.accent;
}

export type VideoKind = 'file' | 'hls' | 'dash';
const VIDEO_KINDS: readonly string[] = ['file', 'hls', 'dash'];
export const MAX_VIDEO_SOURCES = 8;

/** `hls` for a path ending .m3u8, `dash` for .mpd, else `file`. */
export function videoKindOf(url: string): VideoKind {
    let path = url;
    try {
        path = new URL(url, 'http://x.invalid/').pathname;
    } catch {
        // not parseable: judged as written
    }
    path = path.toLowerCase();
    return path.endsWith('.m3u8') ? 'hls' : path.endsWith('.mpd') ? 'dash' : 'file';
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;
const VIMEO_HASH = /^[A-Za-z0-9]{1,32}$/;
const YT_WATCH_HOSTS = ['youtube.com', 'www.youtube.com'];
const YT_NOCOOKIE_HOSTS = ['youtube-nocookie.com', 'www.youtube-nocookie.com'];
const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com'];

export interface HostedVideo {
    provider: 'YouTube' | 'Vimeo';
    embed: string;
    /** YouTube only: the thumbnail YouTube serves for every video. */
    poster?: string;
}

/** Path segments, without the leading and one trailing slash; an empty segment elsewhere stays and fails the match. */
function pathParts(pathname: string): string[] {
    const parts = pathname.split('/').slice(1);
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return parts;
}

const youtube = (id: string): HostedVideo => ({
    provider: 'YouTube',
    embed: `https://www.youtube-nocookie.com/embed/${id}`,
    poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
});
const vimeo = (id: string, hash?: string | null): HostedVideo => ({
    provider: 'Vimeo',
    embed: `https://player.vimeo.com/video/${id}${hash && VIMEO_HASH.test(hash) ? `?h=${hash}` : ''}`,
});

/**
 * Recognises the YouTube and Vimeo URL forms of the spec (3.4.1). The host must be one of the listed ones, exactly:
 * `youtube.com.evil.example` and `evilyoutube.com` are not YouTube. Anything else gives null.
 */
export function hostedVideo(url: string): HostedVideo | null {
    url = url.trim();
    if (url.includes('\\')) return null;
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname;
    const parts = pathParts(u.pathname);
    // A repeated v or h is ambiguous (servers differ on which one wins), so the URL is not recognised.
    if (u.searchParams.getAll('v').length > 1 || u.searchParams.getAll('h').length > 1) return null;
    if (host === 'youtu.be') return parts.length === 1 && YT_ID.test(parts[0]) ? youtube(parts[0]) : null;
    if (YT_WATCH_HOSTS.includes(host) || host === 'm.youtube.com') {
        const v = u.searchParams.get('v');
        if (parts.length === 1 && parts[0] === 'watch' && v && YT_ID.test(v)) return youtube(v);
        if (host !== 'm.youtube.com' && parts.length === 2 && (parts[0] === 'shorts' || parts[0] === 'embed') && YT_ID.test(parts[1])) return youtube(parts[1]);
        return null;
    }
    if (YT_NOCOOKIE_HOSTS.includes(host)) return parts.length === 2 && parts[0] === 'embed' && YT_ID.test(parts[1]) ? youtube(parts[1]) : null;
    if (VIMEO_HOSTS.includes(host)) {
        if (parts.length >= 1 && parts.length <= 2 && VIMEO_ID.test(parts[0]) && (parts.length === 1 || VIMEO_HASH.test(parts[1]))) return vimeo(parts[0], parts[1]);
        return null;
    }
    if (host === 'player.vimeo.com') return parts.length === 2 && parts[0] === 'video' && VIMEO_ID.test(parts[1]) ? vimeo(parts[1], u.searchParams.get('h')) : null;
    return null;
}

/** The canonical embed URL of `unplayable.embed` when it is on the allowlist (https only), else undefined. */
export function allowedEmbed(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    if (text.includes('\\')) return undefined;
    let u: URL;
    try {
        u = new URL(text);
    } catch {
        return undefined;
    }
    if (u.protocol !== 'https:' || u.searchParams.getAll('h').length > 1) return undefined;
    const parts = pathParts(u.pathname);
    if ((u.hostname === 'www.youtube-nocookie.com' || u.hostname === 'www.youtube.com') && parts.length === 2 && parts[0] === 'embed' && YT_ID.test(parts[1])) return youtube(parts[1]).embed;
    if (u.hostname === 'player.vimeo.com' && parts.length === 2 && parts[0] === 'video' && VIMEO_ID.test(parts[1])) return vimeo(parts[1], u.searchParams.get('h')).embed;
    return undefined;
}

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Keeps at most 8 well-formed renditions with a web `src` (resolved against `base`); returns undefined when none is left. */
function cleanVideoSources(value: unknown, base: string | undefined, id: string, warn?: OnWarning): Record<string, unknown>[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: Record<string, unknown>[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const e = raw as Record<string, unknown>;
        const src = typeof e.src === 'string' && e.src ? resolveUrl(e.src, base) : '';
        if (!src || !isWebUrl(src)) {
            if (src) warn?.({ code: 'unsafe-url', message: `a video source of item ${id} is not an http(s) URL`, item: raw });
            continue;
        }
        out.push({
            src,
            ...(typeof e.type === 'string' && VIDEO_KINDS.includes(e.type) ? { type: e.type } : {}),
            ...(positiveInt(e.height) ? { height: e.height } : {}),
            ...(typeof e.codecs === 'string' && e.codecs ? { codecs: e.codecs } : {}),
            ...(positiveInt(e.bitrate) ? { bitrate: e.bitrate } : {}),
        });
        if (out.length >= MAX_VIDEO_SOURCES) break;
    }
    return out.length ? out : undefined;
}

/**
 * Checks the core fields and resolves the URL fields against `base`. Returns null for an item
 * that cannot be shown: a core field missing (id, link, and image with aspect, or a title for a text card), or a `link` or `image` that is not http(s). An optional
 * media URL with another scheme is removed. Unknown fields pass through. An item that brings only
 * `image` gets smaller copies when the site's `resize` rules or a known image host can make them.
 */
export function normalizeItem(raw: unknown, base?: string, warn?: OnWarning, resize?: Resizer): Item | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = { ...(raw as Record<string, unknown>) };
    const id = typeof r.id === 'number' ? String(r.id) : r.id;
    if (typeof id !== 'string' || !id) return null;
    if (typeof r.link !== 'string' || !r.link) return null;
    hostedVideoRule(r, base);
    const validAspect = typeof r.aspect === 'number' && Number.isFinite(r.aspect) && r.aspect > 0;
    const hasImage = typeof r.image === 'string' && r.image !== '';
    // An image needs its aspect. Without an image the item is a text card and needs a title.
    if (hasImage ? !validAspect : (r.image !== undefined && r.image !== null && r.image !== '') || typeof r.title !== 'string' || !r.title.trim()) return null;
    const item: Record<string, unknown> = { ...r, id };
    if (!hasImage) {
        delete item.image;
        if (!validAspect) delete item.aspect;
    }
    cleanTextFields(item);
    for (const k of URL_FIELDS) {
        const v = item[k];
        if (!hasImage && k === 'image') continue;
        if (typeof v === 'string' && v) {
            const abs = resolveUrl(v, base);
            if (isWebUrl(abs)) {
                item[k] = abs;
                continue;
            }
            warn?.({ code: 'unsafe-url', message: `${k} of item ${id} is not an http(s) URL`, item: raw });
            if (k === 'link' || k === 'image') return null;
        } else if (k === 'link' || k === 'image') return null;
        delete item[k];
    }
    if (hasImage && !item.image_focus && !item.image_full) {
        const width = Number(r.width);
        const sized = sizesFor(item.image as string, resize, Number.isFinite(width) && width > 0 ? { width } : undefined);
        if (sized) {
            const original = item.image as string;
            for (const k of ['image', 'image_focus', 'image_full'] as const) {
                const v = sized[k] && resolveUrl(sized[k]!, original);
                if (v && /^https?:/i.test(v)) item[k] = v;
            }
            if (!item.image_full && item.image !== original) item.image_full = original;
        }
    }
    cleanVideoFields(item, base, id, warn);
    return item as unknown as Item;
}

/**
 * A YouTube or Vimeo URL in `video` (or in `link`, when the item has neither `video` nor `media_type`) becomes
 * an embed: `video` goes, `media_type` is video and `unplayable` names the provider and the canonical embed.
 * A YouTube item without an image gets YouTube's thumbnail, so it stays a picture card.
 */
function hostedVideoRule(r: Record<string, unknown>, base: string | undefined): void {
    const fromVideo = typeof r.video === 'string' && r.video !== '';
    const fromLink = !fromVideo && (r.video === undefined || r.video === null || r.video === '') && (r.media_type === undefined || r.media_type === null) && typeof r.link === 'string';
    if (!fromVideo && !fromLink) return;
    const rawUrl = (fromVideo ? r.video : r.link) as string;
    const hosted = rawUrl.includes('\\') ? null : hostedVideo(resolveUrl(rawUrl, base));
    if (!hosted) return;
    delete r.video;
    r.media_type = 'video';
    const prior = r.unplayable && typeof r.unplayable === 'object' && !Array.isArray(r.unplayable) ? (r.unplayable as Record<string, unknown>) : {};
    r.unplayable = { ...prior, provider: hosted.provider, embed: hosted.embed };
    if (hosted.poster && (r.image === undefined || r.image === null || r.image === '')) {
        r.image = hosted.poster;
        r.aspect = 16 / 9;
    }
}

/** video_sources, video, video_type, media_type, duration and unplayable.embed, after the URL fields are checked. */
function cleanVideoFields(item: Record<string, unknown>, base: string | undefined, id: string, warn?: OnWarning): void {
    const sources = cleanVideoSources(item.video_sources, base, id, warn);
    let fromSource: unknown;
    if (sources) {
        item.video_sources = sources;
        if (!item.video) {
            item.video = sources[0].src;
            fromSource = sources[0].type;
        }
    } else delete item.video_sources;
    if (typeof item.video === 'string' && item.video) {
        if (typeof item.video_type !== 'string' || !VIDEO_KINDS.includes(item.video_type)) {
            item.video_type = typeof fromSource === 'string' && VIDEO_KINDS.includes(fromSource) ? fromSource : videoKindOf(item.video);
        }
    } else delete item.video_type;
    if (item.media_type !== undefined && item.media_type !== null && item.media_type !== 'photo' && item.media_type !== 'gif' && item.media_type !== 'video') delete item.media_type;
    if (typeof item.video === 'string' && item.video && (item.media_type === undefined || item.media_type === null)) item.media_type = 'video';
    if (typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration < 0) delete item.duration;
    const un = item.unplayable;
    if (un !== undefined) {
        const u = un as Record<string, unknown> | null;
        if (!u || typeof u !== 'object' || Array.isArray(u) || typeof u.provider !== 'string' || !u.provider) delete item.unplayable;
        else {
            const ok = allowedEmbed(u.embed);
            item.unplayable = { provider: u.provider, ...(ok ? { embed: ok } : {}) };
        }
    }
}

/** Normalizes a list, drops the invalid ones with a warning, caps at MAX_ITEMS. */
export function normalizeList(raws: unknown[], base: string | undefined, warn?: OnWarning, resize?: Resizer): Item[] {
    const out: Item[] = [];
    const seen = new Set<string>();
    for (const raw of raws) {
        const item = normalizeItem(raw, base, warn, resize);
        if (!item) {
            warn?.({ code: 'invalid-item', message: 'item is missing a core field (id, link, and image with aspect, or a title)', item: raw });
            continue;
        }
        if (seen.has(item.id)) {
            warn?.({ code: 'dropped-duplicate', message: `duplicate id ${item.id}`, item: raw });
            continue;
        }
        seen.add(item.id);
        if (out.length >= MAX_ITEMS) {
            warn?.({ code: 'too-many-items', message: `page has more than ${MAX_ITEMS} items; the rest are dropped` });
            break;
        }
        out.push(item);
    }
    return out;
}

export function expandTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m));
}

/** Retry-After of a 429 or 503, in seconds (a number, or an HTTP date); undefined when absent or unreadable. */
function retryAfterSeconds(res: Response): number | undefined {
    if (res.status !== 429 && res.status !== 503) return undefined;
    const v = res.headers?.get('Retry-After');
    if (!v) return undefined;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : Math.max(0, (t - Date.now()) / 1000);
}

export async function getText(fetchFn: FetchLike, url: string, init?: RequestInit): Promise<string> {
    let res: Response;
    try {
        res = await fetchFn(url, init);
    } catch (e) {
        throw new AdapterError('http', `${url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new AdapterError('http', `${url}: HTTP ${res.status}`, res.status, retryAfterSeconds(res));
    return res.text();
}

export async function getJson(fetchFn: FetchLike, url: string, init?: RequestInit): Promise<unknown> {
    const text = await getText(fetchFn, url, init);
    try {
        return JSON.parse(text);
    } catch {
        throw new AdapterError('parse', `${url}: not JSON`);
    }
}

export function pageBase(explicit?: string): string | undefined {
    if (explicit) return explicit;
    return typeof location !== 'undefined' ? location.href : undefined;
}
