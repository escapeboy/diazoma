import type { ActionId, ActionResult, Capabilities, FeedAdapter, FeedRequest, Item, ViewConfig } from '@diazoma/wall';
import { AdapterError, DEFAULT_ASPECT, cleanView, decodeCursor, defaultFetch, encodeCursor, getText, isSameOrigin, isWebUrl, normalizeItem, parseHtml, resolveUrl, type FetchLike, type OnWarning } from './common.js';
import { resolveMedia } from './JsonFeedAdapter.js';
import { largestSrcset, srcsetSizes } from './sizes.js';

export type DomMode = 'auto' | 'annotated' | 'jsonld' | 'heuristic';

export interface DomAdapterOptions {
    /** The document (or element) that holds the first page; defaults to the page's `document`. */
    root?: Document | Element;
    mode?: DomMode;
    id?: string;
    /** Base for relative URLs of `root`; defaults to `root.baseURI` or the page location. */
    baseUrl?: string;
    fetch?: FetchLike;
    onWarning?: OnWarning;
    /** How long infinite scroll waits for new items. */
    scrollWaitMs?: number;
}

interface Found {
    items: Item[];
    next?: string;
}

interface ActionDef {
    url: string;
    method: string;
}

const MIN_CLUSTER = 6;

/**
 * Reads items out of a page. Order in `auto`: `[data-wall-item]`, then JSON-LD, then clusters of
 * similar siblings that hold an image and a link. It runs in the page and never renders.
 * Next pages come from `data-wall-next`, `<link rel="next">`, or infinite scroll.
 */
export class DomAdapter implements FeedAdapter {
    readonly id: string;
    private fetchFn: FetchLike;
    private seen = new Set<string>();
    private actions = new Map<string, Map<string, ActionDef>>();
    private actionIds = new Set<string>();
    private scrolling = false;
    private viewRead = false;
    private declared?: ViewConfig;

    constructor(private opts: DomAdapterOptions = {}) {
        this.fetchFn = opts.fetch ?? defaultFetch();
        this.id = opts.id ?? (typeof location !== 'undefined' && location.hostname ? location.hostname : 'dom');
    }

    /** From the first `<script type="application/json" data-wall-view>` of the document; read on first use. */
    get view(): ViewConfig | undefined {
        if (!this.viewRead) {
            this.viewRead = true;
            const root = this.opts.root ?? (typeof document !== 'undefined' ? document : undefined);
            const text = root?.querySelector('script[type="application/json"][data-wall-view]')?.textContent;
            if (text !== undefined && text !== null) {
                try {
                    this.declared = cleanView(JSON.parse(text));
                } catch {
                    // reported below
                }
                if (!this.declared) this.opts.onWarning?.({ code: 'invalid-view', message: 'data-wall-view is not a JSON object and is ignored' });
            }
        }
        return this.declared;
    }

    capabilities(): Capabilities {
        return { search: false, filters: [], actions: [...this.actionIds] };
    }

    async page(req: FeedRequest): Promise<{ items: Item[]; next?: string }> {
        if (!req.cursor) {
            const root = this.opts.root ?? document;
            const base = this.opts.baseUrl ?? (root as Document).baseURI ?? (typeof location !== 'undefined' ? location.href : undefined);
            const found = this.read(root, base);
            if (found.next) return found;
            // Nothing to follow: in a live page keep the door open for infinite scroll.
            return { items: found.items, ...(this.canScroll(root) && found.items.length ? { next: encodeCursor({ p: 1 }) } : {}) };
        }
        const cursor = decodeCursor<{ u?: string; p?: number }>(req.cursor);
        if (typeof cursor.u === 'string') {
            const base = this.opts.baseUrl ?? (typeof location !== 'undefined' ? location.href : undefined);
            const target = new URL(cursor.u, base);
            if (!isSameOrigin(target.href, base)) {
                throw new AdapterError('origin', `${target.href} is not on the origin of the page`);
            }
            const doc = parseHtml(await getText(this.fetchFn, target.href));
            return this.read(doc, target.href);
        }
        if (typeof cursor.p === 'number') {
            const items = await this.scrollForMore(this.opts.root ?? document);
            return { items, ...(items.length ? { next: encodeCursor({ p: cursor.p + 1 }) } : {}) };
        }
        throw new AdapterError('cursor', 'cursor does not belong to this adapter');
    }

