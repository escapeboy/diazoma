/**
 * Frame-time sampler for immersive sessions. Collects frame intervals and turns them into
 * a small summary for the xr_perf event: median fps, the fps of the slowest 5 % of frames,
 * and the share of frames that took over 1.5× the median frame time (visible stutter).
 */
export const PERF_INTERVAL_MS = 60000;
const MIN_FRAMES = 30;
// A gap this long is a paused session (headset off, system menu), not a slow frame.
const MAX_FRAME_MS = 500;

export class FrameStats {
    constructor() {
        this.reset();
    }

    reset() {
        this.frames = [];
        this.last = null;
    }

    /** Call once per rendered frame with performance.now(). */
    tick(now) {
        if (this.last !== null) {
            const dt = now - this.last;
            if (dt > 0 && dt < MAX_FRAME_MS) this.frames.push(dt);
        }
        this.last = now;
    }

    /** @returns {{fps_p50: string, fps_p5: string, slow_pct: string, value: number}|null} null when too few frames */
    summary() {
        if (this.frames.length < MIN_FRAMES) return null;
        const sorted = [...this.frames].sort((a, b) => a - b);
        const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
        const median = at(0.5);
        const slow = sorted.filter((dt) => dt > median * 1.5).length;
        const fps50 = 1000 / median;
        return {
            value: Math.round(fps50 * 10) / 10,
            fps_p50: fps50.toFixed(1),
            // The slowest 5 % of frames are the longest intervals.
            fps_p5: (1000 / at(0.95)).toFixed(1),
            slow_pct: ((slow / sorted.length) * 100).toFixed(1),
        };
    }
}
