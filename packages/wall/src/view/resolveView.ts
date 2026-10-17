import type { ActionView, EnvironmentView, LabelField, PanelField, ResolvedBrand, Strings, ThemeColors, ViewConfig } from '../types';
import { contrast, darkenUntil, parseHex, toHex } from '../brand/contrast';

/** What a site may change, and how far. Out-of-range values are clamped with a warning. */
export const LIMITS = {
    rows: [1, 5],
    radius: [1.8, 4],
    arc: [60, 150],
    cardW: [0.25, 0.6],
    cardH: [0.25, 0.7],
    /** Rows × cell height: taller walls push the top row out of a comfortable view. */
    wallHeight: 2.2,
    /** A card narrower than this angle (radians) is not readable from the centre. */
    minCardAngle: 0.1,
    label: 24,
    icon: 2,
    metaLabel: 24,
    panelLines: 8,
    labelLines: 3,
    primary: 3,
    dim: [0, 0.8],
    textContrast: 4.5,
} as const;

/** Gap between cards; the cell is the card plus this. */
export const CARD_GAP = 0.06;
export const DEFAULT_PANEL = 'rgba(8,8,11,0.78)';

const PANEL_FIELDS = ['title', 'subtitle', 'creator', 'collection', 'description', 'likes', 'tags', 'badges', 'meta'];
const LABEL_FIELDS = ['title', 'subtitle', 'creator', 'count'];
const SIDE = ['creator', 'collection', 'tags'] as const;
const META_FIELD = /^meta\.[^.]+$/;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGBA = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+|1\.0+)\s*)?\)$/i;
const TEXT_KEYS = ['text', 'textSoft', 'muted', 'accent'] as const;
const BACK_KEYS = ['bg', 'surface', 'panel'] as const;

export interface ResolvedEnvironment {
    preset?: 'studio' | 'night' | 'plain';
    top?: string;
    horizon?: string;
    bottom?: string;
    floor?: string;
    stars?: boolean;
    panorama?: string;
    dim: number;
}

export interface ResolvedView {
    actions: Record<string, ActionView>;
    panel: { fields: PanelField[] | null; side: ('creator' | 'collection' | 'tags')[]; metaLabels: Record<string, string> };
    wall: {
        rows: number;
        radius: number;
        /** Degrees. */
        arc: number;
        cardW: number;
        cardH: number;
        label: 'hover' | 'none';
        labelFields: LabelField[];
        badges: boolean;
        indicator: string | null;
    };
    colors: ThemeColors;
    font: string;
    environment: ResolvedEnvironment | null;
    strings: Strings;
}

type Warn = (message: string) => void;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Objects merge key by key; anything else (arrays included) is replaced by the later value. */
export function mergeView(...views: unknown[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const v of views) {
        if (!isObject(v)) continue;
        for (const [k, val] of Object.entries(v)) {
            out[k] = isObject(val) && isObject(out[k]) ? mergeView(out[k], val) : val;
        }
    }
    return out;
}

/** Cuts to `max` user-perceived characters, with "…" when something was cut. */
export function truncate(text: string, max: number, ellipsis = true): string {
    const chars = graphemes(text);
    if (chars.length <= max) return text;
    return chars.slice(0, ellipsis ? max - 1 : max).join('') + (ellipsis ? '…' : '');
}

function graphemes(text: string): string[] {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
    return Seg ? Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment) : Array.from(text);
}

function num(warn: Warn, name: string, value: unknown, [lo, hi]: readonly [number, number], fallback: number, integer = false): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        warn(`[diazoma] view: ${name} is not a number; using ${fallback}.`);
        return fallback;
    }
    let v = integer ? Math.round(value) : value;
    v = Math.min(hi, Math.max(lo, v));
    if (v !== value) warn(`[diazoma] view: ${name} ${value} is outside ${lo}–${hi}; using ${v}.`);
    return v;
}

