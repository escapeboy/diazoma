import type { Capabilities, FeedAdapter, FeedRequest, Filter, Item } from '@diazoma/wall';
import { AdapterError, expandTemplate, getJson, isWebUrl, normalizeList, pageBase, defaultFetch, type FetchLike, type OnWarning } from './common.js';
import type { Resizer } from './sizes.js';

export interface JsonFeedFilter extends Filter {
    /** Query parameter the value is sent in; defaults to `key`. */
    param?: string;
}

export interface JsonFeedOptions {
    /** Site key for storage and telemetry; defaults to the feed's host. */
    id?: string;
    /** Feed URL, absolute or relative to `base`. */
    url: string;
    /** URL template with `{query}`, for search. */
    search?: string;
    filters?: JsonFeedFilter[];
    /** Base for relative URLs; defaults to the page location. */
    base?: string;
    fetch?: FetchLike;
    onWarning?: OnWarning;
    /** The site's `media.resize` rules (see `compileResize`). */
    resize?: Resizer;
}

/** Reads a feed that follows the spec: `{ items, next }`, `cursor=<next>`, `{query}` URL-encoded, filters as `param=value`. */
export class JsonFeedAdapter implements FeedAdapter {
    readonly id: string;
    private base: string | undefined;
    private fetchFn: FetchLike;

    constructor(private opts: JsonFeedOptions) {
        this.base = pageBase(opts.base);
        this.fetchFn = opts.fetch ?? defaultFetch();
        this.id = opts.id ?? hostOf(opts.url, this.base);
    }

    capabilities(): Capabilities {
        return { search: !!this.opts.search, filters: (this.opts.filters ?? []).map(({ key, values }) => ({ key, values })), actions: [] };
    }

    async page(req: FeedRequest): Promise<{ items: Item[]; next?: string }> {
        const query = req.query ?? (req.scope?.kind === 'search' ? (req.scope.q as string | undefined) : undefined);
        const template = query !== undefined && this.opts.search ? this.opts.search : this.opts.url;
        const url = new URL(expandTemplate(template, query !== undefined ? { query: encodeURIComponent(query) } : {}), this.base);
        for (const [key, value] of Object.entries(req.filter ?? {})) {
            if (value === 'all' || value === '') continue;
            const param = this.opts.filters?.find((f) => f.key === key)?.param ?? key;
            url.searchParams.set(param, value);
        }
        if (req.cursor) url.searchParams.set('cursor', req.cursor);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AdapterError('unsafe-url', `${url.protocol} feeds are not read`);

        const body = await getJson(this.fetchFn, url.href);
        if (!body || typeof body !== 'object' || !Array.isArray((body as { items?: unknown }).items)) {
            throw new AdapterError('schema', `${url.href}: response has no items array`);
        }
        const { items, next } = body as { items: unknown[]; next?: unknown };
        return { items: normalizeList(items, url.href, this.opts.onWarning, this.opts.resize), ...(typeof next === 'string' && next ? { next } : {}) };
    }

    async resolveMedia(item: Item, want: 'thumb' | 'focus' | 'full' | 'video'): Promise<string | undefined> {
        return resolveMedia(item, want);
    }
}

export function resolveMedia(item: Item, want: 'thumb' | 'focus' | 'full' | 'video'): string | undefined {
    if (want === 'video') return item.video;
    if (want === 'full') return item.image_full ?? item.image_focus ?? item.image;
    if (want === 'focus') return item.image_focus ?? item.image;
    return item.image;
}

function hostOf(url: string, base: string | undefined): string {
    try {
        return new URL(url, base).host;
    } catch {
        return 'feed';
    }
}
