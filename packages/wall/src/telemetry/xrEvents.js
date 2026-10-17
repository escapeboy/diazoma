/**
 * Batched XR telemetry → POST <endpoint> (≤ 50 events per request).
 * Flushes on a short timer, when the batch is full, and on pagehide (sendBeacon),
 * so events survive the page being closed from inside a headset.
 */

export const ENDPOINT = '/api/v1/xr/events';
export const MAX_BATCH = 50;
const FLUSH_DELAY_MS = 5000;

export function createXrEvents(endpoint = ENDPOINT) {
    let queue = [];
    let timer = null;

    function send(batch, useBeacon) {
        const body = JSON.stringify({ events: batch });
        if (useBeacon && navigator.sendBeacon) {
            navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
            return;
        }
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body,
            keepalive: true,
            credentials: 'same-origin',
        }).catch(() => {});
    }

    function flush(useBeacon = false) {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        while (queue.length) send(queue.splice(0, MAX_BATCH), useBeacon);
    }

    /**
     * @param {string} name   one of xr_supported|xr_enter|xr_exit|xr_watch_seconds|xr_backend|xr_error
     * @param {{pin_id?: string, value?: number, props?: Object<string,string>}} [data]
     */
    function track(name, data = {}) {
        queue.push({ name, ts: Date.now(), ...data });
        if (queue.length >= MAX_BATCH) {
            flush();
        } else if (!timer) {
            timer = setTimeout(() => flush(), FLUSH_DELAY_MS);
        }
    }

    addEventListener('pagehide', () => flush(true));
    return { track, flush };
}

const shipped = createXrEvents();
export const track = shipped.track;
export const flush = shipped.flush;
