import type { ActionId, ActionResult, Capabilities, FeedAdapter, FeedRequest, Item, ViewConfig } from '@diazoma/wall';
import { findAll } from 'json-p3';
import { AdapterError, cleanView, decodeCursor, defaultFetch, encodeCursor, expandTemplate, getJson, getText, normalizeList, parseHtml, resolveUrl, type FetchLike, type OnWarning } from './common.js';
import { resolveMedia } from './JsonFeedAdapter.js';
import { checkRegex, MAX_RE_INPUT } from './regex.js';
import { compileResize, largestSrcset, srcsetSizes, type ResizeRule, type Resizer } from './sizes.js';

export interface DomField {
    sel?: string;
    attr?: string;
    text?: boolean;
    const?: string | number | boolean;
    srcset?: 'largest';
    re?: string;
    group?: number;
}

/** A JSONPath, a template over the item's own values, or (for `aspect`) a width and a height path. */
export type ApiField = string | { template: string } | { w: string; h: string };

export interface Recipe {
    id: string;
    version: number;
    match: string[];
    list?: {
        pages?: string[];
        source?: 'dom';
        item: string;
        fields: Record<string, DomField>;
        next?: { sel: string; attr?: string };
    };
    api?: {
        source?: 'api';
        url: string;
        page?: { start?: number; param?: string; step?: number; next?: string };
        items: string;
        fields: Record<string, ApiField>;
    };
    media?: { needsPrivilegedFetch?: boolean; referer?: string; resize?: ResizeRule[] };
    actions?: Record<string, { method: string; url: string; body?: Record<string, unknown>; auth?: 'none' | 'session' }>;
    search?: { url: string };
    fixtures?: string[];
    license?: string;
    tags?: string[];
    view?: ViewConfig;
}

export interface RecipeOptions {
    recipe: Recipe;
    fetch?: FetchLike;
    /** The page the recipe runs in. Without it the first `match` pattern's origin is fetched. */
    document?: Document;
    /** URL of `document`, or the page to start from; defaults to the page location. */
    url?: string;
    /** Use only this source. */
    source?: 'api' | 'dom';
    onWarning?: OnWarning;
}

/**
 * Runs a recipe: the `api` source when there is one (JSONPath through json-p3, no eval), else the
 * `dom` source (CSS selectors, attributes, text, constants, srcset largest, regex on extracted
 * strings only). It refuses to run for a URL outside the recipe's `match` patterns.
 */
export class RecipeAdapter implements FeedAdapter {
    readonly id: string;
    private fetchFn: FetchLike;
    private pageUrl: string;
    private usedApi: boolean | null = null;
    readonly view?: ViewConfig;
    private resize?: Resizer;
    private warned = new Set<string>();

    constructor(private opts: RecipeOptions) {
        this.fetchFn = opts.fetch ?? defaultFetch();
        this.id = opts.recipe.id;
        this.view = cleanView(opts.recipe.view);
        this.resize = compileResize(opts.recipe.media?.resize, opts.onWarning);
        this.pageUrl = opts.url ?? (typeof location !== 'undefined' ? location.href : this.firstOrigin());
        if (!matchesAny(opts.recipe.match, this.pageUrl)) {
            throw new AdapterError('recipe-no-match', `${this.pageUrl} is outside the match patterns of recipe ${opts.recipe.id}`);
        }
    }

    capabilities(): Capabilities {
        const r = this.opts.recipe;
        return { search: !!r.search, filters: [], actions: Object.keys(r.actions ?? {}) };
    }

