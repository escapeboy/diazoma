import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../recipe.schema.json', import.meta.url), 'utf8'));
const viewSchema = JSON.parse(readFileSync(new URL('../view.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
ajv.addSchema(viewSchema);
const validate = ajv.compile(schema);

const dom = {
    id: 'example.com',
    version: 7,
    match: ['https://example.com/*'],
    list: {
        pages: ['/listings*'],
        source: 'dom',
        item: 'li.listing-card',
        fields: {
            id: { attr: 'data-id' },
            link: { sel: 'a.card__link', attr: 'href' },
            image: { sel: 'img.card__img', attr: 'src', srcset: 'largest' },
            title: { sel: 'h3', text: true },
            aspect: { const: 1.333 },
            'meta.price': { sel: '.price', text: true, re: '(\\d+)', group: 1 },
        },
        next: { sel: 'a[rel=next]', attr: 'href' },
    },
    fixtures: ['fixtures/example.com/listings.html'],
    license: 'CC0-1.0',
    tags: ['listings'],
};

const api = {
    id: 'example.com',
    version: 1,
    match: ['https://example.com/*'],
    api: {
        source: 'api',
        url: 'https://example.com/api/listings?page={page}&per=50',
        page: { start: 1, param: 'page' },
        items: '$.data[*]',
        fields: { id: '$.id', link: '$.url', image: '$.images[0].large', aspect: '$.images[0].ratio' },
    },
    media: { needsPrivilegedFetch: true, referer: 'https://example.com/' },
    actions: { like: { method: 'POST', url: 'https://example.com/api/like', body: { id: '{id}' }, auth: 'session' } },
    search: { url: 'https://example.com/search?q={query}' },
};

describe('recipe.schema.json', () => {
    it('accepts a dom recipe', () => {
        expect(validate(dom), JSON.stringify(validate.errors)).toBe(true);
    });
    it('accepts an api recipe with media, actions and search', () => {
        expect(validate(api), JSON.stringify(validate.errors)).toBe(true);
    });
    it('accepts a recipe with both sources', () => {
        expect(validate({ ...dom, api: api.api })).toBe(true);
    });
    it('rejects a recipe without id, version or match', () => {
        for (const k of ['id', 'version', 'match']) {
            const r: Record<string, unknown> = { ...dom };
            delete r[k];
            expect(validate(r), k).toBe(false);
        }
    });
    it('rejects a recipe with neither list nor api', () => {
        const { list, ...rest } = dom;
        expect(list).toBeTruthy();
        expect(validate(rest)).toBe(false);
    });
    it('rejects a dom list without link or image fields', () => {
        expect(validate({ ...dom, list: { ...dom.list, fields: { id: { attr: 'x' } } } })).toBe(false);
    });
    it('rejects an unknown key in a dom field and a non-JSONPath api field', () => {
        const bad = structuredClone(dom);
        (bad.list.fields.title as Record<string, unknown>).eval = 'x';
        expect(validate(bad)).toBe(false);
        const badApi = structuredClone(api);
        badApi.api.fields.link = 'url';
        expect(validate(badApi)).toBe(false);
    });
});

describe('recipe view', () => {
    it('accepts a recipe with a view', () => {
        const view = { wall: { rows: 4, card: { width: 0.3 } }, panel: { fields: ['title', 'meta.price'] }, theme: { colors: { accent: '#c9334f' } } };
        expect(validate({ ...dom, view }), JSON.stringify(validate.errors)).toBe(true);
    });
    it('rejects a view outside the limits', () => {
        expect(validate({ ...dom, view: { wall: { rows: 9 } } })).toBe(false);
        expect(validate({ ...dom, view: { theme: { colors: { accent: 'red' } } } })).toBe(false);
    });
    it('ships the same view.schema.json as @diazoma/spec', () => {
        const spec = readFileSync(new URL('../../spec/schemas/view.schema.json', import.meta.url), 'utf8');
        expect(readFileSync(new URL('../view.schema.json', import.meta.url), 'utf8')).toBe(spec);
    });
});

describe('api extensions: templates, aspect w/h, offset and token paging', () => {
    const withApi = (patch: Record<string, unknown>) => {
        const r = structuredClone(api);
        Object.assign(r.api, patch);
        return r;
    };
    it('accepts a template field, an aspect from w and h, page.step and page.next', () => {
        const r = withApi({
            page: { start: 0, param: 'offset', step: 20 },
            fields: { ...api.api.fields, image: { template: 'https://x/{image_id}/full/512,/0/default.jpg' }, aspect: { w: '$.width', h: '$.height' } },
        });
        expect(validate(r), JSON.stringify(validate.errors)).toBe(true);
        expect(validate(withApi({ page: { param: 'gsroffset', next: '$.continue.gsroffset' } })), JSON.stringify(validate.errors)).toBe(true);
    });
    it('rejects step together with next, a step below 1, a next that is not a JSONPath, and a long re', () => {
        expect(validate(withApi({ page: { param: 'o', step: 20, next: '$.n' } }))).toBe(false);
        expect(validate(withApi({ page: { step: 0 } }))).toBe(false);
        expect(validate(withApi({ page: { next: 'continue' } }))).toBe(false);
        const d = structuredClone(dom);
        d.list.fields['meta.x'] = { sel: 'a', re: 'a'.repeat(201) } as never;
        expect(validate(d)).toBe(false);
    });
    it('rejects {w,h} on a field other than aspect, a template with extra keys, and an empty template', () => {
        expect(validate(withApi({ fields: { ...api.api.fields, title: { w: '$.a', h: '$.b' } } }))).toBe(false);
        expect(validate(withApi({ fields: { ...api.api.fields, title: { template: 'x', eval: 1 } } }))).toBe(false);
        expect(validate(withApi({ fields: { ...api.api.fields, title: { template: '' } } }))).toBe(false);
        expect(validate(withApi({ fields: { ...api.api.fields, aspect: { w: '$.a' } } }))).toBe(false);
    });
});

describe('video fields', () => {
    it('accepts the video fields in a dom and an api recipe', () => {
        const d = structuredClone(dom);
        Object.assign(d.list.fields, { video: { sel: 'video', attr: 'src' }, duration: { sel: '.len', text: true }, video_type: { const: 'hls' }, projection: { const: 'equirect360' }, stereo: { const: 'sbs' }, media_type: { const: 'video' } });
        expect(validate(d), JSON.stringify(validate.errors)).toBe(true);
        const a = structuredClone(api);
        Object.assign(a.api.fields, { video: '$.mp4', video_type: '$.kind', video_sources: '$.renditions', duration: '$.seconds', projection: '$.proj', stereo: '$.stereo', media_type: { template: 'video' } });
        expect(validate(a), JSON.stringify(validate.errors)).toBe(true);
    });
    it('rejects a video field that is not a field rule', () => {
        const d = structuredClone(dom);
        (d.list.fields as Record<string, unknown>).video = 'video';
        expect(validate(d)).toBe(false);
        const a = structuredClone(api);
        (a.api.fields as Record<string, unknown>).video = 'mp4';
        expect(validate(a)).toBe(false);
    });
    it('ships the same recipe.schema.json as @diazoma/spec', () => {
        const spec = readFileSync(new URL('../../spec/schemas/recipe.schema.json', import.meta.url), 'utf8');
        expect(readFileSync(new URL('../recipe.schema.json', import.meta.url), 'utf8')).toBe(spec);
    });
});
