import { describe, expect, it } from 'vitest';
import { RecipeAdapter, matchPattern, type Recipe } from '../src/RecipeAdapter';
import { decodeCursor, encodeCursor } from '../src/common';
import { checkRegex } from '../src/regex';
import { doc, read, stubFetch } from './helpers';

const domRecipe = JSON.parse(read('recipes/botanical-dom.json')) as Recipe;
const apiRecipe = JSON.parse(read('recipes/botanical-api.json')) as Recipe;
const START = 'https://prints.example/plates';

describe('RecipeAdapter dom source', () => {
    const html = read('recipes/botanical-dom/listing.html');

    it('extracts fields with attr, text, const, srcset largest and regex on the extracted string', async () => {
        const a = new RecipeAdapter({ recipe: domRecipe, document: doc(html), url: START });
        const { items } = await a.page({});
        expect(items).toHaveLength(3);
        expect(items[0]).toEqual({
            id: 'p1',
            link: 'https://prints.example/plates/p1',
            image: 'https://prints.example/i/p1-480.png',
            title: 'Fern frond',
            aspect: 1.333,
            meta: { price: '12 EUR', year: '1998' },
        });
        expect(items[2].image).toBe('https://prints.example/i/p3-192.png'); // no srcset: falls back to src
    });
    it('follows next within the match patterns through an opaque cursor', async () => {
        const f = stubFetch({ 'https://prints.example/plates?page=2': html });
        const a = new RecipeAdapter({ recipe: domRecipe, document: doc(html), url: START, fetch: f });
        const p1 = await a.page({});
        expect(decodeCursor(p1.next!)).toEqual({ u: 'https://prints.example/plates?page=2' });
        const p2 = await a.page({ cursor: p1.next });
        expect(p2.items).toHaveLength(3);
        expect(f.calls.map((c) => c.url)).toEqual(['https://prints.example/plates?page=2']);
    });
    it('drops a next link that leads outside the match patterns', async () => {
        const out = html.replace('/plates?page=2', 'https://evil.example/plates');
        const { next } = await new RecipeAdapter({ recipe: domRecipe, document: doc(out), url: START }).page({});
        expect(next).toBeUndefined();
    });
    it('uses the search URL for a query', async () => {
        const f = stubFetch({ 'https://prints.example/plates?q=fern%20leaf': html });
        const { items } = await new RecipeAdapter({ recipe: domRecipe, url: START, fetch: f }).page({ query: 'fern leaf' });
        expect(items).toHaveLength(3);
    });
    it('skips items whose required fields are missing', async () => {
        const broken = html.replace('<a class="plate__link" href="/plates/p2">', '<a class="plate__link">');
        const { items } = await new RecipeAdapter({ recipe: domRecipe, document: doc(broken), url: START }).page({});
        expect(items.map((i) => i.id)).toEqual(['p1', 'p3']);
    });
    it('ignores a regex that does not match and an invalid one', async () => {
        const recipe: Recipe = structuredClone(domRecipe);
        recipe.list!.fields['meta.year'] = { sel: '.caption', text: true, re: '(\\d{9})', group: 1 };
        recipe.list!.fields['meta.bad'] = { sel: '.caption', text: true, re: '(' };
        const { items } = await new RecipeAdapter({ recipe, document: doc(html), url: START }).page({});
        expect(items[0].meta).toEqual({ price: '12 EUR' });
    });
});