function text(warn: Warn, name: string, value: unknown, max: number, ellipsis = true): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        warn(`[diazoma] view: ${name} is not a string; ignored.`);
        return undefined;
    }
    const out = truncate(value, max, ellipsis);
    if (out !== value) warn(`[diazoma] view: ${name} is longer than ${max} characters; cut to "${out}".`);
    return out;
}

function actionView(warn: Warn, id: string, raw: unknown): ActionView | null {
    if (!isObject(raw)) {
        warn(`[diazoma] view: actions.${id} is not an object; ignored.`);
        return null;
    }
    const a: ActionView = {};
    const p = `actions.${id}`;
    const label = text(warn, `${p}.label`, raw.label, LIMITS.label);
    if (label !== undefined) a.label = label;
    const labelActive = text(warn, `${p}.labelActive`, raw.labelActive, LIMITS.label);
    if (labelActive !== undefined) a.labelActive = labelActive;
    const icon = text(warn, `${p}.icon`, raw.icon, LIMITS.icon, false);
    if (icon !== undefined) a.icon = icon;
    const iconActive = text(warn, `${p}.iconActive`, raw.iconActive, LIMITS.icon, false);
    if (iconActive !== undefined) a.iconActive = iconActive;
    if (raw.placement !== undefined) {
        if (raw.placement === 'primary' || raw.placement === 'more' || raw.placement === 'hidden') a.placement = raw.placement;
        else warn(`[diazoma] view: ${p}.placement must be primary, more or hidden; ignored.`);
    }
    if (typeof raw.order === 'number' && Number.isFinite(raw.order)) a.order = raw.order;
    if (raw.style === 'primary' || raw.style === 'secondary') a.style = raw.style;
    if (typeof raw.confirm === 'boolean') a.confirm = raw.confirm;
    if (typeof raw.state === 'string' && raw.state) a.state = raw.state;
    if (typeof raw.count === 'string' && raw.count) a.count = raw.count;
    return a;
}

/** rgb of a #hex or rgb()/rgba() colour; alpha is ignored (panels sit on the dark scene). */
function rgbOf(colour: string): [number, number, number] | null {
    const hex = parseHex(colour);
    if (hex) return hex;
    const m = RGBA.exec(colour.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.min(255, v)) as [number, number, number] : null;
}

function minContrast(fg: string, backs: string[]): number {
    return Math.min(...backs.map((b) => contrast(fg, toHex(rgbOf(b)!))));
}

/**
 * Moves `fg` toward white or black (whichever reads better on all `backs`) until it reaches the limit.
 * A colour that is not #hex (a brand may give "red" or hsl(); the canvas draws it) is left alone, and
 * so are backgrounds that are not #hex or rgb(): their contrast cannot be measured here.
 */
export function fixTextColour(fg: string, backs: string[], min: number = LIMITS.textContrast): string {
    if (!parseHex(fg)) return fg;
    backs = backs.filter((b) => rgbOf(b));
    if (!backs.length || minContrast(fg, backs) >= min) return fg;
    const target: [number, number, number] = minContrast('#ffffff', backs) >= minContrast('#000000', backs) ? [255, 255, 255] : [0, 0, 0];
    const from = parseHex(fg)!;
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
        const c = toHex([0, 1, 2].map((i) => from[i] + (target[i] - from[i]) * t) as [number, number, number]);
        if (minContrast(c, backs) >= min) return c;
    }
    return toHex(target);
}

