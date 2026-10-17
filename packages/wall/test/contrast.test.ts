import { describe, expect, it, vi } from 'vitest';
import { contrast, DEFAULT_BRAND, validateBrand } from '../src/brand/contrast';

describe('brand contrast', () => {
    it('matches the WCAG reference ratios', () => {
        expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
        expect(contrast('#f4f3f2', '#c9334f')).toBeGreaterThanOrEqual(4.5); // the shipped fill: 4.66
        expect(contrast('#f4f3f2', '#ef5a73')).toBeLessThan(3); // the shipped accent: 2.97
    });

    it('keeps the shipped brand untouched and silent', () => {
        const warn = vi.fn();
        const b = validateBrand({ accent: '#ef5a73', accentStrong: '#c9334f' }, warn);
        expect(b).toEqual(DEFAULT_BRAND);
        expect(warn).not.toHaveBeenCalled();
    });

    it('darkens a fill that fails 4.5:1 and warns once', () => {
        const warn = vi.fn();
        const b = validateBrand({ accent: '#ffd400' }, warn);
        expect(contrast(b.accentStrong, b.accentText)).toBeGreaterThanOrEqual(4.5);
        expect(b.accentStrong).not.toBe('#ffd400');
        expect(b.accent).toBe('#ffd400');
        expect(warn).toHaveBeenCalledOnce();
    });

    it('returns the defaults unchanged and silent when no brand is given', () => {
        const warn = vi.fn();
        expect(validateBrand(undefined, warn)).toEqual(DEFAULT_BRAND);
        expect(validateBrand({}, warn).accentStrong).toBe('#c9334f');
        expect(warn).not.toHaveBeenCalled();
    });

    it('derives a passing strong colour from an accent given alone', () => {
        const warn = vi.fn();
        const b = validateBrand({ accent: '#3a86ff' }, warn);
        expect(b.accent).toBe('#3a86ff');
        expect(b.accentStrong).not.toBe('#c9334f');
        expect(contrast(b.accentStrong, b.accentText)).toBeGreaterThanOrEqual(4.5);
    });

    it('passes a given accent and accentStrong through when they pass', () => {
        const warn = vi.fn();
        const b = validateBrand({ accent: '#3a86ff', accentStrong: '#1d4ed8' }, warn);
        expect(b.accentStrong).toBe('#1d4ed8');
        expect(warn).not.toHaveBeenCalled();
    });
});
