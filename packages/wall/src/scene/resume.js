/**
 * "Continue where I left off": the wall's place (scope, back trail, filters, scroll, open pin)
 * kept in localStorage and offered again for a limited time (settings → resumeHours).
 */
export const RESUME_KEY = 'xr_resume';
export const RESUME_HOURS_STEPS = [0, 1, 24, 72]; // 0 = off
const MAX_STACK = 10;
const SCOPE_KINDS = ['home', 'user', 'following', 'board', 'tag', 'related', 'discover', 'search', 'queue'];

/** @returns {object|null} a plain copy of the place, or null when there is nothing worth keeping */
export function snapshot({ scope, stack, filters, scroll, pinId, userId }, now = Date.now()) {
    if (!scope || !SCOPE_KINDS.includes(scope.kind)) return null;
    return {
        at: now,
        // Headsets are shared: a place belongs to the account (or guest) that left it.
        userId: userId ? String(userId) : null,
        scope: { ...scope },
        stack: (stack || []).slice(-MAX_STACK).map((s) => ({ ...s })),
        filters: { ...filters },
        scroll: Number.isFinite(scroll) ? scroll : 0,
        pinId: typeof pinId === 'string' ? pinId : null,
    };
}

export function save(storage, state, key = RESUME_KEY) {
    try {
        if (state) storage.setItem(key, JSON.stringify(state));
    } catch (e) {
        // private mode / quota: the place is simply not kept
    }
}

export function clear(storage, key = RESUME_KEY) {
    try {
        storage.removeItem(key);
    } catch (e) {}
}

/**
 * The saved place if it is younger than `hours` and was left by the same account (or guest),
 * else null; an expired or foreign one is dropped. Anything malformed is ignored: this runs
 * before the wall exists.
 */
export function load(storage, hours, userId = null, now = Date.now(), key = RESUME_KEY) {
    if (!hours) return null;
    let state;
    try {
        state = JSON.parse(storage.getItem(key) || 'null');
    } catch (e) {
        return null;
    }
    if (!state || typeof state !== 'object' || !state.scope || !SCOPE_KINDS.includes(state.scope.kind)) return null;
    const owner = typeof state.userId === 'string' ? state.userId : null;
    if (owner !== (userId ? String(userId) : null) || !Number.isFinite(state.at) || now - state.at > hours * 3600 * 1000 || state.at > now) {
        clear(storage, key);
        return null;
    }
    return {
        scope: state.scope,
        stack: Array.isArray(state.stack) ? state.stack.filter((s) => s && SCOPE_KINDS.includes(s.kind)).slice(-MAX_STACK) : [],
        filters: state.filters && typeof state.filters === 'object' ? state.filters : null,
        scroll: Number.isFinite(state.scroll) ? state.scroll : 0,
        pinId: typeof state.pinId === 'string' ? state.pinId : null,
    };
}
