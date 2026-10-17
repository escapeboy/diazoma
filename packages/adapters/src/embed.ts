import { WellKnownAdapter } from './WellKnownAdapter.js';
import type { FetchLike } from './common.js';

/** What the one-tag embed reads from its own `<script>`. */
export interface EmbedAttributes {
    manifest: string;
    route?: string;
    core: string;
    loader: string;
    mount: string;
    locale?: 'en' | 'bg';
    /** Copied to the loader script when present: data-title, data-body, data-enter, data-browse. */
    passthrough: Record<string, string>;
}

export interface EmbedEnv {
    document: Document;
    window: Window & { diazoma?: { options?: Record<string, any>; [k: string]: unknown }; __diazoma?: unknown };
    fetch?: FetchLike;
    /** Absolute URL of the page, to resolve data-manifest against. */
    pageUrl?: string;
}

const PASS = ['title', 'body', 'enter', 'browse'] as const;

/** Reads the data-* attributes. `data-core` and the loader default to files next to the embed script itself. */
export function parseEmbedAttributes(tag: Element, pageUrl?: string): EmbedAttributes {
    const get = (k: string) => tag.getAttribute('data-' + k) || undefined;
    const manifest = get('manifest');
    if (!manifest) throw new Error('diazoma-embed: data-manifest is missing');
    const src = tag.getAttribute('src') || '';
    const base = src ? new URL('.', new URL(src, pageUrl)).href : undefined;
    const core = get('core') ?? (base && base + 'wall.iife.js');
    if (!core) throw new Error('diazoma-embed: data-core is missing and the script has no src to derive it from');
    const loader = get('loader') ?? (base && base + 'loader.js');
    if (!loader) throw new Error('diazoma-embed: data-loader is missing and the script has no src to derive it from');
    const locale = get('locale');
    const passthrough: Record<string, string> = {};
    for (const k of PASS) {
        const v = get(k);
        if (v !== undefined) passthrough[k] = v;
    }
    return { manifest, route: get('route'), core, loader, mount: get('mount') ?? '#diazoma', ...(locale === 'en' || locale === 'bg' ? { locale } : {}), passthrough };
}

const ready = (doc: Document) => new Promise<void>((ok) => {
    if (doc.readyState !== 'loading') ok();
    else doc.addEventListener('DOMContentLoaded', () => ok(), { once: true });
});

/**
 * Turns `data-manifest` into an adapter and hands it to the loader: sets `window.diazoma.options`,
 * makes sure a mount element exists, then injects the loader, which loads the core lazily.
 * Resolves to what it did, so the caller (and tests) can tell; it never throws.
 */
export async function runEmbed(tag: Element, env: EmbedEnv): Promise<'started' | 'denied' | 'failed'> {
    const { document: doc, window: win } = env;
    try {
        const attrs = parseEmbedAttributes(tag, env.pageUrl);
        const manifestUrl = new URL(attrs.manifest, env.pageUrl).href;
        const adapter = await new WellKnownAdapter({ origin: new URL(manifestUrl).origin, manifestUrl, fetch: env.fetch }).ready();
        if (adapter.policy === 'deny') {
            console.warn(`diazoma-embed: ${manifestUrl} publishes policy "deny"; the wall is not started`);
            return 'denied';
        }
        await ready(doc);

        // The wall sets the full window.__diazoma when it mounts; until then this marks the page as Level 3.
        if (!win.__diazoma) win.__diazoma = { version: 'pending', route: attrs.route ?? new URL(env.pageUrl ?? 'http://localhost/').pathname };

        const host = (win.diazoma = win.diazoma || {});
        const prior = host.options || {};
        host.options = { ...(attrs.locale ? { locale: attrs.locale } : {}), ...(attrs.route ? { route: attrs.route } : {}), ...prior, adapter, brand: { ...adapter.brand, ...(prior.brand || {}) } };

        if (!doc.querySelector(attrs.mount)) {
            const mount = doc.createElement('div');
            mount.id = attrs.mount.startsWith('#') ? attrs.mount.slice(1) : 'diazoma';
            mount.setAttribute('style', 'position:fixed;inset:0');
            doc.body.appendChild(mount);
        }

        const s = doc.createElement('script');
        s.src = new URL(attrs.loader, env.pageUrl).href;
        s.setAttribute('data-core', new URL(attrs.core, env.pageUrl).href);
        s.setAttribute('data-mount', attrs.mount);
        for (const [k, v] of Object.entries(attrs.passthrough)) s.setAttribute('data-' + k, v);
        doc.body.appendChild(s);
        return 'started';
    } catch (e) {
        console.error(e instanceof Error ? e.message : e);
        return 'failed';
    }
}
