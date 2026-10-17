import type { Capabilities, FeedAdapter, FeedRequest, Item } from '@diazoma/wall';
import { AdapterError, DEFAULT_ASPECT, decodeCursor, defaultFetch, encodeCursor, getText, normalizeList, parseHtml, parseXml, resolveUrl, type FetchLike, type OnWarning } from './common.js';
import { resolveMedia } from './JsonFeedAdapter.js';
import type { Resizer } from './sizes.js';

export interface RssOptions {
    url: string;
    id?: string;
    fetch?: FetchLike;
    onWarning?: OnWarning;
    /**
     * Smaller versions of a feed's image, when the publisher serves them by URL (a resize parameter or
     * a size folder). Feeds usually link only the original, which can be megabytes per card. Given the
     * absolute image URL, return the wall's thumbnail (`image`, ~512 px), the focused size
     * (`image_focus`, ~1024 px) and what the viewer opens (`image_full`, the feed's URL when not
     * returned). Without it, or when it returns nothing, the known image hosts are tried.
     */
    sizes?: Resizer;
}

/**
 * RSS 2.0 and Atom. An entry with an image becomes an image card; one without becomes a text card (title,
 * description as `excerpt`, date). The image comes from an image enclosure, `media:content` or `media:thumbnail`,
 * or the first `<img>` in the description. A feed has one page unless it links its next page with
 * `<atom:link rel="next">`.
 */
export class RssAdapter implements FeedAdapter {
    readonly id: string;
    private fetchFn: FetchLike;

    constructor(private opts: RssOptions) {
        this.fetchFn = opts.fetch ?? defaultFetch();
        this.id = opts.id ?? safeHost(opts.url);
    }

    capabilities(): Capabilities {
        return { search: false, filters: [], actions: [] };
    }

    async page(req: FeedRequest): Promise<{ items: Item[]; next?: string }> {
        const url = req.cursor ? String(decodeCursor<{ u?: string }>(req.cursor).u ?? '') : this.opts.url;
        if (!url) throw new AdapterError('cursor', 'cursor does not belong to this adapter');
        if (!/^https?:/i.test(url)) throw new AdapterError('unsafe-url', 'only http(s) feeds are read');
        const doc = parseXml(await getText(this.fetchFn, url));
        const entries = Array.from(doc.querySelectorAll('item, entry'));
        if (!entries.length && !doc.querySelector('rss, feed, rdf')) throw new AdapterError('parse', `${url}: not an RSS or Atom feed`);
        const raws = entries.map((e) => this.entry(e, url));
        const next = nextLink(doc, url);
        return { items: normalizeList(raws.filter((r) => r !== null), url, this.opts.onWarning, this.opts.sizes), ...(next ? { next: encodeCursor({ u: next }) } : {}) };
    }

    async resolveMedia(item: Item, want: 'thumb' | 'focus' | 'full' | 'video'): Promise<string | undefined> {
        return resolveMedia(item, want);
    }

    private entry(e: Element, base: string): Record<string, unknown> | null {
        const link = linkOf(e);
        const id = text(e, 'guid') || text(e, 'id') || link;
        const description = text(e, 'content:encoded') || text(e, 'description') || text(e, 'summary') || text(e, 'content');
        const found = mediaOf(e) ?? imgIn(description);
        const title = text(e, 'title');
        const creator = text(e, 'dc:creator') || text(e, 'author name') || text(e, 'author');
        const published = text(e, 'pubDate') || text(e, 'published') || text(e, 'dc:date') || text(e, 'updated');
        if (!found) {
            // An entry without a picture is a text card: the title, the plain text of the description and the date.
            if (!title) {
                this.opts.onWarning?.({ code: 'no-image', message: `entry ${id || '(no id)'} has no image and no title and is skipped` });
                return null;
            }
            const excerpt = plainText(description);
            const date = isoDate(published);
            return {
                id,
                link: link && resolveUrl(link, base),
                title,
                ...(creator ? { subtitle: creator } : {}),
                ...(excerpt && excerpt !== title ? { excerpt } : {}),
                ...(date ? { date } : {}),
            };
        }
        let aspect = found.w && found.h ? found.w / found.h : 0;
        if (!aspect) {
            aspect = DEFAULT_ASPECT;
            this.opts.onWarning?.({ code: 'aspect-default', message: `entry ${id} has no image size; aspect ${DEFAULT_ASPECT} is a default` });
        }
        const subtitle = creator || text(e, 'pubDate') || text(e, 'updated');
        return {
            id,
            link: link && resolveUrl(link, base),
            image: resolveUrl(found.url, base),
            aspect,
            ...(title ? { title } : {}),
            ...(subtitle ? { subtitle } : {}),
            ...videoOf(e, base),
        };
    }
}

interface Rendition {
    src: string;
    type?: 'hls' | 'dash';
    height?: number;
    bitrate?: number;
}

/**
 * The video of an entry: an enclosure or `media:content` (also inside `media:group`) of type `video/*` or medium `video`.
 * The first one is `video`; two or more give `video_sources` (with `height`, and `bitrate` from kbit/s).
 * The duration is `media:content@duration`, else `itunes:duration`.
 */
