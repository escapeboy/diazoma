import { CanvasTexture, SRGBColorSpace } from 'three';
import { DEFAULT_PANEL } from '../view/resolveView';

/** Brand tokens — the 3D scene mirrors the host site's design system. Defaults; setBrand() replaces them. */
export const COLORS = {
    bg: '#0e0e10',
    surface: '#1b1b1f',
    surfaceHi: '#26262c',
    text: '#f4f3f2',
    textSoft: '#c4c4ca',
    muted: '#9a9aa2',
    accent: '#ef5a73',
    // Filled (active) buttons: #f4f3f2 text on #ef5a73 is 2.97:1; on this darker accent 4.66:1 (WCAG AA).
    accentStrong: '#c9334f',
    accentText: '#f4f3f2',
};

let FONT = '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';

// The site's panel colour; null keeps the shipped dark tints, which differ per panel.
let PANEL = null;

/** Background of info panels, hints, labels and badges. */
export function panelBg(alpha) {
    return PANEL || `rgba(8,8,11,${alpha})`;
}

/** Applies the resolved theme (colour tokens, panel colour and canvas font) before the first texture is drawn. */
export function setBrand({ font, panel, ...colors }) {
    Object.assign(COLORS, colors);
    PANEL = panel && panel !== DEFAULT_PANEL ? panel : null;
    if (font) FONT = font;
}

/** The canvas font stack of the current brand. */
export function fontFamily() {
    return FONT;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
}

/**
 * Canvas-rendered text (no troika/three-mesh-ui). Returns a texture plus the
 * world size to give its plane so 1 canvas px ≈ `pxPerMetre`.
 */
export function textTexture(lines, {
    width = 512,
    height = 128,
    pxPerMetre = 1000,
    background = null,
    radius = 24,
    padding = 28,
    align = 'left',
    sizes = [40, 28],
    colors = [COLORS.text, COLORS.muted],
    weights = [700, 500],
    border = null,
} = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (background) {
        roundRect(ctx, 0, 0, width, height, radius);
        ctx.fillStyle = background;
        ctx.fill();
    }
    if (border) {
        roundRect(ctx, 2, 2, width - 4, height - 4, Math.max(0, radius - 2));
        ctx.lineWidth = 4;
        ctx.strokeStyle = border;
        ctx.stroke();
    }
    const list = (Array.isArray(lines) ? lines : [lines]).filter((l) => l !== null && l !== undefined && l !== '');
    const lineHeights = list.map((_, i) => (sizes[i] ?? sizes[sizes.length - 1]) * 1.25);
    const total = lineHeights.reduce((a, b) => a + b, 0);
    let y = (height - total) / 2;
    ctx.textBaseline = 'top';
    ctx.textAlign = align;
    const x = align === 'center' ? width / 2 : align === 'right' ? width - padding : padding;
    list.forEach((line, i) => {
        const size = sizes[i] ?? sizes[sizes.length - 1];
        ctx.font = `${weights[i] ?? weights[weights.length - 1]} ${size}px ${FONT}`;
        ctx.fillStyle = colors[i] ?? colors[colors.length - 1];
        ctx.fillText(fitText(ctx, String(line), width - padding * 2), x, y + (lineHeights[i] - size * 1.1) / 2);
        y += lineHeights[i];
    });
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return { texture, w: width / pxPerMetre, h: height / pxPerMetre };
}

/** Pill button face; `active` renders the brand-pink filled state. */
export function buttonTexture(label, { active = false, width = 320, height = 96, icon = null } = {}) {
    return textTexture(icon ? `${icon}  ${label}` : label, {
        width,
        height,
        radius: height / 2,
        align: 'center',
        background: active ? COLORS.accentStrong : COLORS.surface,
        border: active ? null : 'rgba(255,255,255,0.12)',
        sizes: [Math.round(height * 0.38)],
        colors: [active ? COLORS.accentText : COLORS.text],
        weights: [700],
        padding: 20,
    });
}

/** Dark striped placeholder shown while a card texture loads (matches .pp-placeholder). */
export function placeholderTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#22222c';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 8;
    for (let i = -64; i < 128; i += 20) {
        ctx.beginPath();
        ctx.moveTo(i, 64);
        ctx.lineTo(i + 64, 0);
        ctx.stroke();
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
}

/** Shared rounded-corner alpha mask for card planes (used with alphaTest, no blending). */
export function roundedMaskTexture(radius = 0.06) {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    roundRect(ctx, 0, 0, s, s, s * radius);
    ctx.fillStyle = '#fff';
    ctx.fill();
    return new CanvasTexture(c);
}