describe('RecipeAdapter api source', () => {
    const json = read('recipes/botanical-api/page1.json');

    it('expands {page}, selects with JSONPath and pages by number', async () => {
        const f = stubFetch({ 'https://prints.example/api/plates?page=1&per=50': json, 'https://prints.example/api/plates?page=2&per=50': '{"data":[]}' });
        const a = new RecipeAdapter({ recipe: apiRecipe, fetch: f, url: START });
        const p1 = await a.page({});
        expect(p1.items).toEqual([
            { id: '101', link: 'https://prints.example/plates/101', image: 'https://prints.example/i/101-480.png', title: 'Heather sprig', aspect: 0.8, meta: { price: '11 EUR' } },
            expect.objectContaining({ id: '102', aspect: 1.5 }),
            expect.objectContaining({ id: '103', aspect: 1 }),
        ]);
        expect(decodeCursor(p1.next!)).toEqual({ page: 2 });
        const p2 = await a.page({ cursor: p1.next });
        expect(p2.items).toEqual([]);
        expect(p2.next).toBeUndefined();
    });
    it('sets the page parameter when the URL has no {page}', async () => {
        const recipe: Recipe = structuredClone(apiRecipe);
        recipe.api!.url = 'https://prints.example/api/plates';
        recipe.api!.page = { start: 0, param: 'p' };
        const f = stubFetch({ 'https://prints.example/api/plates?p=0': json });
        expect((await new RecipeAdapter({ recipe, fetch: f, url: START }).page({})).items).toHaveLength(3);
    });
    it('does not evaluate script in a path: a filter expression with code is just a failing selector', async () => {
        const recipe: Recipe = structuredClone(apiRecipe);
        recipe.api!.items = "$.data[?(process.exit(1))]";
        const f = stubFetch({ 'https://prints.example/api/plates?page=1&per=50': json });
        await expect(new RecipeAdapter({ recipe, fetch: f, url: START, source: 'api' }).page({})).rejects.toMatchObject({ code: 'parse' });
    });
    it('prefers api, and falls back to dom when the api fails and a list exists', async () => {
        const both: Recipe = { ...structuredClone(domRecipe), api: apiRecipe.api };
        const ok = stubFetch({ 'https://prints.example/api/plates?page=1&per=50': json });
        const viaApi = await new RecipeAdapter({ recipe: both, fetch: ok, url: START, document: doc(read('recipes/botanical-dom/listing.html')) }).page({});
        expect(viaApi.items[0].id).toBe('101');
        const down = stubFetch({});
        const viaDom = await new RecipeAdapter({ recipe: both, fetch: down, url: START, document: doc(read('recipes/botanical-dom/listing.html')) }).page({});
        expect(viaDom.items[0].id).toBe('p1');
    });
    it('keeps the api error when there is no dom source to fall back to', async () => {
        await expect(new RecipeAdapter({ recipe: apiRecipe, fetch: stubFetch({}), url: START }).page({})).rejects.toMatchObject({ code: 'http' });
    });
});

describe('match patterns', () => {
    it.each([
        ['https://example.com/*', 'https://example.com/a/b?c=1', true],
        ['https://example.com/*', 'http://example.com/a', false],
        ['*://example.com/*', 'http://example.com/a', true],
        ['https://*.example.com/*', 'https://www.example.com/a', true],
        ['https://*.example.com/*', 'https://example.com/a', true],
        ['https://*.example.com/*', 'https://evilexample.com/a', false],
        ['https://example.com/listings*', 'https://example.com/listings/2', true],
        ['https://example.com/listings*', 'https://example.com/other', false],
        ['https://example.com:8080/*', 'https://example.com:8080/x', true],
        ['https://example.com/*', 'ftp://example.com/x', false],
        ['<all_urls>', 'https://anything.test/x', true],
        ['example.com', 'https://example.com/', false],
    ])('%s vs %s -> %s', (pattern, url, want) => {
        expect(matchPattern(pattern, url)).toBe(want);
    });

    it('refuses to run outside the recipe patterns, at construction and for action URLs', async () => {
        expect(() => new RecipeAdapter({ recipe: domRecipe, url: 'https://other.example/plates' })).toThrowError(/match patterns/);
        const recipe: Recipe = { ...structuredClone(apiRecipe), actions: { like: { method: 'POST', url: 'https://evil.example/like', auth: 'session' } } };
        const a = new RecipeAdapter({ recipe, url: START, fetch: stubFetch({}) });
        expect(await a.action('like', { id: '1', link: 'l', image: 'i', aspect: 1 })).toMatchObject({ ok: false, reason: 'error' });
    });
    it('runs an action inside the patterns with the body filled in', async () => {
        const recipe: Recipe = { ...structuredClone(apiRecipe), actions: { like: { method: 'POST', url: 'https://prints.example/api/like', body: { id: '{id}' }, auth: 'session' } } };
        const f = stubFetch({ 'https://prints.example/api/like': '' });
        const r = await new RecipeAdapter({ recipe, url: START, fetch: f }).action('like', { id: '42', link: 'l', image: 'i', aspect: 1 });
        expect(r).toEqual({ ok: true });
        expect(f.calls[0].init).toMatchObject({ method: 'POST', credentials: 'include', body: '{"id":"42"}' });
    });
});

