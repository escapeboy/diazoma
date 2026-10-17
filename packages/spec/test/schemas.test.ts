import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validators } from '../src/schemas';
import { fixtureDir, PACKAGE, readJson } from './helpers';

const v = validators();

// The examples of the spec text (spec/v1.md), as JSON.
const specManifest = {
    version: 1,
    policy: 'allow',
    name: 'Example',
    brand: { accent: '#c9334f', logo: '/logo-512.png', bg: '#0e0e10' },
    feeds: [
        { id: 'latest', title: 'Latest', url: '/wall/feed?sort=new', cursor: true },
        { id: 'popular', title: 'Popular', url: '/wall/feed?sort=popular', cursor: true },
        { id: 'search', type: 'search', url: '/wall/feed?q={query}' },
    ],
    filters: [{ id: 'type', title: 'Type', values: ['all', 'photo', 'video'], param: 'type' }],
    media: { hosts: ['cdn.example.com'], variants: { thumb: 512, focus: 1024, full: 2560 }, projections: ['flat', 'equirect180'] },
    actions: {
        like: { method: 'POST', url: '/api/items/{id}/like', auth: 'session', toggle: true },
        cart: { mode: 'deeplink', url: '/cart/add/{id}' },
    },
    auth: { login: '/login', device_link: '/wall/link' },
    recipe: '/.well-known/wall-recipe.json',
    embed: { route: '/xr' },
};
const specFeed = {
    items: [{
        id: '12345', link: '/listing/12345', title: 'A title', subtitle: 'Author',
        image: 'https://cdn.example.com/12345/512.jpg', image_focus: 'https://cdn.example.com/12345/1024.jpg', image_full: 'https://cdn.example.com/12345/full.jpg',
        aspect: 1.5, badges: ['video'], blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
        video: 'https://cdn.example.com/12345/720.mp4', projection: 'flat', stereo: 'mono',
        meta: { price: '1 250 EUR', location: 'Plovdiv' },
    }],
    next: 'eyJzIjpbMTY5',
};
const core = { id: 'a', link: '/a', image: '/a.png', aspect: 1 };
// Applies a patch on the full view, one level deep for objects.
function mergeDeep(patch: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
        const base = (fullView as Record<string, unknown>)[k];
        out[k] = val && typeof val === 'object' && !Array.isArray(val) && base && typeof base === 'object' ? { ...(base as object), ...val } : val;
    }
    return out;
}
const errs = (fn: typeof v.item) => JSON.stringify(fn.errors);

describe('schemas accept the spec examples', () => {
    it('manifest', () => expect(v.manifest(specManifest), errs(v.manifest)).toBe(true));
    it('feed page', () => expect(v.feed(specFeed), errs(v.feed)).toBe(true));
});

describe('schemas accept the fixture sites', () => {
    it('level2-feed manifest and every feed page', () => {
        const dir = path.join(fixtureDir('level2-feed'));
        expect(v.manifest(readJson(path.join(dir, '.well-known/wall.json'))), errs(v.manifest)).toBe(true);
        for (const f of ['feed.json', 'feed.p2.json', 'feed.p3.json', 'popular.json', 'search.json']) {
            const page = readJson(path.join(dir, 'wall', f));
            expect(v.feed(page), `${f} ${errs(v.feed)}`).toBe(true);
        }
    });
});

