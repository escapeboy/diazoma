import { describe, expect, it } from 'vitest';
import en from '../src/strings/en.js';
import { actionFace, actionIds, cardLabelLines, hookLines, isActive, panelLines, placeActions, stateKey } from '../src/view/actions';
import type { Item } from '../src/types';

const item = (extra: Partial<Item> & { _liked?: boolean } = {}): Item & { _liked?: boolean } => ({ id: '1', link: 'https://x.test/1', image: 'https://x.test/1.jpg', aspect: 1, ...extra });
const SHIPPED = ['like', 'follow', 'save', 'create-and-save'];

describe('actionIds', () => {
    it('keeps the shipped column for a site with like, follow, save and create-and-save', () => {
        expect(actionIds(SHIPPED, item(), {})).toEqual(['like', 'save']);
    });

    it('shows nothing when the site declares nothing', () => {
        expect(actionIds([], item(), {})).toEqual([]);
    });

    it('narrows to item.actions, ignoring a value that is not an array and unknown ids', () => {
        const declared = ['favourite', 'cart', 'compare'];
        expect(actionIds(declared, item({ actions: ['cart', 'nope'] }), {})).toEqual(['cart']);
        expect(actionIds(declared, item({ actions: [] }), {})).toEqual([]);
        expect(actionIds(declared, item({ actions: 'cart' as unknown as string[] }), {})).toEqual(declared);
    });

    it('drops hidden actions and sorts by order, then declaration', () => {
        const views = { cart: { order: 1 }, compare: { placement: 'hidden' as const }, enquire: { order: 0 } };
        expect(actionIds(['favourite', 'cart', 'compare', 'enquire'], item(), views)).toEqual(['enquire', 'cart', 'favourite']);
    });

    it('puts follow in the column only when the site places it', () => {
        expect(actionIds(['follow'], item(), {})).toEqual([]);
        expect(actionIds(['follow'], item(), { follow: { placement: 'more' } })).toEqual(['follow']);
        expect(actionIds(['follow'], item(), { follow: { placement: 'hidden' } })).toEqual([]);
    });

    it('lets a hook reorder and drop, never add', () => {
        expect(actionIds(['a', 'b', 'c'], item(), {}, () => ['c', 'x', 'a', 'a'])).toEqual(['c', 'a']);
        expect(actionIds(['a', 'b'], item(), {}, () => 'nope' as unknown as string[])).toEqual(['a', 'b']);
    });

    it('drops duplicate declarations', () => {
        expect(actionIds(['a', 'a', 'b'], item(), {})).toEqual(['a', 'b']);
    });
});

describe('placeActions', () => {
    it('puts the first two in the column by default', () => {
        expect(placeActions(['a', 'b', 'c'], {})).toEqual({ primary: ['a', 'b'], more: ['c'] });
    });

    it('skips actions placed under More when choosing the default two', () => {
        expect(placeActions(['a', 'b', 'c'], { a: { placement: 'more' } })).toEqual({ primary: ['b', 'c'], more: ['a'] });
    });

    it('takes explicit primaries, at most three', () => {
        const views = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, { placement: 'primary' as const }]));
        expect(placeActions(['a', 'b', 'c', 'd', 'e'], views)).toEqual({ primary: ['a', 'b', 'c'], more: ['d', 'e'] });
        expect(placeActions(['a', 'b', 'c'], { c: { placement: 'primary' } })).toEqual({ primary: ['c'], more: ['a', 'b'] });
    });
});

