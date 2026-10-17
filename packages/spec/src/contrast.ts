/** Parses #rgb or #rrggbb; anything else (named colours, rgb(), hsl()) returns null. */
export function parseHex(color: string): [number, number, number] | null {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
    const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of a colour against white, or null when the colour cannot be parsed. */
export function contrastOnWhite(color: string): number | null {
    const rgb = parseHex(color);
    return rgb ? 1.05 / (luminance(rgb) + 0.05) : null;
}

/** WCAG contrast ratio of two colours, or null when either cannot be parsed. */
export function contrastRatio(a: string, b: string): number | null {
    const x = parseHex(a);
    const y = parseHex(b);
    if (!x || !y) return null;
    const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
}

/** The wall's background when the manifest names none, and its card surface (DEFAULT_BRAND in @diazoma/wall). */
export const DEFAULT_WALL_BG = '#0e0e10';
export const DEFAULT_WALL_SURFACE = '#1b1b1f';