describe('item schema', () => {
    it.each(['id', 'link', 'image', 'aspect'])('requires %s', (k) => {
        const bad: Record<string, unknown> = { ...core };
        delete bad[k];
        expect(v.item(bad)).toBe(false);
    });
    it('accepts a text card with a title and no image or aspect', () => {
        expect(v.item({ id: 'a', link: '/a', title: 'Act 1' }), errs(v.item)).toBe(true);
        expect(v.item({ id: 'a', link: '/a', title: 'Act 1', excerpt: 'Text', date: '2026-10-10', accent: '#a1b' }), errs(v.item)).toBe(true);
        expect(v.item({ id: 'a', link: '/a', title: 'Act 1', date: '2026-10-10T12:30:00+03:00', accent: '#A1B2C3' }), errs(v.item)).toBe(true);
    });
    it('rejects an item with neither image nor title, or an image without aspect', () => {
        expect(v.item({ id: 'a', link: '/a' })).toBe(false);
        expect(v.item({ id: 'a', link: '/a', excerpt: 'x' })).toBe(false);
        expect(v.item({ id: 'a', link: '/a', image: '/a.png' })).toBe(false);
        expect(v.item({ id: 'a', link: '/a', aspect: 1 })).toBe(false);
    });
    it('rejects an image without aspect even when a title is given (the normalizer would drop it)', () => {
        expect(v.item({ id: 'a', link: '/a', image: '/a.png', title: 'T' })).toBe(false);
        expect(v.item({ id: 'a', link: '/a', image: '/a.png', aspect: 1.5, title: 'T' })).toBe(true);
    });
    it('rejects a blank title on a text card (the normalizer would drop it)', () => {
        for (const title of ['', ' ', ' \t\n ']) expect(v.item({ id: 'a', link: '/a', title }), JSON.stringify(title)).toBe(false);
        expect(v.item({ id: 'a', link: '/a', title: ' x ' })).toBe(true);
        expect(v.item({ id: 'a', link: '/a', image: '/a.png', aspect: 1.5, title: '' })).toBe(true);
    });
    it('rejects a bad excerpt, date or accent', () => {
        const t = { id: 'a', link: '/a', title: 'T' };
        expect(v.item({ ...t, excerpt: 'x'.repeat(501) })).toBe(false);
        expect(v.item({ ...t, excerpt: 'x'.repeat(500) })).toBe(true);
        for (const date of ['yesterday', '10.10.2026', 20261010]) expect(v.item({ ...t, date })).toBe(false);
        for (const accent of ['red', '#12', '#12345', '#gggggg', 'a1b2c3']) expect(v.item({ ...t, accent })).toBe(false);
    });
    it('rejects aspect 0, a negative aspect and a string aspect', () => {
        for (const aspect of [0, -1, '1.5']) expect(v.item({ ...core, aspect })).toBe(false);
    });
    it('accepts all optional extensions of the contract', () => {
        const full = {
            ...core, kind: 'collection', media_type: 'video', unplayable: { provider: 'ExampleTube' },
            creator: { id: 'c1', label: 'Ana' }, collection: { id: 's1', label: 'Set', following: true },
            tags: ['a'], count: 12, width: 800, height: 600, state: { liked: true }, likes: 3, description: 'text', tag: 'fern',
        };
        expect(v.item(full), errs(v.item)).toBe(true);
    });
    it('rejects wrong types and values of optional fields', () => {
        for (const bad of [{ kind: 'album' }, { media_type: 'audio' }, { tags: 'a' }, { creator: { id: 'x' } }, { projection: 'cube' }, { stereo: 'x' }, { count: -1 }, { likes: 1.5 }, { badges: [1] }, { meta: { a: 1 } }]) {
            expect(v.item({ ...core, ...bad }), JSON.stringify(bad)).toBe(false);
        }
    });
    it('accepts the video fields', () => {
        const ok = {
            ...core, video: 'https://cdn.example.com/a.m3u8', video_type: 'hls', duration: 12.5, media_type: 'video',
            video_sources: [
                { src: 'https://cdn.example.com/a-720.mp4', type: 'file', height: 720, codecs: 'avc1.640028', bitrate: 2500000 },
                { src: '/a-1080.mp4' },
            ],
            unplayable: { provider: 'YouTube', embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' },
        };
        expect(v.item(ok), errs(v.item)).toBe(true);
        expect(v.item({ ...core, duration: 0 })).toBe(true);
        expect(v.item({ ...core, video_sources: Array.from({ length: 8 }, (_, i) => ({ src: `/${i}.mp4` })) })).toBe(true);
    });
    it('rejects bad video fields', () => {
        const src = { src: '/a.mp4' };
        for (const bad of [
            { video_type: 'mp4' }, { video_sources: 'a.mp4' }, { video_sources: [{ height: 720 }] }, { video_sources: [{ src: '' }] },
            { video_sources: Array.from({ length: 9 }, (_, i) => ({ src: `/${i}.mp4` })) },
            { video_sources: [{ ...src, height: 0 }] }, { video_sources: [{ ...src, height: 720.5 }] }, { video_sources: [{ ...src, bitrate: -1 }] },
            { video_sources: [{ ...src, type: 'mp4' }] }, { video_sources: [{ ...src, codecs: 5 }] },
            { duration: -1 }, { duration: '10' }, { unplayable: { provider: 'YouTube', embed: 5 } }, { unplayable: { embed: 'https://player.vimeo.com/video/1' } },
        ]) {
            expect(v.item({ ...core, ...bad }), JSON.stringify(bad)).toBe(false);
        }
    });
    it('ignores unknown fields', () => {
        expect(v.item({ ...core, shop_specific: { anything: [1, 2] } })).toBe(true);
    });
});

describe('feed schema', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ ...core, id: `i${i}` }));
    it('allows 100 items and rejects 101', () => {
        expect(v.feed({ items: items(100) })).toBe(true);
        expect(v.feed({ items: items(101) })).toBe(false);
    });
    it('requires items, and a string next when present', () => {
        expect(v.feed({})).toBe(false);
        expect(v.feed({ items: [], next: 5 })).toBe(false);
        expect(v.feed({ items: [] })).toBe(true);
    });
    it('reports the item that lacks a core field', () => {
        expect(v.feed({ items: [core, { id: 'b', link: '/b', aspect: 1 }] })).toBe(false);
        expect(v.feed.errors!.some((e) => e.instancePath === '/items/1')).toBe(true);
    });
});

