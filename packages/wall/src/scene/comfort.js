import { CARD_GAP, LIMITS } from '../view/resolveView';

/** Curve steps in metres (the wall's radius); the site's own radius is always one of the choices. */
export const CURVE_STEP = 0.2;

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

/** The most rows that fit the comfortable wall height for this card size (same rule as resolveView). */
export function maxRowsFor(cardH) {
    return Math.max(1, Math.min(LIMITS.rows[1], Math.floor((LIMITS.wallHeight + 1e-9) / (cardH + CARD_GAP))));
}

/** Curve in use: the user's choice when set, else the view's radius; always inside the radius limits. */
export function curveOf(settings, view) {
    const v = Number.isFinite(settings.curve) ? settings.curve : view.wall.radius;
    return round(Math.min(LIMITS.radius[1], Math.max(LIMITS.radius[0], v)), 2);
}

/** Rows in use: the user's choice when set, else the view's rows. */
export function rowsOf(settings, view) {
    const v = Number.isFinite(settings.rows) ? Math.round(settings.rows) : view.wall.rows;
    return Math.min(maxRowsFor(view.wall.cardH), Math.max(LIMITS.rows[0], v));
}

export function stepCurve(settings, view, delta) {
    const next = curveOf(settings, view) + (delta > 0 ? CURVE_STEP : -CURVE_STEP);
    return round(Math.min(LIMITS.radius[1], Math.max(LIMITS.radius[0], next)), 2);
}

export function stepRows(settings, view, delta) {
    return Math.min(maxRowsFor(view.wall.cardH), Math.max(LIMITS.rows[0], rowsOf(settings, view) + (delta > 0 ? 1 : -1)));
}

/** The layout options for the user's comfort settings on top of the site's view. */
export function shapeOf(settings, view) {
    const w = view.wall;
    return { rows: rowsOf(settings, view), radius: curveOf(settings, view), arc: w.arc, cardW: w.cardW, cardH: w.cardH };
}
