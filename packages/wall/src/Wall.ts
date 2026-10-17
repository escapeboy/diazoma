import { Gallery } from './scene/Gallery.js';
import { configureLayout } from './scene/layout.js';
import { resolveView } from './view/resolveView';
import { Pager } from './feed/Pager.js';
import { validateBrand } from './brand/contrast';
import { pickProfile } from './input/profiles';
import { createTelemetry } from './telemetry/createTelemetry';
import en from './strings/en.js';
import bg from './strings/bg.js';
import pkg from '../package.json';
import type { AccountAdapter, ActionId, FeedAdapter, InputProfile, Item, StorageKeys, WallOptions } from './types';

export const VERSION: string = pkg.version;

const SESSION_OPTIONS = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
const LOCALES: Record<string, Record<string, string>> = { en, bg };

const GUEST: AccountAdapter = { state: () => ({ authed: false }) };

type Listener = (payload: any) => void;

/** Public API of spec 01 §1.1. One instance per page: the layout module keeps wall zoom state. */
/** Opens an item's page. Only http(s) links are followed; anything else is reported as xr_error and not opened. */
function navigateTo(link: string, track: (name: string, data?: any) => void): void {
    let url: URL | null = null;
    try {
        url = new URL(String(link), window.location.href);
    } catch {
        // an unparseable link is refused below
    }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        track('xr_error', { props: { name: 'BlockedNavigation', message: 'item link is not an http(s) URL: ' + (url ? url.protocol : 'unparseable'), surface: 'gallery' } });
        return;
    }
    window.location.href = url.href;
}

export class Wall {
    readonly options: WallOptions;
    scene: any = null;
    profile: InputProfile;
    private listeners: Record<string, Listener[]> = { open: [], action: [] };
    private telemetry;
    private stopErrorHooks: (() => void) | null = null;

    constructor(options: WallOptions) {
        this.options = options;
        this.profile = pickProfile(options.inputProfile ?? 'auto');
        this.telemetry = createTelemetry(options.telemetry, {
            site: options.site || (typeof location !== 'undefined' ? location.hostname : ''),
            adapter: options.adapter.id,
            profile: this.profile.name,
            wallVersion: VERSION,
        });
    }

    /** Builds the scene in `options.mount`: the magic window works at once. */
    mount(): this {
        if (this.scene) return this;
        const o = this.options;
        const adapter = this.withActionEvents(o.adapter);
        const key = `diazoma:${o.adapter.id}:`;
        const storageKeys: StorageKeys = { settings: key + 'settings', queue: key + 'queue', resume: key + 'resume', ...o.storageKeys };
        // Comfort settings saved before the rename to Diazoma lived under stena:*; carry them over once.
        if (!o.storageKeys?.settings) {
            try {
                const old = localStorage.getItem(`stena:${o.adapter.id}:settings`);
                if (old !== null && localStorage.getItem(storageKeys.settings) === null) localStorage.setItem(storageKeys.settings, old);
            } catch {
                // storage blocked
            }
        }
        const brand = validateBrand(o.brand);
        // The site's view (manifest, recipe or page) under the page's own options, clamped to the comfort limits.
        const view = resolveView(o.adapter.view, o.view, brand);
        configureLayout({ rows: view.wall.rows, radius: view.wall.radius, arc: view.wall.arc, cardW: view.wall.cardW, cardH: view.wall.cardH });
        const strings = { ...(LOCALES[o.locale || 'en'] || en), ...view.strings, ...(o.strings || {}) };
        const openItem = (item: Item) => {
            if (this.listeners.open.length) this.listeners.open.forEach((fn) => fn(item));
            else if (o.hooks?.openItem) o.hooks.openItem(item);
            else navigateTo(item.link, this.telemetry.track);
        };
        this.scene = new (Gallery as any)({
            container: o.mount,
            feed: new Pager(adapter),
            adapter,
            account: o.account || GUEST,
            brand: { ...view.colors, font: view.font, name: brand.name, logo: brand.logo },
            view,
            hooks: o.hooks || {},
            hasAccount: !!o.account,
            strings,
            locale: o.locale,
            profile: this.profile,
            storageKeys,
            openItem,
            initialItem: o.initialItem ?? null,
            track: this.telemetry.track,
            announce: o.announce,
            onFilterChange: o.onFilterChange,
            onAuthChange: o.onAuthChange,
            onScopeChange: o.onScopeChange,
            video: { libs: o.videoLibs, embeds: o.embeds !== false, maxHeight: o.maxVideoHeight },
        });
        const scene = this.scene;
        (window as any).__diazoma = {
            version: VERSION,
            // The spec shape: route is the path of the wall's page; the current scope has its own key.
            route: (o as { route?: string }).route ?? ((typeof location !== 'undefined' && location.pathname) || '/'),
            get scope() { return { ...scene.scope }; },
            state: () => scene.state(),
            scene, // test hook of the headless harness
        };
        if (o.features?.captureErrors !== false) this.captureErrors();
        return this;
    }

    /** Enters VR; must run inside a user gesture. Rejects when the headset refuses. */
    async enterVr(mode: 'immersive-vr' | 'immersive-ar' = 'immersive-vr'): Promise<void> {
        if (!this.scene) this.mount();
        try {
            const session = await (navigator as any).xr.requestSession(mode, SESSION_OPTIONS);
            await this.scene.renderer.xr.setSession(session);
        } catch (e: any) {
            this.telemetry.track('xr_error', { props: { name: (e && e.name) || 'Error', message: String(e && e.message).slice(0, 180), surface: 'gallery' } });
            if (e && e.name === 'NotSupportedError' && mode === 'immersive-vr' && this.options.features?.capsCookie) {
                document.cookie = 'xr_caps=none; max-age=' + 7 * 86400 + '; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
            }
            throw e;
        }
    }

    /** Hands an already created session to the scene (the browser's own Enter VR button, offerSession). */
    async attachSession(session: unknown): Promise<void> {
        if (!this.scene) this.mount();
        await this.scene.renderer.xr.setSession(session);
    }

    on(event: 'open' | 'action', fn: Listener): () => void {
        this.listeners[event].push(fn);
        return () => { this.listeners[event] = this.listeners[event].filter((f) => f !== fn); };
    }

    destroy(): void {
        if (!this.scene) return;
        if (this.stopErrorHooks) this.stopErrorHooks();
        // Stream players, video elements and the embed overlay go before the renderer.
        if (typeof this.scene.dispose === 'function') this.scene.dispose();
        this.scene.renderer.setAnimationLoop(null);
        this.scene.renderer.dispose();
        this.scene.renderer.domElement.remove();
        delete (window as any).__diazoma;
        this.telemetry.flush();
        this.scene = null;
    }

    private withActionEvents(adapter: FeedAdapter): FeedAdapter {
        if (!adapter.action) return adapter;
        const wrapped: FeedAdapter = Object.create(adapter);
        wrapped.action = async (id: ActionId, item: Item, args?: Record<string, unknown>) => {
            const result = await adapter.action!(id, item, args);
            this.listeners.action.forEach((fn) => fn({ id, item, result }));
            return result;
        };
        return wrapped;
    }

    private captureErrors(): void {
        const onError = (e: ErrorEvent) => this.scene?.reportError('window', e.error || e.message);
        const onRejection = (e: PromiseRejectionEvent) => this.scene?.reportError('promise', e.reason);
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        this.stopErrorHooks = () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }
}
