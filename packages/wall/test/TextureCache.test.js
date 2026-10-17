import { describe, expect, it, vi } from 'vitest';
import { TextureCache } from '../src/scene/TextureCache.js';

const tex = (id) => ({ id, dispose: vi.fn() });

describe('TextureCache', () => {
    it('evicts and disposes the least recently used entry past the limit', () => {
        const cache = new TextureCache(3);
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(tex);
        cache.set('a', a);
        cache.set('b', b);
        cache.set('c', c);
        cache.get('a'); // a is now most recent → b is the LRU
        expect(cache.set('d', d)).toEqual(['b']);
        expect(b.dispose).toHaveBeenCalledOnce();
        expect(cache.has('a') && cache.has('c') && cache.has('d')).toBe(true);
        expect(cache.size).toBe(3);
    });

    it('never holds more than 60 textures by default', () => {
        const cache = new TextureCache();
        const all = Array.from({ length: 200 }, (_, i) => tex(i));
        all.forEach((t, i) => cache.set(i, t));
        expect(cache.size).toBe(60);
        expect(all.filter((t) => t.dispose.mock.calls.length === 1)).toHaveLength(140);
        expect(cache.has(199) && !cache.has(139)).toBe(true);
    });

    it('replacing a key disposes the old value, not the new one', () => {
        const cache = new TextureCache(2);
        const old = tex('old');
        const fresh = tex('new');
        cache.set('k', old);
        cache.set('k', fresh);
        expect(old.dispose).toHaveBeenCalledOnce();
        expect(fresh.dispose).not.toHaveBeenCalled();
        expect(cache.get('k')).toBe(fresh);
    });

    it('delete and clear dispose', () => {
        const cache = new TextureCache(5);
        const [a, b] = [tex('a'), tex('b')];
        cache.set('a', a);
        cache.set('b', b);
        expect(cache.delete('a')).toBe(true);
        expect(cache.delete('missing')).toBe(false);
        cache.clear();
        expect(a.dispose).toHaveBeenCalledOnce();
        expect(b.dispose).toHaveBeenCalledOnce();
        expect(cache.size).toBe(0);
    });

    it('uses a custom dispose callback', () => {
        const dispose = vi.fn();
        const cache = new TextureCache(1, dispose);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(dispose).toHaveBeenCalledWith(1);
    });

    it('skips protected keys when evicting, and may go past max while all that is left is protected', () => {
        const cache = new TextureCache(2);
        const protectedKeys = new Set(['a', 'b']);
        cache.set('a', tex('a'));
        cache.set('b', tex('b'));
        expect(cache.set('c', tex('c'), (k) => protectedKeys.has(k))).toEqual([]);
        expect(cache.size).toBe(3);
        protectedKeys.delete('a');
        expect(cache.set('d', tex('d'), (k) => protectedKeys.has(k))).toEqual(['a', 'c']);
        expect(cache.has('b') && cache.has('d')).toBe(true);
    });
});