function colours(warn: Warn, brand: ResolvedBrand, raw: unknown): ThemeColors {
    const out: ThemeColors = {
        bg: brand.bg,
        surface: brand.surface,
        surfaceHi: brand.surfaceHi,
        text: brand.text,
        textSoft: brand.textSoft,
        muted: brand.muted,
        accent: brand.accent,
        accentStrong: brand.accentStrong,
        accentText: brand.accentText,
        panel: DEFAULT_PANEL,
    };
    if (raw !== undefined && !isObject(raw)) warn('[diazoma] view: theme.colors is not an object; ignored.');
    const given = isObject(raw) ? raw : {};
    for (const key of Object.keys(out) as (keyof ThemeColors)[]) {
        const v = given[key];
        if (v === undefined) continue;
        const ok = typeof v === 'string' && (HEX.test(v.trim()) || (key === 'panel' && RGBA.test(v.trim())));
        if (ok) out[key] = (v as string).trim();
        else warn(`[diazoma] view: theme.colors.${key} "${String(v)}" is not a ${key === 'panel' ? '#hex or rgba()' : '#hex'} colour; ignored.`);
    }
    if (given.accentStrong !== undefined || given.accentText !== undefined) {
        const fixed = darkenUntil(out.accentStrong, out.accentText);
        if (fixed !== out.accentStrong) warn(`[diazoma] view: ${out.accentText} on ${out.accentStrong} is below 4.5:1; using ${fixed} for filled buttons.`);
        out.accentStrong = fixed;
    }
    const backs = BACK_KEYS.map((k) => out[k]);
    for (const key of TEXT_KEYS) {
        const fixed = fixTextColour(out[key], backs);
        if (fixed !== out[key]) {
            warn(`[diazoma] view: theme colour ${key} ${out[key]} is below 4.5:1 on bg, surface or panel; using ${fixed}.`);
            out[key] = fixed;
        }
    }
    return out;
}

function environment(warn: Warn, raw: unknown): ResolvedEnvironment | null {
    if (raw === undefined) return null;
    if (!isObject(raw)) {
        warn('[diazoma] view: theme.environment is not an object; ignored.');
        return null;
    }
    const env: ResolvedEnvironment = { dim: num(warn, 'theme.environment.dim', raw.dim, LIMITS.dim, 0.35) };
    if (raw.preset === 'studio' || raw.preset === 'night' || raw.preset === 'plain') env.preset = raw.preset;
    for (const key of ['top', 'horizon', 'bottom', 'floor'] as const) {
        const v = raw[key];
        if (v === undefined) continue;
        if (typeof v === 'string' && HEX.test(v.trim())) env[key] = v.trim();
        else warn(`[diazoma] view: theme.environment.${key} is not a #hex colour; ignored.`);
    }
    if (typeof raw.stars === 'boolean') env.stars = raw.stars;
    if (raw.panorama !== undefined) {
        let url: URL | null = null;
        try {
            url = typeof raw.panorama === 'string' ? new URL(raw.panorama) : null;
        } catch {
            url = null;
        }
        if (url && (url.protocol === 'https:' || url.protocol === 'http:')) env.panorama = url.href;
        else warn('[diazoma] view: theme.environment.panorama must be an absolute http(s) URL; ignored.');
    }
    return env;
}

/**
 * Merges the site's view (adapter, then Wall options) over the shipped defaults and applies
 * the comfort limits. Without a view the result reproduces the shipped scene exactly.
 */