    async page(req: FeedRequest): Promise<{ items: Item[]; next?: string }> {
        const { recipe, source } = this.opts;
        const query = req.query ?? (req.scope?.kind === 'search' ? (req.scope.q as string | undefined) : undefined);
        const cursor = req.cursor ? decodeCursor<{ page?: number; u?: string; t?: string }>(req.cursor) : null;

        if (query !== undefined && recipe.search && recipe.list && source !== 'api') {
            const url = this.allowed(expandTemplate(recipe.search.url, { query: encodeURIComponent(query) }), cursor?.u);
            return this.domPage(url, false);
        }
        if (cursor?.u !== undefined) return this.domPage(this.allowed(cursor.u), false);
        if (cursor?.t !== undefined && recipe.api) return this.apiPage(1, query, String(cursor.t));
        if (cursor?.page !== undefined) return this.apiPage(cursor.page, query);

        if (recipe.api && source !== 'dom') {
            try {
                const first = await this.apiPage(recipe.api.page?.step ? 1 : (recipe.api.page?.start ?? 1), query);
                if (first.items.length || !recipe.list || source === 'api') {
                    this.usedApi = true;
                    return first;
                }
            } catch (e) {
                if (!recipe.list || source === 'api') throw e;
            }
        }
        if (!recipe.list) throw new AdapterError('unsupported', `recipe ${recipe.id} has no source to read`);
        this.usedApi = false;
        return this.domPage(this.pageUrl, true);
    }