describe('manifest schema', () => {
    it('requires version 1 and at least one feed', () => {
        expect(v.manifest({ feeds: specManifest.feeds })).toBe(false);
        expect(v.manifest({ ...specManifest, version: 2 })).toBe(false);
        expect(v.manifest({ ...specManifest, feeds: [] })).toBe(false);
    });
    it('needs {query} in a search feed URL', () => {
        expect(v.manifest({ version: 1, feeds: [{ id: 's', type: 'search', url: '/s' }] })).toBe(false);
    });
    it('knows only the three policies and the auth kinds', () => {
        expect(v.manifest({ ...specManifest, policy: 'maybe' })).toBe(false);
        expect(v.manifest({ ...specManifest, actions: { like: { method: 'POST', url: '/x', auth: 'cookie' } } })).toBe(false);
    });
    it('needs method and url, or mode deeplink and url, in an action', () => {
        expect(v.manifest({ ...specManifest, actions: { like: { url: '/x' } } })).toBe(false);
    });
    it('ignores unknown top-level fields', () => {
        expect(v.manifest({ ...specManifest, future: { a: 1 } })).toBe(true);
    });
});

describe('manifest schema: auth.csrf and action response', () => {
    const withAuth = (auth: object) => ({ ...specManifest, auth });
    it('accepts a csrf contract by meta, by cookie, or both', () => {
        for (const csrf of [{ meta: 'csrf-token', header: 'X-CSRF-TOKEN' }, { cookie: 'XSRF-TOKEN', header: 'X-XSRF-TOKEN' }, { meta: 'm', cookie: 'c', header: 'X-T' }]) {
            expect(v.manifest(withAuth({ csrf })), JSON.stringify(csrf) + errs(v.manifest)).toBe(true);
        }
    });
    it('rejects a contract without header, without meta or cookie, or with a header that is not a plain name', () => {
        for (const csrf of [{ meta: 'm' }, { header: 'X-T' }, { meta: 'm', header: 'X T' }, { meta: 'm', header: 'X-A\r\nB' }, { meta: '', header: 'X-T' }]) {
            expect(v.manifest(withAuth({ csrf })), JSON.stringify(csrf)).toBe(false);
        }
    });
    it('knows response json and empty on an action and nothing else', () => {
        const act = (response: string) => ({ ...specManifest, actions: { like: { method: 'POST', url: '/x', auth: 'session', response } } });
        expect(v.manifest(act('json'))).toBe(true);
        expect(v.manifest(act('empty'))).toBe(true);
        expect(v.manifest(act('xml'))).toBe(false);
    });
});