describe('recipe re: refused patterns', () => {
    const html = read('recipes/botanical-dom/listing.html');
    const withRe = (re: string, extra: Partial<Recipe['list']> = {}) => {
        const recipe: Recipe = structuredClone(domRecipe);
        recipe.list!.fields['meta.x'] = { sel: '.caption', text: true, re };
        Object.assign(recipe.list!, extra);
        return recipe;
    };
    const run = async (recipe: Recipe, document = html) => {
        const warnings: { code: string; message: string }[] = [];
        const { items } = await new RecipeAdapter({ recipe, document: doc(document), url: START, onWarning: (w) => warnings.push(w) }).page({});
        return { items, warnings };
    };

    it('refuses the classic evil pattern fast, drops the value and warns once', async () => {
        const evil = html.replace('Printed 1998', 'a'.repeat(30) + '!');
        const t = performance.now();
        const { items, warnings } = await run(withRe('(a+)+$'), evil);
        expect(performance.now() - t).toBeLessThan(50);
        expect(items[0].meta?.x).toBeUndefined();
        expect(items).toHaveLength(3);
        expect(warnings.filter((w) => w.code === 'bad-recipe')).toHaveLength(1);
    });
    it.each(['(a|a)*$', '(a*)*b', '(\\w+\\s?)+$', '(a)\\1', '(?<n>a)\\k<n>', '.*.*.*x', '(a{2,})+', '(a|b){2,}c'])('refuses %s', async (re) => {
        const { items, warnings } = await run(withRe(re));
        expect(items[0].meta?.x).toBeUndefined();
        expect(warnings.some((w) => w.code === 'bad-recipe')).toBe(true);
    });
    it('keeps working patterns, including those of the shipped recipes', async () => {
        const { items, warnings } = await run(withRe('^(\\d+)$'));
        expect(items[0].meta?.x).toBeUndefined(); // caption text is "12 EUR (1998)" style: no full match, but not refused
        expect(warnings.filter((w) => w.code === 'bad-recipe')).toEqual([]);
        const ok = await run(withRe('Printed (\\d+)'));
        expect(ok.items[0].meta?.x).toBe('1998');
        for (const re of ['^(.*)-3000(\\.png)$', '(\\d{4})', '(?:a|b)c', '[a+]+(x)', '^(a+)b?', '^\\(a+\\)+', 'Printed\\s+(\\d{4})']) expect(checkRegex(re), re).toBeNull();
    });
    it('does not run a pattern on text longer than 256 characters', async () => {
        const long = html.replace('Printed 1998', 'Printed ' + '1'.repeat(3000));
        const { items, warnings } = await run(withRe('Printed (\\d+)'), long);
        expect(items[0].meta?.x).toBeUndefined();
        expect(warnings.some((w) => w.code === 'bad-recipe' && w.message.includes('256'))).toBe(true);
    });
    it('refuses a pattern longer than 200 characters', () => {
        expect(checkRegex('a'.repeat(201))).toMatch(/200/);
    });
});