    async action(id: ActionId, item: Item): Promise<ActionResult> {
        const a = this.opts.recipe.actions?.[id];
        if (!a) return { ok: false, reason: 'error', message: `no action ${id}` };
        const values = { id: item.id };
        const fill = (v: unknown): unknown => (typeof v === 'string' ? expandTemplate(v, values) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
        try {
            const target = this.allowed(expandTemplate(a.url, values));
            // A call that carries the session goes to the origin of the page the recipe runs on.
            if (a.auth === 'session' && new URL(target).origin !== new URL(this.pageUrl).origin) {
                return { ok: false, reason: 'error', message: `action ${id}: a session action must stay on ${new URL(this.pageUrl).origin}` };
            }
            const res = await this.fetchFn(target, {
                method: a.method,
                credentials: a.auth === 'session' ? 'include' : 'omit',
                ...(a.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fill(a.body)) } : {}),
            });
            if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth' };
            return res.ok ? { ok: true } : { ok: false, reason: 'error', message: `HTTP ${res.status}` };
        } catch (e) {
            return { ok: false, reason: 'error', message: (e as Error).message };
        }
    }

    async resolveMedia(item: Item, want: 'thumb' | 'focus' | 'full' | 'video'): Promise<string | undefined> {
        return resolveMedia(item, want);
    }

    // ---- api source ----

    private async apiPage(page: number, query: string | undefined, token?: string): Promise<{ items: Item[]; next?: string }> {
        const api = this.opts.recipe.api!;
        const paging = api.page;
        const template = api.url;
        // The value of `{page}` and `page.param`: the page number, or the offset when `page.step` is set.
        const at = paging?.step ? (paging.start ?? 0) + (page - 1) * paging.step : page;
        let url: string;
        if (token !== undefined && /^https?:\/\//i.test(token)) {
            url = this.allowed(token);
        } else {
            url = this.allowed(expandTemplate(template, { page: String(at), query: encodeURIComponent(query ?? '') }));
            const value = paging?.next ? token : !template.includes('{page}') ? String(at) : undefined;
            if (paging?.next && token !== undefined && !paging.param) {
                // A cursor with nowhere to go would fetch page 1 again for ever: end the paging instead.
                this.warnOnce('page.next gave a token that is not a URL, and the recipe has no page.param to send it in; paging ends');
                return { items: [] };
            }
            if (value !== undefined && paging?.param) {
                const u = new URL(url);
                u.searchParams.set(paging.param, value);
                url = u.href;
            }
        }
        const body = await getJson(this.fetchFn, url);
        const rows = pathValues(api.items, body);
        const raws: unknown[] = [];
        for (const row of rows) {
            const raw: Record<string, unknown> = {};
            for (const [name, field] of Object.entries(api.fields)) {
                const v = apiValue(field, row);
                if (v !== undefined && v !== null) setField(raw, name, v);
            }
            raws.push(raw);
        }
        const items = normalizeList(raws, url, this.opts.onWarning, this.resize);
        if (!items.length) return { items };
        if (paging?.next) {
            const t = pathValues(paging.next, body)[0];
            let ok = (typeof t === 'string' && t !== '') || (typeof t === 'number' && Number.isFinite(t));
            if (ok && !paging.param && !/^https?:\/\//i.test(String(t))) {
                this.warnOnce('page.next gave a token that is not a URL, and the recipe has no page.param to send it in; paging ends');
                ok = false;
            }
            return { items, ...(ok ? { next: encodeCursor({ t: String(t) }) } : {}) };
        }
        return { items, next: encodeCursor({ page: page + 1 }) };
    }

    // ---- dom source ----

    private async domPage(url: string, first: boolean): Promise<{ items: Item[]; next?: string }> {
        const list = this.opts.recipe.list!;
        const doc = first && this.opts.document ? this.opts.document : parseHtml(await getText(this.fetchFn, url));
        const raws: unknown[] = [];
        for (const el of Array.from(doc.querySelectorAll(list.item))) {
            const raw: Record<string, unknown> = {};
            for (const [name, field] of Object.entries(list.fields)) {
                const v = extract(el, field, (m) => this.warnOnce(m));
                if (v !== undefined) setField(raw, name, name === 'aspect' || name === 'duration' ? toNumber(v) : v);
            }
            // An image read from a srcset also gives the other sizes, unless the recipe names them or
            // rewrites the URL with `re` (the raw srcset copies would skip that rewrite).
            const image = list.fields.image;
            if (image?.srcset && !image.re && raw.image !== undefined && !list.fields.image_focus && !list.fields.image_full) {
                const target = image.sel ? el.querySelector(image.sel) : el;
                Object.assign(raw, srcsetSizes(target?.getAttribute('srcset') ?? null));
            }
            raws.push(raw);
        }
        const items = normalizeList(raws, url, this.opts.onWarning, this.resize);
        let next: string | undefined;
        if (list.next) {
            const href = doc.querySelector(list.next.sel)?.getAttribute(list.next.attr ?? 'href');
            if (href) next = resolveUrl(href, url);
        }
        return { items, ...(next && matchesAny(this.opts.recipe.match, next) ? { next: encodeCursor({ u: next }) } : {}) };
    }

    private warnOnce(message: string) {
        if (this.warned.has(message)) return;
        this.warned.add(message);
        this.opts.onWarning?.({ code: 'bad-recipe', message });
    }

    private allowed(url: string, fallback?: string): string {
        const abs = resolveUrl(url || fallback || '', this.pageUrl);
        if (!matchesAny(this.opts.recipe.match, abs)) throw new AdapterError('recipe-no-match', `${abs} is outside the match patterns of recipe ${this.opts.recipe.id}`);
        return abs;
    }

    private firstOrigin(): string {
        const m = this.opts.recipe.match[0] ?? '';
        return m.replace(/\*/g, '').replace(/^(\w+):\/\/\.?/, '$1://') || 'https://invalid.example/';
    }
}

function pathValues(path: string, data: unknown): unknown[] {
    try {
        return findAll(path, data as never) as unknown[];
    } catch (e) {
        throw new AdapterError('parse', `bad JSONPath ${path}: ${(e as Error).message}`);
    }
}

