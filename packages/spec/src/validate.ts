import { parseHTML } from 'linkedom';
import { contrastOnWhite } from './contrast.js';
import { describeErrors, validators } from './schemas.js';

export type Status = 'pass' | 'fail' | 'warn' | 'info';

export interface Check {
    name: string;
    status: Status;
    detail?: string;
}

export interface LevelReport {
    level: 3 | 2 | 1;
    name: string;
    detected: boolean;
    status: 'pass' | 'fail' | 'not-detected';
    checks: Check[];
}

export interface Report {
    url: string;
    levels: LevelReport[];
    /** Highest detected level; 0 when none. */
    highest: 0 | 1 | 2 | 3;
    ok: boolean;
    policy?: string;
}

export interface ValidateOptions {
    fetch?: typeof fetch;
}

type Doc = ReturnType<typeof parseHTML>['document'];

interface Manifest {
    policy?: string;
    brand?: { accent?: string; logo?: string };
    feeds: { id: string; type?: string; url: string; title?: string }[];
    media?: { hosts?: string[] };
}

const LEVEL_NAMES = { 3: 'embed', 2: 'feed + manifest', 1: 'annotations' } as const;

/** Runs the ladder of the spec against one URL. Never throws for a bad site; the problems are checks. */
export async function validate(url: string, opts: ValidateOptions = {}): Promise<Report> {
    const f = opts.fetch ?? globalThis.fetch;
    const levels: Record<3 | 2 | 1, LevelReport> = {
        3: { level: 3, name: LEVEL_NAMES[3], detected: false, status: 'not-detected', checks: [] },
        2: { level: 2, name: LEVEL_NAMES[2], detected: false, status: 'not-detected', checks: [] },
        1: { level: 1, name: LEVEL_NAMES[1], detected: false, status: 'not-detected', checks: [] },
    };
    const report: Report = { url, levels: [levels[3], levels[2], levels[1]], highest: 0, ok: false };

    let html: string;
    try {
        const res = await f(url, { headers: { Accept: 'text/html,*/*' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
    } catch (e) {
        levels[1].checks.push({ name: 'page', status: 'fail', detail: `${url}: ${(e as Error).message}` });
        return report;
    }
    const document = parseHTML(html).document;
    const origin = new URL(url).origin;

    // Level 3: the embed script. `window.__diazoma` needs JS and is not checked.
    const embed = Array.from(document.querySelectorAll('script')).find((s) => s.hasAttribute('data-manifest') || /(wall\.iife|diazoma-embed)\.js(\?|$)/.test(s.getAttribute('src') ?? ''));
    const declaredManifest = embed?.getAttribute('data-manifest') ?? null;
    if (embed) {
        levels[3].detected = true;
        levels[3].checks.push({ name: 'embed script', status: 'pass', detail: embed.getAttribute('src') ?? 'inline' });
        levels[3].checks.push({ name: 'window.__diazoma', status: 'info', detail: 'needs JavaScript; not checked here' });
    }

    // Level 2: manifest by <link>, by the embed's data-manifest, or at the well-known path; else bare feed links.
    const linked = document.querySelector('link[rel~="wall-manifest"]')?.getAttribute('href') ?? declaredManifest;
    let manifestUrl: string | null = linked ? new URL(linked, url).href : null;
    let manifestBody: unknown;
    if (!manifestUrl) {
        const probe = new URL('/.well-known/wall.json', url).href;
        const got = await getJson(f, probe);
        if (got.ok) {
            manifestUrl = probe;
            manifestBody = got.body;
        }
    }
    const feedLinks = Array.from(document.querySelectorAll('link[rel~="wall-feed"]')).map((l) => ({ href: new URL(l.getAttribute('href') ?? '', url).href, title: l.getAttribute('title') ?? '' }));

    if (manifestUrl) {
        levels[2].detected = true;
        await checkManifest(levels[2], f, manifestUrl, manifestBody, origin, report);
    } else if (feedLinks.length) {
        levels[2].detected = true;
        levels[2].checks.push({ name: 'manifest', status: 'info', detail: 'none; feeds found through <link rel="wall-feed">' });
        for (const link of feedLinks) await checkFeed(levels[2], f, link.title || link.href, link.href);
    }

    // Level 1: annotations in this page.
    const items = Array.from(document.querySelectorAll('[data-wall-item]'));
    if (items.length) {
        levels[1].detected = true;
        checkAnnotations(levels[1], document, items);
    }

    for (const l of report.levels) if (l.detected) l.status = l.checks.some((c) => c.status === 'fail') ? 'fail' : 'pass';
    if (levels[3].detected && levels[2].detected && declaredManifest) {
        levels[3].checks.push({ name: 'declared manifest', status: levels[2].status === 'fail' ? 'fail' : 'pass', detail: levels[2].status === 'fail' ? 'see Level 2' : 'valid, see Level 2' });
        levels[3].status = levels[3].checks.some((c) => c.status === 'fail') ? 'fail' : 'pass';
    }
    const detected = report.levels.filter((l) => l.detected);
    report.highest = detected.length ? (Math.max(...detected.map((l) => l.level)) as 1 | 2 | 3) : 0;
    report.ok = report.highest > 0 && levels[report.highest as 1 | 2 | 3].status === 'pass';
    if (!report.highest) levels[1].checks.push({ name: 'detection', status: 'info', detail: 'no data-wall-item, no wall-manifest, no wall-feed: this site is Level 0 (recipes or heuristics)' });
    return report;
}

async function getJson(f: typeof fetch, url: string): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
    try {
        const res = await f(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true, body: JSON.parse(await res.text()) };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

async function checkManifest(level: LevelReport, f: typeof fetch, url: string, preloaded: unknown, origin: string, report: Report) {
    const v = validators();
    let body = preloaded;
    if (body === undefined) {
        const got = await getJson(f, url);
        if (!got.ok) {
            level.checks.push({ name: 'manifest', status: 'fail', detail: `${url}: ${got.error}` });
            return;
        }
        body = got.body;
    }
    if (!v.manifest(body)) {
        level.checks.push({ name: 'manifest', status: 'fail', detail: `${url}: ${describeErrors(v.manifest)}` });
        return;
    }
    const m = body as Manifest;
    level.checks.push({ name: 'manifest', status: 'pass', detail: `schema valid (${url})` });
    const policy = m.policy ?? 'allow';
    report.policy = policy;
    level.checks.push({ name: 'policy', status: 'info', detail: policy === 'deny' ? 'deny: surfaces must not build a wall for this origin' : policy });

    const samples: string[] = [];
    for (const feed of m.feeds) {
        if (feed.type === 'search') {
            level.checks.push({ name: `feed ${feed.id}`, status: 'info', detail: 'search feed, not fetched' });
            continue;
        }
        const items = await checkFeed(level, f, feed.id, new URL(feed.url, url).href);
        samples.push(...items);
    }

    for (const host of m.media?.hosts ?? []) await checkCors(level, f, host, samples, m, url, origin);
    if (!(m.media?.hosts ?? []).length) level.checks.push({ name: 'media.hosts', status: 'info', detail: 'none declared; CORS not checked' });

    const accent = m.brand?.accent;
    if (accent) {
        const ratio = contrastOnWhite(accent);
        if (ratio === null) level.checks.push({ name: 'brand.accent contrast', status: 'warn', detail: `${accent} is not #rgb or #rrggbb; not checked` });
        else level.checks.push({ name: 'brand.accent contrast', status: ratio >= 4.5 ? 'pass' : 'fail', detail: `${accent} on white is ${ratio.toFixed(2)}:1 (needs 4.5:1)` });
    }
}

/** Fetches one page of a feed, validates it, returns its image URLs for the CORS check. */
async function checkFeed(level: LevelReport, f: typeof fetch, name: string, url: string): Promise<string[]> {
    const v = validators();
    const label = `feed ${name}`;
    const got = await getJson(f, url);
    if (!got.ok) {
        level.checks.push({ name: label, status: 'fail', detail: `${url}: ${got.error}` });
        return [];
    }
    if (!v.feed(got.body)) {
        level.checks.push({ name: label, status: 'fail', detail: `${url}: ${describeErrors(v.feed)}` });
        const items = (got.body as { items?: unknown })?.items;
        return Array.isArray(items) ? imagesOf(items, url) : [];
    }
    const items = (got.body as { items: unknown[]; next?: string }).items;
    const next = (got.body as { next?: string }).next;
    level.checks.push({ name: label, status: 'pass', detail: `${items.length} items, schema valid${next ? ', has next' : ', last page'}` });
    return imagesOf(items, url);
}

function imagesOf(items: unknown[], base: string): string[] {
    const out: string[] = [];
    for (const it of items) {
        const image = (it as { image?: unknown })?.image;
        if (typeof image === 'string' && image) out.push(new URL(image, base).href);
    }
    return out;
}

async function checkCors(level: LevelReport, f: typeof fetch, host: string, samples: string[], m: Manifest, manifestUrl: string, origin: string) {
    const name = `CORS ${host}`;
    let sample = samples.find((u) => new URL(u).host === host);
    if (!sample && m.brand?.logo) {
        const logo = new URL(m.brand.logo, manifestUrl).href;
        if (new URL(logo).host === host) sample = logo;
    }
    if (!sample) {
        level.checks.push({ name, status: 'warn', detail: 'no image on this host in the first feed page; not checked' });
        return;
    }
    try {
        const res = await f(sample, { headers: { Origin: origin } });
        await res.body?.cancel();
        const acao = res.headers.get('access-control-allow-origin');
        if (!res.ok) level.checks.push({ name, status: 'fail', detail: `${sample}: HTTP ${res.status}` });
        else if (acao === '*' || acao === origin) level.checks.push({ name, status: 'pass', detail: `Access-Control-Allow-Origin: ${acao} (${sample})` });
        else level.checks.push({ name, status: 'fail', detail: `${sample}: Access-Control-Allow-Origin is ${acao === null ? 'missing' : `"${acao}"`}, needs * or ${origin}` });
    } catch (e) {
        level.checks.push({ name, status: 'fail', detail: `${sample}: ${(e as Error).message}` });
    }
}

function checkAnnotations(level: LevelReport, document: Doc, items: Element[]) {
    let noImage = 0;
    let noLink = 0;
    let noAspect = 0;
    for (const el of items) {
        const img = el.querySelector('[data-wall-image]') ?? el.querySelector('img');
        const hasImage = !!(img && (img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('srcset')));
        const hasLink = el.hasAttribute('data-wall-link') || !!el.querySelector('[data-wall-link]') || el.matches('a[href]') || !!el.querySelector('a[href]');
        if (!hasImage) noImage++;
        if (!hasLink) noLink++;
        if (!el.hasAttribute('data-wall-aspect') && !(img?.getAttribute('width') && img?.getAttribute('height'))) noAspect++;
    }
    level.checks.push({ name: 'items', status: items.length ? 'pass' : 'fail', detail: `${items.length} [data-wall-item]` });
    level.checks.push({ name: 'image on every item', status: noImage ? 'fail' : 'pass', detail: noImage ? `${noImage} of ${items.length} items have no image` : undefined });
    level.checks.push({ name: 'link on every item', status: noLink ? 'fail' : 'pass', detail: noLink ? `${noLink} of ${items.length} items have no link` : undefined });
    level.checks.push({ name: 'aspect', status: noAspect ? 'info' : 'pass', detail: noAspect ? `${noAspect} items without data-wall-aspect or image size; the adapter reads the natural size or uses 1.5` : undefined });

    const sel = document.querySelector('[data-wall-next]')?.getAttribute('data-wall-next');
    const rel = document.querySelector('link[rel~="next"]');
    if (sel) {
        let hit: Element | null = null;
        try {
            hit = document.querySelector(sel);
        } catch {
            // an invalid selector counts as not matching
        }
        level.checks.push({ name: 'pagination', status: hit?.getAttribute('href') ? 'pass' : 'fail', detail: hit?.getAttribute('href') ? `data-wall-next "${sel}" -> ${hit.getAttribute('href')}` : `data-wall-next "${sel}" matches no link with an href` });
    } else if (rel) {
        level.checks.push({ name: 'pagination', status: 'pass', detail: `<link rel="next"> -> ${rel.getAttribute('href')}` });
    } else {
        level.checks.push({ name: 'pagination', status: 'info', detail: 'no data-wall-next and no <link rel="next">; infinite scroll will be observed' });
    }
}
