import { describe, expect, it } from 'vitest';
import { bandColor, bandTextColor, layoutTextCard, shortDate, wrapText } from '../src/scene/textCard.js';
import { COLORS } from '../src/scene/text.js';
import { descriptionOf } from '../src/view/actions';

// 10 px per character, whatever the size: enough to test wrapping.
const m = (s) => s.length * 10;

describe('wrapText', () => {
    it('breaks at spaces and keeps every word', () => {
        expect(wrapText('one two three four', 90, 5, m)).toEqual(['one two', 'three', 'four']);
    });
    it('ends the last line with an ellipsis when text is left over', () => {
        const lines = wrapText('one two three four five six', 90, 2, m);
        expect(lines).toHaveLength(2);
        expect(lines[1].endsWith('…')).toBe(true);
        expect(lines.every((l) => m(l) <= 90)).toBe(true);
    });
    it('splits a word longer than a line', () => {
        expect(wrapText('abcdefghijkl', 50, 5, m)).toEqual(['abcde', 'fghij', 'kl']);
    });
    it('wraps Cyrillic like Latin', () => {
        const lines = wrapText('Закон за изменение и допълнение на Закона за данъците', 120, 2, m);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe('Закон за');
        expect(lines[1].endsWith('…')).toBe(true);
    });
    it('returns no lines for empty text and one line for a short text', () => {
        expect(wrapText('', 100, 3, m)).toEqual([]);
        expect(wrapText('hi', 100, 3, m)).toEqual(['hi']);
    });
    it('never exceeds maxLines, even for one very long word', () => {
        const lines = wrapText('x'.repeat(500), 50, 3, m);
        expect(lines).toHaveLength(3);
        expect(lines[2].endsWith('…')).toBe(true);
    });
});

describe('wrapText cost', () => {
    const cjk = '规'.repeat(500);
    const counted = () => {
        const c = { calls: 0, chars: 0 };
        return [c, (s) => { c.calls++; c.chars += s.length; return s.length * 10; }];
    };
    it('measures a 500-char unbroken excerpt a bounded number of times', () => {
        const [c, measure] = counted();
        const lines = wrapText(cjk, 200, 12, measure);
        expect(lines).toHaveLength(12);
        expect(lines.every((l) => l.length * 10 <= 200)).toBe(true);
        expect(c.calls).toBeLessThan(200);
        expect(c.chars).toBeLessThan(20000);
    });
    it('gives the same lines as a character-by-character trim', () => {
        const slow = (text, width, max) => {
            const lines = [];
            let rest = text;
            while (rest && lines.length < max) {
                let cut = rest.length;
                while (cut > 1 && cut * 10 > width) cut--;
                lines.push(rest.slice(0, cut));
                rest = rest.slice(cut);
            }
            return lines;
        };
        expect(wrapText(cjk, 200, 5, m).slice(0, 4)).toEqual(slow(cjk, 200, 5).slice(0, 4));
    });
});

describe('shortDate', () => {
    it('shows the day a bare date names, in any time zone', () => {
        expect(shortDate('2026-10-10', 'en')).toBe('Oct 10, 2026');
        expect(shortDate('2026-01-01', 'en')).toBe('Jan 1, 2026');
    });
    it('localises', () => {
        expect(shortDate('2026-10-10', 'bg')).toMatch(/2026/);
        expect(shortDate('2026-10-10', 'bg')).not.toBe(shortDate('2026-10-10', 'en'));
    });
    it('accepts a date-time and gives an empty string for rubbish', () => {
        expect(shortDate('2026-10-10T12:00:00Z', 'en')).toMatch(/Oct (10|11), 2026/);
        expect(shortDate('yesterday', 'en')).toBe('');
        expect(shortDate(undefined, 'en')).toBe('');
    });
});

describe('band colours', () => {
    it('uses a valid item accent and falls back to the brand otherwise', () => {
        expect(bandColor({ accent: '#a1b2c3' })).toBe('#a1b2c3');
        expect(bandColor({ accent: '#abc' })).toBe('#abc');
        expect(bandColor({ accent: 'red' })).toBe(COLORS.accentStrong);
        expect(bandColor({})).toBe(COLORS.accentStrong);
    });
    it('picks light text on a dark band and dark text on a light band', () => {
        expect(bandTextColor('#7a1f2b')).toBe('#ffffff');
        expect(bandTextColor('#f2c94c')).toBe('#0e0e10');
    });
});

describe('layoutTextCard', () => {
    const item = { id: '1', link: '/a', title: 'Закон за нещо си много дълго заглавие което не се събира', subtitle: 'Народно събрание', badges: ['Закон'], excerpt: 'Първо изречение. '.repeat(30), date: '2026-10-10' };
    it('fits everything inside the canvas, leaving room for the date', () => {
        const L = layoutTextCard(item, 512, 683, (s, size) => s.length * size * 0.5, { locale: 'en' });
        expect(L.kicker).toBe('Закон');
        expect(L.title.length).toBeGreaterThan(1);
        expect(L.title.length).toBeLessThanOrEqual(4);
        expect(L.excerpt.length).toBeGreaterThan(0);
        const lastBottom = L.y.excerpt + L.excerpt.length * L.lineH;
        expect(lastBottom).toBeLessThanOrEqual(L.footRule + 1);
        expect(L.date).toBe('Oct 10, 2026');
    });
    it('gives the viewer more excerpt lines than the card', () => {
        const meas = (s, size) => s.length * size * 0.5;
        const card = layoutTextCard(item, 512, 683, meas, { detail: 'card' });
        const view = layoutTextCard(item, 1024, 1365, meas, { detail: 'viewer' });
        expect(view.excerpt.length).toBeGreaterThan(card.excerpt.length);
    });
    it('copes with a title only: no kicker, no date, no excerpt', () => {
        const L = layoutTextCard({ id: '1', link: '/a', title: 'Just a title' }, 512, 683, m);
        expect(L.kicker).toBe('');
        expect(L.date).toBe('');
        expect(L.excerpt).toEqual([]);
        expect(L.subtitle).toEqual([]);
        expect(L.title).toEqual(['Just a title']);
    });
});

describe('descriptionOf', () => {
    it('prefers description, falls back to excerpt only for an item with a picture', () => {
        expect(descriptionOf({ id: '1', link: '/', description: 'd', excerpt: 'e', image: '/i.jpg' })).toBe('d');
        expect(descriptionOf({ id: '1', link: '/', excerpt: 'e', image: '/i.jpg' })).toBe('e');
        expect(descriptionOf({ id: '1', link: '/', excerpt: 'e', title: 'T' })).toBeUndefined();
    });
});
