import { describe, expect, it } from 'vitest';
import { FrameStats } from '../src/scene/perf.js';

function run(intervals) {
    const s = new FrameStats();
    let t = 0;
    s.tick(t);
    for (const dt of intervals) s.tick((t += dt));
    return s.summary();
}

describe('FrameStats', () => {
    it('needs enough frames before it reports', () => {
        expect(run(Array(10).fill(13.9))).toBeNull();
    });

    it('reports a steady 72 Hz session', () => {
        const r = run(Array(720).fill(1000 / 72));
        expect(r.fps_p50).toBe('72.0');
        expect(r.fps_p5).toBe('72.0');
        expect(r.slow_pct).toBe('0.0');
        expect(r.value).toBe(72);
    });

    it('measures stutter as the share of frames over 1.5× the median', () => {
        const frames = [...Array(90).fill(1000 / 72), ...Array(10).fill(1000 / 36)];
        const r = run(frames);
        expect(r.fps_p50).toBe('72.0');
        expect(r.fps_p5).toBe('36.0');
        expect(r.slow_pct).toBe('10.0');
    });

    it('ignores a long pause instead of counting it as a slow frame', () => {
        const r = run([...Array(100).fill(1000 / 72), 5000, ...Array(100).fill(1000 / 72)]);
        expect(r.slow_pct).toBe('0.0');
    });
});
