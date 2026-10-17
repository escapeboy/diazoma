import { describe, expect, it, vi } from 'vitest';
import { normalizeItem } from '../src/common';
import { compileResize, sizesFor, srcsetSizes } from '../src/sizes';
import { DomAdapter } from '../src/DomAdapter';
import { RecipeAdapter, type Recipe } from '../src/RecipeAdapter';
import { WellKnownAdapter } from '../src/WellKnownAdapter';
import { doc, read, stubFetch } from './helpers';

const item = (image: string, extra: Record<string, unknown> = {}) => ({ id: '1', link: 'https://x.test/1', image, aspect: 1, ...extra });

describe('sizesFor: known image hosts', () => {
    it.each([
        ['https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/500px-Example.jpg', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/1280px-Example.jpg'],
        ['https://upload.wikimedia.org/wikipedia/commons/8/84/Example.svg', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Example.svg/500px-Example.svg.png', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Example.svg/1280px-Example.svg.png'],
        ['https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg', 'https://res.cloudinary.com/demo/image/upload/c_limit,w_512,f_auto,q_auto/v1312461204/sample.jpg', 'https://res.cloudinary.com/demo/image/upload/c_limit,w_1024,f_auto,q_auto/v1312461204/sample.jpg'],
        ['https://assets.imgix.net/unsplash/bridge.jpg', 'https://assets.imgix.net/unsplash/bridge.jpg?w=512', 'https://assets.imgix.net/unsplash/bridge.jpg?w=1024'],
        ['https://images.unsplash.com/photo-1?w=4000&q=80', 'https://images.unsplash.com/photo-1?w=512&q=80', 'https://images.unsplash.com/photo-1?w=1024&q=80'],
        ['https://cdn.sanity.io/images/abc/prod/f2-1200x630.png', 'https://cdn.sanity.io/images/abc/prod/f2-1200x630.png?w=512', 'https://cdn.sanity.io/images/abc/prod/f2-1200x630.png?w=1024'],
        ['https://shop.example/cdn/shop/files/a.jpg?v=1', 'https://shop.example/cdn/shop/files/a.jpg?v=1&width=512', 'https://shop.example/cdn/shop/files/a.jpg?v=1&width=1024'],
        ['https://i0.wp.com/example.org/wp-content/uploads/a.jpg', 'https://i0.wp.com/example.org/wp-content/uploads/a.jpg?w=512', 'https://i0.wp.com/example.org/wp-content/uploads/a.jpg?w=1024'],
        ['https://images.squarespace-cdn.com/content/v1/a/b/image.png', 'https://images.squarespace-cdn.com/content/v1/a/b/image.png?format=500w', 'https://images.squarespace-cdn.com/content/v1/a/b/image.png?format=1000w'],
        ['https://live.staticflickr.com/65535/55574605665_0084f1236a.jpg', 'https://live.staticflickr.com/65535/55574605665_0084f1236a_z.jpg', 'https://live.staticflickr.com/65535/55574605665_0084f1236a_b.jpg'],
        ['https://i.imgur.com/OB0y6MR.jpg', 'https://i.imgur.com/OB0y6MRl.jpg', 'https://i.imgur.com/OB0y6MRh.jpg'],
    ])('%s', (url, image, focus) => {
        expect(sizesFor(url)).toEqual({ image, image_focus: focus });
    });

    it.each([
        'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/500px-Example.jpg',
        'https://upload.wikimedia.org/wikipedia/commons/a/a9/Scan.tif',
        'https://live.staticflickr.com/65535/1_abc_o.jpg',
        'https://live.staticflickr.com/65535/1_abc_k.jpg',
        'https://live.staticflickr.com/65535/1_abc_3k.jpg',
        'https://res.cloudinary.com/demo/image/upload/w_2000/v1/sample.jpg',
        'https://i.imgur.com/a/album.jpg',
        'https://example.com/photo.jpg',
        'https://blog.example/wp-content/uploads/2026/10/a.jpg',
        'not a url',
    ])('leaves %s alone', (url) => {
        expect(sizesFor(url)).toBeUndefined();
    });
});

describe('compileResize: the site\'s own rules', () => {
    it('replaces the first match, or fills {url}; first matching rule wins, before the known hosts', () => {
        const resize = compileResize([
            { match: '/images/screen/', image: '/images/thumb700x/', image_full: '/images/large/' },
            { match: 'https://upload.wikimedia.org/', image: '{url_raw}?s=512' },
        ]);
        expect(sizesFor('https://cdn.eso.org/images/screen/a.jpg', resize)).toEqual({ image: 'https://cdn.eso.org/images/thumb700x/a.jpg', image_full: 'https://cdn.eso.org/images/large/a.jpg' });
        expect(sizesFor('https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg', resize)).toEqual({ image: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg?s=512' });
        expect(sizesFor('https://images.unsplash.com/p', resize)?.image).toBe('https://images.unsplash.com/p?w=512');
    });

    it('takes match as plain text: no regular expressions, $ stays literal', () => {
        const resize = compileResize([{ match: '(a+)+$', image: 'x' }, { match: '/up/', image: '/$&$1/' }])!;
        expect(resize('https://x.test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!')).toBeUndefined();
        expect(resize('https://x.test/(a+)+$/p.jpg')).toEqual({ image: 'https://x.test/x/p.jpg' });
        expect(resize('https://x.test/up/p.jpg')).toEqual({ image: 'https://x.test/$&$1/p.jpg' });
        expect(resize('https://x.test/up/' + 'a'.repeat(3000))).toBeUndefined();
    });

    it('drops bad rules with a warning', () => {
        const warn = vi.fn();
        expect(compileResize([{ match: '' }, { image: 'x' }, { match: 'a'.repeat(201) }], warn)).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(3);
        expect(compileResize('nope')).toBeUndefined();
        const many = Array.from({ length: 25 }, (_, i) => ({ match: `r${i}`, image: 'x' }));
        compileResize(many, warn);
        expect(warn).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'bad-resize' }));
    });
});

