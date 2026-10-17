import { afterEach, describe, expect, it } from 'vitest';
import * as L from '../src/scene/layout.js';
import {
    ARC,
    CARD_MAX_H,
    CARD_MAX_W,
    COL_ANGLE,
    EYE_Y,
    RADIUS,
    ROWS,
    START_ANGLE,
    clampScroll,
    columnCount,
    fitCard,
    itemTransform,
    nearEnd,
    rowY,
    scrollBounds,
    scrollProgress,
    stepInertia,
    visibleColumns,
    visibleItems,
    setWallZoom,
    WALL_ZOOM_MAX,
    WALL_ZOOM_MIN,
} from '../src/scene/layout.js';

afterEach(() => setWallZoom(1));

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('itemTransform', () => {
    it('places every card on the cylinder, facing the viewer', () => {
        for (const [index, scroll] of [[0, 0], [7, 0.3], [40, -0.2], [100, 2]]) {
            const t = itemTransform(index, scroll);
            expect(close(Math.hypot(t.x, t.z), RADIUS)).toBe(true);
            // Facing the origin: the card's forward (+Z rotated by rotationY) points back at the viewer.
            const fx = Math.sin(t.rotationY);
            const fz = Math.cos(t.rotationY);
            expect(close(fx * -t.x + fz * -t.z, RADIUS, 1e-6)).toBe(true);
        }
    });

    it('fills columns top to bottom', () => {
        expect(itemTransform(0, 0).y).toBeGreaterThan(itemTransform(1, 0).y);
        expect(itemTransform(1, 0).y).toBeGreaterThan(itemTransform(2, 0).y);
        expect(close(itemTransform(3, 0).y, itemTransform(0, 0).y)).toBe(true);
        expect(close(itemTransform(1, 0).y, EYE_Y)).toBe(true);
        expect(close(itemTransform(3, 0).angle - itemTransform(0, 0).angle, COL_ANGLE)).toBe(true);
    });

    it('column 0 at scroll 0 is straight ahead; positive scroll moves cards left', () => {
        const t = itemTransform(0, 0);
        expect(close(t.x, 0)).toBe(true);
        expect(close(t.z, -RADIUS)).toBe(true);
        expect(itemTransform(0, 0.5).x).toBeLessThan(0);
    });

    it('rows are one cell apart around eye height', () => {
        expect(rowY(0) - rowY(1)).toBeCloseTo(rowY(1) - rowY(2), 9);
        expect(rowY(1)).toBe(EYE_Y);
    });
});

describe('fitCard', () => {
    it.each([[0.5], [0.75], [1], [1.78], [3]])('fits aspect %s inside the cell and keeps the ratio', (aspect) => {
        const { w, h } = fitCard(aspect);
        expect(w).toBeLessThanOrEqual(CARD_MAX_W + 1e-9);
        expect(h).toBeLessThanOrEqual(CARD_MAX_H + 1e-9);
        expect(w / h).toBeCloseTo(aspect, 6);
    });

    it('falls back to portrait 3:4 for missing or broken aspects', () => {
        for (const a of [0, -1, NaN, Infinity, undefined]) expect(fitCard(a).w / fitCard(a).h).toBeCloseTo(0.75, 6);
    });
});

describe('scroll bounds and visibility', () => {
    it('starts with the first column just left of straight ahead, so the newest pins are in view', () => {
        const { min } = scrollBounds(90);
        expect(itemTransform(0, min).angle).toBeCloseTo(-START_ANGLE, 9);
        expect(Math.abs(itemTransform(0, min).angle)).toBeLessThan(ARC / 4);
    });

    it('ends with the last column at the right edge', () => {
        const n = 90;
        const { max } = scrollBounds(n);
        expect(itemTransform(n - 1, max).angle).toBeCloseTo(ARC / 2 - COL_ANGLE / 2, 9);
    });

    it('never lets a short wall scroll', () => {
        const { min, max } = scrollBounds(4);
        expect(max).toBe(min);
        expect(clampScroll(5, 4)).toBe(min);
    });

    it('visible columns cover the arc plus the margin', () => {
        const n = 300;
        const scroll = 3;
        const { first, last } = visibleColumns(scroll, n, 0);
        expect(itemTransform(first * ROWS, scroll).angle).toBeLessThanOrEqual(-ARC / 2 + COL_ANGLE);
        expect(itemTransform(last * ROWS, scroll).angle).toBeGreaterThanOrEqual(ARC / 2 - COL_ANGLE);
        const withMargin = visibleColumns(scroll, n, 2);
        expect(withMargin.first).toBe(first - 2);
        expect(withMargin.last).toBe(last + 2);
    });

    it('item range is clamped to what exists', () => {
        expect(visibleItems(0, 0)).toEqual({ first: 0, last: -1 });
        const r = visibleItems(scrollBounds(7).min, 7, 1);
        expect(r.first).toBe(0);
        expect(r.last).toBe(6);
        expect(columnCount(7)).toBe(3);
    });

    it('nearEnd triggers only when the tail is close', () => {
        const n = 150;
        expect(nearEnd(scrollBounds(n).min, n)).toBe(false);
        expect(nearEnd(scrollBounds(n).max, n)).toBe(true);
    });

    it('progress runs 0 → 1', () => {
        const n = 120;
        expect(scrollProgress(scrollBounds(n).min, n)).toBeCloseTo(0, 9);
        expect(scrollProgress(scrollBounds(n).max, n)).toBeCloseTo(1, 9);
    });
});