describe('recipe api extensions', () => {
    const recipe = (api: Partial<NonNullable<Recipe['api']>>): Recipe => ({
        id: 'api.test',
        version: 1,
        match: ['https://api.test/*'],
        api: { url: 'https://api.test/list', items: '$.data[*]', fields: { id: '$.id', link: '$.url', image: '$.img', aspect: '$.r' }, ...api },
    });
    const row = (n: number, extra: Record<string, unknown> = {}) => ({ id: n, url: `https://api.test/o/${n}`, img: `https://api.test/i/${n}.jpg`, r: 1, ...extra });
    const body = (...rows: unknown[]) => JSON.stringify({ data: rows });

    it('fills a template from the item, encoding each value but not a whole-value placeholder', async () => {
        const r = recipe({
            fields: {
                id: '$.id',
                link: '$.url',
                image: { template: 'https://img.test/{image_id}/full/512,/0/default.jpg?t={source.title}' },
                aspect: '$.r',
                'meta.raw': { template: '{source.title}' },
                'meta.gone': { template: 'x/{nothing}' },
            },
        });
        const f = stubFetch({ 'https://api.test/list': body(row(1, { image_id: 'a/b c', source: { title: 'Fern & moss' } })) });
        const { items } = await new RecipeAdapter({ recipe: r, fetch: f, url: 'https://api.test/' }).page({});
        expect(items[0].image).toBe('https://img.test/a%2Fb%20c/full/512,/0/default.jpg?t=Fern%20%26%20moss');
        expect(items[0].meta).toEqual({ raw: 'Fern & moss' });
    });
    it('drops a template field when a value is missing, empty or not a scalar', async () => {
        const r = recipe({ fields: { id: '$.id', link: '$.url', image: '$.img', aspect: '$.r', 'meta.a': { template: '{a}' }, 'meta.b': { template: '{b}' }, 'meta.c': { template: '{c.d}' } } });
        const f = stubFetch({ 'https://api.test/list': body(row(1, { b: '', c: { d: { x: 1 } } })) });
        const { items } = await new RecipeAdapter({ recipe: r, fetch: f, url: 'https://api.test/' }).page({});
        expect(items[0].meta).toBeUndefined();
    });
    it('takes the aspect from width and height, and drops it when they are not positive', async () => {
        const r = recipe({ fields: { id: '$.id', link: '$.url', image: '$.img', aspect: { w: '$.w', h: '$.h' } } });
        const rows = [{ ...row(1), w: 800, h: 400 }, { ...row(2), w: '300', h: '200' }, { ...row(3), w: 0, h: 5 }, { ...row(4), w: 5 }, { ...row(5), w: 5, h: -1 }];
        const warnings: string[] = [];
        const f = stubFetch({ 'https://api.test/list': JSON.stringify({ data: rows }) });
        const { items } = await new RecipeAdapter({ recipe: r, fetch: f, url: 'https://api.test/', onWarning: (w) => warnings.push(w.code) }).page({});
        expect(items.map((i) => [i.id, i.aspect])).toEqual([['1', 2], ['2', 1.5]]);
        expect(warnings.filter((c) => c === 'invalid-item')).toHaveLength(3);
    });
    it('pages by offset with page.step: start + (page-1)*step in page.param and {page}', async () => {
        const f = stubFetch({
            'https://api.test/list?off=0': body(row(1)),
            'https://api.test/list?off=20': body(row(2)),
            'https://api.test/list?off=40': '{"data":[]}',
        });
        const a = new RecipeAdapter({ recipe: recipe({ page: { param: 'off', step: 20 } }), fetch: f, url: 'https://api.test/' });
        const p1 = await a.page({});
        const p2 = await a.page({ cursor: p1.next });
        const p3 = await a.page({ cursor: p2.next });
        expect([p1.items[0].id, p2.items[0].id, p3.items.length, p3.next]).toEqual(['1', '2', 0, undefined]);
        expect(f.calls.map((c) => c.url)).toEqual(['https://api.test/list?off=0', 'https://api.test/list?off=20', 'https://api.test/list?off=40']);
        expect(decodeCursor(p1.next!)).toEqual({ page: 2 });

        const g = stubFetch({ 'https://api.test/list?o=10&per=5': body(row(1)), 'https://api.test/list?o=15&per=5': body(row(2)) });
        const b = new RecipeAdapter({ recipe: recipe({ url: 'https://api.test/list?o={page}&per=5', page: { start: 10, step: 5 } }), fetch: g, url: 'https://api.test/' });
        const q1 = await b.page({});
        await b.page({ cursor: q1.next });
        expect(g.calls.map((c) => c.url)).toEqual(['https://api.test/list?o=10&per=5', 'https://api.test/list?o=15&per=5']);
    });
    it('pages by continuation token with page.next, and stops when there is none', async () => {
        const f = stubFetch({
            'https://api.test/list': JSON.stringify({ continue: { gsroffset: 20 }, data: [row(1)] }),
            'https://api.test/list?gsroffset=20': JSON.stringify({ continue: { gsroffset: 'ab c' }, data: [row(2)] }),
            'https://api.test/list?gsroffset=ab+c': JSON.stringify({ data: [row(3)] }),
        });
        const a = new RecipeAdapter({ recipe: recipe({ page: { param: 'gsroffset', next: '$.continue.gsroffset' } }), fetch: f, url: 'https://api.test/' });
        const p1 = await a.page({});
        expect(decodeCursor(p1.next!)).toEqual({ t: '20' });
        const p2 = await a.page({ cursor: p1.next });
        const p3 = await a.page({ cursor: p2.next });
        expect([p2.items[0].id, p3.items[0].id, p3.next]).toEqual(['2', '3', undefined]);
    });
    it('follows a URL token only inside the match patterns', async () => {
        const mk = (next: string) => new RecipeAdapter({
            recipe: recipe({ page: { next: '$.next' } }),
            fetch: stubFetch({ 'https://api.test/list': JSON.stringify({ next, data: [row(1)] }), 'https://api.test/list?c=2': body(row(2)) }),
            url: 'https://api.test/',
        });
        const inside = mk('https://api.test/list?c=2');
        const p1 = await inside.page({});
        expect((await inside.page({ cursor: p1.next })).items[0].id).toBe('2');
        const outside = mk('https://evil.test/x');
        await expect(outside.page({ cursor: (await outside.page({})).next })).rejects.toMatchObject({ code: 'recipe-no-match' });
    });
    it('leaves a recipe without the extensions as it was', async () => {
        const f = stubFetch({ 'https://api.test/list?page=1': body(row(1)), 'https://api.test/list?page=2': body(row(2)) });
        const a = new RecipeAdapter({ recipe: recipe({ page: { start: 1, param: 'page' } }), fetch: f, url: 'https://api.test/' });
        const p1 = await a.page({});
        expect(decodeCursor(p1.next!)).toEqual({ page: 2 });
        expect((await a.page({ cursor: p1.next })).items[0].id).toBe('2');
    });
});