describe('srcsetSizes', () => {
    it('takes the smallest copy of at least 512 and 1024 px and the largest for the viewer', () => {
        expect(srcsetSizes('/a-300.jpg 300w, /a-2000.jpg 2000w, /a-600.jpg 600w, /a-1200.jpg 1200w')).toEqual({ image: '/a-600.jpg', image_focus: '/a-1200.jpg', image_full: '/a-2000.jpg' });
    });

    it('keeps commas that belong to a URL', () => {
        const c = (w: number) => `https://res.cloudinary.com/d/image/upload/c_scale,w_${w}/a.jpg`;
        expect(srcsetSizes(`${c(400)} 400w, ${c(800)} 800w,${c(1600)} 1600w`)).toEqual({ image: c(800), image_focus: c(1600) });
        expect(srcsetSizes('/a.jpg, /b-600.jpg 600w, /b-900.jpg 900w')).toEqual({ image: '/b-600.jpg', image_focus: '/b-900.jpg' });
    });

    it('drops sizes that repeat and needs two or more widths', () => {
        expect(srcsetSizes('/a-192.png 192w, /a-480.png 480w')).toEqual({ image: '/a-480.png' });
        expect(srcsetSizes('/a-600.jpg 600w, /a-900.jpg 900w')).toEqual({ image: '/a-600.jpg', image_focus: '/a-900.jpg' });
        expect(srcsetSizes('/a.jpg 800w')).toBeUndefined();
        expect(srcsetSizes('/a.jpg 1x, /b.jpg 2x')).toBeUndefined();
        expect(srcsetSizes(null)).toBeUndefined();
    });
});

describe('normalizeItem applies the sizes', () => {
    it('keeps the original as image_full', () => {
        expect(normalizeItem(item('https://i.imgur.com/OB0y6MR.jpg'))).toMatchObject({ image: 'https://i.imgur.com/OB0y6MRl.jpg', image_focus: 'https://i.imgur.com/OB0y6MRh.jpg', image_full: 'https://i.imgur.com/OB0y6MR.jpg' });
    });

    it('leaves an item that already has sizes, and one from an unknown host', () => {
        const sized = item('https://i.imgur.com/OB0y6MR.jpg', { image_focus: 'https://i.imgur.com/big.jpg' });
        expect(normalizeItem(sized)).toEqual(sized);
        expect(normalizeItem(item('https://example.com/a.jpg'))).toEqual(item('https://example.com/a.jpg'));
    });

    it('drops a size that is not http(s)', () => {
        const resize = compileResize([{ match: 'https://', image: 'javascript:alert(1)//{url}', image_focus: '{url_raw}?f=1' }]);
        expect(normalizeItem(item('https://x.test/a.jpg'), undefined, undefined, resize)).toEqual({ ...item('https://x.test/a.jpg'), image_focus: 'https://x.test/a.jpg?f=1', image_full: undefined });
    });
});