describe('stepInertia', () => {
    it('decays velocity independent of frame rate', () => {
        const n = 600;
        let a = { scroll: 0, velocity: 1 };
        for (let i = 0; i < 60; i++) a = stepInertia(a.scroll, a.velocity, 1 / 60, n);
        let b = { scroll: 0, velocity: 1 };
        for (let i = 0; i < 90; i++) b = stepInertia(b.scroll, b.velocity, 1 / 90, n);
        expect(a.velocity).toBeCloseTo(b.velocity, 6);
        expect(a.velocity).toBeLessThan(0.05);
        expect(a.scroll).toBeGreaterThan(0);
    });

    it('stops dead at the bounds', () => {
        const n = 60;
        const { max } = scrollBounds(n);
        const r = stepInertia(max - 0.01, 5, 0.1, n);
        expect(r.scroll).toBe(max);
        expect(r.velocity).toBe(0);
    });
});

describe('wall zoom', () => {
    it('widens columns and rows while cards stay on the same cylinder', () => {
        const before = itemTransform(3, 0);
        setWallZoom(2);
        const after = itemTransform(3, 0);
        expect(after.angle).toBeCloseTo(before.angle * 2, 9);
        expect(Math.hypot(after.x, after.z)).toBeCloseTo(RADIUS, 9);
        expect(rowY(0) - rowY(1)).toBeCloseTo(1.0, 9);
    });

    it('shows fewer columns when zoomed in and more when zoomed out', () => {
        const n = 600;
        const span = () => { const v = visibleColumns(3, n, 0); return v.last - v.first; };
        const normal = span();
        setWallZoom(2);
        const zoomedIn = span();
        setWallZoom(0.7);
        const zoomedOut = span();
        expect(zoomedIn).toBeLessThan(normal);
        expect(zoomedOut).toBeGreaterThan(normal);
    });

    it('clamps to the allowed range', () => {
        expect(setWallZoom(10)).toBe(WALL_ZOOM_MAX);
        expect(setWallZoom(0.1)).toBe(WALL_ZOOM_MIN);
        expect(setWallZoom(NaN)).toBe(1);
    });
});

describe('configureLayout', () => {
    afterEach(() => L.configureLayout());

    it('keeps the shipped shape by default', () => {
        L.configureLayout();
        expect([L.ROWS, L.RADIUS, L.CARD_MAX_W, L.CARD_MAX_H, L.CELL_W, L.CELL_H]).toEqual([3, 2.5, 0.38, 0.44, 0.44, 0.5]);
        expect(L.ARC).toBe((120 * Math.PI) / 180);
        expect(L.rowY(0)).toBeCloseTo(L.EYE_Y + 0.5, 12);
        expect(L.rowY(2)).toBeCloseTo(L.EYE_Y - 0.5, 12);
    });

    it.each([1, 2, 4, 5])('centres %i rows on the eye height', (rows) => {
        L.configureLayout({ rows, cardH: 0.3 });
        const ys = Array.from({ length: rows }, (_, r) => L.rowY(r));
        const mid = (ys[0] + ys[rows - 1]) / 2;
        expect(mid).toBeCloseTo(L.EYE_Y, 12);
        expect(ys[0]).toBeGreaterThanOrEqual(ys[rows - 1]);
        for (let i = 0; i < 3 * rows; i++) expect(L.columnOf(i) * rows + L.rowOf(i)).toBe(i);
        expect(L.columnCount(3 * rows + 1)).toBe(4);
    });

    it('places cards on the configured radius and covers the configured arc', () => {
        L.configureLayout({ radius: 3.2, arc: 90, cardW: 0.3, cardH: 0.3 });
        const t = L.itemTransform(0, 0);
        expect(Math.hypot(t.x, t.z)).toBeCloseTo(3.2, 9);
        expect(L.COL_ANGLE).toBeCloseTo(0.36 / 3.2, 12);
        const { first, last } = L.visibleColumns(1, 1000, 0);
        expect((last - first + 1) * L.COL_ANGLE).toBeGreaterThanOrEqual((90 * Math.PI) / 180);
    });

    it('fits cards into the configured size and zooms from the configured cell', () => {
        L.configureLayout({ cardW: 0.5, cardH: 0.3 });
        expect(L.fitCard(1)).toEqual({ w: 0.3, h: 0.3 });
        expect(L.fitCard(2)).toEqual({ w: 0.5, h: 0.25 });
        L.setWallZoom(2);
        expect(L.CELL_W).toBeCloseTo(1.12, 12);
        expect(L.CELL_H).toBeCloseTo(0.72, 12);
        expect(L.configureLayout({ cardW: 0.5, cardH: 0.3 })).toBe(1);
    });
});
