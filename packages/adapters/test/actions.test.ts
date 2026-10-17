import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { WellKnownAdapter } from '../src/WellKnownAdapter';

const ORIGIN = 'https://shop.test';
const item = { id: '9', link: 'l', image: 'i', aspect: 1, state: { liked: false } };

interface Call { url: string; init?: RequestInit }
type Reply = Response | ((c: Call) => Response);

async function open(opts: { id?: string; action?: object; auth?: object; view?: object; reply?: Reply; html?: string; cookie?: string; pageOrigin?: string }) {
    const calls: Call[] = [];
    const action = { method: 'POST', url: '/api/{id}/like', auth: 'session', ...(opts.action ?? {}) };
    const manifest = JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }], actions: { [opts.id ?? 'like']: action }, ...(opts.auth ? { auth: opts.auth } : {}), ...(opts.view ? { view: opts.view } : {}) });
    const fetchFn = async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('wall.json')) return new Response(manifest);
        const r = opts.reply ?? new Response('{"ok":true}');
        return typeof r === 'function' ? r({ url, init }) : r.clone();
    };
    const document = parseHTML(`<html><head>${opts.html ?? ''}</head></html>`).document as unknown as Document;
    if (opts.cookie !== undefined) Object.defineProperty(document, 'cookie', { value: opts.cookie });
    const a = await new WellKnownAdapter({ origin: ORIGIN, fetch: fetchFn, document, pageOrigin: opts.pageOrigin ?? ORIGIN }).ready();
    return { a, calls, last: () => calls.at(-1)! };
}
const hdr = (c: Call) => c.init!.headers as Record<string, string>;