describe('api page.next without page.param', () => {
    const row = (n: number) => ({ id: String(n), url: `https://api.test/i/${n}`, img: `https://api.test/${n}.jpg`, r: 1 });
    const mk = (next: unknown, onWarning?: (w: { code: string; message: string }) => void) =>
        new RecipeAdapter({
            recipe: {
                id: 'api.test',
                version: 1,
                match: ['https://api.test/*'],
                api: { url: 'https://api.test/list', items: '$.data[*]', fields: { id: '$.id', link: '$.url', image: '$.img', aspect: '$.r' }, page: { next: '$.next' } },
            },
            fetch: stubFetch({ 'https://api.test/list': JSON.stringify({ next, data: [row(1)] }) }),
            url: 'https://api.test/',
            onWarning,
        });
    it('ends the paging with a warning when the token is not a URL and there is no param', async () => {
        const warnings: string[] = [];
        const p1 = await mk('cursor-2', (w) => warnings.push(w.code)).page({});
        expect(p1.items).toHaveLength(1);
        expect(p1.next).toBeUndefined();
        expect(warnings).toEqual(['bad-recipe']);
    });
    it('ends the paging when a cursor with a token arrives without a param', async () => {
        const a = mk('x');
        const p = await a.page({ cursor: encodeCursor({ t: '2' }) });
        expect(p.items).toEqual([]);
        expect(p.next).toBeUndefined();
    });
    it('still follows a URL token without a param', async () => {
        const p1 = await mk('https://api.test/list').page({});
        expect(decodeCursor(p1.next!)).toEqual({ t: 'https://api.test/list' });
    });
});

describe('match patterns are linear', () => {
    it('answers an attack pattern fast', () => {
        const t = performance.now();
        expect(matchPattern('https://x.test/*a*a*a*a*a*a*b', 'https://x.test/' + 'a'.repeat(100))).toBe(false);
        expect(matchPattern('https://x.test/*a*a*a*a*a*a*b', 'https://x.test/' + 'a'.repeat(100) + 'b')).toBe(true);
        expect(performance.now() - t).toBeLessThan(50);
    });
    it.each([
        ['https://x.test/a*b', 'https://x.test/ab', true],
        ['https://x.test/a*b', 'https://x.test/a', false],
        ['https://x.test/a*ab', 'https://x.test/ab', false],
        ['https://x.test/*', 'https://x.test/', true],
        ['https://x.test/a**b', 'https://x.test/a-b', true],
        ['https://x.test/a.b', 'https://x.test/aXb', false],
        ['https://x.test/*?page=*', 'https://x.test/p?page=3', true],
    ])('%s vs %s -> %s', (pattern, url, want) => expect(matchPattern(pattern, url)).toBe(want));
});
