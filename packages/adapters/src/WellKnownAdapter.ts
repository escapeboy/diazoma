import type { ActionId, ActionResult, Brand, Capabilities, FeedAdapter, FeedRequest, Item, ViewConfig } from '@diazoma/wall';
import { AdapterError, cleanView, decodeCursor, defaultFetch, encodeCursor, expandTemplate, getJson, getText, isWebUrl, parseHtml, type FetchLike, type OnWarning } from './common.js';
import { JsonFeedAdapter, resolveMedia, type JsonFeedFilter } from './JsonFeedAdapter.js';
import { compileResize, type ResizeRule } from './sizes.js';

export interface Manifest {
    version: number;
    policy?: 'allow' | 'deny' | 'recipes-only';
    name?: string;
    brand?: { accent?: string; logo?: string; bg?: string };
    feeds: { id: string; title?: string; type?: 'feed' | 'search'; url: string; cursor?: boolean }[];
    filters?: { id: string; title?: string; values: string[]; param: string }[];
    media?: { hosts?: string[]; variants?: Record<string, number>; projections?: string[]; resize?: ResizeRule[] };
    actions?: Record<string, ManifestAction>;
    auth?: { login?: string; device_link?: string; csrf?: CsrfContract };
    recipe?: string;
    embed?: { route?: string };
    view?: ViewConfig;
}

/** Where a session action finds its CSRF token in the site's own page, and which header carries it. */
export interface CsrfContract {
    meta?: string;
    cookie?: string;
    header: string;
}

export interface ManifestAction {
    /** `json` (default): a 2xx answer must be a JSON object. `empty`: a 2xx answer with no body is the success. */
    response?: 'json' | 'empty';
    method?: string;
    url: string;
    auth?: 'none' | 'session' | 'bearer';
    toggle?: boolean;
    mode?: 'deeplink';
}

export interface WellKnownOptions {
    origin: string;
    /** Use this manifest URL instead of looking for one. */
    manifestUrl?: string;
    fetch?: FetchLike;
    onWarning?: OnWarning;
    /** The document and origin the CSRF token is read from; default the page's own. */
    document?: Document;
    pageOrigin?: string;
}

const SEARCH = 'search';

/**
 * Loads `/.well-known/wall.json` (or the page's `<link rel="wall-manifest">`) and serves the
 * manifest's feeds. Call `await adapter.ready()` before handing it to the wall, because
 * `capabilities()` is synchronous and comes from the manifest.
 */
export class WellKnownAdapter implements FeedAdapter {
    readonly id: string;
    manifest!: Manifest;
    brand: Brand = {};
    view?: ViewConfig;
    login?: string;
    policy: 'allow' | 'deny' | 'recipes-only' = 'allow';
    private fetchFn: FetchLike;
    private feeds = new Map<string, JsonFeedAdapter>();
    private manifestUrl = '';
    private loading: Promise<this> | null = null;

    constructor(private opts: WellKnownOptions) {
        this.fetchFn = opts.fetch ?? defaultFetch();
        this.id = new URL(opts.origin).host;
    }

    ready(): Promise<this> {
        return (this.loading ??= this.load());
    }

    private async load(): Promise<this> {
        const origin = this.opts.origin;
        let url = this.opts.manifestUrl;
        let body: unknown;
        if (url) {
            if (!/^https?:/i.test(url)) throw new AdapterError('unsafe-url', `${url}: only http(s) manifests are read`);
            body = await getJson(this.fetchFn, url);
        } else {
            url = new URL('/.well-known/wall.json', origin).href;
            try {
                body = await getJson(this.fetchFn, url);
            } catch (e) {
                const linked = await this.linkedManifest(origin);
                if (!linked) throw new AdapterError('no-manifest', `no manifest at ${url} and no <link rel="wall-manifest"> on ${origin}`, (e as AdapterError).status);
                url = linked;
                body = await getJson(this.fetchFn, url);
            }
        }
        const m = body as Manifest;
        if (!/^https?:/i.test(url)) throw new AdapterError('unsafe-url', `${url}: only http(s) manifests are read`);
        if (!m || typeof m !== 'object' || !Array.isArray(m.feeds) || !m.feeds.length) throw new AdapterError('schema', `${url}: manifest has no feeds`);
        if (m.version !== 1) throw new AdapterError('unsupported', `${url}: manifest version ${String(m.version)} is not supported`);
        this.manifest = m;
        this.manifestUrl = url;
        this.policy = m.policy ?? 'allow';
        this.brand = brandOf(m, url);
        this.view = cleanView(m.view, url);
        this.login = loginOf(m, url);
        const filters: JsonFeedFilter[] = (m.filters ?? []).map((f) => ({ key: f.id, param: f.param, values: f.values.map((value) => ({ value, label: value })) }));
        const search = m.feeds.find((f) => f.type === SEARCH);
        const resize = compileResize(m.media?.resize, this.opts.onWarning);
        for (const f of m.feeds) {
            if (f.type === SEARCH) continue;
            this.feeds.set(f.id, new JsonFeedAdapter({ id: this.id, url: new URL(f.url, url).href, search: search && new URL(search.url, url).href, filters, fetch: this.fetchFn, onWarning: this.opts.onWarning, resize }));
        }
        if (search) this.feeds.set(SEARCH, new JsonFeedAdapter({ id: this.id, url: new URL(search.url, url).href, search: new URL(search.url, url).href, filters, fetch: this.fetchFn, onWarning: this.opts.onWarning, resize }));
        return this;
    }

