import type { Capabilities, FeedAdapter, FeedRequest, Item, ViewConfig } from '@diazoma/wall';
import { AdapterError, decodeCursor, encodeCursor } from './common.js';

export interface MixWarning {
    code: 'source-failed';
    message: string;
    /** Id of the source adapter that threw. */
    source: string;
}

export interface MixOptions {
    id: string;
    sources: FeedAdapter[];
    view?: ViewConfig;
    onWarning?: (w: MixWarning) => void;
}

/** Where one source stands: null = first page not asked yet, 0 = finished, string = its cursor for the next page. */
type SourceState = string | 0 | null;

/**
 * Reads several adapters as one feed: every call asks each unfinished source for a page and interleaves the
 * items one by one. Item ids get the source's index in front (`<i>:<id>`) so ids from different sources
 * cannot clash. Read-only: no actions.
 */
export class MixAdapter implements FeedAdapter {
    readonly id: string;
    view?: ViewConfig;
    private readonly sources: FeedAdapter[];
    private readonly onWarning?: (w: MixWarning) => void;

    constructor(opts: MixOptions) {
        if (!opts.sources.length) throw new AdapterError('schema', 'a mix needs at least one source');
        this.id = opts.id;
        this.sources = opts.sources;
        this.view = opts.view;
        this.onWarning = opts.onWarning;
    }

    capabilities(): Capabilities {
        return { search: this.sources.every((s) => s.capabilities().search), filters: [], actions: [] };
    }

    async page(req: FeedRequest): Promise<{ items: Item[]; next?: string }> {
        const states = this.readStates(req.cursor);
        const asked = states.flatMap((s, i) => (s === 0 ? [] : [i]));
        if (!asked.length) return { items: [] };

        const answers = await Promise.all(
            asked.map(async (i) => {
                const { cursor: _cursor, ...rest } = req;
                const one: FeedRequest = { ...rest, ...(typeof states[i] === 'string' ? { cursor: states[i] as string } : {}) };
                try {
                    return { i, page: await this.sources[i].page(one) };
                } catch (e) {
                    this.onWarning?.({ code: 'source-failed', source: this.sources[i].id, message: `${this.sources[i].id}: ${(e as Error).message}` });
                    return { i, error: e as Error };
                }
            }),
        );

        const failed = answers.filter((a) => a.error);
        if (failed.length === answers.length) throw failed[0].error;

        const next: SourceState[] = [...states];
        const lists: Item[][] = this.sources.map(() => []);
        for (const a of answers) {
            if (!a.page) {
                next[a.i] = 0;
                continue;
            }
            lists[a.i] = a.page.items.map((it) => ({ ...it, id: `${a.i}:${it.id}` }));
            next[a.i] = a.page.next ?? 0;
        }

        const items: Item[] = [];
        const longest = Math.max(...lists.map((l) => l.length));
        for (let k = 0; k < longest; k++) for (const l of lists) if (k < l.length) items.push(l[k]);

        return { items, ...(next.some((s) => s !== 0) ? { next: encodeCursor({ s: next }) } : {}) };
    }

    private readStates(cursor: string | undefined): SourceState[] {
        if (!cursor) return this.sources.map(() => null);
        const s = decodeCursor<{ s?: unknown }>(cursor).s;
        if (!Array.isArray(s) || s.length !== this.sources.length || !s.every((v) => v === null || v === 0 || typeof v === 'string')) {
            throw new AdapterError('cursor', 'cursor does not belong to this mix');
        }
        return s as SourceState[];
    }
}