describe('actionFace', () => {
    it('draws like exactly as shipped', () => {
        expect(actionFace('like', item(), undefined, en)).toEqual({ label: '♡ ' + en.like, filled: false, active: false });
        expect(actionFace('like', item({ _liked: true }), undefined, en)).toEqual({ label: '♥ ' + en.liked, filled: true, active: true });
        expect(actionFace('save', item(), undefined, en).label).toBe('📌 ' + en.save);
    });

    it('uses the site label, icon, active label and count', () => {
        const view = { label: 'Favourite', labelActive: 'Favourited', icon: '☆', iconActive: '★', state: 'fav', count: 'favs' };
        expect(actionFace('favourite', item({ state: { favs: 3 } }), view, en).label).toBe('☆ Favourite · 3');
        expect(actionFace('favourite', item({ state: { fav: true, favs: 4 } }), view, en)).toEqual({ label: '★ Favourited · 4', filled: true, active: true });
    });

    it('reads a count from the item itself', () => {
        expect(actionFace('like', item({ likes: 12 }), { count: 'likes' }, en).label).toBe('♡ ' + en.like + ' · 12');
    });

    it('falls back to action_<id> strings, then the id', () => {
        expect(actionFace('add_to_cart', item(), undefined, en).label).toBe('Add to cart');
        expect(actionFace('cart', item(), undefined, { ...en, action_cart: 'In den Warenkorb' }).label).toBe('In den Warenkorb');
    });

    it('fills primary-style buttons even when inactive', () => {
        expect(actionFace('cart', item(), { style: 'primary' }, en).filled).toBe(true);
    });

    it('takes a hook label, cut to the limit', () => {
        expect(actionFace('cart', item(), undefined, en, () => 'Buy · 12 €').label).toBe('Buy · 12 €');
        expect(actionFace('cart', item(), undefined, en, () => 'x'.repeat(60)).label.length).toBe(28);
        expect(actionFace('cart', item(), { label: 'Cart' }, en, () => undefined).label).toBe('Cart');
    });

    it('state keys', () => {
        expect(stateKey('like')).toBe('liked');
        expect(stateKey('cart')).toBe('cart');
        expect(stateKey('cart', { state: 'in_cart' })).toBe('in_cart');
        expect(isActive(item({ state: { in_cart: true } }), 'cart', { state: 'in_cart' })).toBe(true);
        expect(isActive(item({ state: { liked: true } }), 'like')).toBe(false); // like reads _liked, set by the scene from state.liked
    });
});

describe('panel and label lines', () => {
    const full = item({
        title: 'Chair', subtitle: 'Oak', creator: { id: 'c', label: 'maker' }, collection: { id: 'k', label: 'Living' },
        description: 'Solid oak chair', likes: 7, tags: ['oak', 'chair'], badges: ['New', 'Sale'], meta: { price: '120 €', size: '45 cm' },
    });

    it('draws every field type in the asked order', () => {
        const lines = panelLines(full, ['title', 'meta.price', 'subtitle', 'creator', 'collection', 'description', 'likes', 'tags', 'badges'], { price: 'Цена' });
        expect(lines).toEqual([
            { text: 'Chair', style: 'title' },
            { text: 'Цена: 120 €', style: 'body' },
            { text: 'Oak', style: 'soft' },
            { text: '@maker', style: 'soft' },
            { text: '▦ Living', style: 'soft' },
            { text: 'Solid oak chair', style: 'body' },
            { text: '♥ 7', style: 'body' },
            { text: '#oak #chair', style: 'soft' },
        ]);
    });

    it('expands meta into one line per pair and skips missing fields', () => {
        expect(panelLines(full, ['meta'], {}).map((l) => l.text)).toEqual(['Price: 120 €', 'Size: 45 cm']);
        expect(panelLines(item(), ['title', 'meta.price', 'badges'], {})).toEqual([]);
    });

    it('stops at eight lines', () => {
        const meta = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['k' + i, String(i)]));
        expect(panelLines(item({ meta }), ['meta'], {}).length).toBe(8);
    });

    it('cleans hook lines', () => {
        expect(hookLines('x')).toBeNull();
        expect(hookLines([{ text: 'a', style: 'loud' }, { nope: 1 }, { text: 'b', style: 'accent' }])).toEqual([{ text: 'a', style: 'body' }, { text: 'b', style: 'accent' }]);
        expect(hookLines(Array.from({ length: 12 }, () => ({ text: 'l' })))!.length).toBe(8);
    });

    it('builds card labels from fields, three lines at most', () => {
        expect(cardLabelLines(full, ['title', 'meta.price', 'creator'], {}, ':n pins')).toEqual(['Chair', 'Price: 120 €', '@maker']);
        expect(cardLabelLines(item({ kind: 'collection', count: 4, title: 'Board' }), ['title', 'count'], {}, ':n items')).toEqual(['Board', '4 items']);
        expect(cardLabelLines(full, ['count'], {}, ':n')).toEqual([]);
    });
});
