import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../src/scene/Gallery.js';
import { Pager } from '../src/feed/Pager.js';
import { shortDate, sourceHost } from '../src/scene/textCard.js';
import { curveOf, rowsOf, shapeOf, stepCurve, stepRows } from '../src/scene/comfort.js';
import { resolveView } from '../src/view/resolveView';
import { DEFAULT_BRAND } from '../src/brand/contrast';
import { cardLabelLines, creatorName, panelLines } from '../src/view/actions';
import en from '../src/strings/en.js';

const proto = Gallery.prototype;

describe('panel lines: date and source host', () => {
    const lines = (item) => proto.defaultPanelLines.call({ locale: 'en' }, item);

    it('adds the short date and the host without www. after title and creator', () => {
        const item = { title: 'T', creator: { label: 'Ann' }, date: '2026-10-10', link: 'https://www.artic.edu/artworks/1', likes: 3 };
        const out = lines(item);
        expect(out.map((l) => l.text)).toEqual(['T', 'Ann', shortDate('2026-10-10', 'en') + ' · artic.edu', '♥ 3']);
        expect(out.map((l) => l.text)[1]).toBe('Ann');
        expect(out[2].style).toBe('soft');
        expect(lines({ title: 'T', creator: { id: 'ann', label: 'ann' } })[1].text).toBe('@ann');
    });

    it('every creator line uses @ only for accounts', () => {
        const art = { title: 'Water Lilies', creator: { label: 'Claude Monet' } };
        expect(creatorName(art.creator)).toBe('Claude Monet');
        expect(creatorName({ id: 'u1', label: 'ann' })).toBe('@ann');
        expect(creatorName(undefined)).toBe('');
        expect(panelLines(art, ['title', 'creator']).map((l) => l.text)).toEqual(['Water Lilies', 'Claude Monet']);
        expect(cardLabelLines(art, ['title', 'creator'])).toEqual(['Water Lilies', 'Claude Monet']);
        expect(proto.describe.call({ strings: en, cards: [] }, { item: art }, 0)).not.toContain('@');
    });

    it('skips what it cannot show and never throws on a bad link', () => {
        expect(() => lines({ title: 'T', link: 'not a url', date: 'nope' })).not.toThrow();
        expect(lines({ title: 'T', link: 'not a url', date: 'nope' }).map((l) => l.text)).toEqual(['T']);
        expect(lines({ title: 'T', link: '/relative/path' }).map((l) => l.text)).toEqual(['T']);
        expect(lines({ title: 'T', link: 'https://example.org/x' }).map((l) => l.text)).toEqual(['T', 'example.org']);
    });

    it('sourceHost strips only a leading www.', () => {
        expect(sourceHost('https://www.smk.dk/a')).toBe('smk.dk');
        expect(sourceHost('https://api.www.example.org/')).toBe('api.www.example.org');
        expect(sourceHost(undefined)).toBe('');
    });
});

describe('comfort: curve and rows', () => {
    const view = resolveView(null, null, DEFAULT_BRAND, () => {});

    it('defaults to the view and steps inside the limits', () => {
        expect(curveOf({ curve: null }, view)).toBe(2.5);
        expect(rowsOf({ rows: null }, view)).toBe(3);
        expect(stepCurve({ curve: 1.8 }, view, -1)).toBe(1.8);
        expect(stepCurve({ curve: 4 }, view, 1)).toBe(4);
        expect(stepCurve({ curve: null }, view, 1)).toBe(2.7);
        expect(stepRows({ rows: 1 }, view, -1)).toBe(1);
        expect(stepRows({ rows: null }, view, -1)).toBe(2);
        expect(rowsOf({ rows: 99 }, view)).toBeLessThanOrEqual(5);
        expect(curveOf({ curve: 99 }, view)).toBe(4);
    });

    it('shapeOf keeps the view arc and card size and uses the choice', () => {
        expect(shapeOf({ curve: 3, rows: 2 }, view)).toMatchObject({ radius: 3, rows: 2, arc: view.wall.arc, cardW: view.wall.cardW });
    });

    it('changeSetting persists curve and rows, relayouts without a reload, and reset clears both', () => {
        const save = vi.fn();
        const g = {
            settings: { height: 0, distance: 1, curve: null, rows: null },
            view,
            applyShape: vi.fn(),
            saveSettings: save,
            applyComfort: vi.fn(),
            openSettings: vi.fn(),
            reload: vi.fn(),
        };
        proto.changeSetting.call(g, 'curve', 1);
        proto.changeSetting.call(g, 'rows', -1);
        expect(g.settings).toMatchObject({ curve: 2.7, rows: 2 });
        proto.changeSetting.call(g, 'resetComfort', 0);
        expect(g.settings).toMatchObject({ curve: null, rows: null });
        expect(g.applyShape).toHaveBeenCalledTimes(3);
        expect(save).toHaveBeenCalledTimes(3);
        expect(g.reload).not.toHaveBeenCalled();
    });
});

