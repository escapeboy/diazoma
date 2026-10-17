/** Loads a classic script once per URL and resolves with `window[globalName]` (an existing global wins). */
const pending = new Map();

export function loadScript(url, globalName) {
    const win = globalThis;
    if (win[globalName]) return Promise.resolve(win[globalName]);
    if (pending.has(url)) return pending.get(url);
    const p = new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => (win[globalName] ? ok(win[globalName]) : fail(new Error(globalName + ' missing after ' + url)));
        s.onerror = () => fail(new Error('could not load ' + url));
        document.head.appendChild(s);
    });
    // A failed load may be retried later (another item, after the network came back).
    p.catch(() => pending.delete(url));
    pending.set(url, p);
    return p;
}
