import type { TelemetryConfig, TelemetryData, TelemetrySink } from '../types';
import { createXrEvents } from './xrEvents.js';

export interface TelemetryContext {
    site: string;
    adapter: string;
    profile: string;
    wallVersion: string;
}

export interface Telemetry {
    track: TelemetrySink;
    flush(useBeacon?: boolean): void;
}

const NONE: Telemetry = { track() {}, flush() {} };

/**
 * A function is used as is: the host decides names and payload (the host passes its own track).
 * An { endpoint, sample, prefix } config uses the batched xrEvents sink; event names start with
 * `prefix` instead of the shipped `xr_`, and the payload carries site, adapter, profile and version.
 */
export function createTelemetry(config: TelemetrySink | TelemetryConfig | undefined, ctx: TelemetryContext): Telemetry {
    if (!config) return NONE;
    if (typeof config === 'function') return { track: config, flush() {} };
    const sink = createXrEvents(config.endpoint);
    const prefix = config.prefix ?? 'xr_';
    const sample = config.sample ?? 1;
    return {
        track(name: string, data: TelemetryData = {}) {
            if (sample < 1 && Math.random() >= sample) return;
            const props = { ...(data.props || {}), site: ctx.site, adapter: ctx.adapter, profile: ctx.profile, wallVersion: ctx.wallVersion };
            sink.track(name.replace(/^xr_/, prefix), { ...data, props });
        },
        flush: sink.flush,
    };
}