const fullView = {
    actions: {
        favourite: { label: 'Favourite', labelActive: 'Favourited', icon: '♡', iconActive: '♥', placement: 'primary', order: 1, style: 'primary', state: 'favourited', count: 'favourites' },
        cart: { label: 'Add to cart', placement: 'more', confirm: true },
        compare: { placement: 'hidden' },
    },
    panel: { fields: ['title', 'subtitle', 'creator', 'description', 'likes', 'tags', 'meta', 'meta.price'], side: ['creator', 'tags'], metaLabels: { price: 'Price' } },
    wall: { rows: 4, radius: 3, arc: 110, card: { width: 0.3, height: 0.3 }, label: 'hover', labelFields: ['title', 'meta.price', 'count'], badges: true, indicator: 'favourite' },
    theme: {
        colors: { bg: '#101014', surface: '#1b1b22', surfaceHi: '#25252e', text: '#fff', textSoft: '#d0d0d8', muted: '#a0a0aa', accent: '#c9334f', accentStrong: '#a8213a', accentText: '#ffffff', panel: 'rgba(8, 8, 11, 0.82)' },
        font: 'Georgia, serif',
        environment: { preset: 'night', top: '#000', horizon: '#223', bottom: '#111', floor: '#0a0a0a', stars: true, panorama: 'https://cdn.example.com/sky.jpg', dim: 0.5 },
    },
    strings: { signin_on_site: 'Sign in on {site}' },
};
const view = (patch: object) => ({ ...fullView, ...patch });

describe('view schema', () => {
    const viewSchema = () => v.view;
    it('accepts a full example and an empty one', () => {
        expect(viewSchema()(fullView), JSON.stringify(viewSchema().errors)).toBe(true);
        expect(viewSchema()({})).toBe(true);
    });
    it('accepts the limits themselves', () => {
        const edge = { wall: { rows: 1, radius: 1.8, arc: 60, card: { width: 0.25, height: 0.25 } }, theme: { environment: { dim: 0 } } };
        const top = { wall: { rows: 5, radius: 4, arc: 150, card: { width: 0.6, height: 0.7 } }, theme: { environment: { dim: 0.8 } } };
        expect(viewSchema()(edge)).toBe(true);
        expect(viewSchema()(top)).toBe(true);
    });
    it.each([
        ['rows 9', { wall: { rows: 9 } }],
        ['rows 0', { wall: { rows: 0 } }],
        ['rows 2.5', { wall: { rows: 2.5 } }],
        ['radius 1.7', { wall: { radius: 1.7 } }],
        ['radius 4.1', { wall: { radius: 4.1 } }],
        ['arc 200', { wall: { arc: 200 } }],
        ['arc 59', { wall: { arc: 59 } }],
        ['card width 0.7', { wall: { card: { width: 0.7 } } }],
        ['card height 0.2', { wall: { card: { height: 0.2 } } }],
        ['label sometimes', { wall: { label: 'sometimes' } }],
        ['4 label fields', { wall: { labelFields: ['title', 'subtitle', 'creator', 'count'] } }],
        ['unknown label field', { wall: { labelFields: ['price'] } }],
        ['indicator 5', { wall: { indicator: 5 } }],
        ['unknown placement', { actions: { a: { placement: 'top' } } }],
        ['unknown style', { actions: { a: { style: 'ghost' } } }],
        ['label of 25 chars', { actions: { a: { label: 'x'.repeat(25) } } }],
        ['labelActive of 25 chars', { actions: { a: { labelActive: 'x'.repeat(25) } } }],
        ['icon of 5 chars', { actions: { a: { icon: 'abcde' } } }],
        ['iconActive of 5 chars', { actions: { a: { iconActive: 'abcde' } } }],
        ['meta label of 25 chars', { panel: { metaLabels: { price: 'x'.repeat(25) } } }],
        ['9 panel fields', { panel: { fields: Array(9).fill('title') } }],
        ['unknown panel field', { panel: { fields: ['price'] } }],
        ['nested meta key', { panel: { fields: ['meta.a.b'] } }],
        ['unknown side', { panel: { side: ['author'] } }],
        ['non-hex colour', { theme: { colors: { accent: 'red' } } }],
        ['4-digit hex', { theme: { colors: { bg: '#1234' } } }],
        ['rgba on bg', { theme: { colors: { bg: 'rgba(0, 0, 0, 0.5)' } } }],
        ['bad rgba on panel', { theme: { colors: { panel: 'rgba(0, 0, 0)' } } }],
        ['unknown preset', { theme: { environment: { preset: 'day' } } }],
        ['rgb environment colour', { theme: { environment: { top: 'rgb(0,0,0)' } } }],
        ['stars as string', { theme: { environment: { stars: 'yes' } } }],
        ['dim 0.9', { theme: { environment: { dim: 0.9 } } }],
        ['dim -0.1', { theme: { environment: { dim: -0.1 } } }],
        ['non-string strings value', { strings: { a: 1 } }],
    ])('rejects %s', (_name, patch) => {
        expect(viewSchema()(view(mergeDeep(patch)))).toBe(false);
    });
    it('allows unknown fields everywhere', () => {
        expect(viewSchema()({ future: 1, wall: { future: 2 }, actions: { a: { future: 3 } }, theme: { future: 4, environment: { future: 5 } }, panel: { future: 6 } })).toBe(true);
    });
});

