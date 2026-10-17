import { CanvasTexture, SRGBColorSpace } from 'three';
import { contrast } from '../brand/contrast';
import { COLORS, fontFamily } from './text.js';
import { creatorName } from '../view/actions';

/** Portrait 3:4, the aspect of a text card that brings none. */
export const TEXT_CARD_ASPECT = 0.75;

const ACCENT_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The item's own accent when it is a valid hex colour, else the site's accent. */
export function bandColor(item) {
    return typeof item.accent === 'string' && ACCENT_RE.test(item.accent) ? item.accent : COLORS.accentStrong;
}

/** Dark or light text, whichever reads better on the band. */
export function bandTextColor(band) {
    const light = '#ffffff';
    const dark = '#0e0e10';
    return contrast(band, light) >= contrast(band, dark) ? light : dark;
}

/** Short local date ("10 Oct 2026") of an ISO 8601 date or date-time; '' when it does not parse. */
export function shortDate(value, locale) {
    if (typeof value !== 'string' || !value) return '';
    const dateOnly = DATE_ONLY_RE.test(value);
    const d = new Date(dateOnly ? value + 'T00:00:00Z' : value.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return '';
    try {
        // A bare date has no time zone: show the day it names, not the day it falls on in UTC-5.
        return new Intl.DateTimeFormat(locale || undefined, { day: 'numeric', month: 'short', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) }).format(d);
    } catch {
        return value.slice(0, 10);
    }
}

/** Host of a link without "www." ('' when it is not an absolute URL). */
export function sourceHost(link) {
    try {
        return new URL(link).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

/** The largest n in 1..max for which fitsN(n) holds (1 when none does), by bisection: width grows with n. */
function longestFit(max, fitsN) {
    if (fitsN(max)) return max;
    let lo = 1;
    let hi = max;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (fitsN(mid)) lo = mid;
        else hi = mid;
    }
    return lo;
}

/**
 * Breaks `text` into at most `maxLines` lines no wider than `maxWidth`, measured by `measure`.
 * Breaks at spaces, splits a word longer than a line, and ends the last line with an ellipsis when
 * text is left over. Works on any script: Cyrillic has the same spaces as Latin.
 */
export function wrapText(text, maxWidth, maxLines, measure) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    let i = 0;
    const fits = (s) => measure(s) <= maxWidth;
    while (i < words.length && lines.length < maxLines) {
        const word = words[i];
        const candidate = line ? line + ' ' + word : word;
        if (fits(candidate)) {
            line = candidate;
            i++;
        } else if (line) {
            lines.push(line);
            line = '';
        } else {
            // One word wider than a line: take as many characters as fit.
            const cut = longestFit(word.length, (n) => fits(word.slice(0, n)));
            lines.push(word.slice(0, cut));
            words[i] = word.slice(cut);
            if (!words[i]) i++;
        }
    }
    if (line && lines.length < maxLines) {
        lines.push(line);
        line = '';
        i = words.length;
    }
    if (i < words.length || line) {
        // Text is left over: the last line ends with an ellipsis.
        const rest = (line ? [line] : []).concat(words.slice(i)).join(' ');
        const last = lines.length ? lines.pop() : '';
        let joined = last ? last + ' ' + rest : rest;
        joined = joined.slice(0, longestFit(joined.length, (n) => fits(joined.slice(0, n) + '…')));
        lines.push(joined.replace(/[\s.,;:–-]+$/u, '') + '…');
    }
    return lines.slice(0, maxLines);
}

/**
 * Positions the parts of a text card. Pure: sizes in canvas px, `measure(text, size, weight)` gives a width.
 * `detail: 'viewer'` gives the excerpt more room and a bigger type scale.
 */
