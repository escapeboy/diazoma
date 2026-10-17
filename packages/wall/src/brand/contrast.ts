import type { Brand, ResolvedBrand } from '../types';

/** The shipped design tokens (dark, one accent). */
export const DEFAULT_BRAND: ResolvedBrand = {
    bg: '#0e0e10',
    surface: '#1b1b1f',
    surfaceHi: '#26262c',
    text: '#f4f3f2',
    textSoft: '#c4c4ca',
    muted: '#9a9aa2',
    accent: '#ef5a73',
    accentStrong: '#c9334f',
    accentText: '#f4f3f2',
    font: '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif',
};

export function parseHex(hex: string): [number, number, number] | null {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex([r, g, b]: [number, number, number]): string {
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** WCAG 2.x relative luminance. */
export function luminance([r, g, b]: [number, number, number]): number {
    const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio of two #rgb / #rrggbb colours. NaN when one does not parse. */
export function contrast(a: string, b: string): number {
    const x = parseHex(a);
    const y = parseHex(b);
    if (!x || !y) return NaN;
    const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
}

/** Darkens `colour` in small steps until `text` on it reaches `min`. */
export function darkenUntil(colour: string, text: string, min = 4.5): string {
    const rgb = parseHex(colour);
    if (!rgb || !(contrast(colour, text) < min)) return colour;
    let cur = rgb;
    for (let i = 0; i < 100 && contrast(toHex(cur), text) < min; i++) cur = [cur[0] * 0.96, cur[1] * 0.96, cur[2] * 0.96];
    return toHex(cur);
}

/**
 * Fills the missing tokens and makes sure text on the active-button fill reads at 4.5:1:
 * the fill is darkened until it does, and a warning says so (the shipped accent needed it).
 */
export function validateBrand(brand: Brand = {}, warn: (msg: string) => void = (m) => console.warn(m)): ResolvedBrand {
    const out = { ...DEFAULT_BRAND, ...Object.fromEntries(Object.entries(brand).filter(([, v]) => v !== undefined)) } as ResolvedBrand;
    const accentText = brand.accentText || out.text;
    const strongGiven = brand.accentStrong;
    // A brand that only names its accent: an accent the default strong colour was derived for must not leak in.
    const strong = strongGiven || (brand.accent ? brand.accent : out.accentStrong);
    const fixed = darkenUntil(strong, accentText);
    if (fixed !== strong) warn(`[diazoma] brand: ${accentText} on ${strong} is ${contrast(strong, accentText).toFixed(2)}:1 (< 4.5:1); using ${fixed} for filled buttons.`);
    out.accentStrong = fixed;
    out.accentText = accentText;
    return out;
}
