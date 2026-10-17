import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import type { FetchLike } from '../src/common';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
export const read = (rel: string) => readFileSync(path.join(FIXTURES, rel), 'utf8');
export const doc = (html: string) => parseHTML(html).document as unknown as Document;

/** A fetch that answers from a table of URL to body; anything else is a 404. Records the calls. */
export function stubFetch(table: Record<string, string | ((url: string, init?: RequestInit) => string)>) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fn: FetchLike = async (url, init) => {
        calls.push({ url, init });
        const hit = table[url];
        if (hit === undefined) return new Response('not found', { status: 404 });
        return new Response(typeof hit === 'function' ? hit(url, init) : hit, { status: 200 });
    };
    return Object.assign(fn, { calls });
}