    private async linkedManifest(origin: string): Promise<string | null> {
        try {
            const doc = parseHtml(await getText(this.fetchFn, origin));
            const href = doc.querySelector('link[rel~="wall-manifest"]')?.getAttribute('href');
            return href ? new URL(href, origin).href : null;
        } catch {
            return null;
        }
    }

    capabilities(): Capabilities {
        const m = this.manifest;
        if (!m) return { search: false, filters: [], actions: [] };
        const links = Object.entries(m.actions ?? {}).filter(([, a]) => a.mode === 'deeplink').map(([id]) => id);
        return {
            search: m.feeds.some((f) => f.type === SEARCH),
            filters: (m.filters ?? []).map((f) => ({ key: f.id, values: f.values.map((value) => ({ value, label: value })) })),
            actions: Object.keys(m.actions ?? {}),
            ...(m.media?.projections ? { projections: m.media.projections } : {}),
            ...(links.length ? { links } : {}),
        };
    }

    async page(req: FeedRequest): Promise<{ items: Item[]; next?: string }> {
        await this.ready();
        if (this.policy === 'deny') throw new AdapterError('policy-denied', `${this.opts.origin} publishes policy "deny"`);
        const queried = req.query !== undefined || req.scope?.kind === 'search';
        let feedId: string;
        let inner: string | undefined;
        let query = req.query ?? (req.scope?.kind === 'search' ? (req.scope.q as string | undefined) : undefined);
        if (req.cursor) {
            const c = decodeCursor<{ f?: string; c?: string; q?: string }>(req.cursor);
            if (typeof c.f !== 'string' || typeof c.c !== 'string') throw new AdapterError('cursor', 'cursor does not belong to this adapter');
            feedId = c.f;
            inner = c.c;
            query = c.q ?? query;
        } else if (queried && this.feeds.has(SEARCH)) {
            feedId = SEARCH;
        } else {
            const wanted = req.scope?.feed as string | undefined;
            feedId = wanted && this.feeds.has(wanted) ? wanted : this.manifest.feeds.find((f) => f.type !== SEARCH)!.id;
        }
        const feed = this.feeds.get(feedId);
        if (!feed) throw new AdapterError('cursor', `unknown feed ${feedId}`);
        const page = await feed.page({ ...req, query, cursor: inner });
        return { items: page.items, ...(page.next ? { next: encodeCursor({ f: feedId, c: page.next, ...(query !== undefined ? { q: query } : {}) }) } : {}) };
    }