    async action(id: ActionId, item: Item): Promise<ActionResult> {
        const def = this.actions.get(item.id)?.get(id);
        if (!def) return { ok: false, reason: 'error', message: `no action ${id} on item ${item.id}` };
        try {
            const res = await this.fetchFn(def.url, { method: def.method, credentials: 'include' });
            if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth' };
            if (!res.ok) return { ok: false, reason: 'error', message: `HTTP ${res.status}` };
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: 'error', message: (e as Error).message };
        }
    }

    async resolveMedia(item: Item, want: 'thumb' | 'focus' | 'full' | 'video'): Promise<string | undefined> {
        return resolveMedia(item, want);
    }

    // ---- reading ----

    private read(root: Document | Element, base: string | undefined): Found {
        const mode = this.opts.mode ?? 'auto';
        let raw: Item[] = [];
        if (mode === 'auto' || mode === 'annotated') raw = this.readAnnotated(root, base);
        if (!raw.length && (mode === 'auto' || mode === 'jsonld')) raw = this.readJsonLd(root, base);
        if (!raw.length && (mode === 'auto' || mode === 'heuristic')) raw = this.readHeuristic(root, base);
        // Same gate as every other adapter: no javascript:, data: or other non-http(s) link or image.
        const safe = raw.map((i) => normalizeItem(i, base, this.opts.onWarning)).filter((i): i is Item => i !== null);
        const items = safe.filter((i) => {
            if (this.seen.has(i.id)) return false;
            this.seen.add(i.id);
            return true;
        });
        const next = this.findNext(root, base);
        return { items, ...(next ? { next: encodeCursor({ u: next }) } : {}) };
    }

    private findNext(root: Document | Element, base: string | undefined): string | undefined {
        const sel = root.querySelector('[data-wall-next]')?.getAttribute('data-wall-next');
        if (sel) {
            let target: Element | null = null;
            try {
                target = root.querySelector(sel);
            } catch {
                // a selector the browser rejects is treated as absent
            }
            const href = target?.getAttribute('href');
            if (href) return resolveUrl(href, base);
        }
        const link = root.querySelector('link[rel~="next"]')?.getAttribute('href');
        return link ? resolveUrl(link, base) : undefined;
    }

    private readAnnotated(root: Document | Element, base: string | undefined): Item[] {
        const out: Item[] = [];
        for (const el of Array.from(root.querySelectorAll('[data-wall-item]'))) {
            const item = this.annotatedItem(el, base);
            if (item) out.push(item);
        }
        return out;
    }

    private annotatedItem(el: Element, base: string | undefined): Item | null {
        const imgEl = el.querySelector('[data-wall-image]') ?? el.querySelector('img');
        const image = imgEl && imageUrl(imgEl);
        // Without an image the item is a text card, and needs a data-wall-title.
        const textTitle = image ? undefined : el.querySelector('[data-wall-title]')?.textContent?.trim();
        if (!image && !textTitle) {
            this.opts.onWarning?.({ code: 'no-image', message: 'item without an image is skipped' });
            return null;
        }
        const marked = el.hasAttribute('data-wall-link') ? el : el.querySelector('[data-wall-link]');
        const anchor = el.matches('a[href]') ? el : el.querySelector('a[href]');
        const link = marked?.getAttribute('data-wall-link') || marked?.getAttribute('href') || anchor?.getAttribute('href');
        if (!link) {
            this.opts.onWarning?.({ code: 'no-link', message: 'item without a link is skipped' });
            return null;
        }
        const absLink = resolveUrl(link, base);
        const item: Item = {
            id: el.getAttribute('data-wall-id') || absLink,
            link: absLink,
            ...(image ? { image: resolveUrl(image, base), aspect: this.aspectOf(el, imgEl) } : {}),
        };
        const excerpt = el.querySelector('[data-wall-excerpt]')?.textContent?.replace(/\s+/g, ' ').trim();
        if (excerpt) item.excerpt = excerpt;
        const date = el.getAttribute('data-wall-date');
        if (date) item.date = date;
        const accent = el.getAttribute('data-wall-accent');
        if (accent) item.accent = accent;
        if (!image) {
            item.title = textTitle;
            const sub = el.querySelector('[data-wall-subtitle]')?.textContent?.trim();
            if (sub) item.subtitle = sub;
            const kicker = el.getAttribute('data-wall-badges');
            if (kicker) item.badges = kicker.split(',').map((b) => b.trim()).filter(Boolean);
            this.collectActions(el, item.id, base);
            return item;
        }
        const focus = imgEl!.getAttribute('data-wall-image-focus');
        const full = imgEl!.getAttribute('data-wall-image-full');
        if (focus || full) {
            if (focus) item.image_focus = resolveUrl(focus, base);
            if (full) item.image_full = resolveUrl(full, base);
        } else {
            setSrcsetSizes(item, imgEl!, base);
        }
        this.readVideo(el, item, base);
        const title = el.querySelector('[data-wall-title]')?.textContent?.trim();
        if (title) item.title = title;
        const subtitle = el.querySelector('[data-wall-subtitle]')?.textContent?.trim();
        if (subtitle) item.subtitle = subtitle;
        const badges = el.getAttribute('data-wall-badges');
        if (badges) item.badges = badges.split(',').map((b) => b.trim()).filter(Boolean);
        this.collectActions(el, item.id, base);
        return item;
    }

    /**
     * `data-wall-video`, else a `<video src>` or its first `<source src>` inside the item, else the page's `og:video`
     * (`og:video:secure_url` first) when the page holds a single item. Also `data-wall-video-sources` (a JSON array),
     * `data-wall-video-type` and `data-wall-duration`; the shape is checked by normalizeItem.
     */
    private readVideo(el: Element, item: Item, base: string | undefined): void {
        const rec = item as unknown as Record<string, unknown>;
        let video = el.getAttribute('data-wall-video');
        if (!video) {
            const player = el.querySelector('video');
            video = player?.getAttribute('src') || player?.querySelector('source[src]')?.getAttribute('src') || null;
        }
        if (!video) {
            const doc = el.ownerDocument;
            if (doc && doc.querySelectorAll('[data-wall-item]').length === 1) {
                video = doc.querySelector('meta[property="og:video:secure_url"]')?.getAttribute('content') || doc.querySelector('meta[property="og:video"]')?.getAttribute('content') || null;
            }
        }
        if (video) rec.video = resolveUrl(video, base);
        const sources = el.getAttribute('data-wall-video-sources');
        if (sources) {
            try {
                rec.video_sources = JSON.parse(sources);
            } catch {
                // unreadable JSON is ignored like other broken markup
            }
        }
        const kind = el.getAttribute('data-wall-video-type');
        if (kind) rec.video_type = kind;
        const duration = el.getAttribute('data-wall-duration');
        if (duration && duration.trim() !== '') rec.duration = Number(duration);
    }

    private aspectOf(el: Element, img: Element | null): number {
        const declared = Number(el.getAttribute('data-wall-aspect'));
        if (declared > 0) return declared;
        const natural = img as HTMLImageElement | null;
        if (natural && natural.naturalWidth > 0 && natural.naturalHeight > 0) return natural.naturalWidth / natural.naturalHeight;
        const w = Number(img?.getAttribute('width'));
        const h = Number(img?.getAttribute('height'));
        if (w > 0 && h > 0) return w / h;
        this.opts.onWarning?.({ code: 'aspect-default', message: `no aspect for an item; using ${DEFAULT_ASPECT}` });
        return DEFAULT_ASPECT;
    }

    private collectActions(el: Element, itemId: string, base: string | undefined) {
        for (const a of Array.from(el.querySelectorAll('[data-wall-action]'))) {
            const id = a.getAttribute('data-wall-action');
            const url = a.getAttribute('data-wall-action-url');
            if (!id || !url) continue;
            const abs = resolveUrl(url, base);
            if (!isSameOrigin(abs, base)) {
                this.opts.onWarning?.({ code: 'unsafe-url', message: `action ${id} of item ${itemId} is not on the origin of the page and is ignored` });
                continue;
            }
            const defs = this.actions.get(itemId) ?? new Map<string, ActionDef>();
            const method = (a.getAttribute('data-wall-action-method') || 'POST').toUpperCase();
            if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;
            defs.set(id, { url: abs, method });
            this.actions.set(itemId, defs);
            this.actionIds.add(id);
        }
    }

    private readJsonLd(root: Document | Element, base: string | undefined): Item[] {
        const nodes: Record<string, unknown>[] = [];
        for (const s of Array.from(root.querySelectorAll('script[type="application/ld+json"]'))) {
            try {
                collect(JSON.parse(s.textContent || ''), nodes);
            } catch {
                // broken JSON-LD is ignored like any other unreadable markup
            }
        }
        const out: Item[] = [];
        for (const n of nodes) {
            const types = ([] as unknown[]).concat(n['@type']);
            if (types.includes('ItemList')) {
                for (const el of ([] as unknown[]).concat(n.itemListElement ?? [])) {
                    const inner = (el as Record<string, unknown>)?.item ?? el;
                    const item = this.ldItem(inner as Record<string, unknown>, base);
                    if (item) out.push(item);
                }
            } else if (types.includes('Product') || types.includes('ImageObject')) {
                const item = this.ldItem(n, base);
                if (item) out.push(item);
            }
        }
        return dedupe(out);
    }

    private ldItem(n: Record<string, unknown>, base: string | undefined): Item | null {
        if (!n || typeof n !== 'object') return null;
        const image = firstUrl(n.image) ?? firstUrl(n.contentUrl) ?? firstUrl(n.thumbnailUrl);
        const link = firstUrl(n.url) ?? firstUrl(n['@id']);
        if (!image || !link) return null;
        const w = Number(n.width);
        const h = Number(n.height);
        let aspect = DEFAULT_ASPECT;
        if (w > 0 && h > 0) aspect = w / h;
        else this.opts.onWarning?.({ code: 'aspect-default', message: `no aspect for ${link}; using ${DEFAULT_ASPECT}` });
        const absLink = resolveUrl(link, base);
        const title = typeof n.name === 'string' ? n.name : undefined;
        return { id: typeof n.sku === 'string' && n.sku ? n.sku : absLink, link: absLink, image: resolveUrl(image, base), aspect, ...(title ? { title } : {}) };
    }

    private readHeuristic(root: Document | Element, base: string | undefined): Item[] {
        const groups = new Map<string, Element[]>();
        for (const parent of Array.from(root.querySelectorAll('*'))) {
            const kids = Array.from(parent.children);
            if (kids.length < MIN_CLUSTER) continue;
            const bySig = new Map<string, Element[]>();
            for (const k of kids) {
                if (!k.querySelector('img') || !(k.matches('a[href]') || k.querySelector('a[href]'))) continue;
                const sig = `${k.tagName}.${(k.getAttribute('class') || '').split(/\s+/).filter(Boolean).sort().join('.')}`;
                (bySig.get(sig) ?? bySig.set(sig, []).get(sig)!).push(k);
            }
            for (const [sig, els] of bySig) {
                if (els.length >= MIN_CLUSTER) groups.set(`${groups.size}:${sig}`, els);
            }
        }
        let best: Element[] = [];
        for (const els of groups.values()) if (els.length > best.length) best = els;
        const out: Item[] = [];
        for (const el of best) {
            const img = el.querySelector('img');
            const src = img && imageUrl(img);
            const a = el.matches('a[href]') ? el : el.querySelector('a[href]');
            const href = a?.getAttribute('href');
            if (!src || !href) continue;
            const link = resolveUrl(href, base);
            const title = img!.getAttribute('alt')?.trim() || el.querySelector('h1,h2,h3,h4')?.textContent?.trim();
            const item: Item = { id: link, link, image: resolveUrl(src, base), aspect: this.aspectOf(el, img), ...(title ? { title } : {}) };
            setSrcsetSizes(item, img!, base);
            out.push(item);
        }
        return dedupe(out);
    }

    // ---- infinite scroll ----

    private canScroll(root: Document | Element): boolean {
        const doc = (root as Element).ownerDocument ?? (root as Document);
        return !!doc.defaultView && typeof doc.defaultView.MutationObserver === 'function' && typeof (doc.defaultView as Window).scrollTo === 'function';
    }

    private async scrollForMore(root: Document | Element): Promise<Item[]> {
        if (this.scrolling) return [];
        this.scrolling = true;
        try {
            const doc = (root as Element).ownerDocument ?? (root as Document);
            const win = doc.defaultView;
            if (!win || typeof win.MutationObserver !== 'function') return [];
            const base = this.opts.baseUrl ?? doc.baseURI;
            const fresh = () => this.read(root, base).items;
            const list = root.querySelector('[data-wall-list]') ?? (doc as Document).body ?? (root as Element);
            return await new Promise<Item[]>((resolve) => {
                let done = false;
                const finish = (items: Item[]) => {
                    if (done) return;
                    done = true;
                    mo.disconnect();
                    clearTimeout(timer);
                    resolve(items);
                };
                const mo = new win.MutationObserver(() => {
                    const items = fresh();
                    if (items.length) finish(items);
                });
                mo.observe(list, { childList: true, subtree: true });
                const timer = setTimeout(() => finish([]), this.opts.scrollWaitMs ?? 3000);
                const all = root.querySelectorAll('[data-wall-item]');
                const last = all[all.length - 1] ?? root.querySelector('img');
                (last as HTMLElement | null)?.scrollIntoView?.({ block: 'end' });
            });
        } finally {
            this.scrolling = false;
        }
    }
}

