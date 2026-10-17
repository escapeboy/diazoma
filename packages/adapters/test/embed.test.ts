import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { parseEmbedAttributes, runEmbed } from '../src/embed';
import { stubFetch } from './helpers';

const PAGE = 'https://shop.test/xr';
const manifest = (extra: object = {}) => JSON.stringify({ version: 1, name: 'Shop', brand: { accent: '#9b2335' }, feeds: [{ id: 'f', url: '/f.json' }], ...extra });
const fetches = (extra?: object) => stubFetch({ 'https://shop.test/.well-known/wall.json': manifest(extra), 'https://shop.test/f.json': '{"items":[]}' });

function page(attrs: string, body = '') {
    const { document } = parseHTML(`<html><head></head><body>${body}<script id="t" ${attrs}></script></body></html>`);
    // linkedom hands every parse the same window object; a fresh one keeps the tests apart.
    return { document: document as unknown as Document, window: {} as any, tag: document.getElementById('t')! };
}

describe('parseEmbedAttributes', () => {
    it('reads manifest, route, core, loader, mount and the loader texts', () => {
        const { tag } = page('src="https://cdn.test/v1/diazoma-embed.js" data-manifest="/.well-known/wall.json" data-route="/xr" data-core="https://cdn.test/v1/wall.iife.js" data-loader="https://cdn.test/v1/loader.js" data-mount="#wall" data-locale="bg" data-title="Hi" data-browse="Look"');
        expect(parseEmbedAttributes(tag, PAGE)).toEqual({
            manifest: '/.well-known/wall.json', route: '/xr', core: 'https://cdn.test/v1/wall.iife.js', loader: 'https://cdn.test/v1/loader.js',
            mount: '#wall', locale: 'bg', passthrough: { title: 'Hi', browse: 'Look' },
        });
    });
    it('derives data-core and the loader from the embed script\'s own directory', () => {
        const { tag } = page('src="/assets/diazoma/diazoma-embed.js" data-manifest="/m.json"');
        expect(parseEmbedAttributes(tag, PAGE)).toMatchObject({ core: 'https://shop.test/assets/diazoma/wall.iife.js', loader: 'https://shop.test/assets/diazoma/loader.js', mount: '#diazoma' });
    });
    it('throws without data-manifest, and without data-core when there is no src to derive from', () => {
        expect(() => parseEmbedAttributes(page('src="/e.js"').tag, PAGE)).toThrow(/data-manifest/);
        expect(() => parseEmbedAttributes(page('data-manifest="/m.json"').tag, PAGE)).toThrow(/data-core/);
    });
    it('ignores a locale it does not know', () => {
        expect(parseEmbedAttributes(page('src="/e.js" data-manifest="/m" data-locale="fr"').tag, PAGE)).not.toHaveProperty('locale');
    });
});

describe('runEmbed', () => {
    const tagAttrs = 'src="https://cdn.test/diazoma-embed.js" data-manifest="/.well-known/wall.json" data-route="/xr" data-core="https://cdn.test/wall.iife.js"';

    it('sets window.diazoma.options with the adapter and brand, creates the mount, injects the loader with data-core', async () => {
        const { document, window, tag } = page(tagAttrs);
        expect(await runEmbed(tag, { document, window, fetch: fetches(), pageUrl: PAGE })).toBe('started');
        const opts = window.diazoma.options;
        expect(opts.adapter.capabilities().search).toBe(false);
        expect(opts.brand).toMatchObject({ name: 'Shop', accent: '#9b2335' });
        expect(document.querySelector('#diazoma')).toBeTruthy();
        const loader = Array.from(document.querySelectorAll('script')).find((s) => s.getAttribute('src') === 'https://cdn.test/loader.js')!;
        expect(loader.getAttribute('data-core')).toBe('https://cdn.test/wall.iife.js');
        expect(loader.getAttribute('data-mount')).toBe('#diazoma');
        expect(window.__diazoma).toEqual({ version: 'pending', route: '/xr' });
        expect(window.diazoma.options.route).toBe('/xr');
    });
    it('keeps an existing mount element and host options, and copies the loader texts', async () => {
        const { document, window, tag } = page(tagAttrs + ' data-mount="#wall" data-title="Step in"', '<div id="wall"></div>');
        window.diazoma = { options: { brand: { accent: '#000000' }, inputProfile: 'desktop' } };
        await runEmbed(tag, { document, window, fetch: fetches(), pageUrl: PAGE });
        expect(document.querySelectorAll('#wall')).toHaveLength(1);
        expect(document.querySelector('#diazoma')).toBeNull();
        expect(window.diazoma.options).toMatchObject({ inputProfile: 'desktop', brand: { name: 'Shop', accent: '#000000' } });
        const loader = Array.from(document.querySelectorAll('script')).find((s) => s.getAttribute('src')?.endsWith('loader.js'))!;
        expect(loader.getAttribute('data-title')).toBe('Step in');
        expect(loader.getAttribute('data-mount')).toBe('#wall');
    });
    it('stops on policy deny: no options, no loader, no marker', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { document, window, tag } = page(tagAttrs);
        expect(await runEmbed(tag, { document, window, fetch: fetches({ policy: 'deny' }), pageUrl: PAGE })).toBe('denied');
        warn.mockRestore();
        expect(window.diazoma).toBeUndefined();
        expect(window.__diazoma).toBeUndefined();
        expect(document.querySelector('#diazoma')).toBeNull();
        expect(Array.from(document.querySelectorAll('script')).some((s) => s.getAttribute('src')?.endsWith('loader.js'))).toBe(false);
    });
    it('starts for policy recipes-only (it restricts recipes, not the feed)', async () => {
        const { document, window, tag } = page(tagAttrs);
        expect(await runEmbed(tag, { document, window, fetch: fetches({ policy: 'recipes-only' }), pageUrl: PAGE })).toBe('started');
    });
    it('fails quietly, with a console error and no loader, when the manifest cannot be read or the attributes are wrong', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const a = page(tagAttrs);
        expect(await runEmbed(a.tag, { document: a.document, window: a.window, fetch: stubFetch({}), pageUrl: PAGE })).toBe('failed');
        const b = page('src="/e.js"');
        expect(await runEmbed(b.tag, { document: b.document, window: b.window, fetch: fetches(), pageUrl: PAGE })).toBe('failed');
        expect(err).toHaveBeenCalledTimes(2);
        err.mockRestore();
        expect(a.window.diazoma).toBeUndefined();
        expect(a.document.querySelectorAll('script')).toHaveLength(1);
    });
});