    async action(id: ActionId, item: Item, args?: Record<string, unknown>): Promise<ActionResult> {
        await this.ready();
        const a = this.manifest.actions?.[id];
        if (!a) return { ok: false, reason: 'error', message: `no action ${id}` };
        const url = new URL(expandTemplate(a.url, { id: encodeURIComponent(item.id) }), this.manifestUrl);
        // A manifest can come from a site the user does not trust with their cookies elsewhere:
        // only http(s), and a call that carries the session goes to the manifest's own origin.
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'error', message: `action ${id}: only http(s) URLs are allowed` };
        if (a.mode === 'deeplink') return { ok: true, state: { deeplink: url.href } };
        const auth = a.auth ?? 'none';
        if (auth === 'bearer') return { ok: false, reason: 'auth', message: 'bearer actions are not supported yet' };
        if (auth === 'session' && url.origin !== new URL(this.manifestUrl).origin) {
            return { ok: false, reason: 'error', message: `action ${id}: a session action must stay on ${new URL(this.manifestUrl).origin}` };
        }
        const method = (a.method ?? 'POST').toUpperCase();
        const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
        const csrf = this.manifest.auth?.csrf;
        if (csrf && !/^[A-Za-z0-9-]{1,64}$/.test(csrf.header)) return { ok: false, reason: 'error', message: 'auth.csrf.header is not a plain header name' };
        if (auth === 'session' && csrf && method !== 'GET' && method !== 'HEAD') {
            const token = this.csrfToken(csrf);
            if (!token) return { ok: false, reason: 'auth', message: `action ${id}: no CSRF token found (${csrf.meta ? 'meta ' + csrf.meta : ''}${csrf.meta && csrf.cookie ? ', ' : ''}${csrf.cookie ? 'cookie ' + csrf.cookie : ''})` };
            headers[csrf.header] = token;
        }
        let body: string | undefined;
        if (args && Object.keys(args).length) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(args);
        }
        let res: Response;
        try {
            // A redirect (usually to a login page) is not a success, so it is not followed.
            res = await this.fetchFn(url.href, { method, credentials: auth === 'session' ? 'include' : 'omit', redirect: 'manual', headers, ...(body !== undefined ? { body } : {}) });
        } catch (e) {
            return { ok: false, reason: 'error', message: (e as Error).message };
        }
        if (res.status === 401 || res.status === 403 || res.status === 419) return { ok: false, reason: 'auth' };
        if (res.type === 'opaqueredirect' || res.redirected || (res.status >= 300 && res.status < 400)) return { ok: false, reason: 'error', message: `action ${id}: redirected, not followed` };
        if (!res.ok) return { ok: false, reason: 'error', message: `HTTP ${res.status}` };
        const text = await res.text().catch(() => '');
        let state: Record<string, unknown> | undefined;
        if (a.response === 'empty') {
            if (text.trim()) return { ok: false, reason: 'error', message: `action ${id}: expected an empty answer` };
        } else {
            let parsed: unknown;
            try {
                parsed = JSON.parse(text);
            } catch {
                return { ok: false, reason: 'error', message: `action ${id}: the answer is not JSON` };
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'error', message: `action ${id}: the answer is not a JSON object` };
            const b = parsed as { ok?: unknown; state?: unknown; message?: unknown };
            if (b.ok === false) return { ok: false, reason: 'error', ...(typeof b.message === 'string' ? { message: b.message } : {}) };
            if (b.state && typeof b.state === 'object') state = b.state as Record<string, unknown>;
        }
        // A toggle that answers without a state flips the item's own flag: the key the view names
        // (`view.actions[id].state`), else `liked` for like and the action id for the rest.
        if (!state && a.toggle) {
            const key = this.view?.actions?.[id]?.state || (id === 'like' ? 'liked' : id);
            state = { [key]: !item.state?.[key] };
        }
        return { ok: true, ...(state ? { state } : {}) };
    }

    /** Reads the token from the document this code runs in, and only when that document is on the manifest's origin. */
    private csrfToken(c: CsrfContract): string | undefined {
        const doc = this.opts.document ?? (typeof document !== 'undefined' ? document : undefined);
        const pageOrigin = this.opts.pageOrigin ?? (typeof location !== 'undefined' ? location.origin : undefined);
        if (!doc || !pageOrigin || pageOrigin !== new URL(this.manifestUrl).origin) return undefined;
        let token: string | undefined;
        if (c.meta) {
            for (const m of Array.from(doc.querySelectorAll('meta'))) if (m.getAttribute('name') === c.meta) token = m.getAttribute('content') ?? undefined;
        }
        if (!token && c.cookie) {
            for (const part of (doc.cookie || '').split(';')) {
                const i = part.indexOf('=');
                if (i > 0 && part.slice(0, i).trim() === c.cookie) {
                    try {
                        token = decodeURIComponent(part.slice(i + 1).trim());
                    } catch {
                        token = part.slice(i + 1).trim();
                    }
                }
            }
        }
        return token && token.length <= 4096 && !/[\r\n]/.test(token) ? token : undefined;
    }

    async resolveMedia(item: Item, want: 'thumb' | 'focus' | 'full' | 'video'): Promise<string | undefined> {
        return resolveMedia(item, want);
    }
}

function brandOf(m: Manifest, manifestUrl: string): Brand {
    const brand: Brand = {};
    if (m.name) brand.name = m.name;
    if (m.brand?.accent) brand.accent = m.brand.accent;
    if (m.brand?.bg) brand.bg = m.brand.bg;
    if (m.brand?.logo) {
        const logo = new URL(m.brand.logo, manifestUrl).href;
        if (isWebUrl(logo)) brand.logo = logo;
    }
    return brand;
}

function loginOf(m: Manifest, manifestUrl: string): string | undefined {
    if (typeof m.auth?.login !== 'string') return undefined;
    try {
        const u = new URL(m.auth.login, manifestUrl);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
    } catch {
        return undefined;
    }
}
