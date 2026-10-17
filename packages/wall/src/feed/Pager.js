/**
 * Cursor pager over FeedAdapter.page(). Deduplicates by id so a retried or overlapping
 * page can never put the same card on the wall twice. Cursors are opaque strings.
 */
export const MAX_EMPTY_PAGES = 3;
export const EMPTY_BACKOFF_MS = 400;
export const MAX_FAILURES = 6;
export const FAIL_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 60000;

export class Pager {
    constructor(adapter, request = {}) {
        this.adapter = adapter;
        this.reset(request);
    }

    /** Starts over on another request ({ scope, filter, query }). */
    reset(request = {}) {
        this.request = request;
        this.items = [];
        this.ids = new Set();
        this.cursor = null;
        this.done = false;
        this.loading = null;
        this.stopped = null;
        this.emptyRun = 0;
        this.failures = 0;
        this.notBefore = 0;
        this.generation = (this.generation || 0) + 1;
    }

    /**
     * After a failed page (HTTP 429/5xx, network, parse): wait 1 s, 2 s, 4 s ... up to 60 s with a little
     * jitter, or as long as the site's Retry-After (seconds, on `error.retryAfter`) says. After MAX_FAILURES
     * in a row paging stops.
     */
    backOff(error) {
        this.failures++;
        if (this.failures >= MAX_FAILURES) {
            this.stopped = 'errors';
            this.done = true;
            return;
        }
        const backoff = Math.min(MAX_BACKOFF_MS, FAIL_BACKOFF_MS * 2 ** (this.failures - 1)) * (1 + Math.random() * 0.2);
        const retryAfter = error && Number.isFinite(error.retryAfter) ? error.retryAfter * 1000 : 0;
        this.notBefore = Date.now() + Math.min(MAX_BACKOFF_MS * 5, Math.max(backoff, retryAfter));
    }

    /**
     * After paging stopped (errors, repeated cursor, no new cards): allow another try. Items and the cursor
     * stay, so the wall keeps what it has and continues from where it stopped.
     */
    resume() {
        if (!this.stopped) return;
        this.stopped = null;
        this.done = false;
        this.failures = 0;
        this.emptyRun = 0;
        this.notBefore = 0;
    }

    /** False while backing off after a page that added nothing, so a render loop cannot hammer the feed. */
    canFetch(now = Date.now()) {
        return !this.done && !this.loading && now >= this.notBefore;
    }

    /** Loads the next page; resolves to the newly added items (empty when finished). */
    next() {
        if (this.done) return Promise.resolve([]);
        if (this.loading) return this.loading;
        const generation = this.generation;
        const req = this.cursor ? { ...this.request, cursor: this.cursor } : { ...this.request };

        this.loading = this.adapter.page(req)
            .then((data) => {
                if (generation !== this.generation) return [];
                const fresh = (data.items || []).filter((it) => it && it.id && !this.ids.has(it.id));
                fresh.forEach((it) => this.ids.add(it.id));
                this.items.push(...fresh);
                this.failures = 0;
                const next = data.next || null;
                if (next && next === this.cursor) {
                    // The feed handed back the cursor we just used: it would answer the same page forever.
                    this.stopped = 'cursor_repeat';
                    this.done = true;
                    this.cursor = next;
                    return fresh;
                }
                this.cursor = next;
                this.done = !this.cursor;
                this.emptyRun = fresh.length ? 0 : this.emptyRun + 1;
                if (!this.done && this.emptyRun >= MAX_EMPTY_PAGES) {
                    this.stopped = 'no_new_cards';
                    this.done = true;
                } else if (!fresh.length) {
                    this.notBefore = Date.now() + EMPTY_BACKOFF_MS * 2 ** (this.emptyRun - 1);
                }
                return fresh;
            })
            .catch((e) => {
                if (generation === this.generation) this.backOff(e);
                throw e;
            })
            .finally(() => {
                if (generation === this.generation) this.loading = null;
            });
        return this.loading;
    }
}

/** Same interface as Pager over a fixed list (the watch-later queue kept in the browser). */
export class LocalFeed {
    constructor(items = []) {
        this.items = items;
        this.done = false;
        this.loading = null;
    }

    reset() {}

    canFetch() {
        return !this.done;
    }

    next() {
        if (this.done) return Promise.resolve([]);
        this.done = true;
        return Promise.resolve(this.items);
    }
}