describe('view in the manifest, items and recipes', () => {
    it('manifest with a view is valid, and an out-of-range view is not', () => {
        expect(v.manifest({ ...specManifest, view: fullView }), errs(v.manifest)).toBe(true);
        expect(v.manifest({ ...specManifest, view: { wall: { rows: 9 } } })).toBe(false);
        expect(v.manifest.errors!.some((e) => e.instancePath === '/view/wall/rows')).toBe(true);
    });
    it('item with actions and state is valid', () => {
        expect(v.item({ ...core, actions: ['like', 'cart'], state: { liked: true, in_cart: false, qty: 2, note: 'x' } }), errs(v.item)).toBe(true);
        expect(v.item({ ...core, actions: [] })).toBe(true);
    });
    it('item rejects actions that are not a list of unique non-empty strings, and state values that are not scalars', () => {
        for (const bad of [{ actions: 'like' }, { actions: [''] }, { actions: [1] }, { actions: ['a', 'a'] }, { state: { a: null } }, { state: { a: { b: 1 } } }, { state: { a: [1] } }, { state: { liked: 'yes' } }]) {
            expect(v.item({ ...core, ...bad }), JSON.stringify(bad)).toBe(false);
        }
    });
    it('recipe with a view is valid, and an out-of-range view is not', () => {
        const recipe = readJson(path.join(fixtureDir('recipes'), 'botanical-dom.json'));
        expect(v.recipe({ ...recipe, view: fullView }), errs(v.recipe)).toBe(true);
        expect(v.recipe({ ...recipe, view: { wall: { arc: 200 } } })).toBe(false);
    });
});

describe('recipe schema', () => {
    it('is the same file as the one in @diazoma/recipe-schema', () => {
        const mine = readFileSync(path.join(PACKAGE, 'schemas/recipe.schema.json'), 'utf8');
        const canonical = readFileSync(path.join(PACKAGE, '../recipe-schema/recipe.schema.json'), 'utf8');
        expect(mine).toBe(canonical);
    });
    it('ships the same view.schema.json as @diazoma/recipe-schema', () => {
        const mine = readFileSync(path.join(PACKAGE, 'schemas/view.schema.json'), 'utf8');
        const canonical = readFileSync(path.join(PACKAGE, '../recipe-schema/view.schema.json'), 'utf8');
        expect(mine).toBe(canonical);
    });
    it('accepts the api extensions of spec 3.6 and documents each in v1.md', () => {
        const base = readJson(path.join(fixtureDir('recipes'), 'botanical-api.json')) as { api: { page: unknown; fields: Record<string, unknown> } };
        const fields = { ...base.api.fields, image: { template: 'https://x/{image_id}/512.jpg' }, aspect: { w: '$.width', h: '$.height' } };
        const step = { ...base, api: { ...base.api, fields, page: { param: 'offset', start: 0, step: 20 } } };
        const next = { ...base, api: { ...base.api, page: { param: 'gsroffset', next: '$.continue.gsroffset' } } };
        expect(v.recipe(step), errs(v.recipe)).toBe(true);
        expect(v.recipe(next), errs(v.recipe)).toBe(true);
        expect(v.recipe({ ...base, api: { ...base.api, page: { step: 20, next: '$.n' } } })).toBe(false);
        expect(v.recipe({ ...base, api: { ...base.api, page: { next: '$.n' } } }), 'next without param').toBe(false);
        const doc = readFileSync(path.join(PACKAGE, 'spec/v1.md'), 'utf8');
        for (const word of ['{url_raw}', '"template"', '"w"', 'page.step', 'page.next', 'bad-recipe']) expect(doc, word).toContain(word);
    });
    it('accepts the sample recipes', () => {
        for (const f of ['botanical-dom.json', 'botanical-api.json']) {
            expect(v.recipe(readJson(path.join(fixtureDir('recipes'), f))), f + errs(v.recipe)).toBe(true);
        }
    });
});