function videoOf(e: Element, base: string): Record<string, unknown> {
    const found: Rendition[] = [];
    const add = (r: Rendition) => {
        if (!found.some((f) => f.src === r.src)) found.push(r);
    };
    let duration: number | undefined;
    const enc = Array.from(e.getElementsByTagName('enclosure')).find((x) => isVideoType(x.getAttribute('type') || '') && x.getAttribute('url'));
    if (enc) add({ src: resolveUrl(enc.getAttribute('url')!, base), ...mimeKind(enc.getAttribute('type') || '') });
    for (const m of Array.from(e.getElementsByTagName('media:content'))) {
        const url = m.getAttribute('url');
        const type = m.getAttribute('type') || '';
        if (!url || !(isVideoType(type) || m.getAttribute('medium') === 'video')) continue;
        const height = Number(m.getAttribute('height'));
        const kbps = Number(m.getAttribute('bitrate'));
        add({ src: resolveUrl(url, base), ...mimeKind(type), ...(height > 0 ? { height: Math.round(height) } : {}), ...(kbps > 0 ? { bitrate: Math.round(kbps * 1000) } : {}) });
        duration ??= clock(m.getAttribute('duration'));
    }
    if (!found.length) return {};
    duration ??= clock(text(e, 'itunes:duration'));
    return {
        video: found[0].src,
        ...(found[0].type ? { video_type: found[0].type } : {}),
        ...(found.length > 1 ? { video_sources: found } : {}),
        ...(duration !== undefined ? { duration } : {}),
    };
}

const HLS_MIME = /^application\/(vnd\.apple\.mpegurl|x-mpegurl)$/i;
const DASH_MIME = /^application\/dash\+xml$/i;
const isVideoType = (t: string) => t.startsWith('video/') || HLS_MIME.test(t.trim()) || DASH_MIME.test(t.trim());
const mimeKind = (t: string): { type?: 'hls' | 'dash' } => (HLS_MIME.test(t.trim()) ? { type: 'hls' } : DASH_MIME.test(t.trim()) ? { type: 'dash' } : {});

/** Seconds from "90", "1:30" or "1:02:03"; undefined for anything else. */
function clock(value: string | null | undefined): number | undefined {
    if (!value || !/^\d+(\.\d+)?(:\d+(\.\d+)?){0,2}$/.test(value.trim())) return undefined;
    return value.trim().split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** The text of an HTML fragment, with tags removed and white space collapsed. */
function plainText(html: string): string {
    if (!html) return '';
    return (parseHtml('<html><body>' + html + '</body></html>').body?.textContent || '').replace(/\s+/g, ' ').trim();
}

/** An RFC 822 or ISO 8601 date as ISO 8601, or '' when it does not parse. */
function isoDate(value: string): string {
    if (!value) return '';
    const t = Date.parse(value);
    return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

function text(e: Element, tag: string): string {
    // `author name` is an Atom path; the rest are single tags. A direct-child match avoids nested entries' tags.
    const el = tag.includes(' ') ? e.querySelector(tag) : (Array.from(e.getElementsByTagName(tag))[0] ?? null);
    return (el?.textContent || '').trim();
}

function linkOf(e: Element): string {
    const links = Array.from(e.getElementsByTagName('link'));
    const alt = links.find((l) => l.getAttribute('href') && (!l.getAttribute('rel') || l.getAttribute('rel') === 'alternate')) ?? links.find((l) => l.getAttribute('href'));
    return alt?.getAttribute('href') || links.find((l) => !l.getAttribute('href'))?.textContent?.trim() || '';
}

function mediaOf(e: Element): { url: string; w?: number; h?: number } | null {
    const enc = Array.from(e.getElementsByTagName('enclosure')).find((x) => (x.getAttribute('type') || '').startsWith('image'));
    if (enc?.getAttribute('url')) return { url: enc.getAttribute('url')! };
    for (const tag of ['media:content', 'media:thumbnail']) {
        for (const m of Array.from(e.getElementsByTagName(tag))) {
            const type = m.getAttribute('type') || '';
            const medium = m.getAttribute('medium') || '';
            const url = m.getAttribute('url');
            if (!url || (tag === 'media:content' && (type || medium) && !type.startsWith('image') && medium !== 'image')) continue;
            const w = Number(m.getAttribute('width'));
            const h = Number(m.getAttribute('height'));
            return { url, ...(w > 0 && h > 0 ? { w, h } : {}) };
        }
    }
    return null;
}

function imgIn(html: string): { url: string; w?: number; h?: number } | null {
    if (!html) return null;
    const img = parseHtml(html).querySelector('img[src]');
    if (!img) return null;
    const w = Number(img.getAttribute('width'));
    const h = Number(img.getAttribute('height'));
    return { url: img.getAttribute('src')!, ...(w > 0 && h > 0 ? { w, h } : {}) };
}

function nextLink(doc: Document, base: string): string | undefined {
    for (const l of [...Array.from(doc.getElementsByTagName('link')), ...Array.from(doc.getElementsByTagName('atom:link'))] as Element[]) {
        if (l.getAttribute('rel') === 'next' && l.getAttribute('href')) {
            // Only feed-level links: those directly under channel or feed.
            const p = l.parentNode as Element | null;
            if (p && /^(channel|feed|rss)$/i.test(p.nodeName)) return resolveUrl(l.getAttribute('href')!, base);
        }
    }
    return undefined;
}

function safeHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return 'rss';
    }
}