export function layoutTextCard(item, width, height, measure, { detail = 'card', locale } = {}) {
    const viewer = detail === 'viewer';
    const pad = Math.round(width * 0.075);
    const inner = width - pad * 2;
    const bandH = Math.round(width * 0.12);
    const kicker = Array.isArray(item.badges) && typeof item.badges[0] === 'string' ? item.badges[0] : '';
    const date = shortDate(item.date, locale);
    const out = { pad, bandH, kicker, date, title: [], subtitle: [], excerpt: [], sizes: {}, y: {} };

    const titleSize = Math.round(width * (viewer ? 0.07 : 0.082));
    const subSize = Math.round(width * (viewer ? 0.045 : 0.055));
    const bodySize = Math.round(width * (viewer ? 0.042 : 0.05));
    const footSize = Math.round(width * 0.045);
    out.sizes = { kicker: Math.round(bandH * 0.42), title: titleSize, subtitle: subSize, excerpt: bodySize, foot: footSize };

    const footH = date ? footSize * 2.2 : 0;
    const bottom = height - pad - footH;
    let y = bandH + pad;

    const title = item.title || '—';
    out.title = wrapText(title, inner, viewer ? 6 : 4, (s) => measure(s, titleSize, 700));
    out.y.title = y;
    y += out.title.length * titleSize * 1.22 + pad * 0.35;

    const sub = item.subtitle || creatorName(item.creator);
    if (sub) {
        out.subtitle = wrapText(sub, inner, 2, (s) => measure(s, subSize, 500));
        out.y.subtitle = y;
        y += out.subtitle.length * subSize * 1.3 + pad * 0.45;
    }

    if (item.excerpt) {
        const lineH = bodySize * 1.38;
        const room = Math.floor((bottom - y) / lineH);
        if (room >= 1) {
            out.excerpt = wrapText(item.excerpt, inner, Math.min(room, viewer ? 18 : 12), (s) => measure(s, bodySize, 400));
            out.y.excerpt = y;
            out.lineH = lineH;
        }
    }
    out.y.foot = height - pad - footSize * 1.1;
    out.footRule = height - pad - footH + footSize * 0.2;
    return out;
}

/**
 * Draws a text card on a canvas of `width` x `height` px: top band with the kicker, then title,
 * subtitle, excerpt and, at the bottom, the date. Colours come from the site's theme (COLORS),
 * so a light brand gives a light card.
 */
export function drawTextCard(ctx, item, width, height, opts = {}) {
    const measure = (s, size, weight) => {
        ctx.font = `${weight} ${size}px ${fontFamily()}`;
        return ctx.measureText(s).width;
    };
    const L = layoutTextCard(item, width, height, measure, opts);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(0, 0, width, height);
    const band = bandColor(item);
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, width, L.bandH);

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (L.kicker) {
        ctx.font = `700 ${L.sizes.kicker}px ${fontFamily()}`;
        ctx.fillStyle = bandTextColor(band);
        const text = wrapText(L.kicker, width - L.pad * 2, 1, (s) => measure(s, L.sizes.kicker, 700))[0] || '';
        ctx.fillText(text, L.pad, (L.bandH - L.sizes.kicker) / 2);
    }
    const block = (lines, y, size, weight, color, lineHeight) => {
        ctx.font = `${weight} ${size}px ${fontFamily()}`;
        ctx.fillStyle = color;
        lines.forEach((line, i) => ctx.fillText(line, L.pad, y + i * size * lineHeight));
    };
    block(L.title, L.y.title, L.sizes.title, 700, COLORS.text, 1.22);
    if (L.subtitle.length) block(L.subtitle, L.y.subtitle, L.sizes.subtitle, 500, COLORS.textSoft, 1.3);
    if (L.excerpt.length) block(L.excerpt, L.y.excerpt, L.sizes.excerpt, 400, COLORS.textSoft, 1.38);
    if (L.date) {
        ctx.fillStyle = COLORS.muted;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(L.pad, L.footRule, width - L.pad * 2, Math.max(1, Math.round(width / 512)));
        ctx.globalAlpha = 1;
        block([L.date], L.y.foot, L.sizes.foot, 500, COLORS.muted, 1);
    }
    return L;
}

/**
 * A text card as a texture. 512 px wide on the wall, 1024 px in the viewer; `aspect` is the card's
 * width over height (TEXT_CARD_ASPECT when the item has none). No network request is made.
 */
export function textCardTexture(item, { aspect, width = 512, detail = 'card', locale } = {}) {
    const a = aspect > 0 && Number.isFinite(aspect) ? aspect : TEXT_CARD_ASPECT;
    const height = Math.round(width / a);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    drawTextCard(canvas.getContext('2d'), item, width, height, { detail, locale });
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}
