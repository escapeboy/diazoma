import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND, contrast, validateBrand } from '../src/brand/contrast';
import { DEFAULT_PANEL, fixTextColour, mergeView, resolveView, truncate } from '../src/view/resolveView';

const brand = validateBrand({}, () => {});
const run = (adapterView?: unknown, optionsView?: unknown, b = brand) => {
    const warnings: string[] = [];
    const view = resolveView(adapterView, optionsView, b, (m) => warnings.push(m));
    return { view, warnings };
};

describe('resolveView', () => {
    it('reproduces the shipped scene without a view, with no warning', () => {
        const { view, warnings } = run();
        expect(warnings).toEqual([]);
        expect(view.wall).toEqual({ rows: 3, radius: 2.5, arc: 120, cardW: 0.38, cardH: 0.44, label: 'hover', labelFields: ['title', 'creator', 'count'], badges: true, indicator: 'like' });
        expect(view.panel).toEqual({ fields: null, side: ['creator', 'collection', 'tags'], metaLabels: {} });
        expect(view.actions).toEqual({});
        expect(view.environment).toBeNull();
        expect(view.font).toBe(DEFAULT_BRAND.font);
        const { panel, ...colors } = view.colors;
        expect(panel).toBe(DEFAULT_PANEL);
        expect(colors).toEqual({ bg: '#0e0e10', surface: '#1b1b1f', surfaceHi: '#26262c', text: '#f4f3f2', textSoft: '#c4c4ca', muted: '#9a9aa2', accent: '#ef5a73', accentStrong: '#c9334f', accentText: '#f4f3f2' });
    });

    it('clamps rows, radius, arc and card sizes, one warning each', () => {
        const { view, warnings } = run({ wall: { rows: 0, radius: 9, arc: 200, card: { width: 0.1, height: 0.9 } } });
        expect(view.wall.rows).toBe(1);
        expect(view.wall.radius).toBe(4);
        expect(view.wall.arc).toBe(150);
        expect(view.wall.cardH).toBe(0.7);
        // 0.25 m (the minimum) is narrower than 0.1 rad at 4 m, so it is widened to 0.4.
        expect(view.wall.cardW).toBe(0.4);
        expect(warnings.length).toBe(6);
    });

    it('rounds rows to an integer and drops rows that make the wall too tall', () => {
        expect(run({ wall: { rows: 2.4 } }).view.wall.rows).toBe(2);
        const tall = run({ wall: { rows: 5, card: { height: 0.6 } } });
        expect(tall.view.wall.rows).toBe(3); // 3 × 0.66 ≤ 2.2 < 4 × 0.66
        expect(tall.warnings.join()).toContain('taller than 2.2 m');
        expect(run({ wall: { rows: 4 } }).view.wall.rows).toBe(4); // 4 × 0.5 = 2.0
    });

    it('ignores values that are not numbers', () => {
        const { view, warnings } = run({ wall: { rows: '4' } });
        expect(view.wall.rows).toBe(3);
        expect(warnings[0]).toContain('not a number');
    });

    it('cuts labels and icons, and keeps only known placements', () => {
        const { view, warnings } = run({ actions: { cart: { label: 'Add this lovely item to the cart now', icon: '🛒🛒🛒', placement: 'top', style: 'loud', order: 2, confirm: true } } });
        expect(view.actions.cart.label).toBe('Add this lovely item to…');
        expect([...view.actions.cart.label!].length).toBe(24);
        expect(view.actions.cart.icon).toBe('🛒🛒');
        expect(view.actions.cart.placement).toBeUndefined();
        expect(view.actions.cart.style).toBeUndefined();
        expect(view.actions.cart).toMatchObject({ order: 2, confirm: true });
        expect(warnings.length).toBe(3);
    });

    it('counts a flag emoji as one character', () => {
        expect(run({ actions: { a: { icon: '🇧🇬' } } }).view.actions.a.icon).toBe('🇧🇬');
    });

    it('warns when more than three actions ask to be primary', () => {
        const actions = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, { placement: 'primary' }]));
        expect(run({ actions }).warnings.join()).toContain('at most 3');
    });

    it('takes options over the adapter, key by key, and replaces arrays', () => {
        const { view } = run(
            { wall: { rows: 4, badges: false }, panel: { fields: ['title', 'meta'] }, strings: { a: 'site', b: 'site' } },
            { wall: { rows: 2 }, panel: { fields: ['subtitle'] }, strings: { b: 'page' } },
        );
        expect(view.wall.rows).toBe(2);
        expect(view.wall.badges).toBe(false);
        expect(view.panel.fields).toEqual(['subtitle']);
        expect(view.strings).toEqual({ a: 'site', b: 'page' });
    });

    it('keeps known panel and label fields, meta.<key> included, up to the line limits', () => {
        const { view, warnings } = run({
            panel: { fields: ['title', 'meta.price', 'nope', 'meta.a.b', 'likes', 'tags', 'badges', 'meta', 'description', 'creator', 'subtitle'], side: ['tags', 'x'], metaLabels: { price: 'Цена' } },
            wall: { labelFields: ['title', 'meta.price', 'subtitle', 'creator'] },
        });
        expect(view.panel.fields).toEqual(['title', 'meta.price', 'likes', 'tags', 'badges', 'meta', 'description', 'creator']);
        expect(view.panel.side).toEqual(['tags']);
        expect(view.panel.metaLabels).toEqual({ price: 'Цена' });
        expect(view.wall.labelFields).toEqual(['title', 'meta.price', 'subtitle']);
        expect(warnings.length).toBe(2);
    });

    it('keeps an explicit null indicator and label none', () => {
        const { view } = run({ wall: { indicator: null, label: 'none' } });
        expect(view.wall.indicator).toBeNull();
        expect(view.wall.label).toBe('none');
    });

    it('fixes text that does not read on a light background', () => {
        const { view, warnings } = run({ theme: { colors: { bg: '#ffffff', surface: '#f2f2f2', panel: 'rgba(255,255,255,0.9)' } } });
        for (const key of ['text', 'textSoft', 'muted', 'accent'] as const) {
            for (const back of ['#ffffff', '#f2f2f2']) expect(contrast(view.colors[key], back)).toBeGreaterThanOrEqual(4.5);
        }
        expect(warnings.length).toBeGreaterThanOrEqual(3);
    });

    it('ignores invalid colours and darkens a filled button that the text does not read on', () => {
        const { view, warnings } = run({ theme: { colors: { text: 'red', accentStrong: '#ffcc00', accentText: '#ffffff' } } });
        expect(view.colors.text).toBe('#f4f3f2');
        expect(contrast(view.colors.accentText, view.colors.accentStrong)).toBeGreaterThanOrEqual(4.5);
        expect(warnings.some((w) => w.includes('theme.colors.text'))).toBe(true);
    });

    it('accepts the alpha 1.0 the schema allows', () => {
        const { view, warnings } = run({ theme: { colors: { panel: 'rgba(10,20,40,1.0)' } } });
        expect(view.colors.panel).toBe('rgba(10,20,40,1.0)');
        expect(warnings).toEqual([]);
    });

    it('accepts an rgba panel and rejects rgba elsewhere', () => {
        const { view, warnings } = run({ theme: { colors: { panel: 'rgba(0, 0, 0, .6)', bg: 'rgba(0,0,0,1)' } } });
        expect(view.colors.panel).toBe('rgba(0, 0, 0, .6)');
        expect(view.colors.bg).toBe('#0e0e10');
        expect(warnings.length).toBe(1);
    });

    it('keeps only http(s) panoramas and clamps dim', () => {
        expect(run({ theme: { environment: { panorama: 'javascript:alert(1)' } } }).view.environment!.panorama).toBeUndefined();
        expect(run({ theme: { environment: { panorama: 'data:image/png;base64,AA' } } }).view.environment!.panorama).toBeUndefined();
        expect(run({ theme: { environment: { panorama: '/sky.jpg' } } }).view.environment!.panorama).toBeUndefined();
        const ok = run({ theme: { environment: { panorama: 'https://cdn.example.com/sky.jpg', dim: 2, top: '#000', floor: 'blue', preset: 'night', stars: false } } });
        expect(ok.view.environment).toEqual({ panorama: 'https://cdn.example.com/sky.jpg', dim: 0.8, top: '#000', preset: 'night', stars: false });
        expect(ok.warnings.length).toBe(2);
    });

    it('rejects a font with CSS syntax in it', () => {
        expect(run({ theme: { font: 'x; } body { color: red' } }).view.font).toBe(DEFAULT_BRAND.font);
        expect(run({ theme: { font: 'Georgia, serif' } }).view.font).toBe('Georgia, serif');
    });

    it('leaves brand colours that are not #hex alone instead of throwing', () => {
        const b = validateBrand({ accent: 'red', bg: 'black', text: 'hsl(0 0% 95%)' }, () => {});
        const { view, warnings } = run(undefined, undefined, b);
        expect(view.colors.text).toBe('hsl(0 0% 95%)');
        expect(view.colors.bg).toBe('black');
        expect(warnings).toEqual([]);
        expect(() => run({ theme: { colors: { surface: '#ffffff' } } }, undefined, b)).not.toThrow();
    });

    it('survives garbage', () => {
        for (const bad of [null, 1, 'x', [], { actions: [], panel: 3, wall: 'x', theme: [], strings: 2 }]) {
            expect(() => run(bad, bad)).not.toThrow();
        }
    });
});

describe('helpers', () => {
    it('mergeView merges objects and replaces everything else', () => {
        expect(mergeView({ a: { b: 1, c: [1] } }, { a: { c: [2], d: 3 } }, null)).toEqual({ a: { b: 1, c: [2], d: 3 } });
    });

    it('truncate leaves short text alone', () => {
        expect(truncate('abc', 3)).toBe('abc');
        expect(truncate('abcd', 3)).toBe('ab…');
        expect(truncate('abcd', 3, false)).toBe('abc');
    });

    it('fixTextColour picks black on light and white on dark', () => {
        expect(contrast(fixTextColour('#cccccc', ['#ffffff']), '#ffffff')).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fixTextColour('#333333', ['#000000']), '#000000')).toBeGreaterThanOrEqual(4.5);
        expect(fixTextColour('#ffffff', ['#000000'])).toBe('#ffffff');
    });
});
