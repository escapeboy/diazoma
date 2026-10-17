import { beforeEach, describe, expect, it } from 'vitest';
import { RESUME_KEY, load, save, snapshot } from '../src/scene/resume.js';

function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const HOUR = 3600 * 1000;
const place = { scope: { kind: 'board', id: 'b1', name: 'Board' }, stack: [{ kind: 'home', returnScroll: 2.5 }], filters: { type: 'video', sort: 'popular' }, scroll: 4.2, pinId: 'p9' };

describe('resume', () => {
    let storage;
    beforeEach(() => { storage = memoryStorage(); });

    it('round-trips a place within the window', () => {
        save(storage, snapshot(place, 1000));
        expect(load(storage, 24, null, 1000 + 23 * HOUR)).toEqual({ scope: place.scope, stack: place.stack, filters: place.filters, scroll: 4.2, pinId: 'p9' });
    });

    it('expires after the configured hours and drops the stale entry', () => {
        save(storage, snapshot(place, 1000));
        expect(load(storage, 1, null, 1000 + HOUR + 1)).toBeNull();
        expect(storage.m.has(RESUME_KEY)).toBe(false);
    });

    it('is off when the setting is 0', () => {
        save(storage, snapshot(place, 1000));
        expect(load(storage, 0, null, 1001)).toBeNull();
    });

    it('ignores malformed or foreign data', () => {
        storage.setItem(RESUME_KEY, '{not json');
        expect(load(storage, 24, null, 1)).toBeNull();
        storage.setItem(RESUME_KEY, JSON.stringify({ at: 1, scope: { kind: 'evil' } }));
        expect(load(storage, 24, null, 2)).toBeNull();
        storage.setItem(RESUME_KEY, JSON.stringify({ at: 5000, scope: { kind: 'home' } }));
        expect(load(storage, 24, null, 1000)).toBeNull(); // saved "in the future": clock skew, not trusted
    });

    it('keeps only the last 10 back steps and valid kinds', () => {
        const stack = [...Array(14)].map((_, i) => ({ kind: 'tag', id: String(i) }));
        save(storage, snapshot({ ...place, stack }, 1));
        expect(load(storage, 24, null, 2).stack.map((s) => s.id)).toEqual(['4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
    });

    it('does not throw when storage is unavailable', () => {
        const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
        expect(() => save(broken, snapshot(place, 1))).not.toThrow();
        expect(load(broken, 24, null, 2)).toBeNull();
    });

    it('belongs to the account that left it', () => {
        save(storage, snapshot({ ...place, userId: 'u1' }, 1000));
        expect(load(storage, 24, 'u2', 2000)).toBeNull(); // another account on the same headset
        save(storage, snapshot({ ...place, userId: 'u1' }, 1000));
        expect(load(storage, 24, null, 2000)).toBeNull(); // signed out
        expect(storage.m.has(RESUME_KEY)).toBe(false);
        save(storage, snapshot({ ...place, userId: 'u1' }, 1000));
        expect(load(storage, 24, 'u1', 2000).scope).toEqual(place.scope);
    });

    it('a guest place is not offered to a signed-in account', () => {
        save(storage, snapshot(place, 1000));
        expect(load(storage, 24, 'u1', 2000)).toBeNull();
    });
});
