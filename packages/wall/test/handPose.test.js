import { describe, expect, it } from 'vitest';
import { classifyHand } from '../src/scene/handPose.js';

// Real samples from xr_hand_sample (finger ratios i/m/r/p, gap in cm → m).
const s = (r, gapCm) => classifyHand(r, gapCm === null ? null : gapCm / 100);

describe('classifyHand', () => {
    it('reads the typical poses', () => {
        expect(s([1.75, 1.87, 1.86, 1.74], 6.4)).toBe('open');
        expect(s([1.71, 0.78, 0.72, 0.85], 9.6)).toBe('point');
        expect(s([0.91, 0.81, 0.74, 0.75], 4.2)).toBe('fist');
        expect(s([1.33, 1.12, 1.0, 1.02], 1.3)).toBe('claw');
        expect(s([1.48, 1.43, 1.35, 1.34], 4.0)).toBe('loose');
    });

    it('keeps a slightly relaxed index pointing (was claw at 1.55, flickering the dwell)', () => {
        expect(s([1.52, 0.8, 0.75, 0.9], 8.0)).toBe('point');
    });

    it('keeps a fist with the thumb close to the index (was claw under 2.5 cm)', () => {
        expect(s([0.95, 0.8, 0.75, 0.78], 2.2)).toBe('fist');
    });

    it('still tells a pinch (thumb on the index tip) from a fist', () => {
        expect(s([1.1, 0.9, 0.85, 0.9], 0.8)).toBe('claw');
        expect(s([1.1, 0.9, 0.85, 0.9], null)).toBe('fist');
    });
});