export function resolveView(adapterView: unknown, optionsView: unknown, brand: ResolvedBrand, warn: Warn = (m) => console.warn(m)): ResolvedView {
    const v = mergeView(adapterView, optionsView);

    const actions: Record<string, ActionView> = {};
    if (v.actions !== undefined && !isObject(v.actions)) warn('[diazoma] view: actions is not an object; ignored.');
    for (const [id, raw] of Object.entries(isObject(v.actions) ? v.actions : {})) {
        const a = actionView(warn, id, raw);
        if (a) actions[id] = a;
    }
    const primaries = Object.entries(actions).filter(([, a]) => a.placement === 'primary').map(([id]) => id);
    if (primaries.length > LIMITS.primary) warn(`[diazoma] view: ${primaries.length} actions ask to be primary (${primaries.join(', ')}); at most ${LIMITS.primary} are, the rest go under "More".`);

    const panelRaw = isObject(v.panel) ? v.panel : {};
    let fields: PanelField[] | null = null;
    if (Array.isArray(panelRaw.fields)) {
        const valid = panelRaw.fields.filter((f): f is PanelField => typeof f === 'string' && (PANEL_FIELDS.includes(f) || META_FIELD.test(f)));
        if (valid.length !== panelRaw.fields.length) warn('[diazoma] view: panel.fields has unknown entries; they are ignored.');
        if (valid.length > LIMITS.panelLines) warn(`[diazoma] view: panel.fields has more than ${LIMITS.panelLines} entries; the rest are ignored.`);
        fields = valid.slice(0, LIMITS.panelLines);
    }
    const side = Array.isArray(panelRaw.side) ? SIDE.filter((s) => (panelRaw.side as unknown[]).includes(s)) : [...SIDE];
    const metaLabels: Record<string, string> = {};
    for (const [k, label] of Object.entries(isObject(panelRaw.metaLabels) ? panelRaw.metaLabels : {})) {
        const t = text(warn, `panel.metaLabels.${k}`, label, LIMITS.metaLabel);
        if (t !== undefined) metaLabels[k] = t;
    }

    const wallRaw = isObject(v.wall) ? v.wall : {};
    const cardRaw = isObject(wallRaw.card) ? wallRaw.card : {};
    let rows = num(warn, 'wall.rows', wallRaw.rows, LIMITS.rows, 3, true);
    const radius = num(warn, 'wall.radius', wallRaw.radius, LIMITS.radius, 2.5);
    const arc = num(warn, 'wall.arc', wallRaw.arc, LIMITS.arc, 120);
    let cardW = num(warn, 'wall.card.width', cardRaw.width, LIMITS.cardW, 0.38);
    const cardH = num(warn, 'wall.card.height', cardRaw.height, LIMITS.cardH, 0.44);
    const maxRows = Math.max(1, Math.floor((LIMITS.wallHeight + 1e-9) / (cardH + CARD_GAP)));
    if (rows > maxRows) {
        warn(`[diazoma] view: ${rows} rows of ${cardH} m cards are taller than ${LIMITS.wallHeight} m; using ${maxRows} rows.`);
        rows = maxRows;
    }
    const minW = Math.round(LIMITS.minCardAngle * radius * 1000) / 1000;
    if (cardW < minW) {
        warn(`[diazoma] view: a ${cardW} m card at ${radius} m is too small to read; using ${minW} m.`);
        cardW = minW;
    }
    let labelFields: LabelField[] = ['title', 'creator', 'count'];
    if (Array.isArray(wallRaw.labelFields)) {
        labelFields = wallRaw.labelFields.filter((f): f is LabelField => typeof f === 'string' && (LABEL_FIELDS.includes(f) || META_FIELD.test(f))).slice(0, LIMITS.labelLines);
    }
    let indicator: string | null = 'like';
    if (wallRaw.indicator === null) indicator = null;
    else if (typeof wallRaw.indicator === 'string' && wallRaw.indicator) indicator = wallRaw.indicator;

    const themeRaw = isObject(v.theme) ? v.theme : {};
    let font = brand.font;
    if (themeRaw.font !== undefined) {
        if (typeof themeRaw.font === 'string' && themeRaw.font.trim() && themeRaw.font.length <= 200 && !/[;{}]/.test(themeRaw.font)) font = themeRaw.font.trim();
        else warn('[diazoma] view: theme.font must be a CSS font-family list; ignored.');
    }

    const strings: Strings = {};
    for (const [k, s] of Object.entries(isObject(v.strings) ? v.strings : {})) if (typeof s === 'string') strings[k] = s;

    return {
        actions,
        panel: { fields, side, metaLabels },
        wall: {
            rows,
            radius,
            arc,
            cardW,
            cardH,
            label: wallRaw.label === 'none' ? 'none' : 'hover',
            labelFields,
            badges: wallRaw.badges !== false,
            indicator,
        },
        colors: colours(warn, brand, themeRaw.colors),
        font,
        environment: environment(warn, themeRaw.environment as EnvironmentView | undefined),
        strings,
    };
}
