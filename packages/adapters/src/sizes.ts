import type { OnWarning } from './common.js';

/** Smaller copies of one image: the wall's card (~512 px), the focused size (~1024 px) and what the viewer opens. */
export interface Sized {
    image?: string;
    image_focus?: string;
    image_full?: string;
}

/**
 * A site's own rule, as data (manifest or recipe `media.resize`). `match` is plain text that the
 * absolute image URL must contain; no regular expressions, so a rule cannot hang the page. A size
 * with `{url}` is that template with the whole URL put in, percent-encoded as one query value (`{url_raw}`
 * puts it in as it is); any other size replaces the first `match`.
 */
export interface ResizeRule extends Sized {
    match: string;
}

export type Resizer = (url: string) => Sized | undefined;

/** What the item already says about the image; lets a preset avoid asking for a copy larger than the original. */
export interface SizeHint {
    width?: number;
}

const MAX_RULES = 20;
const MAX_PATTERN = 200;
const MAX_URL = 2048;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

function withParams(u: URL, params: Record<string, string>): string {
    const out = new URL(u.href);
    for (const [k, v] of Object.entries(params)) out.searchParams.set(k, v);
    return out.href;
}

/** Resizing by URL that well-known image hosts offer. Each one was checked against the live host. */
const PRESETS: ((u: URL, hint?: SizeHint) => Sized | undefined)[] = [
    // Wikimedia serves only its standard widths (500 and 1280 among them); 512 is refused.
    (u, hint) => {
        if (u.hostname !== 'upload.wikimedia.org') return;
        const m = /^\/(wikipedia\/[^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/.exec(u.pathname);
        if (!m) return;
        const [, project, hash, name] = m;
        const png = /\.svg$/i.test(name) ? '.png' : '';
        if (!png && !IMAGE_EXT.test(name)) return;
        const thumb = (w: number) => `${u.origin}/${project}/thumb/${hash}/${name}/${w}px-${name}${png}`;
        // A thumb wider than the original is upscaled (blurry, and larger than the file): keep the original there.
        // An SVG is rasterized from vectors, so any width is fine. An unknown width keeps both thumbs.
        const known = !png && hint?.width !== undefined && hint.width > 0 ? hint.width : undefined;
        if (known !== undefined && known < 500) return;
        return { image: thumb(500), image_focus: known !== undefined && known < 1280 ? u.href : thumb(1280) };
    },
    (u) => {
        if (u.hostname !== 'res.cloudinary.com' || !u.pathname.includes('/image/upload/')) return;
        // Already transformed (`w_2000/...`): a chained width would be scaled back up by the next step.
        if (/^[a-z]{1,3}_[^/]*\//.test(u.pathname.split('/image/upload/')[1])) return;
        const at = (w: number) => u.origin + u.pathname.replace('/image/upload/', `/image/upload/c_limit,w_${w},f_auto,q_auto/`) + u.search;
        return { image: at(512), image_focus: at(1024) };
    },
    // Hosts that take the width as a query parameter.
    (u) => {
        const h = u.hostname;
        let param: string | undefined;
        if (h.endsWith('.imgix.net') || h === 'images.unsplash.com' || h === 'images.ctfassets.net') param = 'w';
        else if (h === 'cdn.sanity.io' && u.pathname.startsWith('/images/')) param = 'w';
        else if (h === 'cdn.shopify.com' || u.pathname.startsWith('/cdn/shop/')) param = 'width';
        // WordPress.com and Jetpack resize with ?w=; a self-hosted WordPress ignores it and sends the original.
        else if (/^i[0-3]\.wp\.com$/.test(h) || h.endsWith('.files.wordpress.com')) param = 'w';
        if (!param) return;
        return { image: withParams(u, { [param]: '512' }), image_focus: withParams(u, { [param]: '1024' }) };
    },
    (u) => {
        if (u.hostname !== 'images.squarespace-cdn.com') return;
        return { image: withParams(u, { format: '500w' }), image_focus: withParams(u, { format: '1000w' }) };
    },
    // Flickr: the original (`_o`) and the sizes from 1600 px up (`_h`, `_k`, `_3k`, ...) have their own
    // secret, so only a URL with the regular secret can be swapped to `_z` and `_b`.
    (u) => {
        if (!u.hostname.endsWith('.staticflickr.com')) return;
        const m = /^(\/\d+\/\d+_[0-9a-f]+)(?:_[sqtmnwzcb])?\.jpg$/.exec(u.pathname);
        if (!m) return;
        return { image: `${u.origin}${m[1]}_z.jpg`, image_focus: `${u.origin}${m[1]}_b.jpg` };
    },
    (u) => {
        if (u.hostname !== 'i.imgur.com') return;
        const m = /^\/([A-Za-z0-9]{5}|[A-Za-z0-9]{7})\.(jpe?g|png|webp)$/.exec(u.pathname);
        if (!m) return;
        return { image: `${u.origin}/${m[1]}l.jpg`, image_focus: `${u.origin}/${m[1]}h.jpg` };
    },
];

/** Checks a site's `media.resize` rules; a bad one is dropped with a warning. */
export function compileResize(raw: unknown, warn?: OnWarning): Resizer | undefined {
    if (!Array.isArray(raw) || !raw.length) return undefined;
    const rules: ResizeRule[] = [];
    for (const r of raw.slice(0, MAX_RULES)) {
        const rule = r as ResizeRule;
        if (!rule || typeof rule.match !== 'string' || !rule.match || rule.match.length > MAX_PATTERN) {
            warn?.({ code: 'bad-resize', message: 'a media.resize rule needs match text of at most 200 characters' });
            continue;
        }
        rules.push(rule);
    }
    if (raw.length > MAX_RULES) warn?.({ code: 'bad-resize', message: `media.resize has more than ${MAX_RULES} rules; the rest are ignored` });
    if (!rules.length) return undefined;
    return (url) => {
        if (url.length > MAX_URL) return undefined;
        const rule = rules.find((r) => url.includes(r.match));
        if (!rule) return undefined;
        const out: Sized = {};
        for (const k of ['image', 'image_focus', 'image_full'] as const) {
            const size = rule[k];
            if (typeof size !== 'string') continue;
            // A function replacer, so `$` in the text stays literal.
            out[k] = size.includes('{url}') || size.includes('{url_raw}') ? size.split('{url}').join(encodeURIComponent(url)).split('{url_raw}').join(url) : url.replace(rule.match, () => size);
        }
        return out;
    };
}

/** The site's rules first, then the known hosts. */
export function sizesFor(url: string, resize?: Resizer, hint?: SizeHint): Sized | undefined {
    const own = resize?.(url);
    if (own && (own.image || own.image_focus || own.image_full)) return own;
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return undefined;
    }
    for (const preset of PRESETS) {
        const s = preset(u, hint);
        if (s) return s;
    }
    return undefined;
}

function candidates(srcset: string | null): { url: string; w: number; x: boolean }[] {
    if (!srcset) return [];
    const out: { url: string; w: number; x: boolean }[] = [];
    // A URL may itself contain commas (Cloudinary's `c_scale,w_400`), so a candidate ends at the
    // comma after its descriptor, or at commas that close a URL without one (as the HTML parser does).
    const n = srcset.length;
    let i = 0;
    while (i < n) {
        while (i < n && /[\s,]/.test(srcset[i])) i++;
        let j = i;
        while (j < n && !/\s/.test(srcset[j])) j++;
        let url = srcset.slice(i, j);
        let d = '';
        if (url.endsWith(',')) {
            url = url.replace(/,+$/, '');
            i = j;
        } else {
            const comma = srcset.indexOf(',', j);
            const end = comma < 0 ? n : comma;
            d = srcset.slice(j, end).trim();
            i = end + 1;
        }
        if (url) out.push({ url, w: d ? parseFloat(d) || 1 : 1, x: !d || !/w$/i.test(d) });
    }
    return out;
}

export function largestSrcset(srcset: string | null): string | undefined {
    let best: { url: string; w: number } | undefined;
    for (const c of candidates(srcset)) if (!best || c.w > best.w) best = c;
    return best?.url;
}

/**
 * Sizes from a srcset with width descriptors: the smallest copy at least 512 px wide for the card,
 * at least 1024 px for the focused card, and the largest for the viewer. Undefined unless it lists
 * two or more widths.
 */
export function srcsetSizes(srcset: string | null): Sized | undefined {
    const list = candidates(srcset).filter((c) => !c.x).sort((a, b) => a.w - b.w);
    if (list.length < 2) return undefined;
    const atLeast = (w: number) => (list.find((c) => c.w >= w) ?? list[list.length - 1]).url;
    const image = atLeast(512);
    const focus = atLeast(1024);
    const full = list[list.length - 1].url;
    return { image, ...(focus !== image ? { image_focus: focus } : {}), ...(full !== focus ? { image_full: full } : {}) };
}
