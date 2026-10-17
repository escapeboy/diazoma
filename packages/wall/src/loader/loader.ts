/**
 * Loader (≤ 3 KB gz): the big full-screen Enter VR card, navigator.xr.offerSession, and the
 * dynamic load of the core. It holds no three.js. Host options are read from the script tag
 * (data-core, data-mount, data-title, data-body, data-enter, data-browse) and from
 * window.diazoma.options (adapter, brand, strings, …; see WallOptions).
 */
const win: any = window;
const nav: any = navigator;
const doc: any = document;

const FEATURES = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
const tag = doc.currentScript;
const attr = (k: string, d: string) => (tag && tag.getAttribute('data-' + k)) || d;
const host = (win.diazoma = win.diazoma || {});

let core: Promise<any> | null = null;
const loadCore = () => core || (core = new Promise((ok, fail) => {
    if (win.Diazoma) return ok(win.Diazoma);
    const s = doc.createElement('script');
    s.src = attr('core', 'wall.iife.js');
    s.onload = () => ok(win.Diazoma);
    s.onerror = fail;
    doc.head.appendChild(s);
}));

let wall: any = null;
async function boot() {
    const { Wall } = await loadCore();
    if (!wall) {
        wall = new Wall({ mount: doc.querySelector(attr('mount', '#diazoma')), ...host.options });
        wall.mount();
        host.wall = wall;
    }
    return wall;
}

function el(parent: any, name: string, css: string, text?: string, id?: string) {
    const e = doc.createElement(name);
    e.style.cssText = css;
    if (id) e.id = id;
    if (text) e.textContent = text;
    parent.appendChild(e);
    return e;
}

function card(onEnter: () => void, onBrowse: () => void) {
    const root = el(doc.body, 'div', 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:rgba(8,8,11,.72);z-index:2147483000;font-family:system-ui,sans-serif', '', 'diazoma-intro');
    // The whole card is the target: one big surface for the controller ray.
    const box = el(root, 'div', 'width:min(640px,100%);padding:40px 36px 28px;border-radius:28px;background:#141417;text-align:center;cursor:pointer;color:#f4f3f2', '', 'diazoma-intro-card');
    el(box, 'h1', 'margin:0 0 12px;font-size:34px', attr('title', 'Step inside'));
    el(box, 'p', 'margin:0 0 28px;font-size:20px;line-height:1.45;color:#c4c4ca', attr('body', 'Everything around you in VR. Point and pull the trigger to open one.'));
    const enter = el(box, 'button', 'width:100%;min-height:84px;border:0;border-radius:999px;background:#c9334f;color:#fff;font-weight:700;font-size:28px;cursor:pointer', attr('enter', 'Enter VR'), 'diazoma-enter');
    const browse = el(box, 'button', 'margin-top:14px;min-height:56px;border:0;background:none;color:#c4c4ca;font-weight:600;font-size:18px;text-decoration:underline;cursor:pointer', attr('browse', 'Browse here'), 'diazoma-browse');
    box.onclick = onEnter;
    enter.onclick = (e: any) => { e.stopPropagation(); onEnter(); };
    browse.onclick = (e: any) => { e.stopPropagation(); root.remove(); onBrowse(); };
    return root;
}

// The small button that brings the visitor back into VR after the session ended or entering failed.
let small: any = null;
let hooked = false;
function showSmall(enter: () => void) {
    if (!small) {
        small = el(doc.body, 'button', 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);min-height:56px;padding:0 28px;border:0;border-radius:999px;background:#c9334f;color:#fff;font:700 18px system-ui,sans-serif;cursor:pointer;z-index:2147482000', attr('enter', 'Enter VR'), 'diazoma-enter-small');
        small.onclick = enter;
    }
    small.hidden = false;
}

async function start() {
    const xr = nav.xr;
    const ok = xr && xr.isSessionSupported ? await xr.isSessionSupported('immersive-vr').catch(() => false) : false;
    if (!ok) {
        boot();
        return;
    }
    loadCore();
    const hook = (w: any) => {
        if (hooked) return;
        hooked = true;
        w.scene.renderer.xr.addEventListener('sessionend', () => showSmall(enter));
    };
    let entering = false;
    const enter = async () => {
        if (entering) return;
        entering = true;
        try {
            const w = await boot();
            hook(w);
            await w.enterVr();
            if (small) small.hidden = true;
        } catch (e: any) {
            if (!e || e.name !== 'NotSupportedError') showSmall(enter);
        } finally {
            root.remove();
            entering = false;
        }
    };
    const root = card(enter, () => { boot(); });
    // Browsers that implement offerSession show their own "Enter VR" affordance as well.
    if (xr.offerSession && (host.options || {}).features?.offerSession !== false) {
        xr.offerSession('immersive-vr', FEATURES).then(async (session: any) => {
            const w = await boot();
            hook(w);
            await w.attachSession(session);
            if (small) small.hidden = true;
            root.remove();
        }, () => {});
    }
}

if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
else start();