describe('action responses', () => {
    it('sends Accept, X-Requested-With, manual redirect handling and the session credentials', async () => {
        const { a, last } = await open({});
        expect(await a.action('like', item)).toEqual({ ok: true });
        expect(hdr(last())).toMatchObject({ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' });
        expect(last().init).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'include' });
    });
    it('takes state from a JSON object answer', async () => {
        const { a } = await open({ reply: new Response('{"ok":true,"state":{"liked":true}}') });
        expect(await a.action('like', item)).toEqual({ ok: true, state: { liked: true } });
    });
    it.each([
        ['an HTML page', new Response('<html>login</html>')],
        ['an empty 200', new Response('')],
        ['a JSON array', new Response('[1]')],
        ['a JSON string', new Response('"ok"')],
        ['ok:false', new Response('{"ok":false,"message":"nope"}')],
    ])('is an error for %s', async (_n, reply) => {
        const { a } = await open({ reply });
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
    });
    it('is an error for a redirect, whether the runtime reports it as 302 or as an opaque redirect', async () => {
        const { a } = await open({ reply: new Response('', { status: 302, headers: { Location: '/login' } }) });
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
        const opaque = Object.defineProperty(new Response(''), 'type', { value: 'opaqueredirect' });
        const b = await open({ reply: () => opaque });
        expect(await b.a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
        const redirected = Object.defineProperty(new Response('{"ok":true}'), 'redirected', { value: true });
        const c = await open({ reply: () => redirected });
        expect(await c.a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
    });
    it.each([401, 403, 419])('maps HTTP %i to reason auth', async (status) => {
        const { a } = await open({ reply: new Response('', { status }) });
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'auth' });
    });
    it('maps HTTP 500 to an error', async () => {
        const { a } = await open({ reply: new Response('{}', { status: 500 }) });
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
    });
    it('accepts an empty answer only for response: "empty", and rejects a body there', async () => {
        const empty = await open({ action: { response: 'empty' }, reply: new Response(null, { status: 204 }) });
        expect(await empty.a.action('like', item)).toEqual({ ok: true });
        const body = await open({ action: { response: 'empty' }, reply: new Response('<html>') });
        expect(await body.a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
        const dflt = await open({ reply: new Response(null, { status: 204 }) });
        expect(await dflt.a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
    });
    it('flips a like toggle when the answer has no state', async () => {
        const { a } = await open({ action: { toggle: true } });
        expect(await a.action('like', item)).toEqual({ ok: true, state: { liked: true } });
    });
    it('flips any other toggle under its own id', async () => {
        const { a } = await open({ id: 'favourite', action: { toggle: true } });
        expect(await a.action('favourite', item)).toEqual({ ok: true, state: { favourite: true } });
        expect(await a.action('favourite', { ...item, state: { favourite: true } })).toEqual({ ok: true, state: { favourite: false } });
    });
    it('flips the state key the view names for the action', async () => {
        const { a } = await open({ id: 'favourite', action: { toggle: true }, view: { actions: { favourite: { state: 'favourited' } } } });
        expect(await a.action('favourite', item)).toEqual({ ok: true, state: { favourited: true } });
        expect(await a.action('favourite', { ...item, state: { favourited: true } })).toEqual({ ok: true, state: { favourited: false } });
    });
});

describe('CSRF contract', () => {
    const meta = { csrf: { meta: 'csrf-token', header: 'X-CSRF-TOKEN' } };
    const cookie = { csrf: { cookie: 'XSRF-TOKEN', header: 'X-XSRF-TOKEN' } };
    const both = { csrf: { meta: 'csrf-token', cookie: 'XSRF-TOKEN', header: 'X-CSRF-TOKEN' } };

    it('sends the token from the meta tag in the header', async () => {
        const { a, last } = await open({ auth: meta, html: '<meta name="other" content="no"><meta name="csrf-token" content="tok123">' });
        expect(await a.action('like', item)).toMatchObject({ ok: true });
        expect(hdr(last())['X-CSRF-TOKEN']).toBe('tok123');
    });
    it('sends the token from the cookie, URL-decoded', async () => {
        const { a, last } = await open({ auth: cookie, cookie: 'a=1; XSRF-TOKEN=ab%3Dcd%2F; b=2' });
        expect(await a.action('like', item)).toMatchObject({ ok: true });
        expect(hdr(last())['X-XSRF-TOKEN']).toBe('ab=cd/');
    });
    it('prefers the meta tag and falls back to the cookie', async () => {
        const m = await open({ auth: both, html: '<meta name="csrf-token" content="fromMeta">', cookie: 'XSRF-TOKEN=fromCookie' });
        await m.a.action('like', item);
        expect(hdr(m.last())['X-CSRF-TOKEN']).toBe('fromMeta');
        const c = await open({ auth: both, cookie: 'XSRF-TOKEN=fromCookie' });
        await c.a.action('like', item);
        expect(hdr(c.last())['X-CSRF-TOKEN']).toBe('fromCookie');
    });
    it('returns reason auth and sends nothing when the contract is declared and no token is found', async () => {
        const { a, calls } = await open({ auth: meta, html: '<meta name="csrf-token" content="">' });
        const n = calls.length;
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'auth' });
        expect(calls).toHaveLength(n);
        const c = await open({ auth: cookie, cookie: 'other=1' });
        expect(await c.a.action('like', item)).toMatchObject({ ok: false, reason: 'auth' });
    });
    it('does not read a token from a page on another origin than the manifest', async () => {
        const { a, calls } = await open({ auth: meta, html: '<meta name="csrf-token" content="foreign">', pageOrigin: 'https://evil.test' });
        const n = calls.length;
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'auth' });
        expect(calls).toHaveLength(n);
    });
    it('sends no token for a GET action, and for auth none', async () => {
        const g = await open({ auth: meta, action: { method: 'GET' } });
        expect(await g.a.action('like', item)).toMatchObject({ ok: true });
        expect(hdr(g.last())).not.toHaveProperty('X-CSRF-TOKEN');
        const n = await open({ auth: meta, action: { auth: 'none' }, html: '<meta name="csrf-token" content="t">' });
        await n.a.action('like', item);
        expect(hdr(n.last())).not.toHaveProperty('X-CSRF-TOKEN');
    });
    it('refuses a header name that is not a plain token and a token with a newline', async () => {
        const bad = await open({ auth: { csrf: { meta: 'csrf-token', header: 'X-A\r\nB' } }, html: '<meta name="csrf-token" content="t">' });
        expect(await bad.a.action('like', item)).toMatchObject({ ok: false, reason: 'error' });
        const nl = await open({ auth: meta, html: '<meta name="csrf-token" content="a\nb">' });
        expect(await nl.a.action('like', item)).toMatchObject({ ok: false, reason: 'auth' });
    });
    it('does not use a meta tag whose name only looks like the selector', async () => {
        const { a } = await open({ auth: { csrf: { meta: 'x"] , [name="csrf-token', header: 'X-CSRF-TOKEN' } }, html: '<meta name="csrf-token" content="t">' });
        expect(await a.action('like', item)).toMatchObject({ ok: false, reason: 'auth' });
    });
});
