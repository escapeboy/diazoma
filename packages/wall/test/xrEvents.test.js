import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('xrEvents', () => {
    let fetchMock;

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('addEventListener', vi.fn());
        vi.stubGlobal('navigator', {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).events);

    it('batches events and flushes after the delay', async () => {
        const { track, ENDPOINT } = await import('../src/telemetry/xrEvents.js');
        track('xr_enter');
        track('xr_backend', { props: { backend: 'layers' } });
        expect(fetchMock).not.toHaveBeenCalled();

        vi.advanceTimersByTime(5000);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINT);
        expect(bodies()[0].map((e) => e.name)).toEqual(['xr_enter', 'xr_backend']);
    });

    it('never sends more than 50 events per request', async () => {
        const { track, flush } = await import('../src/telemetry/xrEvents.js');
        for (let i = 0; i < 120; i++) track('xr_watch_seconds', { value: i });
        flush();

        expect(bodies().map((b) => b.length)).toEqual([50, 50, 20]);
    });
});
