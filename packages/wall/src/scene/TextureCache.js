/**
 * LRU cache for card textures (spec quest-xr §2.2: ≤ 60 live textures on Quest 2).
 * Evicted entries are disposed through the supplied callback so GPU memory is
 * released as soon as a card scrolls far enough away.
 */
export class TextureCache {
    constructor(max = 60, dispose = (value) => value && value.dispose && value.dispose()) {
        this.max = max;
        this.dispose = dispose;
        this.map = new Map();
    }

    get size() {
        return this.map.size;
    }

    has(key) {
        return this.map.has(key);
    }

    /** Returns the value and marks it most recently used. */
    get(key) {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }

    /**
     * Inserts/replaces and evicts least-recently-used entries past `max`; returns evicted keys.
     * Keys for which `isProtected(key)` is true are skipped, so the cache may hold more than `max`
     * while everything left is protected (the caller keeps `max` above the number of those keys).
     */
    set(key, value, isProtected = null) {
        if (this.map.has(key)) {
            const old = this.map.get(key);
            this.map.delete(key);
            if (old !== value) this.dispose(old);
        }
        this.map.set(key, value);
        const evicted = [];
        while (this.map.size > this.max) {
            let victim = null;
            for (const entry of this.map) {
                if (entry[0] !== key && !(isProtected && isProtected(entry[0]))) {
                    victim = entry;
                    break;
                }
            }
            if (!victim) break;
            const [oldKey, oldValue] = victim;
            this.map.delete(oldKey);
            this.dispose(oldValue);
            evicted.push(oldKey);
        }
        return evicted;
    }

    delete(key) {
        if (!this.map.has(key)) return false;
        this.dispose(this.map.get(key));
        return this.map.delete(key);
    }

    clear() {
        for (const value of this.map.values()) this.dispose(value);
        this.map.clear();
    }
}