describe('the adapters use the sizes', () => {
    it('WellKnownAdapter applies the manifest\'s media.resize', async () => {
        const f = stubFetch({
            'http://x.test/.well-known/wall.json': JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }], media: { resize: [{ match: '.png', image: '-512.png' }] } }),
            'http://x.test/f.json': JSON.stringify({ items: [{ id: '1', link: '/1', image: '/1.png', aspect: 1 }] }),
        });
        const [it1] = (await new WellKnownAdapter({ origin: 'http://x.test', fetch: f }).page({})).items;
        expect(it1).toMatchObject({ image: 'http://x.test/1-512.png', image_full: 'http://x.test/1.png' });
    });

    it('RecipeAdapter applies the recipe\'s media.resize and takes the sizes from a srcset', async () => {
        const recipe = JSON.parse(read('recipes/botanical-dom.json')) as Recipe;
        const html = '<ul><li class="plate" data-id="p1"><a class="plate__link" href="/plates/p1"><img class="plate__img" src="/i/a.png" srcset="/i/a-600.png 600w, /i/a-1200.png 1200w, /i/a-3000.png 3000w"></a></li></ul>';
        const a = new RecipeAdapter({ recipe, document: doc(html), url: 'https://prints.example/plates' });
        expect((await a.page({})).items[0]).toMatchObject({ image: 'https://prints.example/i/a-600.png', image_focus: 'https://prints.example/i/a-1200.png', image_full: 'https://prints.example/i/a-3000.png' });

        const ruled = { ...recipe, media: { resize: [{ match: '/i/', image: '/small/' }] } };
        const html2 = '<ul><li class="plate" data-id="p1"><a class="plate__link" href="/plates/p1"><img class="plate__img" src="/i/a.png"></a></li></ul>';
        const b = new RecipeAdapter({ recipe: ruled, document: doc(html2), url: 'https://prints.example/plates' });
        expect((await b.page({})).items[0]).toMatchObject({ image: 'https://prints.example/small/a.png', image_full: 'https://prints.example/i/a.png' });

        const rewritten = { ...recipe, list: { ...recipe.list!, fields: { ...recipe.list!.fields, image: { ...recipe.list!.fields.image, srcset: 'largest' as const, re: '^(.*)-3000(\\.png)$', group: 1 } } } };
        const c = new RecipeAdapter({ recipe: rewritten, document: doc(html), url: 'https://prints.example/plates' });
        expect((await c.page({})).items[0]).toMatchObject({ image: 'https://prints.example/i/a' });
    });

    it('DomAdapter takes the sizes from a srcset, unless the page names them', async () => {
        const page = (img: string) => doc(`<ul><li data-wall-item data-wall-aspect="1"><a href="/x">${img}</a></li></ul>`);
        const read1 = async (img: string) => (await new DomAdapter({ root: page(img), baseUrl: 'http://shop.test/' }).page({})).items[0];
        expect(await read1('<img src="/a.jpg" srcset="/a-400.jpg 400w, /a-800.jpg 800w, /a-1600.jpg 1600w">')).toMatchObject({ image: 'http://shop.test/a-800.jpg', image_focus: 'http://shop.test/a-1600.jpg' });
        expect(await read1('<img src="/a.jpg" data-wall-image-full="/big.jpg" srcset="/a-400.jpg 400w, /a-800.jpg 800w">')).toEqual(expect.objectContaining({ image: 'http://shop.test/a.jpg', image_full: 'http://shop.test/big.jpg' }));
    });
});

describe('{url} is encoded, {url_raw} is not', () => {
    const url = 'https://cdn.test/a b/p.jpg?x=1&y=2#f';
    it('encodes {url} as one query value and leaves {url_raw} as it is', () => {
        const resize = compileResize([{ match: 'https://cdn.test/', image: 'https://proxy.test/r?u={url}&w=512', image_focus: '{url_raw}?w=1024' }])!;
        expect(resize(url)).toEqual({ image: `https://proxy.test/r?u=${encodeURIComponent(url)}&w=512`, image_focus: `${url}?w=1024` });
        expect(resize(url)!.image).not.toContain('&y=2');
    });
});

describe('Wikimedia with a known original width', () => {
    const src = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg';
    const t = (w: number) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/${w}px-Example.jpg`;
    it('asks for no thumb that is wider than the original', () => {
        expect(sizesFor(src, undefined, { width: 300 })).toBeUndefined();
        expect(sizesFor(src, undefined, { width: 499 })).toBeUndefined();
        expect(sizesFor(src, undefined, { width: 800 })).toEqual({ image: t(500), image_focus: src });
        expect(sizesFor(src, undefined, { width: 500 })).toEqual({ image: t(500), image_focus: src });
        expect(sizesFor(src, undefined, { width: 3000 })).toEqual({ image: t(500), image_focus: t(1280) });
    });
    it('keeps both thumbs when the width is unknown or unusable', () => {
        for (const hint of [undefined, {}, { width: 0 }, { width: NaN }]) expect(sizesFor(src, undefined, hint)).toEqual({ image: t(500), image_focus: t(1280) });
    });
    it('does not limit an SVG, which is drawn from vectors', () => {
        const svg = 'https://upload.wikimedia.org/wikipedia/commons/8/84/Example.svg';
        expect(sizesFor(svg, undefined, { width: 100 })?.image_focus).toContain('1280px-');
    });
    it('normalizeItem passes the item width on', () => {
        const base = { id: 'a', link: 'https://x.test/a', image: src, aspect: 1 };
        expect(normalizeItem({ ...base, width: 300, height: 200 })).toMatchObject({ image: src });
        expect(normalizeItem({ ...base, width: 800 })).toMatchObject({ image: t(500), image_focus: src, image_full: src });
        expect(normalizeItem({ ...base, width: '300' })).toMatchObject({ image: src });
        expect(normalizeItem(base)).toMatchObject({ image: t(500), image_focus: t(1280), image_full: src });
    });
});
