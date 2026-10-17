import { describe, expect, it } from 'vitest';
import { pickProfile, profiles } from '../src/input/profiles';
import { HAND_THRESHOLDS } from '../src/scene/handPose.js';

describe('input profiles', () => {
    it('meta-quest carries every shipped threshold', () => {
        const q = profiles['meta-quest'];
        expect(q.pressDragThreshold).toBe(0.035);
        expect(q.pressDragThresholdHand).toBe(0.07);
        expect(q.dwellSelect).toBe(0.8);
        expect(q.dwellRearmRad).toBe(0.08);
        expect(q.fistHold).toBe(0.15);
        expect(q.fistHideHold).toBe(2);
        expect(q.pullThreshold).toBe(0.04);
        expect(Math.exp(0.2 * q.pullZoomGain)).toBeCloseTo(2.5, 10);
        expect(q.zoomRepeat).toBe(0.35);
        expect(q.confirmWindow).toBe(3);
        expect(q.hand).toEqual(HAND_THRESHOLDS);
        expect(q.hand).toEqual({ curled: 1.25, extended: 1.5, release: 1.4, fistMinGap: 0.02 });
    });

    it('pico and android-xr are copies of the Quest numbers in P0', () => {
        for (const name of ['pico', 'android-xr'] as const) {
            const { name: n, ...rest } = profiles[name];
            const { name: _q, ...quest } = profiles['meta-quest'];
            expect(n).toBe(name);
            expect(rest).toEqual(quest);
            expect(profiles[name].hand).not.toBe(profiles['meta-quest'].hand);
        }
    });

    it('visionos is a transient pointer without dwell', () => {
        expect(profiles.visionos.mode).toBe('transient-pointer');
        expect(profiles.visionos.dwellSelect).toBe(0);
    });

    it('picks by name, by input profile id, then by user agent', () => {
        expect(pickProfile('desktop').name).toBe('desktop');
        expect(pickProfile('auto', { inputProfiles: ['meta-quest-touch-plus', 'generic-trigger'] }).name).toBe('meta-quest');
        expect(pickProfile('auto', { inputProfiles: ['pico-4'] }).name).toBe('pico');
        expect(pickProfile('auto', { ua: 'Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/35.0 Quest 3' }).name).toBe('meta-quest');
        expect(pickProfile('auto', { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel) Mobile' }).name).toBe('phone');
        expect(pickProfile('auto', { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' }).name).toBe('desktop');
    });
});
