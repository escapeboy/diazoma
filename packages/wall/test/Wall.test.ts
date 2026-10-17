import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sceneArgs: any[] = [];
vi.mock('../src/scene/Gallery.js', () => ({
    Gallery: class {
        scope = { kind: 'home' };
        renderer = { xr: { setSession: vi.fn() }, setAnimationLoop: vi.fn(), dispose: vi.fn(), domElement: { remove: vi.fn() } };
        reportError = vi.fn();
        constructor(args: any) { sceneArgs.push(args); }
        state() { return { cards: 0 }; }
    },
}));

const adapter = (extra: any = {}) => ({
    id: 'site-a',
    capabilities: () => ({ search: false, filters: [], actions: [] }),
    page: vi.fn().mockResolvedValue({ items: [] }),
    ...extra,
});

describe('Wall', () => {
    let listeners: Record<string, any>;
    beforeEach(() => {
        sceneArgs.length = 0;
        listeners = {};
        vi.stubGlobal('addEventListener', vi.fn());
        vi.stubGlobal('window', { location: { href: '' }, addEventListener: (n: string, f: any) => { listeners[n] = f; }, removeEventListener: vi.fn() });
        vi.stubGlobal('location', { hostname: 'example.test' });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('mounts a scene with namespaced storage keys and merged strings', async () => {
        const { Wall } = await import('../src/Wall');
        new Wall({ mount: {} as any, adapter: adapter(), strings: { loading: 'Wait…' } }).mount();
        const a = sceneArgs[0];
        expect(a.storageKeys).toEqual({ settings: 'diazoma:site-a:settings', queue: 'diazoma:site-a:queue', resume: 'diazoma:site-a:resume' });
        expect(a.strings.loading).toBe('Wait…');
        expect(a.strings.close).toBe('Close');
        expect(a.profile.name).toBe('desktop');
    });

    it('carries comfort settings over from the old stena:* key once', async () => {
        const store = new Map<string, string>([['stena:site-a:settings', '{"height":1.4}']]);
        vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
        const { Wall } = await import('../src/Wall');
        new Wall({ mount: {} as any, adapter: adapter() }).mount();
        expect(store.get('diazoma:site-a:settings')).toBe('{"height":1.4}');
        store.set('diazoma:site-a:settings', '{"height":1.6}');
        new Wall({ mount: {} as any, adapter: adapter() }).mount();
        expect(store.get('diazoma:site-a:settings')).toBe('{"height":1.6}');
    });

    it('lets a site keep its own storage keys (saved places survive a deploy)', async () => {
        const { Wall } = await import('../src/Wall');
        new Wall({ mount: {} as any, adapter: adapter(), storageKeys: { settings: 'xr_settings', queue: 'xr_queue', resume: 'xr_resume' } }).mount();
        expect(sceneArgs[0].storageKeys).toEqual({ settings: 'xr_settings', queue: 'xr_queue', resume: 'xr_resume' });
    });

    it('publishes window.__diazoma with version, route and state()', async () => {
        const { Wall, VERSION } = await import('../src/Wall');
        new Wall({ mount: {} as any, adapter: adapter() }).mount();
        const hook = (window as any).__diazoma;
        expect(hook.version).toBe(VERSION);
        expect(typeof hook.route).toBe('string');
        expect(hook.route).toBe((typeof location !== 'undefined' && location.pathname) || '/');
        expect(hook.scope).toEqual({ kind: 'home' });
        expect(hook.state()).toEqual({ cards: 0 });
    });

    it('takes window.__diazoma.route from options.route when given', async () => {
        const { Wall } = await import('../src/Wall');
        new Wall({ mount: {} as any, adapter: adapter(), route: '/xr' } as any).mount();
        expect((window as any).__diazoma.route).toBe('/xr');
    });

    it('hands a telemetry function to the scene as is', async () => {
        const { Wall } = await import('../src/Wall');
        const track = vi.fn();
        new Wall({ mount: {} as any, adapter: adapter(), telemetry: track }).mount();
        expect(sceneArgs[0].track).toBe(track);
    });

    it('emits open (instead of navigating) and action events', async () => {
        const { Wall } = await import('../src/Wall');
        const result = { ok: true };
        const wall = new Wall({ mount: {} as any, adapter: adapter({ action: vi.fn().mockResolvedValue(result) }) }).mount();
        const opened = vi.fn();
        const acted = vi.fn();
        wall.on('open', opened);
        wall.on('action', acted);
        sceneArgs[0].openItem({ id: '1', link: '/x' });
        expect(opened).toHaveBeenCalledWith({ id: '1', link: '/x' });
        expect((window as any).location.href).toBe('');
        await sceneArgs[0].adapter.action('like', { id: '1' });
        expect(acted).toHaveBeenCalledWith({ id: 'like', item: { id: '1' }, result });
    });

    it('navigates to an http(s) item.link by default, resolved against the page', async () => {
        const { Wall } = await import('../src/Wall');
        (window as any).location.href = 'https://example.test/xr';
        new Wall({ mount: {} as any, adapter: adapter() }).mount();
        sceneArgs[0].openItem({ id: '1', link: '/item/1' });
        expect((window as any).location.href).toBe('https://example.test/item/1');
        sceneArgs[0].openItem({ id: '2', link: 'http://other.test/p' });
        expect((window as any).location.href).toBe('http://other.test/p');
    });

    it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'java\tscript:alert(1)', 'blob:https://example.test/u'])('refuses to navigate to %j and reports xr_error', async (link) => {
        const { Wall } = await import('../src/Wall');
        const track = vi.fn();
        (window as any).location.href = 'https://example.test/xr';
        new Wall({ mount: {} as any, adapter: adapter(), telemetry: track }).mount();
        sceneArgs[0].openItem({ id: '1', link });
        expect((window as any).location.href).toBe('https://example.test/xr');
        expect(track).toHaveBeenCalledWith('xr_error', { props: expect.objectContaining({ name: 'BlockedNavigation', surface: 'gallery' }) });
    });

    it('forwards window errors to the scene unless the host does it', async () => {
        const { Wall } = await import('../src/Wall');
        new Wall({ mount: {} as any, adapter: adapter() }).mount();
        expect(typeof listeners.error).toBe('function');
        listeners.error({ error: new Error('boom') });
        listeners = {};
        new Wall({ mount: {} as any, adapter: adapter(), features: { captureErrors: false } }).mount();
        expect(listeners.error).toBeUndefined();
    });
});