function imageUrl(el: Element): string | null {
    return el.getAttribute('src') || el.getAttribute('data-src') || (largestSrcset(el.getAttribute('srcset')) ?? null);
}

/** A card-sized copy from the image's srcset, with the larger ones for the viewer. */
function setSrcsetSizes(item: Item, img: Element, base: string | undefined): void {
    const sized = srcsetSizes(img.getAttribute('srcset') || img.getAttribute('data-srcset'));
    if (!sized) return;
    for (const k of ['image', 'image_focus', 'image_full'] as const) {
        if (sized[k]) item[k] = resolveUrl(sized[k]!, base);
    }
}

function firstUrl(v: unknown): string | undefined {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return firstUrl(v[0]);
    if (v && typeof v === 'object') return firstUrl((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl);
    return undefined;
}

function collect(json: unknown, out: Record<string, unknown>[]) {
    if (Array.isArray(json)) json.forEach((j) => collect(j, out));
    else if (json && typeof json === 'object') {
        const o = json as Record<string, unknown>;
        out.push(o);
        if (o['@graph']) collect(o['@graph'], out);
    }
}

function dedupe(items: Item[]): Item[] {
    const ids = new Set<string>();
    return items.filter((i) => (ids.has(i.id) ? false : (ids.add(i.id), true)));
}
