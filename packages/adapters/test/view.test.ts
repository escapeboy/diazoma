import { describe, expect, it } from 'vitest';
import { DomAdapter } from '../src/DomAdapter';
import { RecipeAdapter, type Recipe } from '../src/RecipeAdapter';
import { WellKnownAdapter } from '../src/WellKnownAdapter';
import { normalizeItem, type Warning } from '../src/common';
import { doc, read, stubFetch } from './helpers';

const MANIFEST_URL = 'https://shop.test/.well-known/wall.json';

async function wellKnown(extra: object) {
    const manifest = JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }], ...extra });
    return new WellKnownAdapter({ origin: 'https://shop.test', fetch: stubFetch({ [MANIFEST_URL]: manifest }) }).ready();
}

describe('WellKnownAdapter view', () => {
    it('passes manifest.view on', async () => {
        const view = { wall: { rows: 4 }, actions: { cart: { label: 'Add to cart' } } };
        expect((await wellKnown({ view })).view).toEqual(view);
    });
    it('has no view when the manifest has none or it is not an object', async () => {
        expect((await wellKnown({})).view).toBeUndefined();
        expect((await wellKnown({ view: 'dark' })).view).toBeUndefined();
        expect((await wellKnown({ view: [1] })).view).toBeUndefined();
    });
    it.each([['javascript:alert(1)'], ['data:image/png;base64,AAAA'], ['file:///etc/hosts'], [42]])('drops the panorama %s but keeps the rest', async (panorama) => {
        const a = await wellKnown({ view: { theme: { environment: { preset: 'night', panorama } } } });
        expect(a.view).toEqual({ theme: { environment: { preset: 'night' } } });
    });
    it('keeps an https panorama and resolves a relative one against the manifest URL', async () => {
        const abs = await wellKnown({ view: { theme: { environment: { panorama: 'https://cdn.test/sky.jpg' } } } });
        expect(abs.view!.theme!.environment!.panorama).toBe('https://cdn.test/sky.jpg');
        const rel = await wellKnown({ view: { theme: { environment: { panorama: '/img/sky.jpg' } } } });
        expect(rel.view!.theme!.environment!.panorama).toBe('https://shop.test/img/sky.jpg');
    });
    it('resolves auth.login against the manifest URL, only for http(s)', async () => {
        expect((await wellKnown({ auth: { login: '/login' } })).login).toBe('https://shop.test/login');
        expect((await wellKnown({ auth: { login: 'https://id.test/in' } })).login).toBe('https://id.test/in');
        expect((await wellKnown({ auth: { login: 'javascript:alert(1)' } })).login).toBeUndefined();
        expect((await wellKnown({})).login).toBeUndefined();
    });
    it('lists the deeplink actions as links, and leaves the key out when there are none', async () => {
        const actions = { like: { url: '/like/{id}' }, cart: { url: '/cart/{id}', mode: 'deeplink' }, buy: { url: '/buy/{id}', mode: 'deeplink' } };
        expect((await wellKnown({ actions })).capabilities()).toMatchObject({ actions: ['like', 'cart', 'buy'], links: ['cart', 'buy'] });
        expect(await wellKnown({ actions: { like: { url: '/like/{id}' } } }).then((a) => 'links' in a.capabilities())).toBe(false);
    });
});

describe('RecipeAdapter view', () => {
    const recipe = JSON.parse(read('recipes/botanical-dom.json')) as Recipe;
    const START = 'https://prints.example/plates';

    it('passes recipe.view on', () => {
        const view = { panel: { fields: ['title', 'meta'] as ('title' | 'meta')[] } };
        expect(new RecipeAdapter({ recipe: { ...recipe, view }, document: doc('<p></p>'), url: START }).view).toEqual(view);
    });
    it('has no view without one', () => {
        expect(new RecipeAdapter({ recipe, document: doc('<p></p>'), url: START }).view).toBeUndefined();
    });
    it('keeps an absolute https panorama and drops a relative or other-scheme one', () => {
        const make = (panorama: string) => new RecipeAdapter({ recipe: { ...recipe, view: { theme: { environment: { panorama } } } }, document: doc('<p></p>'), url: START }).view;
        expect(make('https://cdn.test/sky.jpg')!.theme!.environment!.panorama).toBe('https://cdn.test/sky.jpg');
        expect(make('/sky.jpg')!.theme!.environment).toEqual({});
        expect(make('data:image/png;base64,AAAA')!.theme!.environment).toEqual({});
    });
});

describe('DomAdapter view', () => {
    const page = (scripts: string) => doc(`<html><head>${scripts}</head><body><ul><li data-wall-item><a href="/x"><img src="/x.png" width="2" height="1"></a></li></ul></body></html>`);

    it('reads the data-wall-view script', () => {
        const a = new DomAdapter({ root: page('<script type="application/json" data-wall-view>{"wall":{"rows":2}}</script>'), baseUrl: 'http://shop.test/' });
        expect(a.view).toEqual({ wall: { rows: 2 } });
    });
    it('has no view and no warning without the script', () => {
        const warnings: Warning[] = [];
        expect(new DomAdapter({ root: page(''), onWarning: (w) => warnings.push(w) }).view).toBeUndefined();
        expect(warnings).toEqual([]);
    });
    it.each([['{not json'], ['[1,2]'], ['"text"'], ['null']])('warns invalid-view once for %s and returns no view', (text) => {
        const warnings: Warning[] = [];
        const a = new DomAdapter({ root: page(`<script type="application/json" data-wall-view>${text}</script>`), onWarning: (w) => warnings.push(w) });
        expect(a.view).toBeUndefined();
        expect(a.view).toBeUndefined();
        expect(warnings.map((w) => w.code)).toEqual(['invalid-view']);
    });
    it('uses the first script when there are two', () => {
        const a = new DomAdapter({ root: page('<script type="application/json" data-wall-view>{"wall":{"rows":2}}</script><script type="application/json" data-wall-view>{"wall":{"rows":5}}</script>') });
        expect(a.view).toEqual({ wall: { rows: 2 } });
    });
    it('does not take other JSON scripts for the view', () => {
        expect(new DomAdapter({ root: page('<script type="application/ld+json">{"a":1}</script>') }).view).toBeUndefined();
    });
});

describe('item actions and state', () => {
    it('survive normalizeItem', () => {
        const item = normalizeItem({ id: 'a', link: '/l', image: 'i.png', aspect: 1, actions: ['like', 'cart'], state: { liked: true, count: 3, note: 'x' } }, 'http://x.test/')!;
        expect(item.actions).toEqual(['like', 'cart']);
        expect(item.state).toEqual({ liked: true, count: 3, note: 'x' });
    });
});
