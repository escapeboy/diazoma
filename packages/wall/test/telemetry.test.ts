import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = { site: 'example.test', adapter: 'a1', profile: 'meta-quest', wallVersion: '0.1.0' };

describe('createTelemetry', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.stubGlobal('addEventListener', vi.fn());
        vi.stubGlobal('navigator', {});
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('passes a function through untouched: names and payload stay byte-identical', async () => {
        const { createTelemetry } = await import('../src/telemetry/createTelemetry');
        const fn = vi.fn();
        const t = createTelemetry(fn, ctx);
        t.track('xr_enter', { props: { surface: 'gallery', mode: 'vr' } });
        expect(fn).toHaveBeenCalledWith('xr_enter', { props: { surface: 'gallery', mode: 'vr' } });
    });

    it('does nothing without a config', async () => {
        const { createTelemetry } = await import('../src/telemetry/createTelemetry');
        expect(() => createTelemetry(undefined, ctx).track('xr_enter')).not.toThrow();
    });

    it('batches to the endpoint with the prefix replaced and the identity added', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        const { createTelemetry } = await import('../src/telemetry/createTelemetry');
        const t = createTelemetry({ endpoint: '/e', prefix: 'w_' }, ctx);
        t.track('xr_enter', { props: { mode: 'vr' } });
        t.track('xr_exit', { value: 12 });
        vi.advanceTimersByTime(5000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/e');
        const events = JSON.parse(fetchMock.mock.calls[0][1].body).events;
        expect(events.map((e: any) => e.name)).toEqual(['w_enter', 'w_exit']);
        expect(events[0].props).toEqual({ mode: 'vr', site: 'example.test', adapter: 'a1', profile: 'meta-quest', wallVersion: '0.1.0' });
        expect(events[1].value).toBe(12);
    });

    it('samples', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        const { createTelemetry } = await import('../src/telemetry/createTelemetry');
        const t = createTelemetry({ endpoint: '/e', sample: 0 }, ctx);
        t.track('xr_enter');
        t.flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