describe('Pager.resume', () => {
    it('continues from the same cursor after a stop and keeps the items', async () => {
        const page = vi.fn()
            .mockResolvedValueOnce({ items: [{ id: 'a' }], next: 'c1' })
            .mockRejectedValue(new Error('down'));
        const pager = new Pager({ page });
        await pager.next();
        for (let i = 0; i < 6; i++) {
            pager.notBefore = 0;
            await pager.next().catch(() => {});
        }
        expect(pager.stopped).toBe('errors');
        expect(pager.done).toBe(true);
        page.mockResolvedValueOnce({ items: [{ id: 'b' }], next: undefined });
        pager.resume();
        expect(pager.canFetch()).toBe(true);
        expect((await pager.next()).map((i) => i.id)).toEqual(['b']);
        expect(page.mock.calls.at(-1)[0].cursor).toBe('c1');
        expect(pager.items.map((i) => i.id)).toEqual(['a', 'b']);
    });

    it('does nothing when paging has not stopped', () => {
        const pager = new Pager({ page: vi.fn() });
        pager.failures = 2;
        pager.resume();
        expect(pager.failures).toBe(2);
    });
});

describe('load errors on the wall', () => {
    const fake = (over = {}) => ({
        strings: en,
        cards: [],
        feed: { stopped: null, done: false, resume: vi.fn() },
        retryButton: { visible: false },
        setStatus: vi.fn(),
        emptyLabel: () => 'empty',
        reload: vi.fn(),
        loadMore: vi.fn(),
        ...over,
    });

    it('a stop with cards shows load_stopped and Try again, which resumes instead of reloading', () => {
        const g = fake({ cards: [{}], feed: { stopped: 'errors', done: true, resume: vi.fn() } });
        proto.showFeedState.call(g, g.feed, true);
        expect(g.setStatus).toHaveBeenLastCalledWith(en.load_stopped);
        expect(g.retryButton.visible).toBe(true);
        proto.retry.call(g);
        expect(g.feed.resume).toHaveBeenCalled();
        expect(g.loadMore).toHaveBeenCalled();
        expect(g.reload).not.toHaveBeenCalled();
        expect(g.retryButton.visible).toBe(false);
    });

    it('a repeated cursor stop (no throw) is shown too; a normal end is not', () => {
        const g = fake({ cards: [{}], feed: { stopped: 'cursor_repeat', done: true } });
        proto.showFeedState.call(g, g.feed);
        expect(g.setStatus).toHaveBeenLastCalledWith(en.load_stopped);
        const h = fake({ cards: [{}], feed: { stopped: null, done: true } });
        proto.showFeedState.call(h, h.feed);
        expect(h.setStatus).toHaveBeenLastCalledWith(null);
        expect(h.retryButton.visible).toBe(false);
    });

    it('with no cards a failure still shows the error and a full reload', () => {
        const g = fake();
        proto.showFeedState.call(g, g.feed, true);
        expect(g.setStatus).toHaveBeenLastCalledWith(en.error);
        expect(g.retryButton.visible).toBe(true);
        proto.retry.call(g);
        expect(g.reload).toHaveBeenCalled();
    });

    describe('still loading after 8 s', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('shows still_loading at 8 s on an empty wall and clears it when a card arrives', () => {
            const g = fake();
            g.clearStillLoading = proto.clearStillLoading;
            proto.armStillLoading.call(g);
            vi.advanceTimersByTime(7999);
            expect(g.setStatus).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1);
            expect(g.setStatus).toHaveBeenLastCalledWith(en.still_loading);
            expect(g.stillLoading).toBe(true);
            g.cards.push({});
            proto.showFeedState.call(g, g.feed);
            expect(g.setStatus).toHaveBeenLastCalledWith(null);
        });

        it('stays quiet when a card arrived in time', () => {
            const g = fake();
            g.clearStillLoading = proto.clearStillLoading;
            proto.armStillLoading.call(g);
            g.cards.push({});
            proto.clearStillLoading.call(g);
            vi.advanceTimersByTime(20000);
            expect(g.setStatus).not.toHaveBeenCalled();
        });
    });
});