function extract(el: Element, f: DomField, refuse: (message: string) => void): string | number | boolean | undefined {
    if (f.const !== undefined) return f.const;
    const target = f.sel ? el.querySelector(f.sel) : el;
    if (!target) return undefined;
    let v: string | null | undefined;
    if (f.srcset === 'largest') v = largestSrcset(target.getAttribute('srcset')) ?? (f.attr ? target.getAttribute(f.attr) : undefined);
    else if (f.attr) v = target.getAttribute(f.attr);
    else if (f.text) v = target.textContent?.trim();
    if (v === null || v === undefined || v === '') return undefined;
    if (f.re) {
        const why = checkRegex(f.re);
        if (why) {
            refuse(`re ${JSON.stringify(f.re)} refused (${why}); the field is dropped`);
            return undefined;
        }
        if (v.length > MAX_RE_INPUT) {
            refuse(`re ${JSON.stringify(f.re)} not run: the text is longer than ${MAX_RE_INPUT} characters; the field is dropped`);
            return undefined;
        }
        let m: RegExpExecArray | null = null;
        try {
            m = new RegExp(f.re).exec(v);
        } catch {
            return undefined;
        }
        if (!m) return undefined;
        return m[f.group ?? 1] ?? undefined;
    }
    return v;
}

/** One api field of one item: a JSONPath, a template, or a width/height pair. Undefined drops the field. */
function apiValue(field: ApiField, row: unknown): unknown {
    if (typeof field === 'string') return pathValues(field, row)[0];
    if ('template' in field) return fillTemplate(field.template, row);
    if ('w' in field && 'h' in field) {
        const w = Number(pathValues(field.w, row)[0]);
        const h = Number(pathValues(field.h, row)[0]);
        return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : undefined;
    }
    return undefined;
}

/**
 * `{a.b}` is the value at that dotted key of the item. Each value is percent-encoded, except when the
 * template is nothing but one placeholder. A missing, empty or non-scalar value drops the whole field.
 */
function fillTemplate(template: string, row: unknown): string | undefined {
    const whole = /^\{([\w.]+)\}$/.test(template);
    let missing = false;
    const out = template.replace(/\{([\w.]+)\}/g, (_m, key: string) => {
        let v: unknown = row;
        for (const part of key.split('.')) v = v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
        if ((typeof v !== 'string' && typeof v !== 'number') || v === '' || (typeof v === 'number' && !Number.isFinite(v))) {
            missing = true;
            return '';
        }
        return whole ? String(v) : encodeURIComponent(String(v));
    });
    return missing ? undefined : out;
}

function toNumber(v: string | number | boolean): number | string | boolean {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : v;
}

function setField(target: Record<string, unknown>, name: string, value: unknown) {
    const parts = name.split('.');
    let o = target;
    for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
    o[parts[parts.length - 1]] = typeof value === 'object' && value !== null ? value : name.startsWith('meta.') ? String(value) : value;
}

// ---- Chrome match patterns ----

export function matchesAny(patterns: string[], url: string): boolean {
    return patterns.some((p) => matchPattern(p, url));
}

export function matchPattern(pattern: string, url: string): boolean {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (pattern === '<all_urls>') return u.protocol === 'http:' || u.protocol === 'https:';
    const m = /^(\*|https?):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (!m) return false;
    const [, scheme, host, path] = m;
    const proto = u.protocol.slice(0, -1);
    if (scheme === '*' ? proto !== 'http' && proto !== 'https' : scheme !== proto) return false;
    if (host !== '*') {
        if (host.startsWith('*.')) {
            const base = host.slice(2);
            if (u.hostname !== base && !u.hostname.endsWith('.' + base)) return false;
        } else if (u.host !== host && u.hostname !== host) return false;
    }
    return globMatch(path, u.pathname + u.search);
}

/**
 * `*` matches any run of characters, everything else is literal. No RegExp: the literal pieces between the
 * stars are found left to right with indexOf, so the work is bounded by (text length x pieces) and cannot blow
 * up on a pattern like `/*a*a*a*b`.
 */
function globMatch(pattern: string, text: string): boolean {
    const parts = pattern.split('*');
    if (parts.length === 1) return text === pattern;
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (text.length < first.length + last.length || !text.startsWith(first) || !text.endsWith(last)) return false;
    let pos = first.length;
    const end = text.length - last.length;
    for (let i = 1; i < parts.length - 1; i++) {
        const at = text.indexOf(parts[i], pos);
        if (at < 0 || at + parts[i].length > end) return false;
        pos = at + parts[i].length;
    }
    return true;
}
