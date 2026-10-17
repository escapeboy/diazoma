/**
 * Curved-wall layout for the immersive gallery (spec quest-xr §2.1).
 *
 * Cards sit on a cylinder segment around the viewer: radius 2.5 m, a 120° usable
 * arc, three rows at eye height. Items fill column by column (top → bottom), and
 * `scroll` is an angle in radians that slides every column along the arc.
 * All positions are in metres in a right-handed, -Z-forward world with the viewer
 * at the origin, so the same math serves the headset and the 2D "magic window".
 */

export let RADIUS = 2.5;
export let ARC = (120 * Math.PI) / 180;
export let ROWS = 3;
export let CARD_MAX_W = 0.38; // card geometry is built at this size; zoom scales the mesh
export let CARD_MAX_H = 0.44;
export const EYE_Y = 1.55;
export const WALL_ZOOM_MIN = 0.7;
export const WALL_ZOOM_MAX = 2.2;
let BASE_CELL_W = 0.44; // arc length per column at zoom 1
let BASE_CELL_H = 0.5;

// Wall zoom: cards (and the gaps between them) grow while the radius stays put, so
// fewer, larger columns fill the arc. Exported as live bindings — importers always
// read the current values.
export let wallZoom = 1;
export let CELL_W = BASE_CELL_W;
export let CELL_H = BASE_CELL_H;
export let COL_ANGLE = CELL_W / RADIUS;

/** Sets the wall zoom (clamped) and returns the applied value. */
export function setWallZoom(z) {
    wallZoom = Math.min(WALL_ZOOM_MAX, Math.max(WALL_ZOOM_MIN, Number.isFinite(z) ? z : 1));
    CELL_W = BASE_CELL_W * wallZoom;
    CELL_H = BASE_CELL_H * wallZoom;
    COL_ANGLE = CELL_W / RADIUS;
    return wallZoom;
}
/** Column 0 starts 25° left of straight ahead. */
export const START_ANGLE = (25 * Math.PI) / 180;

let HALF_ARC = ARC / 2;

export function columnOf(index) {
    return Math.floor(index / ROWS);
}

export function rowOf(index) {
    return index % ROWS;
}

export function columnCount(itemCount) {
    return Math.ceil(itemCount / ROWS);
}

/** Row 0 is the top row; the rows are centred on the eye height. */
export function rowY(row, eyeY = EYE_Y) {
    return eyeY + ((ROWS - 1) / 2 - row) * CELL_H;
}

/** Angle of a column's centre on the arc after scrolling; 0 = straight ahead, negative = left. */
export function columnAngle(col, scroll) {
    return col * COL_ANGLE - scroll;
}

/**
 * World transform of an item: position on the cylinder and the Y rotation that
 * turns the card to face the viewer.
 */
export function itemTransform(index, scroll, eyeY = EYE_Y) {
    const angle = columnAngle(columnOf(index), scroll);
    return {
        x: RADIUS * Math.sin(angle),
        y: rowY(rowOf(index), eyeY),
        z: -RADIUS * Math.cos(angle),
        rotationY: -angle,
        angle,
    };
}

/** Largest card of the given aspect (width / height) that fits a cell. */
export function fitCard(aspect) {
    const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 0.75;
    let w = CARD_MAX_W;
    let h = w / a;
    if (h > CARD_MAX_H) {
        h = CARD_MAX_H;
        w = h * a;
    }
    return { w, h };
}

/** Scroll range: first column just left of centre at the start, last column at the right edge at the end. */
export function scrollBounds(itemCount) {
    const cols = columnCount(itemCount);
    // angle = col * COL_ANGLE - scroll. The wall starts with column 0 slightly left of
    // straight ahead (START_ANGLE), so the newest pins are what the viewer sees first;
    // it ends with the last column at the right edge of the arc.
    const edge = HALF_ARC - COL_ANGLE / 2;
    const min = START_ANGLE;
    const max = Math.max(min, (cols - 1) * COL_ANGLE - edge);
    return { min, max };
}

export function clampScroll(scroll, itemCount) {
    const { min, max } = scrollBounds(itemCount);
    return Math.min(max, Math.max(min, scroll));
}

/**
 * Columns whose centre lies within the arc plus `marginCols` either side — the ones
 * worth keeping in the scene (and texturing).
 */
export function visibleColumns(scroll, itemCount, marginCols = 1) {
    const cols = columnCount(itemCount);
    if (cols === 0) return { first: 0, last: -1 };
    const first = Math.max(0, Math.floor((scroll - HALF_ARC) / COL_ANGLE) - marginCols);
    const last = Math.min(cols - 1, Math.ceil((scroll + HALF_ARC) / COL_ANGLE) + marginCols);
    return { first, last };
}

/** Item index range [first, last] for the visible columns. */
export function visibleItems(scroll, itemCount, marginCols = 1) {
    const { first, last } = visibleColumns(scroll, itemCount, marginCols);
    if (last < first) return { first: 0, last: -1 };
    return { first: first * ROWS, last: Math.min(itemCount - 1, last * ROWS + ROWS - 1) };
}

/** True when the user has scrolled within `thresholdCols` of the last loaded column. */
export function nearEnd(scroll, itemCount, thresholdCols = 6) {
    const { last } = visibleColumns(scroll, itemCount, 0);
    return last >= columnCount(itemCount) - 1 - thresholdCols;
}

/** Scroll position (0..1) for the progress indicator. */
export function scrollProgress(scroll, itemCount) {
    const { min, max } = scrollBounds(itemCount);
    return max > min ? (scroll - min) / (max - min) : 0;
}

/**
 * Frame-rate-independent inertia: velocity decays by `damping` per second and the
 * scroll stops at the bounds. Returns the next {scroll, velocity}.
 */
export function stepInertia(scroll, velocity, dt, itemCount, damping = 4) {
    let next = scroll + velocity * dt;
    let v = velocity * Math.exp(-damping * dt);
    const clamped = clampScroll(next, itemCount);
    if (clamped !== next) v = 0;
    if (Math.abs(v) < 1e-4) v = 0;
    return { scroll: clamped, velocity: v };
}

/**
 * Sets the wall's shape from the site's view (already clamped by resolveView): rows, radius in
 * metres, arc in degrees, card size in metres. Call before the scene is built; resets the zoom.
 * Module state, so one wall per page.
 */
export function configureLayout({ rows = 3, radius = 2.5, arc = 120, cardW = 0.38, cardH = 0.44, gap = 0.06 } = {}) {
    ROWS = rows;
    RADIUS = radius;
    ARC = (arc * Math.PI) / 180;
    HALF_ARC = ARC / 2;
    CARD_MAX_W = cardW;
    CARD_MAX_H = cardH;
    BASE_CELL_W = cardW + gap;
    BASE_CELL_H = cardH + gap;
    return setWallZoom(1);
}
