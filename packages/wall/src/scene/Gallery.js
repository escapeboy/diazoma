import {
    BackSide,
    BufferGeometry,
    Points,
    PointsMaterial,
    CanvasTexture,
    CircleGeometry,
    Clock,
    Color,
    DoubleSide,
    Fog,
    Float32BufferAttribute,
    GridHelper,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    Raycaster,
    RingGeometry,
    Scene,
    ShaderMaterial,
    SphereGeometry,
    SRGBColorSpace,
    Texture,
    TextureLoader,
    Vector2,
    Vector3,
    VideoTexture,
    WebGLRenderer,
} from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import {
    ARC,
    CELL_H,
    COL_ANGLE,
    EYE_Y,
    RADIUS,
    ROWS,
    configureLayout,
    clampScroll,
    columnOf,
    fitCard,
    itemTransform,
    nearEnd,
    rowOf,
    rowY,
    scrollBounds,
    scrollProgress,
    stepInertia,
    visibleItems,
    setWallZoom,
    wallZoom,
    CARD_MAX_H,
    CARD_MAX_W,
} from './layout.js';
import { LocalFeed } from '../feed/Pager.js';
import { TextureCache } from './TextureCache.js';
import { shortDate, sourceHost, textCardTexture } from './textCard.js';
import { curveOf, rowsOf, shapeOf, stepCurve, stepRows } from './comfort.js';
import { classifyHand } from './handPose.js';
import { FrameStats, PERF_INTERVAL_MS } from './perf.js';
import { introToShow } from './intro.js';
import { KEY, canSubmit, createState as keyboardState, press as keyboardPress, rows as keyboardRows } from './keyboard.js';
import { RESUME_HOURS_STEPS, clear as clearResume, load as loadResume, save as saveResume, snapshot as resumeSnapshot } from './resume.js';
import { COLORS, buttonTexture, panelBg, placeholderTexture, roundedMaskTexture, setBrand, textTexture } from './text.js';
import { resolveView, truncate } from '../view/resolveView';
import { actionFace, actionIds, cardLabelLines, creatorName, descriptionOf, hookLines, isActive, panelLines, placeActions } from '../view/actions';
import { DEFAULT_BRAND } from '../brand/contrast';
import { activeStreams, attachVideo, gifSource, hoverSource, mediaTypeOf, playableVideo } from './video/source.js';
import { createImmersive, isImmersive, isStereo } from './video/immersive.js';
import { embedUrl, openEmbed } from './video/embed.js';

const MAX_TEXTURES = 60;
const MAX_TEXTURES_DENSE = 150; // hard cap when a dense view puts more than 60 cards in range
const TEXTURE_MARGIN = 12;
const MAX_LABELS = 24;
const MAX_PARALLEL_LOADS = 6;
const MAX_TEXT_DRAWS = 4; // text cards drawn per scheduling pass: a screenful of long excerpts must not stall one frame
const RELEASE_COLUMNS = 40; // card meshes further than this from view are freed
const FRAME_BORDER = 0.016; // ≈ 7 px on Quest 2 at 2.5 m — thick enough not to shimmer
const FULL_MAX_PX = 2560; // original images are decoded down to this for the viewer
let FRAME; // set from the brand in the constructor
let ACCENT;
const HIDDEN_HINT_BRIGHT = 4; // seconds the "how to bring it back" hint stays bright before dimming
const MAX_ERROR_REPORTS = 5; // distinct runtime errors reported per page
const HAND_FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const _wrist = new Vector3();
const _joint = new Vector3();
const _handPos = new Vector3();
const _headPos = new Vector3();
const MAGIC_FOV = 56;
const MAGIC_CAMERA_Z = 0;
const VIEWER_DISTANCE = 1.6;
const VIEWER_H_XR = 1.2; // ≈ 41° of vertical view at 1.6 m
const VIEWER_LIFT_XR = 0.1; // picture sits a little above eye level so the similar-pins strip stays in view
const FOCUS_SCALE = 1.15; // picture size in focus mode, relative to normal
const CINEMA_SCALE = 1.9; // cinema mode: a big screen…
const CINEMA_PUSH = 1.0; // …pushed back this far so it still fits the view
// Settings → Environment. Sky colours (top / horizon / below) per preset; 'night' adds stars,
// 'plain' drops the floor grid. One draw call more at most (the stars), so no FPS cost to speak of.
const ENVIRONMENTS = {
    studio: { top: 0x0c0b10, horizon: 0x2a1420, bottom: 0x050506, stars: false, floor: true },
    night: { top: 0x04050b, horizon: 0x141028, bottom: 0x030304, stars: true, floor: true },
    plain: { top: 0x0b0b0e, horizon: 0x0e0e12, bottom: 0x0b0b0e, stars: false, floor: false },
};

/** The presets, with the site's environment (view.theme.environment) first when it has one. */
function environmentsFor(site) {
    if (!site) return ENVIRONMENTS;
    const base = ENVIRONMENTS[site.preset] || ENVIRONMENTS.studio;
    const hex = (v, fallback) => (v ? new Color(v).getHex() : fallback);
    return {
        site: {
            top: hex(site.top, base.top),
            horizon: hex(site.horizon, base.horizon),
            bottom: hex(site.bottom, base.bottom),
            stars: site.stars ?? base.stars,
            floor: base.floor,
            floorColor: site.floor ? new Color(site.floor).getHex() : null,
            panorama: site.panorama || null,
            dim: site.dim,
        },
        ...ENVIRONMENTS,
    };
}
const APPEAR_MS = 200; // ease-in of a new view (B7: ≤ 300 ms)
const APPEAR_FROM = 0.92;
const QUEUE_MAX = 200;
const SLIDE_PHOTO_STEPS = [4, 6, 8, 12, 20, 30]; // seconds per photo / GIF in a slideshow
const SLIDE_VIDEO_STEPS = [0, 15, 30, 60]; // seconds per video (0 = until it ends)
const STRIP_MAX = 6; // similar pins under the picture
const STRIP_H = 0.22;
const RELATED_CACHE = 30;
const PREFETCH_AHEAD = 3; // next pins whose sharp image is decoded before they are opened
const VIEWER_H_PAGE = 0.95;
const VIEWER_MAX_W = 1.6;
const ACTIVE_HAND_STEPS = ['auto', 'right', 'left', 'both'];
const _head = new Vector3();
const _audioPos = new Vector3();
const _audioDir = new Vector3();
const _immPos = new Vector3();
const _immDir = new Vector3();
const IMMERSIVE_PANEL_ASPECT = 2; // the controls row under an empty picture area this wide (1.6 m)
const _restHand = new Vector3();

/** Viewer hint fallbacks (three short lines each) until every locale has the keys. */
const VIEWER_TIPS = {
    page: 'Wheel: zoom, drag: move · ← →: next item, Esc: back · Click the picture: hide UI',
    controller: 'Drag ←→: next item · Drag ↑↓: zoom · Press the picture: hide UI',
    pinch: 'Pinch-drag ←→: next item · Pinch-drag ↑↓: zoom · Pinch the picture: hide UI',
    natural: 'Point and hold: select · Fist + move ←→: next item · Thumb–index apart: zoom',
};

const STILL_LOADING_MS = 8000;

function cycle(steps, value, delta) {
    const i = steps.indexOf(value);
    const next = (i < 0 ? 0 : i) + (delta > 0 ? 1 : -1);
    return steps[Math.min(steps.length - 1, Math.max(0, next))];
}

function loadQueue(key) {
    try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(list) ? list.filter((it) => it && it.id) : [];
    } catch (e) {
        return [];
    }
}

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function isShown(object) {
    for (let o = object; o; o = o.parent) if (!o.visible) return false;
    return true;
}

function disposeTexture(tex) {
    if (!tex) return;
    tex.dispose();
    if (tex.userData && tex.userData.bitmap && tex.userData.bitmap.close) tex.userData.bitmap.close();
}

/**
 * Opens an item's page. A feed or a page chooses `item.link`, so only http(s) (resolved against the
 * page) is followed; javascript:, data: and the like are refused and reported as xr_error.
 */
export function navigateTo(link, track) {
    let url = null;
    try {
        url = new URL(String(link), window.location.href);
    } catch (e) {
        // an unparseable link is refused below
    }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        if (track) track('xr_error', { props: { name: 'BlockedNavigation', message: 'item link is not an http(s) URL: ' + (url ? url.protocol : 'unparseable'), surface: 'gallery' } });
        return false;
    }
    window.location.href = url.href;
    return true;
}

/**
 * Immersive gallery: a curved wall of pins. In a headset: thumbstick or trigger-drag
 * (pinch-drag with hands) scrolls, grip drags, pointing highlights, a trigger press
 * opens the pin in a full-view viewer. The same scene renders in the page ("magic
 * window") with mouse and keyboard, so entering and leaving VR keeps the position and
 * the open pin.
 */
export class Gallery {
    constructor({
        container, feed, adapter, account, brand, strings, profile, storageKeys,
        openItem = (item) => { navigateTo(item.link, track); },
        initialItem = null, track = () => {}, announce = () => {}, onFilterChange = () => {}, onAuthChange = () => {}, onScopeChange = () => {},
        view = null, hooks = {}, hasAccount = true, locale = undefined, video = {},
    }) {
        // Stream library URLs, YouTube/Vimeo overlay on/off, height cap (WallOptions videoLibs / embeds / maxVideoHeight).
        this.videoOptions = { libs: video.libs, embeds: video.embeds !== false, maxHeight: video.maxHeight };
        this.embed = null;
        this.recentVideos = []; // the last few <video> elements made, so state() can prove they were emptied
        setBrand(brand);
        FRAME = new Color(COLORS.surface);
        ACCENT = new Color(COLORS.accent);
        this.container = container;
        this.feed = feed;
        this.strings = strings;
        this.locale = locale;
        this.adapter = adapter;
        this.account = account;
        this.profile = profile;
        this.storageKeys = storageKeys;
        this.openItem = openItem;
        const who = account.state();
        this.authed = who.authed;
        this.track = track;
        this.announce = announce;
        this.onFilterChange = onFilterChange;
        this.onAuthChange = onAuthChange;
        this.onScopeChange = onScopeChange;
        this.userName = who.name || null;
        this.userId = who.userId || null;
        this.hasRelated = !!(adapter.capabilities().scopes || {}).related;
        // The site's view, already merged and clamped (resolveView); the shipped scene without one.
        this.view = view || resolveView(null, null, DEFAULT_BRAND, () => {});
        this.hooks = hooks || {};
        this.brandName = (brand && brand.name) || null;
        // Without an account adapter the wall cannot know who is signed in: actions go straight
        // to the site, which answers "not signed in" itself.
        this.hasAccount = hasAccount;
        this.environments = environmentsFor(this.view.environment);
        this.environmentSteps = Object.keys(this.environments);
        this.remoteFeed = feed;
        // What the wall shows (home, a profile tab, a board, a tag, similar pins) and the
        // trail back to where the user came from.
        this.scope = { kind: 'home' };
        this.scopeStack = [];
        this.relatedCache = new Map();
        this.prefetched = new Map(); // item id -> { promise, tex, dropped } — at most PREFETCH_AHEAD
        this.settings = this.loadSettings();
        if (this.settings.curve != null || this.settings.rows != null) configureLayout(shapeOf(this.settings, this.view));
        this.comfortPose = null;
        this.hiddenAll = false;
        this.slideshow = false;
        this.queue = loadQueue(this.storageKeys.queue);
        this.menu = null;

        this.cards = [];
        this.cardsById = new Map();
        this.scroll = scrollBounds(0).min;
        this.velocity = 0;
        this.dirty = true;
        this.loadsInFlight = 0;
        this.interactive = [];
        this.hovered = new Set();
        this.preview = null;
        this.drag = null;
        this.presses = new Map();
        this.grab = null;
        this.focusIndex = -1;
        this.sessionStartedAt = 0;
        this.passthrough = false;
        this.appearing = []; // groups easing in (appear())
        // "Popular" on the home wall is the web homepage's trending feed (XrFeedService::trendingPage).
        this.filters = { type: 'all', sort: 'popular' };
        this.buttonState = {};
        this.wallZoomTarget = 1;

        if (initialItem) {
            // Entry from an item page wins over a resumed place.
            this.scope = { kind: 'related', id: initialItem, self: true };
            this.resumePinId = initialItem;
        } else {
            this.restorePlace();
        }

        this.textures = new TextureCache(MAX_TEXTURES, disposeTexture);
        this.range = { first: 0, last: -1 };
        /** True for the id of a card in the range being textured now. */
        this.inRange = (id) => {
            const card = this.cardsById.get(id);
            return !!card && card.index >= this.range.first && card.index <= this.range.last;
        };
        this.labelCache = new TextureCache(MAX_LABELS, (label) => label && label.texture.dispose());

        this.initRenderer();
        this.initScene();
        this.initControllers();
        this.initPointer();
        const unlock = () => this.unlockAudio();
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        this.buildChrome();
        this.buildScopeChrome();
        this.updateChromeMode();
        this.clock = new Clock();
        this.renderer.setAnimationLoop(() => this.tick());
        this.reload();
        // A resumed visit may start with non-default filters: show them on both toolbars.
        this.refreshFilterButton();
        this.onFilterChange({ ...this.filters });
        setInterval(() => this.rememberPlace(), 3000);
        addEventListener('pagehide', () => this.rememberPlace());
    }

    // ---------------------------------------------------------------- resume

    storage() {
        try {
            return window.localStorage;
        } catch (e) {
            return null;
        }
    }

    /** Back to the wall, filters, scroll and open pin of the last visit (settings → resume window). */
    restorePlace() {
        const storage = this.storage();
        const place = storage && loadResume(storage, this.settings.resumeHours, this.authed ? this.userId : null, Date.now(), this.storageKeys.resume);
        if (!place) return;
        this.scope = place.scope;
        this.scopeStack = place.stack;
        if (place.filters) this.filters = { ...this.filters, ...place.filters };
        this.pendingScroll = place.scroll;
        this.resumePinId = place.pinId;
    }

    rememberPlace() {
        const storage = this.storage();
        // Not while signing out, and not before a resumed place has been applied (the first
        // page is still loading, so scroll and pin would overwrite it with nothing).
        if (!storage || !this.settings.resumeHours || this.leaving || this.pendingScroll != null || this.resumePinId) return;
        const place = resumeSnapshot({
            scope: this.scope,
            stack: this.scopeStack,
            filters: this.filters,
            scroll: this.scroll,
            pinId: this.preview && this.preview.card ? this.preview.card.item.id : null,
            userId: this.authed ? this.userId : null,
        });
        if (!place) return;
        // Skip identical writes; only the timestamp would change.
        const key = JSON.stringify({ ...place, at: 0 });
        if (key === this.lastPlaceKey && Date.now() - (this.lastPlaceAt || 0) < 60000) return;
        this.lastPlaceKey = key;
        this.lastPlaceAt = Date.now();
        saveResume(storage, place, this.storageKeys.resume);
    }

    get presenting() {
        return this.renderer.xr.isPresenting;
    }

    // ---------------------------------------------------------------- setup

    initRenderer() {
        // 4x MSAA on every device: Quest GPUs are tile-based, so MSAA resolves on-chip and
        // costs little, while without it every card and button edge crawls with the head.
        this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local-floor');
        // Moderate foveation: level 1 visibly pixelates cards off the centre of view.
        this.renderer.xr.setFoveation(0.5);
        this.container.appendChild(this.renderer.domElement);
        // The headset drops the GPU context under memory pressure; the scene goes blank until three.js restores it.
        this.renderer.domElement.addEventListener('webglcontextlost', () => this.track('xr_error', { props: { name: 'context_lost', message: String(this.textures ? this.textures.size : ''), surface: 'gallery' } }));
        this.renderer.domElement.addEventListener('webglcontextrestored', () => this.track('xr_error', { props: { name: 'context_restored', surface: 'gallery' } }));

        this.renderer.xr.addEventListener('sessionstart', () => {
            // An iframe cannot show inside an immersive session.
            this.closeEmbed();
            this.sessionStartedAt = performance.now();
            this.firstPinSent = false;
            this.frameStats = new FrameStats();
            this.perfSentAt = this.sessionStartedAt;
            this.alignPending = true;
            // immersive-ar on Quest blends with the room ('alpha-blend'); immersive-vr is 'opaque'.
            const blend = this.renderer.xr.getEnvironmentBlendMode();
            this.setPassthrough(blend === 'alpha-blend' || blend === 'additive');
            this.track('xr_enter', { props: { surface: 'gallery', mode: this.passthrough ? 'mr' : 'vr' } });
            this.track('xr_backend', { props: { backend: 'three', surface: 'gallery' } });
            this.container.classList.add('is-immersive');
            this.updateChromeMode();
            if (this.preview) {
                // Re-laying out a pin that was already open is not a pin opened in VR.
                this.firstPinSent = true;
                this.rebuildPreview();
                this.firstPinSent = false;
            }
        });
        this.renderer.xr.addEventListener('sessionend', () => {
            const seconds = Math.round((performance.now() - this.sessionStartedAt) / 1000);
            this.sendPerf();
            this.frameStats = null;
            this.track('xr_exit', { value: Math.min(seconds, 86400), props: { by: this.exitBy || 'system', hidden: String(!!this.hiddenAll), surface: 'gallery', mode: this.passthrough ? 'mr' : 'vr' } });
            this.setPassthrough(false);
            this.exitBy = null;
            if (this.hiddenAll) this.toggleHidden('exit');
            this.container.classList.remove('is-immersive');
            this.presses.clear();
            this.grab = null;
            this.setHeightOffset(0);
            this.resetMagicCamera();
            this.onResize();
            this.updateChromeMode();
            if (this.preview) this.rebuildPreview();
        });

        window.addEventListener('resize', () => this.onResize());
    }

    initScene() {
        this.scene = new Scene();
        this.scene.background = new Color(COLORS.bg);
        this.scene.fog = new Fog(0x0b0b0e, 5, 14);

        this.camera = new PerspectiveCamera(MAGIC_FOV, this.container.clientWidth / this.container.clientHeight, 0.05, 60);
        this.resetMagicCamera();
        this.scene.add(this.camera);

        // Dark gradient sky with a faint pink horizon — no HDR maps (GPU budget, spec §2.1).
        const sky = new Mesh(
            new SphereGeometry(30, 32, 16),
            new ShaderMaterial({
                side: BackSide,
                depthWrite: false,
                fog: false,
                uniforms: {
                    top: { value: new Color(0x0c0b10) },
                    horizon: { value: new Color(0x2a1420) },
                    bottom: { value: new Color(0x050506) },
                },
                vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
                fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vPos;'
                    + 'void main(){ float h = normalize(vPos).y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.4)); gl_FragColor = vec4(c, 1.0); }',
            }),
        );
        // Sky, floor grid and floor ring: hidden as one in mixed reality (the room replaces them).
        this.environment = new Group();
        this.scene.add(this.environment);
        this.environment.add(sky);
        this.sky = sky;

        const grid = new GridHelper(24, 48, 0x3a1a2a, 0x18181e);
        grid.material.transparent = true;
        grid.material.opacity = 0.55;
        // Its own group: cinema mode toggles grid.visible, the 'plain' environment the floor.
        this.floor = new Group();
        this.floor.add(grid);
        this.environment.add(this.floor);
        this.grid = grid;

        const ring = new Mesh(new RingGeometry(0.34, 0.38, 48), new MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.5 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.005;
        this.environment.add(ring);
        this.ring = ring;
        this.applyEnvironment();

        // Wall, tabs and hover labels live in one group so "centre in front of me",
        // wall height and distance move them together.
        this.world = new Group();
        this.scene.add(this.world);
        this.wall = new Group();
        this.world.add(this.wall);
        this.chrome = new Group();
        this.world.add(this.chrome);

        this.placeholder = placeholderTexture();
        this.mask = roundedMaskTexture(0.05);
        this.raycaster = new Raycaster();
    }

    /**
     * In the page the camera stands at the cylinder centre (every card equidistant,
     * as in the headset) with a narrower FOV than a phone camera, which keeps the
     * edge cards from stretching. In a headset the XR pose replaces this every frame.
     */
    resetMagicCamera() {
        this.camera.position.set(0, EYE_Y, MAGIC_CAMERA_Z);
        this.camera.fov = MAGIC_FOV;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(0, EYE_Y, -RADIUS);
    }

    initControllers() {
        const factory = new XRControllerModelFactory();
        const handFactory = new XRHandModelFactory();
        const lineGeo = new BufferGeometry();
        lineGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
        const reticleGeo = new CircleGeometry(0.012, 20);

        this.controllers = [0, 1].map((i) => {
            const controller = this.renderer.xr.getController(i);
            const line = new Line(lineGeo, new LineBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.8 }));
            line.scale.z = 3;
            controller.add(line);
            controller.userData.line = line;
            controller.userData.index = i;
            // Trigger (or pinch): a short press selects, press-and-move drags the wall.
            // In the natural hand mode a fist also touches thumb to index, which Quest reports as
            // a pinch: hand select events are ignored there and the pose tracker takes over.
            controller.addEventListener('selectstart', () => { if (!this.naturalHand(controller) && this.handActive(controller)) this.startPress(controller); });
            controller.addEventListener('selectend', () => { if (!this.naturalHand(controller)) this.endPress(controller); });
            controller.addEventListener('squeezestart', () => { if (this.handActive(controller)) this.startGrab(controller); });
            controller.addEventListener('squeezeend', () => this.endGrab(controller));
            controller.addEventListener('connected', (e) => { controller.userData.inputSource = e.data; });
            controller.addEventListener('disconnected', () => {
                controller.userData.inputSource = null;
                this.presses.delete(controller);
                if (this.grab && this.grab.controller === controller) this.grab = null;
            });
            this.scene.add(controller);

            const grip = this.renderer.xr.getControllerGrip(i);
            grip.add(factory.createControllerModel(grip));
            this.scene.add(grip);

            // Tracked hands (no controllers): a light procedural model, nothing downloaded.
            // Pointing + pinch arrive as the same select events as a trigger.
            const hand = this.renderer.xr.getHand(i);
            hand.add(handFactory.createHandModel(hand, 'spheres'));
            this.scene.add(hand);
            controller.userData.hand = hand;

            // Dot where the ray lands, so the user sees exactly what a press will hit.
            const reticle = new Mesh(reticleGeo, new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
            reticle.renderOrder = 50;
            reticle.visible = false;
            this.scene.add(reticle);
            controller.userData.reticle = reticle;
            // Natural mode: a ring around the dot fills while pointing, selecting when full.
            // The ring runs clockwise from the top (negative theta), so its faces point away from
            // the viewer: DoubleSide keeps it visible. The fill is a draw range, not a new geometry.
            const dwellRing = new Mesh(
                new RingGeometry(0.017, 0.024, this.profile.dwellSteps, 1, Math.PI / 2, -Math.PI * 2),
                new MeshBasicMaterial({ color: COLORS.accent, depthTest: false, transparent: true, opacity: 0.95, side: DoubleSide }),
            );
            dwellRing.geometry.setDrawRange(0, 0);
            dwellRing.visible = false;
            dwellRing.renderOrder = 51;
            reticle.add(dwellRing);
            controller.userData.dwellRing = dwellRing;
            return controller;
        });
    }

    initPointer() {
        const el = this.renderer.domElement;
        this.pointer = new Vector2(2, 2);
        el.style.touchAction = 'none';
        el.tabIndex = 0;
        el.setAttribute('aria-label', this.strings.canvas_label);

        el.addEventListener('pointerdown', (e) => {
            this.setPointer(e);
            if (this.startScrub(() => {
                this.raycaster.setFromCamera(this.pointer, this.camera);
                return this.raycaster;
            })) {
                el.setPointerCapture(e.pointerId);
                return;
            }
            this.drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), moved: false, v: 0 };
            this.velocity = 0;
            el.setPointerCapture(e.pointerId);
        });
        el.addEventListener('pointermove', (e) => {
            this.setPointer(e);
            if (!this.drag) return;
            const dx = e.clientX - this.drag.lastX;
            const dy = e.clientY - this.drag.lastY;
            const now = performance.now();
            if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 6) this.drag.moved = true;
            const immersive = this.preview && this.preview.media && this.preview.media.immersive;
            if (this.drag.moved && immersive && !this.presenting) {
                // Grab the picture: dragging right turns the view left.
                immersive.lookBy(this.camera, dx, dy);
            } else if (this.drag.moved && this.preview) {
                this.panBy(dx * 0.0022, -dy * 0.0022);
            } else if (this.drag.moved) {
                this.scrollBy(-dx * this.profile.dragPxToRad);
                const dt = Math.max(1, now - this.drag.lastT) / 1000;
                this.drag.v = (-dx * this.profile.dragPxToRad) / dt;
            }
            this.drag.lastX = e.clientX;
            this.drag.lastY = e.clientY;
            this.drag.lastT = now;
        });
        el.addEventListener('pointerup', (e) => {
            if (this.scrub) {
                this.scrub = null;
                return;
            }
            if (this.drag && !this.drag.moved) {
                this.setPointer(e);
                this.raycaster.setFromCamera(this.pointer, this.camera);
                const hit = this.pickHit(this.raycaster);
                this.activate(hit ? hit.object : null, hit);
            } else if (this.drag && !this.preview) {
                this.velocity = this.drag.v;
            }
            this.drag = null;
        });
        el.addEventListener('pointerleave', () => this.pointer.set(2, 2));
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (this.preview) {
                this.zoomBy(Math.exp(-e.deltaY * 0.0015));
                return;
            }
            if (e.ctrlKey) {
                this.zoomWall(Math.exp(-e.deltaY * 0.004)); // trackpad pinch arrives as ctrl+wheel
                return;
            }
            this.scrollBy((e.deltaY + e.deltaX) * 0.0016);
        }, { passive: false });
        window.addEventListener('keydown', (e) => this.onKey(e));
    }

    /**
     * Keyboard: ←/→ move between columns, ↑/↓ within a column, Enter opens the
     * focused pin; in the viewer ←/→ step, +/− zoom, Enter opens the page, Esc back.
     * Ignored while a DOM control (toolbar button, link) has focus.
     */
    onKey(e) {
        const t = e.target;
        const onPage = t === document.body || t === this.renderer.domElement;
        if ((e.key === 'h' || e.key === 'H') && onPage && !this.presenting) {
            this.toggleHidden();
            e.preventDefault();
            return;
        }
        if (this.hiddenAll) return;
        if (e.key === 'Escape' && (this.preview || this.menu)) {
            if (this.menu) this.closeMenu();
            else if (this.preview.focus) this.setFocusMode(false);
            else this.closePreview();
            e.preventDefault();
            return;
        }
        if (e.key === 'Escape' && this.scopeStack.length && (t === document.body || t === this.renderer.domElement)) {
            this.back();
            e.preventDefault();
            return;
        }
        if (!onPage || this.presenting || this.menu) return;
        const handled = this.preview ? this.viewerKey(e.key) : this.wallKey(e.key);
        if (handled) e.preventDefault();
    }

    wallKey(key) {
        switch (key) {
            case 'ArrowRight': this.moveFocus(ROWS); return true;
            case 'ArrowLeft': this.moveFocus(-ROWS); return true;
            case 'ArrowDown': this.moveFocus(1); return true;
            case 'ArrowUp': this.moveFocus(-1); return true;
            case 'Home': this.setFocus(0); return true;
            case 'Backspace': return this.back();
            case '+':
            case '=': this.zoomWall(1.15); return true;
            case '-': this.zoomWall(1 / 1.15); return true;
            case 'Enter':
            case ' ':
                if (this.cards[this.focusIndex]) this.selectCard(this.cards[this.focusIndex]);
                return true;
            default: return false;
        }
    }

    viewerKey(key) {
        switch (key) {
            case 'ArrowRight': this.stepPreview(1); return true;
            case 'ArrowLeft': this.stepPreview(-1); return true;
            case '+':
            case '=': this.zoomBy(1.25); return true;
            case '-': this.zoomBy(0.8); return true;
            case 'Enter': this.openPin(this.preview.card.item); return true;
            case 'f': this.setFocusMode(!this.preview.focus); return true;
            case ' ':
            case 'k': if (!this.preview.media) return false; this.togglePlay(); return true;
            case 'j': this.seekBy(-10); return true;
            case 'l': this.seekBy(10); return true;
            default: return false;
        }
    }

    moveFocus(delta) {
        if (!this.cards.length) return;
        if (this.focusIndex < 0) {
            this.setFocus(visibleItems(this.scroll, this.cards.length, 0).first);
            return;
        }
        this.setFocus(Math.min(this.cards.length - 1, Math.max(0, this.focusIndex + delta)));
    }

    setFocus(index) {
        const card = this.cards[index];
        if (!card) return;
        this.focusIndex = index;
        // Keep the focused column comfortably inside the arc.
        const angle = itemTransform(index, this.scroll).angle;
        if (Math.abs(angle) > ARC * 0.35) this.scroll = clampScroll(columnOf(index) * COL_ANGLE, this.cards.length);
        this.velocity = 0;
        this.dirty = true;
        this.announce(this.describe(card));
    }

    describe(card) {
        const position = (this.strings.card_position || ':n / :total')
            .replace(':n', String(card.index + 1))
            .replace(':total', String(this.cards.length));
        const extra = card.item.kind === 'collection' || card.item.kind === 'tag' ? (this.strings.pins_count || ':n').replace(':n', String(card.item.count || 0)) : null;
        return [card.item.title, creatorName(card.item.creator) || null, extra, position].filter(Boolean).join(' · ');
    }

    setPointer(e) {
        const r = this.renderer.domElement.getBoundingClientRect();
        this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    }

    onResize() {
        if (this.presenting) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    // --------------------------------------------------------------- chrome

    /** Title, top button row and "Exit VR" (headset only), progress bar and status text. */
    buildChrome() {
        // One compact row just above the wall (~20° up, ~±20° wide): the filter choices
        // live in a panel so the row stays within a comfortable glance.
        const topY = rowY(0) + CELL_H / 2 + 0.1;
        this.chromeTop = new Group();
        this.chromeBottom = new Group();
        this.chrome.add(this.chromeTop, this.chromeBottom);

        const row = [
            this.canScope('discover') && ['discoverButton', buttonTexture('# ' + this.strings.discover, { width: 280, height: 88 }), () => this.navigate({ kind: 'discover' })],
            // The account menu signs in on a phone and lists the user's own pages: only with an account.
            this.hasAccount && ['userButton', buttonTexture(this.userLabel(), { width: 340, height: 88 }), () => this.openMenu()],
            ['filterButton', buttonTexture(this.filterLabel(), { width: 460, height: 88 }), () => this.openFilters()],
            ['exitButton', buttonTexture('✕ ' + this.strings.exit_vr, { width: 420, height: 88 }), () => this.confirmExit()],
            ['settingsButton', buttonTexture('⚙', { width: 110, height: 88 }), () => this.openSettings()],
        ].filter(Boolean);
        const gap = 0.04;
        const total = row.reduce((sum, [, t]) => sum + t.w * 1.05, 0) + gap * (row.length - 1);
        let x = -total / 2;
        row.forEach(([name, tex, fn]) => {
            const w = tex.w * 1.05;
            const mesh = this.flatPanel(tex, x + w / 2, topY, RADIUS - 0.12, 1.05);
            this.slot(mesh, 'top', 0, 0.12);
            mesh.userData = { onSelect: fn, hoverScale: 1.06 };
            this.chromeTop.add(mesh);
            this.interactive.push(mesh);
            this[name] = mesh;
            x += w + gap;
        });

        const barY = rowY(ROWS - 1) - CELL_H / 2 - 0.1;
        this.progressTrack = new Mesh(new PlaneGeometry(1.4, 0.012), new MeshBasicMaterial({ color: 0x2a2a30 }));
        this.progressThumb = new Mesh(new PlaneGeometry(0.18, 0.016), new MeshBasicMaterial({ color: COLORS.accent }));
        this.progressTrack.position.set(0, barY, -(RADIUS - 0.1));
        this.progressThumb.position.set(0, barY, -(RADIUS - 0.1) + 0.001);
        this.chromeBottom.add(this.progressTrack, this.progressThumb);
        this.slot(this.progressTrack, 'bottom', 0, 0.1);
        this.slot(this.progressThumb, 'bottom', 0, 0.1 - 0.001);

        this.status = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
        this.status.position.set(0, EYE_Y, -(RADIUS - 0.2));
        this.slot(this.status, 'eye', 0, 0.2);
        this.chrome.add(this.status);
        this.setStatus(this.strings.loading);
        // A failed feed gets a way out; shown only with the error status.
        this.retryButton = this.flatPanel(buttonTexture('↻ ' + (this.strings.try_again || 'Try again'), { active: true, width: 400, height: 96 }), 0, EYE_Y - 0.17, RADIUS - 0.2);
        this.slot(this.retryButton, 'eye', -0.17, 0.2);
        this.retryButton.userData = { onSelect: () => this.retry(), hoverScale: 1.06 };
        this.retryButton.visible = false;
        this.chrome.add(this.retryButton);
        this.interactive.push(this.retryButton);

        // One title/author label per pointer (two controllers + keyboard focus).
        this.hoverLabels = [0, 1, 2].map(() => {
            const label = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
            label.visible = false;
            label.renderOrder = 10;
            this.world.add(label);
            return label;
        });

        const badge = (text, width) => textTexture(text, { width, height: 72, background: panelBg(0.85), radius: 36, align: 'center', sizes: [34], colors: [COLORS.text], padding: 14 });
        this.badges = { video: badge('▶ VIDEO', 240), gif: badge('GIF', 130) };
        // 360° / 180° / 3D replace "▶ VIDEO" on such cards; drawn once, shared by every card.
        this.badges['360'] = badge('▶ 360°', 200);
        this.badges['180'] = badge('▶ 180°', 200);
        this.badges['360 3D'] = badge('▶ 360° 3D', 260);
        this.badges['180 3D'] = badge('▶ 180° 3D', 260);
        this.badges['3D'] = badge('▶ 3D', 150);
        // The corner mark of the indicator action (like by default); a site's own icon for others.
        const ind = this.view.wall.indicator;
        const indView = ind ? this.view.actions[ind] || {} : {};
        this.heartBadge = textTexture(indView.iconActive || indView.icon || '♥', { width: 72, height: 72, background: COLORS.accent, radius: 36, align: 'center', sizes: [40], colors: [COLORS.text], padding: 0 });
    }

    /** In the page the DOM toolbar handles filters, so the 3D title/tabs/exit are headset-only. */
    updateChromeMode() {
        const xr = this.presenting;
        this.title.visible = xr;
        this.exitButton.visible = xr;
        if (this.userButton) this.userButton.visible = xr;
        if (this.discoverButton) this.discoverButton.visible = xr;
        if (this.settingsButton) this.settingsButton.visible = xr;
        this.filterButton.visible = xr && !this.filterButton.userData.hiddenByScope;
        if (this.backButton) this.backButton.visible = xr && this.scopeStack.length > 0;
        (this.sectionMeshes || []).forEach((m) => { m.visible = xr; });
        this.controllers.forEach((c) => { c.userData.reticle.visible = false; });
    }

    // ---------------------------------------------------------------- scope

    /**
     * Scope navigation in a band under the wall (~20–25° down, easy on a seated neck):
     * "← Back" beside the heading, the profile tabs (Pins · Boards · Repins · Liked) below.
     */
    buildScopeChrome() {
        this.scopeBandY = rowY(ROWS - 1) - CELL_H / 2 - 0.1;
        this.title = this.flatPanel(textTexture([this.strings.title, this.strings.hint], {
            width: 1800, height: 190, sizes: [72, 36], align: 'center', colors: [COLORS.text, COLORS.textSoft],
        }), 0, this.scopeBandY - 0.115, RADIUS - 0.1, 0.75);
        this.chromeBottom.add(this.title);
        this.slot(this.title, 'bottom', -0.115, 0.1);
        this.backButton = this.flatPanel(buttonTexture('← ' + this.strings.nav_back, { width: 300, height: 88 }), -0.88, this.scopeBandY - 0.115, RADIUS - 0.12, 1.05);
        this.slot(this.backButton, 'bottom', -0.115, 0.12);
        this.backButton.userData = { onSelect: () => this.back(), hoverScale: 1.06 };
        this.chromeBottom.add(this.backButton);
        this.interactive.push(this.backButton);
        this.sectionMeshes = [];
        this.applyScopeChrome();
    }

    /** Title, profile tabs and which filter tabs apply, for the current scope (3D and DOM). */
    applyScopeChrome() {
        const s = this.scope;
        const heading = this.scopeHeading(s);
        const old = this.title.material.map;
        const t = textTexture(heading, { width: 1800, height: 190, sizes: [72, 36], align: 'center', colors: [COLORS.text, COLORS.textSoft] });
        this.title.material.map = t.texture;
        this.title.material.needsUpdate = true;
        disposeTexture(old);

        this.sectionMeshes.forEach((m) => {
            this.chromeBottom.remove(m);
            m.geometry.dispose();
            disposeTexture(m.material.map);
            m.material.dispose();
            this.hovered.delete(m);
        });
        this.interactive = this.interactive.filter((m) => !this.sectionMeshes.includes(m));
        const sections = this.sectionsFor(s);
        this.sectionMeshes = sections.map(({ key, label }, i) => {
            const x = (i - (sections.length - 1) / 2) * 0.37;
            // "✓" marks the open tab for people who cannot tell it by colour (WCAG 1.3.1).
            const active = s.section === key;
            const mesh = this.flatPanel(buttonTexture((active ? '✓ ' : '') + label, { active, width: 330, height: 88 }), x, this.scopeBandY - 0.24, RADIUS - 0.12, 1.05);
            this.slot(mesh, 'bottom', -0.24, 0.12);
            mesh.userData = { onSelect: () => this.setSection(key), hoverScale: 1.06 };
            this.chromeBottom.add(mesh);
            this.interactive.push(mesh);
            return mesh;
        });

        // Board and tag lists have no media type or order; similar pins, search results
        // (relevance) and the watch-later queue have no order either.
        const lists = s.section === 'boards' || s.kind === 'discover' || s.kind === 'queue';
        const tabs = { type: !lists, sort: !lists && !['related', 'search'].includes(s.kind) };
        this.filterTabs = tabs;
        this.filterButton.userData.hiddenByScope = !tabs.type && !tabs.sort;
        this.refreshFilterButton();
        this.updateChromeMode();
        this.onScopeChange({
            heading,
            canBack: this.scopeStack.length > 0,
            sections: sections.map((x) => ({ ...x, active: s.section === x.key })),
            tabs,
        });
    }

    scopeHeading(s) {
        const L = this.strings;
        switch (s.kind) {
            case 'user': return ['@' + (s.name || ''), (this.sectionsFor(s).find((x) => x.key === s.section) || {}).label];
            case 'following': return [L.following, s.section === 'boards' ? L.section_boards : L.section_pins];
            case 'board': return ['▦ ' + (s.name || ''), s.owner ? '@' + s.owner : null];
            case 'tag': return ['# ' + s.name, L.tag_heading];
            case 'related': return [L.similar, s.title || null];
            case 'discover': return ['# ' + L.discover, L.discover_sub];
            case 'search': return ['🔍 ' + s.q, L.search_heading];
            case 'queue': return ['⏱ ' + L.queue, (this.strings.pins_count || ':n').replace(':n', String(this.queue.length))];
            default: return [L.title, this.settings.handMode === 'natural' ? L.hint_natural : L.hint];
        }
    }

    sectionsFor(s) {
        const L = this.strings;
        if (s.kind === 'user') {
            return [
                { key: 'pins', label: L.section_pins },
                { key: 'boards', label: L.section_boards },
                { key: 'repins', label: L.section_repins },
                { key: 'likes', label: '♥ ' + L.filter_liked },
            ];
        }
        if (s.kind === 'following') {
            return [{ key: 'pins', label: L.section_pins }, { key: 'boards', label: L.section_boards }];
        }
        if (s.kind === 'queue' && this.queue.length) {
            return [{ key: 'play', label: '▶ ' + L.play_all }];
        }
        return [];
    }

    /** Opens another source on the wall; "Back" returns to the previous one at the same spot. */
    navigate(scope) {
        this.closeMenu(false);
        this.closePreview(false);
        this.scopeStack.push({ ...this.scope, returnScroll: this.scroll });
        if (this.scopeStack.length > 30) this.scopeStack.shift();
        this.scope = scope;
        this.showScope();
    }

    back() {
        if (!this.scopeStack.length) return false;
        const prev = this.scopeStack.pop();
        this.pendingScroll = prev.returnScroll;
        delete prev.returnScroll;
        this.scope = prev;
        this.showScope();
        return true;
    }

    setSection(key) {
        if (key === 'play') {
            this.playAll();
            return;
        }
        if (this.scope.section === key) return;
        this.scope = { ...this.scope, section: key };
        this.showScope();
    }

    goHome() {
        this.scopeStack = [];
        this.scope = { kind: 'home' };
        this.showScope();
    }

    /** A profile tab of `user` ({ id, name }); the signed-in user's own profile by default. */
    openProfile(section = 'pins', user = { id: this.userId, name: this.userName }) {
        if (!user.id) {
            this.openMenu();
            return;
        }
        this.navigate({ kind: 'user', id: user.id, name: user.name, section });
    }

    showScope() {
        // A sign-in that completes after the wall changed must not reopen the old pin.
        this.pendingSignIn = null;
        this.closeMenu(false);
        this.closePreview(false);
        this.setWallVisible(true);
        this.applyScopeChrome();
        this.reload();
        this.appear(this.wall);
        this.announce(this.scopeHeading(this.scope).filter(Boolean).join(' · '));
    }

    userLabel() {
        return this.authed ? '👤 @' + String(this.userName || '').slice(0, 14) : '👤 ' + this.strings.login;
    }

    refreshUserButton() {
        if (!this.userButton) return;
        const t = buttonTexture(this.userLabel(), { width: 340, height: 88 });
        this.userButton.material.map.dispose();
        this.userButton.material.map = t.texture;
        this.userButton.material.needsUpdate = true;
    }

    /** Plane facing the origin at world (x, y, -z). */
    flatPanel({ texture, w, h }, x, y, z, scale = 1) {
        const mesh = new Mesh(new PlaneGeometry(w * scale, h * scale), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
        mesh.position.set(x, y, -z);
        // Face the wall's axis (local, so it stays right after the world group turns).
        mesh.rotation.y = Math.atan2(-x, z);
        return mesh;
    }

    /** Remembers where a chrome mesh sits relative to the wall's top/bottom edge or eye height, for placeChrome(). */
    slot(mesh, anchor, dy, dz) {
        (this.chromeSlots = this.chromeSlots || []).push({ mesh, anchor, dy, dz });
    }

    /** Moves the chrome to the wall's current rows and radius (after the curve or rows changed). */
    placeChrome() {
        this.chromeSlots = this.chromeSlots.filter((s) => s.mesh.parent);
        const base = {
            top: rowY(0) + CELL_H / 2 + 0.1,
            bottom: rowY(ROWS - 1) - CELL_H / 2 - 0.1,
            eye: EYE_Y,
        };
        this.chromeSlots.forEach(({ mesh, anchor, dy, dz }) => {
            const z = RADIUS - dz;
            mesh.position.set(mesh.position.x, base[anchor] + dy, -z);
            mesh.rotation.y = Math.atan2(-mesh.position.x, z);
        });
        this.scopeBandY = base.bottom;
        this.chromeTop.position.y = 0;
        this.chromeBottom.position.y = 0;
    }

    /** Re-runs the layout with the user's curve and rows; the feed and the cards stay as they are. */
    applyShape() {
        const centre = this.scroll / COL_ANGLE;
        this.wallZoomTarget = 1;
        configureLayout(shapeOf(this.settings, this.view));
        this.placeChrome();
        this.scroll = clampScroll(centre * COL_ANGLE, this.cards.length);
        this.velocity = 0;
        this.dirty = true;
    }

    setStatus(text) {
        const mat = this.status.material;
        if (mat.map) mat.map.dispose();
        if (!text) {
            this.status.visible = false;
            mat.map = null;
            return;
        }
        const t = textTexture(text, { width: 1200, height: 120, align: 'center', sizes: [40], colors: [COLORS.textSoft] });
        mat.map = t.texture;
        mat.needsUpdate = true;
        this.status.scale.set(t.w, t.h, 1);
        this.status.visible = true;
    }

    setFilter(key, value) {
        if (this.filters[key] === value) return;
        this.filters[key] = value;
        this.refreshFilterButton();
        this.onFilterChange({ ...this.filters });
        this.reload();
    }

    filterChoices() {
        const L = this.strings;
        return {
            type: [['all', L.filter_all], ['photo', L.filter_photo], ['video', L.filter_video], ['gif', L.filter_gif]],
            sort: [['latest', L.sort_latest], ['popular', L.sort_popular]],
        };
    }

    /** "⚲ All · Newest": the current choice, without the order where the scope has none. */
    filterLabel() {
        const choices = this.filterChoices();
        const tabs = this.filterTabs || { type: true, sort: true };
        const current = (key) => (choices[key].find(([v]) => v === this.filters[key]) || [])[1];
        return '⚲ ' + [tabs.type && current('type'), tabs.sort && current('sort')].filter(Boolean).join(' · ');
    }

    refreshFilterButton() {
        const t = buttonTexture(this.filterLabel(), { width: 460, height: 88 });
        disposeTexture(this.filterButton.material.map);
        this.filterButton.material.map = t.texture;
        this.filterButton.material.needsUpdate = true;
    }

    /** Media type and order in a small panel; picking one applies it and closes the panel. */
    openFilters() {
        const tabs = this.filterTabs || { type: true, sort: true };
        const ui = this.startPanel('filters', 1.5, tabs.sort ? 0.66 : 0.54);
        const { panel, button } = ui;
        const L = this.strings;
        const choices = this.filterChoices();
        const top = tabs.sort ? 0.22 : 0.16;
        panel(textTexture('⚲ ' + (L.filters_label || 'Filters'), { width: 1100, height: 90, sizes: [50], align: 'center' }), 0, top);
        const choiceRow = (key, y) => {
            const list = choices[key];
            list.forEach(([value, label], i) => {
                // "✓" marks the current choice for people who cannot tell it by colour (WCAG 1.3.1).
                const active = this.filters[key] === value;
                button((active ? '✓ ' : '') + label, () => {
                    this.closeMenu();
                    this.setFilter(key, value);
                }, (i - (list.length - 1) / 2) * 0.33, y, active, 380);
            });
        };
        if (tabs.type) choiceRow('type', top - 0.16);
        if (tabs.sort) choiceRow('sort', top - 0.28);
        button(L.close, () => this.closeMenu(), 0, tabs.sort ? -0.21 : -0.15);
        this.showPanel(ui);
    }

    exitVr() {
        const session = this.renderer.xr.getSession();
        this.exitBy = 'app';
        if (session) session.end();
    }

    /** A stray pointer (natural hands select after 0.8 s) must not end the session: tap twice within 3 s. */
    confirmExit() {
        if (this.exitConfirmUntil) {
            this.setExitButton(false);
            this.exitVr();
            return;
        }
        this.setExitButton(true);
    }

    setExitButton(confirming) {
        this.exitConfirmUntil = confirming ? performance.now() + 3000 : 0;
        const label = confirming ? (this.strings.tap_to_confirm || 'Tap again to confirm') : '✕ ' + this.strings.exit_vr;
        const t = buttonTexture(label, { active: confirming, width: 420, height: 88 });
        disposeTexture(this.exitButton.material.map);
        this.exitButton.material.map = t.texture;
        this.exitButton.material.needsUpdate = true;
    }

    // ----------------------------------------------------------------- data

    reload() {
        this.stopHoverPlay();
        this.closePreview();
        this.cards.forEach((c) => this.releaseMeshes(c));
        this.cards = [];
        this.cardsById.clear();
        this.textures.clear();
        this.labelCache.clear();
        this.hovered.clear();
        this.focusIndex = -1;
        this.scroll = scrollBounds(0).min;
        this.velocity = 0;
        if (this.scope.kind === 'queue') {
            this.feed = new LocalFeed(this.queue.map((it) => ({ ...it })));
        } else {
            this.feed = this.remoteFeed;
            this.feed.reset({ scope: this.scope, filter: { ...this.filters } });
        }
        this.setStatus(this.strings.loading);
        this.retryButton.visible = false;
        this.armStillLoading();
        this.loadMore();
    }

    /**
     * Status text and the Try again button after a page: a stopped pager says so (and offers a resume) even
     * when cards are on the wall; a failed first page shows the error; otherwise only an empty wall has text.
     */
    showFeedState(feed, failed = false) {
        const stopped = !!feed.stopped;
        const L = this.strings;
        if (stopped) this.setStatus(this.cards.length ? L.load_stopped : failed ? L.error : this.emptyLabel());
        else this.setStatus(this.cards.length ? null : failed ? L.error : this.emptyLabel());
        this.retryButton.visible = stopped || (failed && !this.cards.length);
    }

    /** Try again: continues a stopped pager when cards are already on the wall, else loads from scratch. */
    retry() {
        if (this.cards.length && this.feed.stopped && typeof this.feed.resume === 'function') {
            this.feed.resume();
            this.setStatus(null);
            this.retryButton.visible = false;
            this.loadMore();
        } else {
            this.reload();
        }
    }

    /** An empty wall 8 s after start says the site is slow; the first card clears it. */
    armStillLoading() {
        clearTimeout(this.stillLoadingTimer);
        this.stillLoading = false;
        this.stillLoadingTimer = setTimeout(() => {
            if (this.cards.length || this.retryButton.visible || this.feed.done) return;
            this.stillLoading = true;
            this.setStatus(this.strings.still_loading);
        }, STILL_LOADING_MS);
    }

    clearStillLoading() {
        clearTimeout(this.stillLoadingTimer);
        this.stillLoading = false;
    }

    /** What an empty source says depends on where the user is (and how to fill it). */
    emptyLabel(s = this.scope) {
        const L = this.strings;
        if (s.section === 'boards') return L.empty_boards || 'No collections yet';
        if (s.kind === 'user' && s.section === 'likes') return L.empty_likes || 'Like an item with ♡ and it appears here';
        if (s.kind === 'following') return L.empty_following || 'Follow a collection to see its items here';
        if (s.kind === 'queue') return (L.empty_queue || 'Add items with :button').replace(':button', '＋ ' + L.watch_later);
        if (s.kind === 'search') return (L.empty_search || 'Nothing found for “:q”').replace(':q', s.q || '');
        return L.empty;
    }

    loadMore() {
        if (this.feed.done || this.feed.loading || !this.feed.canFetch()) return;
        const feed = this.feed;
        feed.next().then((items) => {
            items.forEach((item) => this.addCard(item));
            if (feed.stopped) {
                this.track('xr_error', { props: { name: 'feed', message: 'paging stopped: ' + feed.stopped, surface: 'gallery' } });
            }
            if (this.pendingScroll != null) {
                // Back: return to where the user was, as far as the first page reaches.
                this.scroll = clampScroll(this.pendingScroll, this.cards.length);
                this.pendingScroll = null;
            }
            if (this.resumePinId) {
                // Resumed visit: reopen the pin if it is on the first page again.
                const card = this.cardsById.get(this.resumePinId);
                this.resumePinId = null;
                // Photos only: a video opened outside VR would start muted and stay muted.
                if (card && card.item.media_type === 'photo') this.openPreview(card);
            }
            if (this.cards.length) this.clearStillLoading();
            this.showFeedState(feed);
            this.dirty = true;
            if (!items.length && !feed.done && feed === this.feed) {
                // Nothing new: ask again once the back-off has passed (the frame loop sleeps while nothing changes).
                setTimeout(() => { this.dirty = true; }, Math.max(0, feed.notBefore - Date.now()) + 10);
            }
        }).catch((e) => {
            if (feed === this.feed) {
                if (feed.stopped) this.track('xr_error', { props: { name: 'feed', message: 'paging stopped: ' + feed.stopped, surface: 'gallery' } });
                else if (feed.notBefore) setTimeout(() => { this.dirty = true; }, Math.max(0, feed.notBefore - Date.now()) + 10);
            }
            if (feed === this.feed) this.showFeedState(feed, true);
            this.track('xr_error', { props: { name: 'feed', message: String(e && e.message).slice(0, 180), surface: 'gallery' } });
        });
    }

    /** Cards are data until they come near the view; meshes are built and freed on demand. */
    addCard(item) {
        if (item.state && item.state.liked) item._liked = true;
        const { w, h } = fitCard(item.aspect);
        const card = { item, index: this.cards.length, w, h, state: 'none', retried: false, group: null, image: null, frame: null };
        this.cards.push(card);
        this.cardsById.set(item.id, card);
    }

    ensureMeshes(card) {
        if (card.group) return;
        const { w, h, item } = card;
        const group = new Group();
        const frame = new Mesh(new PlaneGeometry(w + FRAME_BORDER * 2, h + FRAME_BORDER * 2), new MeshBasicMaterial({ color: FRAME.clone(), alphaMap: this.mask, alphaToCoverage: true }));
        const cached = this.textures.get(item.id);
        const isText = !item.image;
        // A text card that is not cached is drawn by scheduleTextures, a few per pass.
        const map = cached || this.placeholder;
        const image = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map, alphaMap: this.mask, alphaToCoverage: true }));
        image.position.z = 0.002;
        image.userData = { card, onSelect: () => this.selectCard(card), hoverScale: 1.07 };
        group.add(frame, image);
        card.state = card.state === 'error' ? 'error' : cached ? 'ready' : 'none';

        if (item.kind === 'tag') {
            card.badgeTex = textTexture(item.title, { width: Math.max(200, Math.round(card.w * 900)), height: 72, background: panelBg(0.85), radius: 36, align: 'center', sizes: [34], colors: [COLORS.text], padding: 16 });
        } else if (item.kind === 'collection') {
            card.badgeTex = textTexture('▦ ' + (item.count || 0), { width: 200, height: 72, background: panelBg(0.85), radius: 36, align: 'center', sizes: [34], colors: [COLORS.text], padding: 14 });
        }
        else if (!isText && !this.mediaBadge(item) && this.view.wall.badges && Array.isArray(item.badges) && typeof item.badges[0] === 'string' && item.badges[0]) {
            const text = truncate(item.badges[0], 16);
            card.badgeTex = textTexture(text, { width: Math.min(Math.round(card.w * 900), Math.max(130, 40 + text.length * 22)), height: 72, background: panelBg(0.85), radius: 36, align: 'center', sizes: [34], colors: [COLORS.text], padding: 14 });
        }
        // A text card draws its first badge itself, as the kicker on its band.
        const badge = isText ? null : card.badgeTex || this.mediaBadge(item);
        if (badge) {
            const b = new Mesh(new PlaneGeometry(badge.w, badge.h), new MeshBasicMaterial({ map: badge.texture, transparent: true, depthWrite: false }));
            b.position.set(-w / 2 + badge.w / 2 + 0.014, h / 2 - badge.h / 2 - 0.014, 0.004);
            group.add(b);
        }
        // A video's length, bottom right (its own texture: lengths differ per card).
        if (!isText && mediaTypeOf(item) === 'video' && Number.isFinite(item.duration) && item.duration > 0) {
            card.durationTex = textTexture(formatTime(item.duration), { width: 150, height: 64, background: panelBg(0.85), radius: 32, align: 'center', sizes: [32], colors: [COLORS.text], padding: 10 });
            const t = card.durationTex;
            const d = new Mesh(new PlaneGeometry(t.w, t.h), new MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false }));
            d.position.set(w / 2 - t.w / 2 - 0.014, -h / 2 + t.h / 2 + 0.014, 0.004);
            group.add(d);
        }
        card.group = group;
        card.frame = frame;
        card.image = image;
        if (this.indicatorOn(item)) this.setHeart(card, true);
    }

    /** The shared corner badge of a card's media: GIF, ▶ VIDEO, or ▶ 360° / 180° / 3D. */
    mediaBadge(item) {
        const type = mediaTypeOf(item);
        if (type !== 'video') return this.badges[type] || null;
        const angle = item.projection === 'equirect360' ? '360' : item.projection === 'equirect180' ? '180' : '';
        const key = [angle, isStereo(item.stereo) ? '3D' : ''].filter(Boolean).join(' ');
        return this.badges[key] || this.badges.video;
    }

    releaseMeshes(card) {
        if (!card.group) return;
        if (this.hoverPlay && this.hoverPlay.card === card) this.stopHoverPlay();
        if (card.group.parent) card.group.parent.remove(card.group);
        card.group.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        this.hovered.delete(card.image);
        // The text card's texture lives in the same LRU as image textures; far cards give it back.
        if (card.errorTex) this.textures.delete(card.item.id);
        card.errorTex = null;
        if (card.badgeTex) disposeTexture(card.badgeTex.texture);
        card.badgeTex = null;
        if (card.durationTex) disposeTexture(card.durationTex.texture);
        card.durationTex = null;
        card.group = card.image = card.frame = card.heart = null;
        if (card.state === 'ready' || card.state === 'loading') card.state = 'none';
    }

    setHeart(card, on) {
        if (!card.group) return;
        if (on && !card.heart) {
            const { w, h } = card;
            const t = this.heartBadge;
            card.heart = new Mesh(new PlaneGeometry(t.w * 0.8, t.h * 0.8), new MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false }));
            card.heart.position.set(w / 2 - t.w * 0.4 - 0.014, h / 2 - t.h * 0.4 - 0.014, 0.004);
            card.group.add(card.heart);
        } else if (!on && card.heart) {
            card.group.remove(card.heart);
            card.heart.geometry.dispose();
            card.heart.material.dispose();
            card.heart = null;
        }
    }

    /** A pin opens in the viewer; a board opens its pins on the wall. */
    selectCard(card) {
        const { item } = card;
        if (item.kind === 'collection') {
            this.navigate({ kind: 'board', id: item.id, name: item.title, owner: item.creator && item.creator.label });
            return;
        }
        if (item.kind === 'tag') {
            this.navigate({ kind: 'tag', name: item.tag });
            return;
        }
        this.openPreview(card);
    }

    /** The text card of an item: what a card without an image is, and what one whose image failed shows instead of staying blank. */
    errorTexture(card) {
        let tex = this.textures.get(card.item.id);
        if (!tex) {
            tex = textCardTexture(card.item, { aspect: card.w / card.h, width: 512, locale: this.locale });
            this.onEvicted(this.textures.set(card.item.id, tex, this.inRange));
        }
        card.errorTex = tex;
        return tex;
    }

    /** Cards whose texture the LRU just dropped go back to the placeholder; a scheduling pass loads or draws them again. */
    onEvicted(keys) {
        for (const key of keys) {
            const evicted = this.cardsById.get(key);
            if (!evicted) continue;
            evicted.errorTex = null;
            if (evicted.image) {
                evicted.image.material.map = this.placeholder;
                evicted.image.material.needsUpdate = true;
            }
            if (evicted.state === 'ready') evicted.state = 'none';
        }
    }

    // ------------------------------------------------------------- textures

    /**
     * Texture URL with a query marker. Headsets that browsed the 2D site before the
     * CDN sent CORS headers hold those images in their HTTP cache (immutable, 1 year)
     * without Access-Control-Allow-Origin; a crossOrigin load would reuse that entry
     * and fail. A distinct URL misses it. A retry adds a unique value.
     */
    textureUrl(url, attempt = 0) {
        try {
            const u = new URL(url, location.href);
            u.searchParams.set('xr', attempt ? String(Date.now()) : '1');
            return u.toString();
        } catch (e) {
            return url;
        }
    }

    async loadTexture(url, resizeWidth = 512, attempt = 0) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.src = this.textureUrl(url, attempt);
        await img.decode();
        let texture;
        if (typeof createImageBitmap === 'function') {
            // Decode + downscale off the main thread; ImageBitmaps ignore texture.flipY.
            const width = Math.min(resizeWidth, img.naturalWidth || resizeWidth);
            const bitmap = await createImageBitmap(img, { imageOrientation: 'flipY', resizeWidth: width, resizeQuality: 'medium' });
            texture = new Texture(bitmap);
            texture.flipY = false;
            texture.userData.bitmap = bitmap;
        } else {
            texture = new Texture(img);
        }
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        return texture;
    }

    scheduleTextures(range) {
        if (range.last < range.first) return;
        // The budget is 60 textures, or the number of cards in range plus a margin when a dense view
        // shows more (up to 150). Cards in range are never evicted, so the wall settles: nothing in
        // view is dropped to make room for another card in view.
        const inRange = range.last - range.first + 1;
        this.textures.max = Math.min(MAX_TEXTURES_DENSE, Math.max(MAX_TEXTURES, inRange + TEXTURE_MARGIN));
        this.range = range;
        // Load from the centre of view outwards, so what the user looks at fills in first.
        const centre = this.scroll / COL_ANGLE;
        const order = [];
        for (let i = range.first; i <= range.last; i++) order.push(i);
        order.sort((a, b) => Math.abs(columnOf(a) - centre) - Math.abs(columnOf(b) - centre));
        let textDraws = 0;
        for (const i of order) {
            if (this.loadsInFlight >= MAX_PARALLEL_LOADS) break;
            const card = this.cards[i];
            if (!card || !card.group) continue;
            const cached = this.textures.get(card.item.id);
            if (card.state === 'error') {
                // Failed image: its text card was dropped from the LRU, draw it again.
                if (!cached && textDraws < MAX_TEXT_DRAWS) {
                    textDraws++;
                    this.markError(card);
                }
                continue;
            }
            if (card.state !== 'none') continue;
            if (cached) {
                this.applyTexture(card, cached);
                continue;
            }
            if (!card.item.image) {
                // A text card is drawn here, with no request.
                if (textDraws >= MAX_TEXT_DRAWS) continue;
                textDraws++;
                this.applyTexture(card, this.errorTexture(card));
                continue;
            }
            card.state = 'loading';
            this.loadsInFlight++;
            this.loadTexture(card.item.image, 512, card.retried ? 1 : 0)
                .then((tex) => {
                    if (this.cardsById.get(card.item.id) !== card) {
                        disposeTexture(tex);
                        return;
                    }
                    this.onEvicted(this.textures.set(card.item.id, tex, this.inRange));
                    this.applyTexture(card, tex);
                })
                .catch(() => {
                    // One retry with a fresh URL, then show the title instead.
                    if (card.retried) {
                        this.markError(card);
                    } else {
                        card.retried = true;
                        card.state = 'none';
                    }
                })
                .finally(() => { this.loadsInFlight--; });
        }
    }

    applyTexture(card, tex) {
        card.state = 'ready';
        if (!card.image) return;
        card.image.material.map = tex;
        card.image.material.needsUpdate = true;
    }

    markError(card) {
        card.state = 'error';
        if (!card.image) return;
        card.image.material.map = this.errorTexture(card);
        card.image.material.needsUpdate = true;
    }

    // ---------------------------------------------------------- interaction

    scrollBy(delta) {
        this.scroll = clampScroll(this.scroll + delta, this.cards.length);
        this.dirty = true;
    }

    targets() {
        if (this.hiddenAll) return [];
        if (this.menu) return this.menu.targets;
        if (this.preview) return this.preview.targets.filter(isShown);
        return this.interactive.filter(isShown).concat(this.visibleImages || []);
    }

    pick(raycaster) {
        const hit = this.pickHit(raycaster);
        return hit ? hit.object : null;
    }

    pickHit(raycaster) {
        return raycaster.intersectObjects(this.targets(), false)[0] || null;
    }

    activate(object, hit = null) {
        if (this.hiddenAll) return;
        if (object && object.userData.onSelect) {
            this.flash(object);
            this.click();
            object.userData.onSelect(hit);
        } else if (this.menu && !object) {
            this.closeMenu();
        } else if (this.preview && !object && this.preview.media && this.preview.media.immersive) {
            // Inside a 360°/180° video everything is "empty space": a press brings the controls back (or hides them).
            this.toggleImmersivePanel();
        } else if (this.preview && !object) {
            this.closePreview();
        }
    }

    selectFrom(controller) {
        this.raycaster.setFromXRController(controller);
        const hit = this.pickHit(this.raycaster);
        if (hit) this.pulse(controller, 0.5, 30);
        this.activate(hit ? hit.object : null, hit);
    }

    /**
     * Press confirmation that hands get too (they have no haptics): the selected mesh
     * brightens briefly. A colour tint, not a scale pop, because card groups and the
     * viewer picture have their scale driven every frame by other code.
     */
    flash(object) {
        const mat = object.material;
        if (!mat || !mat.color) return;
        const ud = mat.userData;
        if (!ud.flashBase) ud.flashBase = mat.color.clone();
        mat.color.copy(ud.flashBase).multiplyScalar(1.7);
        clearTimeout(ud.flashTimer);
        ud.flashTimer = setTimeout(() => {
            mat.color.copy(ud.flashBase);
            ud.flashBase = null;
        }, 150);
    }

    /** Browsers start audio only from a user gesture; the Enter VR click is the first one. */
    unlockAudio() {
        // Without UI sounds, still resume a context a spatialized video already uses.
        if (!this.settings.sounds && !this.audio) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        try {
            if (!this.audio && Ctx) this.audio = new Ctx();
            if (this.audio && this.audio.state === 'suspended') this.audio.resume().catch(() => {});
        } catch (e) {
            // no audio: the visual flash still confirms the press
        }
    }

    /** Soft synthesized tick on select (no audio files). */
    click() {
        if (!this.settings.sounds) return;
        this.unlockAudio();
        const ctx = this.audio;
        if (!ctx || ctx.state !== 'running') return;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1400, t);
        osc.frequency.exponentialRampToValueAtTime(700, t + 0.04);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.06);
    }

    /** Short haptic tick on the controller (hover = light, select = firmer). */
    pulse(controller, intensity, ms) {
        const source = controller && controller.userData.inputSource;
        const actuator = source && source.gamepad && source.gamepad.hapticActuators && source.gamepad.hapticActuators[0];
        try {
            if (actuator && actuator.pulse) actuator.pulse(intensity, ms);
        } catch (e) {
            // haptics are best-effort
        }
    }

    controllerYaw(controller) {
        const dir = new Vector3(0, 0, -1).applyQuaternion(controller.quaternion);
        return Math.atan2(dir.x, -dir.z);
    }

    controllerPitch(controller) {
        const dir = new Vector3(0, 0, -1).applyQuaternion(controller.quaternion);
        return Math.asin(Math.max(-1, Math.min(1, dir.y)));
    }

    dragState(controller, moved) {
        return {
            controller, yaw: this.controllerYaw(controller), pitch: this.controllerPitch(controller),
            travel: 0, accYaw: 0, accPitch: 0, axis: null, swipe: 0, swiped: false, moved, v: 0,
            hand: this.isHand(controller), t0: performance.now() / 1000, startTarget: null, holdFired: false,
            depth0: this.handDepth(controller),
        };
    }

    /** Horizontal distance from the head to the controller / hand (metres). */
    handDepth(controller) {
        const head = (this.presenting ? this.renderer.xr.getCamera() : this.camera).getWorldPosition(_headPos);
        const hand = controller.getWorldPosition(_handPos);
        return Math.hypot(hand.x - head.x, hand.z - head.z);
    }

    isHand(controller) {
        const source = controller && controller.userData.inputSource;
        return !!(source && source.hand);
    }

    handActive(controller) {
        return controller.userData.active !== false;
    }

    /**
     * Which hand drives the UI (setting `activeHand`). 'left'/'right' fix it; 'auto' turns off a
     * hand resting low while the other one is raised, so whatever it does down there (a stray
     * pinch, a fist, a pointing finger) never reaches the wall. With both low, both still work.
     * A fixed side that is not connected falls back to both, so the user is never locked out.
     */
    updateActiveHands() {
        if (!this.presenting) return;
        const mode = this.settings.activeHand;
        const connected = this.controllers.filter((c) => c.userData.inputSource);
        this.renderer.xr.getCamera().getWorldPosition(_head);
        for (const c of this.controllers) {
            const ud = c.userData;
            ud.lowered = false;
            if (mode === 'auto' && ud.inputSource) {
                c.getWorldPosition(_restHand);
                const drop = _head.y - _restHand.y;
                ud.restLow = ud.restLow ? drop > this.profile.handWakeDrop : drop > this.profile.handRestDrop;
                ud.lowered = ud.restLow;
            }
        }
        const sideConnected = connected.some((c) => c.userData.inputSource.handedness === mode);
        const anyRaised = connected.some((c) => !c.userData.lowered);
        for (const c of this.controllers) {
            const ud = c.userData;
            const side = ud.inputSource && ud.inputSource.handedness;
            let active = true;
            if ((mode === 'left' || mode === 'right') && sideConnected) active = side === mode;
            else if (mode === 'auto') active = !(ud.lowered && anyRaised);
            if (!active && ud.active !== false) this.deactivateHand(c);
            ud.active = active;
            ud.line.visible = active;
        }
    }

    /** Ends what the hand was doing without selecting anything: no end event will come for it. */
    deactivateHand(controller) {
        this.presses.delete(controller);
        if (this.grab && this.grab.controller === controller) this.grab = null;
        if (this.scrub && this.scrub.controller === controller) this.scrub = null;
        const st = controller.userData.natural;
        if (st) {
            st.fist = false;
            this.resetDwell(controller, st);
        }
        controller.userData.reticle.visible = false;
    }

    startPress(controller) {
        if (this.startScrub(() => {
            this.raycaster.setFromXRController(controller);
            return this.raycaster;
        }, controller)) {
            this.pulse(controller, 0.5, 30);
            return;
        }
        const state = this.dragState(controller, false);
        this.raycaster.setFromXRController(controller);
        state.startTarget = this.pick(this.raycaster);
        this.presses.set(controller, state);
        this.velocity = 0;
    }

    endPress(controller) {
        if (this.scrub && this.scrub.controller === controller) {
            this.scrub = null;
            return;
        }
        const press = this.presses.get(controller);
        this.presses.delete(controller);
        if (!press || press.holdFired) return;
        if (!press.moved && !press.fist) this.selectFrom(controller);
        else if (!this.preview) this.velocity = press.v;
    }

    startGrab(controller) {
        this.grab = this.dragState(controller, true);
        this.grab.grip = true;
        this.velocity = 0;
    }

    endGrab(controller) {
        if (!this.grab || this.grab.controller !== controller) return;
        if (!this.preview) this.velocity = this.grab.v;
        this.grab = null;
    }

    /**
     * Shared by grip-drag and trigger/pinch-drag: sweeping the controller scrolls the
     * wall, or pans a zoomed picture in the viewer. A trigger press only turns into a
     * drag after profile.pressDragThreshold of travel, so a steady press still selects.
     */
    dragTick(state, dt) {
        if (this.menu) return;
        const yaw = this.controllerYaw(state.controller);
        const pitch = this.controllerPitch(state.controller);
        const dYaw = yaw - state.yaw;
        const dPitch = pitch - state.pitch;
        state.yaw = yaw;
        state.pitch = pitch;
        // Nothing moves while hidden (a sideways drag would open the next pin and start its
        // video unseen), nor after this press toggled quick hide. Not counting travel here
        // also keeps a shaky hold able to bring everything back.
        if (this.hiddenAll || state.holdFired) return;
        const pull = state.depth0 - this.handDepth(state.controller); // > 0 = hand came closer
        if (!state.moved) {
            state.travel += Math.abs(dYaw) + Math.abs(dPitch);
            state.accYaw += dYaw;
            state.accPitch += dPitch;
            // A push/pull wins when the hand travelled further in depth than sideways (the
            // angular travel is scaled to metres at arm's length).
            if (Math.abs(pull) >= this.profile.pullThreshold && Math.abs(pull) > state.travel * 0.5 && !state.grip) {
                state.moved = true;
                state.axis = 'z';
                state.pull0 = pull;
                state.zoom0 = this.preview ? this.preview.targetZoom : this.wallZoomTarget;
            } else {
                if (state.travel < (state.hand ? this.profile.pressDragThresholdHand : this.profile.pressDragThreshold)) return;
                state.moved = true;
                // The first direction decides what the drag does, so one hand does everything:
                // sideways = scroll / next pin, up-down or towards/away from you = zoom.
                state.axis = Math.abs(state.accPitch) > Math.abs(state.accYaw) ? 'y' : 'x';
            }
        }
        if (state.axis === 'z') {
            const zoom = state.zoom0 * Math.exp((pull - state.pull0) * this.profile.pullZoomGain);
            if (this.preview) this.preview.targetZoom = Math.min(this.profile.zoomMax, Math.max(this.profile.zoomMin, zoom));
            else this.wallZoomTarget = Math.min(2.2, Math.max(0.7, zoom));
            return;
        }
        if (this.preview) {
            // Decided once per drag: a drag that starts on a zoomed picture (or a grip drag)
            // pans it, so a zoom gesture does not turn into panning halfway through. A drag
            // started off the picture still zooms/steps, so hands can zoom back out.
            if (state.pan === undefined) {
                state.pan = this.preview.targetZoom > 1.05 && (state.grip || state.startTarget === this.preview.image);
            }
            if (state.pan) {
                this.panBy(dYaw * VIEWER_DISTANCE * 1.5, dPitch * VIEWER_DISTANCE * 1.5);
            } else if (state.axis === 'y') {
                this.zoomBy(Math.exp(dPitch * 3));
            } else {
                // A sweep to the left shows the next pin (like a phone), to the right the previous.
                state.swipe += dYaw;
                if (!state.swiped && Math.abs(state.swipe) > this.profile.swipeRad) {
                    state.swiped = true;
                    this.stepPreview(state.swipe < 0 ? 1 : -1);
                }
            }
            return;
        }
        if (state.axis === 'y') {
            this.zoomWall(Math.exp(dPitch * 2.5));
            return;
        }
        this.scrollBy(-dYaw * 1.6);
        state.v = (-dYaw * 1.6) / Math.max(dt, 1e-3);
    }

    // ---------------------------------------------------------- natural hands

    naturalHand(controller) {
        return this.settings.handMode === 'natural' && this.isHand(controller);
    }

    /**
     * Hand pose from the tracked joints: 'fist', 'point' (index out, middle and ring curled),
     * 'open', 'loose' (two or more fingers past FINGER_RELEASE: a relaxed hand), 'other', or
     * null when not tracked. A finger counts as extended/curled by how far its tip is from the
     * wrist relative to its knuckle, so hand size does not matter.
     */
    handPose(hand) {
        const J = hand && hand.joints;
        if (!J || !J.wrist || !J.wrist.visible || !J['index-finger-tip']) return null;
        const w = J.wrist.getWorldPosition(_wrist);
        const ratio = (finger) => {
            const tip = J[finger + '-tip'];
            const knuckle = J[finger + '-phalanx-proximal'];
            if (!tip || !knuckle) return 1.4;
            const k = knuckle.getWorldPosition(_joint).distanceTo(w);
            return k > 1e-4 ? tip.getWorldPosition(_joint).distanceTo(w) / k : 1.4;
        };
        const r = HAND_FINGERS.map(ratio);
        const gap = this.handGap(hand);
        this.lastHandMetrics = { r, gap };
        return classifyHand(r, gap, this.profile.hand);
    }

    /**
     * Hand diagnostics (settings): a small panel in front of the user shows what each hand is
     * read as, and a sample goes to the XR telemetry every profile.handDebugInterval so thresholds can
     * be tuned on real hands. Finger ratio = tip-to-wrist / knuckle-to-wrist (curled < 1.25 < extended 1.5, see handPose.js).
     */
    handDebugSample(controller, pose, metrics, st, now) {
        if (now - (st.debugAt || 0) < this.profile.handDebugInterval) return;
        st.debugAt = now;
        const hand = (controller.userData.inputSource && controller.userData.inputSource.handedness) || String(controller.userData.index);
        const press = this.presses.get(controller);
        const act = st.fist ? (press && press.axis === 'z' ? 'zoom' : 'fist') : st.dwellT > 0 ? 'dwell' : '-';
        const r = metrics ? metrics.r.map((x) => x.toFixed(2)).join(',') : '';
        const gap = metrics && metrics.gap !== null ? (metrics.gap * 100).toFixed(1) : '';
        this.handDebugLines = this.handDebugLines || {};
        this.handDebugLines[hand] = `${hand}: ${pose || 'none'} · ${act} · i/m/r/p ${r} · gap ${gap} cm`;
        this.track('xr_hand_sample', { props: { hand, pose: pose || 'none', act, r, gap, surface: 'gallery' } });
        this.drawHandDebug();
    }

    drawHandDebug() {
        if (!this.handDebugMesh) {
            this.handDebugMesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
            this.handDebugMesh.renderOrder = 60;
            this.scene.add(this.handDebugMesh);
        }
        const lines = Object.values(this.handDebugLines || {});
        const t = textTexture(lines.length ? lines : ['—'], { width: 1100, height: 60 + lines.length * 44, sizes: [30], colors: [COLORS.text], background: panelBg(0.85), radius: 20 });
        disposeTexture(this.handDebugMesh.material.map);
        this.handDebugMesh.material.map = t.texture;
        this.handDebugMesh.material.needsUpdate = true;
        this.handDebugMesh.scale.set(t.w * 0.5, t.h * 0.5, 1);
    }

    /** Keeps the diagnostics panel low in front of the head. */
    placeHandDebug() {
        const m = this.handDebugMesh;
        if (!m) return;
        m.visible = !!this.settings.handDebug && this.settings.handMode === 'natural';
        if (!m.visible) return;
        const cam = this.presenting ? this.renderer.xr.getCamera() : this.camera;
        const pos = cam.getWorldPosition(new Vector3());
        const dir = cam.getWorldDirection(new Vector3());
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
        dir.normalize();
        m.position.set(pos.x + dir.x * 0.8, pos.y - 0.32, pos.z + dir.z * 0.8);
        m.lookAt(pos.x, pos.y - 0.32, pos.z);
    }

    /** Distance between thumb tip and index tip (metres), or null when not tracked. */
    handGap(hand) {
        const J = hand && hand.joints;
        const thumb = J && J['thumb-tip'];
        const index = J && J['index-finger-tip'];
        if (!thumb || !index || thumb.visible === false) return null;
        return thumb.getWorldPosition(_joint).distanceTo(index.getWorldPosition(_wrist));
    }

    /**
     * Natural hand mode, per tracked hand each frame:
     *  - point with the index finger and hold still on something for profile.dwellSelect → select it
     *    (a ring fills around the dot);
     *  - make a fist → grab: moving it drags exactly like a pinch-drag (scroll / zoom / next pin
     *    / pan / timeline scrub), pulling it towards you zooms in; a fist held still for
     *    profile.fistHideHold toggles quick hide.
     * A fist is left only when the fingers open again (two past FINGER_RELEASE), so a loose fist
     * does not flicker in and out of a drag, yet a relaxed half-open hand still lets go.
     * After a dwell select the finger has to move profile.dwellRearmRad before the next one: a select
     * changes what is under a still finger (the viewer opens, a panel rebuilds), and that new
     * object must not fire on its own 0.8 s later.
     */
    updateNaturalHands(dt) {
        if (this.settings.handMode !== 'natural') return;
        for (const controller of this.controllers) {
            if (!this.isHand(controller) || !this.handActive(controller)) continue;
            const ud = controller.userData;
            const st = ud.natural || (ud.natural = { fist: false, dwellTarget: null, dwellT: 0, fired: false, firedDir: new Vector3() });
            const pose = this.handPose(ud.hand);
            if (pose === null) {
                if (st.fist) this.endFist(controller, st);
                this.resetDwell(controller, st);
                continue;
            }
            const metrics = this.lastHandMetrics;
            const now = performance.now() / 1000;
            if (this.settings.handDebug) this.handDebugSample(controller, pose, metrics, st, now);
            // A fist grabs only once it has held for profile.fistHold and not right after a zoom step:
            // closing thumb and index passes through a fist-like pose for a few frames.
            st.fistT = !st.fist && pose === 'fist' ? (st.fistT || 0) + dt : 0;
            if (!st.fist && pose === 'fist' && st.fistT < this.profile.fistHold) continue;
            if (!st.fist && pose === 'fist') {
                st.fist = true;
                this.resetDwell(controller, st);
                this.startPress(controller);
                const press = this.presses.get(controller);
                if (press) press.fist = true;
                continue;
            }
            if (st.fist) {
                if (pose === 'open' || pose === 'point' || pose === 'loose') this.endFist(controller, st);
                continue;
            }
            if (pose !== 'point' || this.hiddenAll) {
                this.resetDwell(controller, st);
                continue;
            }
            this.raycaster.setFromXRController(controller);
            const dir = this.raycaster.ray.direction;
            if (st.fired) {
                if (dir.angleTo(st.firedDir) < this.profile.dwellRearmRad) {
                    this.setDwellRing(controller, 0);
                    continue;
                }
                st.fired = false;
                st.dwellTarget = null;
            }
            const hit = this.pickHit(this.raycaster);
            const target = hit ? hit.object : null;
            if (target !== st.dwellTarget) {
                st.dwellTarget = target;
                st.dwellT = 0;
            } else if (target) {
                st.dwellT += dt;
                if (st.dwellT >= this.profile.dwellSelect) {
                    if (target.userData.repeat) {
                        // − / + keep stepping while the finger stays on them.
                        st.dwellT = this.profile.dwellSelect - this.profile.zoomRepeat;
                    } else {
                        st.fired = true;
                        st.firedDir.copy(dir);
                    }
                    this.setDwellRing(controller, 0);
                    this.activate(target, hit);
                    continue;
                }
            }
            this.setDwellRing(controller, target ? st.dwellT / this.profile.dwellSelect : 0);
        }
    }

    endFist(controller, st) {
        st.fist = false;
        this.endPress(controller);
    }

    /** Drops dwell progress; `fired` stays, so a flicker out of the point pose cannot re-arm a still finger. */
    resetDwell(controller, st) {
        st.dwellTarget = null;
        st.dwellT = 0;
        this.setDwellRing(controller, 0);
    }

    setDwellRing(controller, f) {
        const ring = controller.userData.dwellRing;
        if (!ring) return;
        const step = Math.round(Math.min(1, f) * this.profile.dwellSteps);
        if (ring.userData.step === step) return;
        ring.userData.step = step;
        ring.visible = step > 0;
        ring.geometry.setDrawRange(0, step * 6); // 6 indices (two triangles) per ring segment
    }

    /** A pinch/trigger held still on empty space (or on anything while hidden) toggles quick hide. */
    checkEmptyHold() {
        const now = performance.now() / 1000;
        for (const press of this.presses.values()) {
            if (press.moved || press.holdFired || (press.startTarget && !press.fist)) continue;
            if (now - press.t0 < (press.fist ? this.profile.fistHideHold : this.profile.emptyHold)) continue;
            // One toggle per hold: two hands holding at once must not hide and unhide in the
            // same frame, and the other press must not fire a second toggle later.
            for (const other of this.presses.values()) other.holdFired = true;
            this.toggleHidden(press.fist ? 'fist' : 'hold');
            this.pulse(press.controller, 0.8, 80);
            return;
        }
    }

    readControllers(dt) {
        const session = this.renderer.xr.getSession();
        if (!session) return;
        let x = 0;
        let y = 0;
        let grips = 0;
        const now = performance.now() / 1000;
        for (const source of session.inputSources) {
            const gp = source.gamepad;
            if (!gp) continue;
            // Both grips (quick hide) counts every hand, active or not: it is a deliberate two-hand
            // gesture and must keep working with one hand switched off.
            if (gp.buttons[1] && gp.buttons[1].pressed) grips++;
            const owner = this.controllers.find((c) => c.userData.inputSource === source);
            if (owner && !this.handActive(owner)) {
                // A/B held while the hand comes back up count as already used: nothing fires until released.
                this.buttonState[source.handedness || 'none'] = { primary: true, secondary: true, primaryAt: now, fired: true };
                continue;
            }
            if (this.hiddenAll) continue;
            const axes = gp.axes;
            if (axes && axes.length >= 4) {
                if (Math.abs(axes[2]) > Math.abs(x)) x = axes[2];
                if (Math.abs(axes[3]) > Math.abs(y)) y = axes[3];
            }
            // Hold A/X to open the pin page (leaving VR is never a single accidental tap);
            // B/Y goes back to the wall. Tracked per controller.
            const key = source.handedness || 'none';
            const prev = this.buttonState[key] || {};
            const primary = !!(gp.buttons[this.profile.btnPrimary] && gp.buttons[this.profile.btnPrimary].pressed);
            const secondary = !!(gp.buttons[this.profile.btnSecondary] && gp.buttons[this.profile.btnSecondary].pressed);
            const state = { primary, secondary, primaryAt: primary ? (prev.primary ? prev.primaryAt : now) : null, fired: primary ? prev.fired : false };
            if (this.preview && primary && !state.fired && now - state.primaryAt >= this.profile.holdToOpen) {
                state.fired = true;
                this.pulse(this.controllers.find((c) => c.userData.inputSource === source), 1, 60);
                this.openPin(this.preview.card.item);
            }
            if (secondary && !prev.secondary) {
                if (this.menu) this.closeMenu();
                else if (this.preview && this.preview.focus) this.setFocusMode(false);
                else if (this.preview) this.closePreview();
                else this.back();
            }
            this.buttonState[key] = state;
        }

        // Both grips held: hide everything / bring it back (one toggle per hold).
        if (grips >= 2) {
            this.bothGripsAt = this.bothGripsAt || now;
            if (!this.hideFired && now - this.bothGripsAt >= this.profile.hideHold) {
                this.hideFired = true;
                this.grab = null;
                this.toggleHidden('grips');
                this.controllers.forEach((c) => this.pulse(c, 0.8, 80));
            }
        } else {
            this.bothGripsAt = 0;
            this.hideFired = false;
        }
        if (this.hiddenAll) return;

        if (this.menu) return;
        if (this.preview) {
            // Up/down zooms continuously; a sideways flick steps to the neighbouring pin.
            if (Math.abs(y) > this.profile.thumbDeadzone && Math.abs(y) > Math.abs(x)) {
                this.zoomBy(Math.exp(-y * dt * 1.8));
            }
            if (Math.abs(x) > 0.6 && Math.abs(x) > Math.abs(y)) {
                if (!this.thumbLatch) this.stepPreview(x > 0 ? 1 : -1);
                this.thumbLatch = true;
            } else if (Math.abs(x) < 0.3) {
                this.thumbLatch = false;
            }
            return;
        }

        if (Math.abs(y) > this.profile.thumbDeadzone && Math.abs(y) > Math.abs(x)) {
            this.zoomWall(Math.exp(-y * dt * 1.2));
            return;
        }
        if (Math.abs(x) < this.profile.thumbDeadzone) return;
        const target = Math.sign(x) * (Math.abs(x) - this.profile.thumbDeadzone) / (1 - this.profile.thumbDeadzone) * this.profile.thumbSpeed;
        this.velocity += (target - this.velocity) * Math.min(1, dt * 8);
    }

    // ------------------------------------------------------------ wall zoom

    zoomWall(factor) {
        this.wallZoomTarget = Math.min(2.2, Math.max(0.7, this.wallZoomTarget * factor));
    }

    /**
     * Eases the wall zoom toward its target, keeping the column in the centre of view
     * in place, and moves the tabs/progress bar clear of the taller rows.
     */
    updateWallZoom(dt) {
        const current = wallZoom;
        if (Math.abs(this.wallZoomTarget - current) < 0.0005) return;
        const next = current + (this.wallZoomTarget - current) * Math.min(1, dt * 10);
        const centreCol = this.scroll / COL_ANGLE;
        setWallZoom(Math.abs(this.wallZoomTarget - next) < 0.0005 ? this.wallZoomTarget : next);
        this.scroll = clampScroll(centreCol * COL_ANGLE, this.cards.length);
        // How far the top row's edge moves with the zoom: half the rows' spacing plus half a card.
        const offset = (wallZoom - 1) * (((ROWS - 1) / 2) * (CELL_H / wallZoom) + CARD_MAX_H / 2);
        this.chromeTop.position.y = offset;
        this.chromeBottom.position.y = -offset;
        this.dirty = true;
    }

    // --------------------------------------------------------------- viewer

    /**
     * Full-view viewer: the wall steps aside and the pin fills most of the field of
     * view, with its title and actions in a column beside it at eye level. Photos load
     * their original upload; GIFs and videos play as a video texture in place.
     */
    applyEnvironment() {
        const env = this.environments[this.settings.environment] || ENVIRONMENTS.studio;
        const u = this.sky.material.uniforms;
        u.top.value.setHex(env.top);
        u.horizon.value.setHex(env.horizon);
        u.bottom.value.setHex(env.bottom);
        if (env.stars && !this.stars) this.stars = this.makeStars();
        if (this.stars) this.stars.visible = env.stars;
        this.floor.visible = env.floor;
        this.setGridColour(env.floorColor ?? null);
        if (env.panorama && !this.panorama) this.panorama = this.makePanorama(env.panorama, env.dim);
        if (this.panorama) this.panorama.visible = !!env.panorama && !this.panoramaFailed;
    }

    /** The site's floor colour on every grid line, or the shipped colours back. */
    setGridColour(hex) {
        const attr = this.grid.geometry.getAttribute('color');
        if (!attr) return;
        if (!this.gridColours) this.gridColours = attr.array.slice();
        if (hex === null) attr.array.set(this.gridColours);
        else {
            const c = new Color(hex);
            for (let i = 0; i < attr.count; i++) attr.setXYZ(i, c.r, c.g, c.b);
        }
        attr.needsUpdate = true;
    }

    /** An equirectangular picture around the viewer, inside the sky, darkened by `dim`. */
    makePanorama(url, dim) {
        const material = new MeshBasicMaterial({ color: new Color(1 - dim, 1 - dim, 1 - dim), side: BackSide, fog: false, depthWrite: false });
        const sphere = new Mesh(new SphereGeometry(29, 48, 24), material);
        // Seen from inside: mirror it so the picture is not reversed.
        sphere.scale.x = -1;
        const loader = new TextureLoader();
        loader.setCrossOrigin('anonymous');
        loader.load(url, (tex) => {
            tex.colorSpace = SRGBColorSpace;
            material.map = tex;
            material.needsUpdate = true;
        }, undefined, () => {
            this.panoramaFailed = true;
            sphere.visible = false;
            this.track('xr_error', { props: { name: 'panorama', message: 'could not load the panorama', surface: 'gallery' } });
        });
        this.environment.add(sphere);
        return sphere;
    }

    /** ~1200 points on the upper half of a sphere inside the sky (built once, when first chosen). */
    makeStars() {
        const positions = [];
        for (let i = 0; i < 1200; i++) {
            const y = Math.random() * 0.95 + 0.05; // above the horizon
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(1 - y * y);
            positions.push(Math.cos(a) * r * 28, y * 28, Math.sin(a) * r * 28);
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        const stars = new Points(geometry, new PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.75, fog: false, depthWrite: false }));
        this.environment.add(stars);
        return stars;
    }

    /**
     * Mixed reality: the real room shows through. No sky, fog, floor grid or ring, and the
     * frame is cleared transparent; the wall still follows the head as in VR.
     */
    setPassthrough(on) {
        if (this.passthrough === on) return;
        this.passthrough = on;
        if (on) {
            this.savedBackground = this.scene.background;
            this.savedFog = this.scene.fog;
            this.scene.background = null;
            this.scene.fog = null;
            this.renderer.setClearAlpha(0);
        } else {
            this.scene.background = this.savedBackground || this.scene.background;
            this.scene.fog = this.savedFog || this.scene.fog;
            this.renderer.setClearAlpha(1);
        }
        this.environment.visible = !on;
    }

    /**
     * A short ease-in (92 % → 100 % over 200 ms) when a pin, a panel or a new wall appears,
     * so a change of view is seen as one. Skipped under prefers-reduced-motion.
     */
    appear(object) {
        if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        this.appearing = this.appearing.filter((a) => a.object !== object);
        object.scale.setScalar(APPEAR_FROM);
        this.appearing.push({ object, t0: performance.now() });
    }

    stepAppear() {
        const now = performance.now();
        this.appearing = this.appearing.filter((a) => {
            const k = Math.min(1, (now - a.t0) / APPEAR_MS);
            const eased = 1 - (1 - k) ** 3;
            a.object.scale.setScalar(APPEAR_FROM + (1 - APPEAR_FROM) * eased);
            return k < 1;
        });
    }

    /** Frame-rate summary since the last one (xr_perf); skipped when too few frames were drawn. */
    sendPerf() {
        if (!this.frameStats) return;
        const summary = this.frameStats.summary();
        this.frameStats.reset();
        this.perfSentAt = performance.now();
        if (!summary) return;
        const { value, ...props } = summary;
        this.track('xr_perf', { value, props: { ...props, surface: 'gallery' } });
    }

    openPreview(card) {
        if (this.presenting && !this.firstPinSent) {
            this.firstPinSent = true;
            const seconds = Math.round((performance.now() - this.sessionStartedAt) / 1000);
            this.track('xr_first_pin', { value: Math.min(seconds, 86400), props: { surface: 'gallery' } });
        }
        this.stopHoverPlay();
        this.closeMenu(false);
        if (this.preview) {
            this.swapPreview(card);
            return;
        }
        const group = new Group();
        const image = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.placeholder }));
        image.userData = { onSelect: () => this.onImageSelect(), hoverScale: 1 };
        group.add(image);

        // Video controls sit just under the picture; the progress bar spans its width.
        const progressTrack = new Mesh(new PlaneGeometry(1, 0.012), new MeshBasicMaterial({ color: 0x3a3a40 }));
        const progressFill = new Mesh(new PlaneGeometry(1, 0.016), new MeshBasicMaterial({ color: COLORS.accent }));
        progressFill.position.z = 0.001;
        // The bar is a timeline: point at it to see the time, press to jump, hold and drag to scrub.
        const progressHit = new Mesh(new PlaneGeometry(1, 0.1), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        progressHit.position.z = 0.003;
        progressHit.userData = { onSelect: (hit) => this.seekToHit(hit), hoverScale: 1, timeline: true };
        const knob = new Mesh(new CircleGeometry(0.02, 24), new MeshBasicMaterial({ color: 0xffffff }));
        knob.position.z = 0.002;
        const hoverTime = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
        hoverTime.visible = false;
        hoverTime.renderOrder = 22;
        const progress = new Group();
        progress.add(progressTrack, progressFill, progressHit, knob, hoverTime);
        progress.position.z = 0.02;
        group.add(progress);

        // Author, board and tags on the left; similar pins under the picture.
        const side = new Group();
        side.position.z = 0.08;
        group.add(side);
        const strip = new Group();
        strip.position.z = 0.04;
        group.add(strip);

        // Slideshow: time left on this pin, as a thin bar along the top edge of the picture.
        const slideTrack = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
        const slideFill = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: COLORS.accent, depthWrite: false }));
        slideTrack.renderOrder = 22;
        slideFill.renderOrder = 23;
        const slideBar = new Group();
        slideBar.add(slideTrack, slideFill);
        slideBar.visible = false;
        group.add(slideBar);

        const column = new Group();
        column.position.z = 0.08;
        group.add(column);

        const info = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
        info.renderOrder = 20;
        column.add(info);

        const disposables = [];
        const makeButton = (label, fn, active, parent = column, width = 520) => {
            const t = buttonTexture(label, { active, width, height: 104 });
            disposables.push(t.texture);
            const btn = new Mesh(new PlaneGeometry(t.w * 0.8, t.h * 0.8), new MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false }));
            btn.renderOrder = 21;
            btn.userData = { onSelect: fn, hoverScale: 1.06, label, width, active };
            parent.add(btn);
            return btn;
        };
        // The site's action buttons are built per item (buildActionButtons, from swapPreview).
        const backBtn = makeButton('← ' + this.strings.back_to_wall, () => this.closePreview(), false);
        const zoomOutBtn = makeButton('−', () => this.zoomBy(1 / this.profile.zoomStep), false, column, 250);
        const zoomInBtn = makeButton('+', () => this.zoomBy(this.profile.zoomStep), false, column, 250);
        zoomOutBtn.userData.repeat = true;
        zoomInBtn.userData.repeat = true;
        const moreBtn = makeButton(this.moreLabel(false), () => this.toggleMoreActions(), false);
        // Behind "More" (see layoutColumn). Both ways out of VR need a second select: in
        // natural hand mode a finger merely resting on a button for profile.dwellSelect selects it.
        const laterBtn = makeButton('＋ ' + this.strings.watch_later, () => this.toggleQueue(this.preview.card.item), false);
        const slideBtn = makeButton('▶ ' + this.strings.slideshow, () => this.toggleSlideshow(), false);
        // An allowlisted YouTube/Vimeo item plays in the overlay outside VR; everything else opens its page.
        const openBtn = makeButton(this.strings.open_page, () => {
            const item = this.preview.card.item;
            if (this.embedFor(item)) this.showEmbed(item);
            else this.confirmSelect(openBtn, () => this.openPin(item));
        }, true);
        const extraButtons = [laterBtn, slideBtn, openBtn];
        if (this.presenting) {
            const exitBtn = makeButton('✕ ' + this.strings.exit_vr, () => this.confirmSelect(exitBtn, () => this.exitVr()), false);
            extraButtons.push(exitBtn);
        }
        const buttons = [zoomOutBtn, zoomInBtn, backBtn, moreBtn, ...extraButtons];

        const controls = new Group();
        controls.position.z = 0.08;
        group.add(controls);
        const playBtn = makeButton('❚❚ ' + this.strings.pause, () => this.togglePlay(), false, controls, 300);
        const backwardBtn = makeButton(this.strings.back10, () => this.seekBy(-10), false, controls, 220);
        const forwardBtn = makeButton(this.strings.fwd10, () => this.seekBy(10), false, controls, 220);
        const soundBtn = makeButton('🔊 ' + this.strings.sound_on, () => this.toggleSound(), false, controls, 300);
        const cinemaBtn = makeButton('🎬 ' + this.strings.cinema, () => this.toggleCinema(), false, controls, 260);
        // Shown only when there is a choice of quality / inside a 360°/180° video (layoutControls skips hidden ones).
        const qualityBtn = makeButton(this.strings.quality + ': ' + this.strings.quality_auto, () => this.cycleQuality(), false, controls, 460);
        const immersiveExitBtn = makeButton('✕ ' + this.strings.exit_360, () => this.closePreview(), false, controls, 460);
        qualityBtn.visible = false;
        immersiveExitBtn.visible = false;
        const controlButtons = [playBtn, backwardBtn, forwardBtn, soundBtn, cinemaBtn, qualityBtn, immersiveExitBtn];
        const timeText = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
        timeText.renderOrder = 21;
        timeText.visible = false;
        controls.add(timeText);

        const hintLines = this.viewerTips();
        const hint = textTexture(hintLines, {
            width: 560, height: 43 * hintLines.length + 36, sizes: [34], weights: [500], colors: [COLORS.textSoft], background: panelBg(0.78), radius: 24,
        });
        disposables.push(hint.texture);
        const hintMesh = new Mesh(new PlaneGeometry(hint.w * 0.8, hint.h * 0.8), new MeshBasicMaterial({ map: hint.texture, transparent: true, depthWrite: false }));
        hintMesh.renderOrder = 20;
        column.add(hintMesh);

        this.scene.add(group);
        this.appear(group);
        this.preview = {
            card: null, group, image, column, info, infoTex: null, largeTex: null, openBtn, likeBtn: null, zoomOutBtn, zoomInBtn, backBtn, moreBtn, laterBtn, slideBtn,
            buttons, staticButtons: buttons, extraButtons, moreOpen: false, confirm: null, hintMesh, slideT: 0,
            actionButtons: [], primaryActions: [], moreActions: [], actionDisposables: [], notice: null, noticeText: null,
            controls, controlButtons, playBtn, soundBtn, cinemaBtn, qualityBtn, immersiveExitBtn, panelHidden: false, progress, progressFill, progressHit, knob, hoverTime, hoverTimeText: '',
            timeText, timeTextValue: '', slideBar, slideTrack, slideFill, side, sideTargets: [], sideDisposables: [], strip, stripTargets: [], stripDisposables: [], stripCards: [],
            media: null, quality: '', w: 1, h: 1, zoom: 1, targetZoom: 1, panX: 0, panY: 0,
            baseTargets: [...buttons, ...controlButtons, image, progressHit], staticTargets: [...buttons, ...controlButtons, image, progressHit], targets: [], disposables,
        };
        this.refreshPreviewTargets();
        this.setWallVisible(false);
        this.swapPreview(card);
        this.placePreview();
    }

    refreshPreviewTargets() {
        const p = this.preview;
        p.targets = [...p.baseTargets, ...p.sideTargets, ...p.stripTargets];
    }

    /** Three short lines for the input in use: mouse/keyboard, controllers, pinch or natural hands. */
    viewerTips() {
        let mode = 'page';
        if (this.presenting) {
            const hands = this.controllers.some((c) => this.isHand(c));
            mode = !hands ? 'controller' : this.settings.handMode === 'natural' ? 'natural' : 'pinch';
        }
        return String(this.strings['viewer_tips_' + mode] || VIEWER_TIPS[mode]).split(' · ').slice(0, 3);
    }

    moreLabel(open) {
        return open ? '▴ ' + (this.strings.fewer_actions || 'Less') : '⋯ ' + (this.strings.more_actions || 'More');
    }

    /** "More" unfolds the secondary actions in place; it stays open while stepping pins. */
    toggleMoreActions() {
        const p = this.preview;
        p.moreOpen = !p.moreOpen;
        if (!p.moreOpen) this.cancelConfirm();
        this.setButton(p.moreBtn, this.moreLabel(p.moreOpen), false);
        this.layoutColumn();
        this.layoutStrip();
    }

    /**
     * Action column: Like, Save, Back and More, with Watch later, Slideshow, Open page and
     * Exit VR unfolding under More. An embed's "Watch in the browser" is the only way to play
     * it, so for embeds (and videos that failed to load here) it moves up among the primary
     * buttons (still behind a confirm).
     * Hidden buttons are invisible, so `targets()` never offers them to a ray.
     */
    layoutColumn() {
        const p = this.preview;
        // − and + share one row (an embed plays in the browser, so it gets no zoom).
        const zoomRow = p.card.item.unplayable ? [] : [p.zoomOutBtn];
        const primary = [...p.primaryActions, ...zoomRow, p.backBtn, p.moreBtn];
        if (p.card.item.unplayable || (p.media && p.media.failed)) primary.splice(p.primaryActions.length, 0, p.openBtn);
        const extras = [...p.moreActions, ...p.extraButtons];
        const shown = p.moreOpen ? [...primary, ...extras.filter((b) => !primary.includes(b))] : primary;
        p.buttons.forEach((btn) => { btn.visible = shown.includes(btn) || (btn === p.zoomInBtn && zoomRow.length > 0); });
        let y = 0.13;
        shown.forEach((btn) => {
            if (btn === p.zoomOutBtn) {
                p.zoomOutBtn.position.set(-0.108, y, 0.001);
                p.zoomInBtn.position.set(0.108, y, 0.001);
            } else {
                btn.position.set(0, y, 0.001);
            }
            y -= 0.092;
        });
        // Hint top 3 cm under the last button's bottom edge (buttons are 0.083 m tall).
        const hintH = p.hintMesh.geometry.parameters.height;
        p.hintMesh.position.set(0, y + 0.092 - 0.042 - 0.03 - hintH / 2, 0);
    }

    /**
     * Leaving VR takes two selects: the first arms the button ("Tap again to confirm") for
     * profile.confirmWindow seconds, a second select on it runs `run`; otherwise it reverts in
     * updateViewer. Hold A and page-mode Enter still open the page in one step.
     */
    confirmSelect(btn, run) {
        const p = this.preview;
        if (p.confirm && p.confirm.btn === btn) {
            this.cancelConfirm();
            run();
            return;
        }
        this.cancelConfirm();
        p.confirm = { btn, until: performance.now() / 1000 + this.profile.confirmWindow, label: btn.userData.label, active: btn.userData.active };
        this.setButton(btn, this.strings.tap_to_confirm || 'Tap again to confirm', true);
    }

    cancelConfirm() {
        const p = this.preview;
        const c = p && p.confirm;
        if (!c) return;
        p.confirm = null;
        this.setButton(c.btn, c.label, c.active);
    }

    /** Button face on a plane; its texture is owned by `bag` (disposed with the panel). */
    viewerButton(label, fn, parent, bag, width = 440, active = false) {
        const t = buttonTexture(label, { active, width, height: 96 });
        bag.push(t.texture);
        const btn = new Mesh(new PlaneGeometry(t.w * 0.8, t.h * 0.8), new MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false }));
        btn.renderOrder = 21;
        btn.userData = { onSelect: fn, hoverScale: 1.06, label, width };
        parent.add(btn);
        return btn;
    }

    clearGroup(group, bag) {
        [...group.children].forEach((o) => {
            group.remove(o);
            o.traverse((c) => {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
                this.hovered.delete(c);
            });
        });
        bag.forEach(disposeTexture);
        bag.length = 0;
    }

    /**
     * Left column: the author (opens their profile), the board (opens it) and up to
     * eight tags (each opens its tag page) — the pin's context, one press away.
     */
    buildContext(card) {
        const p = this.preview;
        this.clearGroup(p.side, p.sideDisposables);
        const { item } = card;
        const targets = [];
        let y = 0.36;
        const side = this.view.panel.side;
        if (side.includes('creator') && this.canScope('user') && item.creator && item.creator.id) {
            targets.push(this.viewerButton('👤 @' + item.creator.label, () => this.openProfile('pins', { id: item.creator.id, name: item.creator.label }), p.side, p.sideDisposables));
            targets[targets.length - 1].position.set(0, y, 0.001);
            y -= 0.1;
        }
        if (side.includes('collection') && this.canScope('board') && item.collection && item.collection.id && item.collection.label) {
            const btn = this.viewerButton('▦ ' + item.collection.label, () => this.navigate({ kind: 'board', id: item.collection.id, name: item.collection.label, owner: item.creator && item.creator.label }), p.side, p.sideDisposables);
            btn.position.set(0, y, 0.001);
            targets.push(btn);
            y -= 0.1;
            // Follow the board (not one's own); its pins then appear under "Following".
            if (this.declares('follow') && this.view.actions.follow?.placement === undefined && !(this.userId && item.creator && item.creator.id === this.userId)) {
                const follow = this.viewerButton(this.followLabel(item), () => this.toggleFollow(item, follow), p.side, p.sideDisposables, 440, !!item.collection.following);
                p.followBtn = follow;
                follow.position.set(0, y, 0.001);
                targets.push(follow);
                y -= 0.1;
            }
        }
        const tags = side.includes('tags') && this.canScope('tag') ? (item.tags || []).slice(0, 8) : [];
        if (tags.length) {
            const head = textTexture(this.strings.tags_label, { width: 440, height: 64, sizes: [34], colors: [COLORS.muted], align: 'center' });
            p.sideDisposables.push(head.texture);
            const headMesh = new Mesh(new PlaneGeometry(head.w * 0.8, head.h * 0.8), new MeshBasicMaterial({ map: head.texture, transparent: true, depthWrite: false }));
            headMesh.position.set(0, y - 0.01, 0);
            p.side.add(headMesh);
            y -= 0.08;
            tags.forEach((tag, i) => {
                const btn = this.viewerButton('#' + tag, () => this.navigate({ kind: 'tag', name: tag }), p.side, p.sideDisposables, 262);
                btn.position.set(i % 2 ? 0.108 : -0.108, y - Math.floor(i / 2) * 0.092, 0.001);
                targets.push(btn);
            });
        }
        p.sideTargets = targets;
        this.refreshPreviewTargets();
    }

    /** Similar pins (cached per pin) as small thumbnails under the picture, plus "more". */
    buildStrip(card) {
        const p = this.preview;
        this.clearGroup(p.strip, p.stripDisposables);
        p.stripTargets = [];
        p.stripCards = [];
        this.refreshPreviewTargets();
        const { item } = card;
        if (item.kind === 'collection' || !this.hasRelated) return;
        this.fetchRelated(item.id).then((items) => {
            if (!this.preview || this.preview.card !== card) return;
            const shown = items.slice(0, STRIP_MAX);
            if (!shown.length) return;
            p.stripCards = items.map((it, i) => ({ ...fitCard(it.aspect), item: it, index: i, state: 'none', retried: false, group: null, image: null, frame: null, list: null }));
            p.stripCards.forEach((c) => { c.list = p.stripCards; });
            const widths = shown.map((it) => STRIP_H * Math.max(0.55, Math.min(1.5, it.aspect || 0.75)));
            const more = this.viewerButton(this.strings.more_similar + ' →', () => this.navigate({ kind: 'related', id: item.id, title: item.title }), p.strip, p.stripDisposables, 330);
            const moreW = 0.264;
            const total = widths.reduce((a, b) => a + b, 0) + 0.025 * shown.length + moreW;
            let x = -total / 2;
            const targets = [];
            shown.forEach((it, i) => {
                const mesh = new Mesh(new PlaneGeometry(widths[i], STRIP_H), new MeshBasicMaterial({ map: this.placeholder, alphaMap: this.mask, alphaToCoverage: true }));
                mesh.position.set(x + widths[i] / 2, 0, 0);
                mesh.userData = { onSelect: () => this.openStripCard(i), hoverScale: 1.1, stripCard: p.stripCards[i] };
                p.strip.add(mesh);
                targets.push(mesh);
                x += widths[i] + 0.025;
                if (!it.image) {
                    const tex = textCardTexture(it, { aspect: widths[i] / STRIP_H, width: 384, locale: this.locale });
                    p.stripDisposables.push(tex);
                    mesh.material.map = tex;
                    return;
                }
                this.loadTexture(it.image, 256).then((tex) => {
                    if (!this.preview || this.preview.card !== card || mesh.parent !== p.strip) {
                        disposeTexture(tex);
                        return;
                    }
                    p.stripDisposables.push(tex);
                    mesh.material.map = tex;
                    mesh.material.needsUpdate = true;
                }).catch(() => {});
            });
            more.position.set(x + moreW / 2, 0, 0.001);
            targets.push(more);
            p.stripTargets = targets;
            this.refreshPreviewTargets();
            this.layoutStrip();
        }).catch(() => {});
    }

    layoutStrip() {
        const p = this.preview;
        // Under the video controls when they are shown, else right under the picture.
        const below = p.hasControls ? 0.3 : 0.08;
        // Also below the action column's hint, which can reach under a short picture.
        const hint = p.hintMesh.geometry.parameters;
        const columnBottom = p.hintMesh.position.y - hint.height / 2 - 0.03;
        p.strip.position.y = Math.min(-p.h / 2 - below, columnBottom) - STRIP_H / 2;
    }

    fetchRelated(pinId) {
        const cached = this.relatedCache.get(pinId);
        if (cached) return cached;
        const request = this.adapter.page({ scope: { kind: 'related', id: pinId } })
            .then((data) => (data.items || []).map((it) => ({ ...it, _liked: !!(it.state && it.state.liked) })))
            .catch((e) => {
                this.relatedCache.delete(pinId);
                throw e;
            });
        this.relatedCache.set(pinId, request);
        if (this.relatedCache.size > RELATED_CACHE) this.relatedCache.delete(this.relatedCache.keys().next().value);
        return request;
    }

    /** A similar pin opens in the viewer; ←/→ then walk the similar list it came from. */
    openStripCard(i) {
        const card = this.preview && this.preview.stripCards[i];
        if (card) this.swapPreview(card);
    }

    /** Fills the viewer with `card`: picture, title, like state, best image or video. */
    swapPreview(card, resumeAt = 0) {
        const p = this.preview;
        const { item } = card;
        this.stopMedia();
        this.closeEmbed();
        this.cancelConfirm();
        p.card = card;
        this.sizeViewer(item.aspect || 0.75);
        p.image.material.map = this.textures.get(item.id) || (card.state === 'error' ? this.errorTexture(card) : this.placeholder);
        p.image.material.needsUpdate = true;
        disposeTexture(p.largeTex);
        p.largeTex = null;
        if (!item.image) {
            // A text card is drawn larger in the viewer, with more of the excerpt.
            p.largeTex = textCardTexture(item, { aspect: item.aspect || undefined, width: 1024, detail: 'viewer', locale: this.locale });
            p.image.material.map = p.largeTex;
        }
        this.buildActionButtons(item);
        this.syncViewerButtons();
        p.slideT = 0;

        // A feed may send `video` without `media_type`: the type is inferred, so it still plays.
        const type = mediaTypeOf(item);
        const video = playableVideo(item);
        p.hasControls = video && type === 'video';
        this.applyViewerChrome();
        p.quality = type === 'photo' ? this.strings.quality_loading : '';
        // Third-party players (video sites, …) are cross-origin iframes: WebGL cannot draw them
        // and Quest Browser has no DOM layers in VR, so in VR they only play on the pin page.
        // Outside VR an allowlisted embed plays in a DOM overlay over the wall.
        const embed = item.unplayable && item.unplayable.provider;
        if (embed) p.quality = this.strings.embed_notice.replace(':provider', embed);
        const playsHere = !!this.embedFor(item);
        this.setButton(p.openBtn, playsHere ? '▶ ' + this.strings.embed_play : embed ? '▶ ' + this.strings.watch_in_browser : this.strings.open_page, true);
        // Not in a slideshow: an autoplaying player per item would stack up; the poster shows and the show moves on.
        if (playsHere && !this.slideshow) this.showEmbed(item);
        this.updateInfo();
        this.buildContext(card);
        this.buildStrip(card);
        this.layoutStrip();
        this.announce(this.describe(card));

        // Take this pin's prefetched image BEFORE moving the window: prefetchAround keeps
        // only the pins after this one, so it would dispose this pin's texture.
        const ready = this.takePrefetched(item);
        this.prefetchAround(card);

        if (video) {
            // The sharp poster (prefetched when this pin was coming up) bridges the video load.
            if (ready) {
                ready.then((tex) => {
                    if (this.preview !== p || p.card !== card || (p.media && p.media.texture)) {
                        disposeTexture(tex);
                        return;
                    }
                    disposeTexture(p.largeTex);
                    p.largeTex = tex;
                    p.image.material.map = tex;
                    p.image.material.needsUpdate = true;
                }).catch(() => {});
            }
            this.startMedia(item, resumeAt);
            return;
        }
        if (embed) {
            // Poster only; the notice stays in place of a quality line.
            const poster = item.image_focus || item.image;
            if (poster) {
                (ready || this.loadTexture(poster, 1600)).then((tex) => {
                    if (this.preview !== p || p.card !== card) {
                        disposeTexture(tex);
                        return;
                    }
                    disposeTexture(p.largeTex);
                    p.largeTex = tex;
                    p.image.material.map = tex;
                    p.image.material.needsUpdate = true;
                }).catch(() => {});
            }
            return;
        }
        // Photos: sharp 1200 first, then the original upload (downscaled only if huge).
        const large = item.image_focus || item.image;
        // A text card has no larger copy to fetch.
        if (!large && !item.image_full) return;
        const loadFull = () => {
            if (!item.image_full || item.image_full === large) {
                p.quality = this.strings.quality_preview.replace(':w', String(p.largeTex ? p.largeTex.image.width : 1200));
                this.updateInfo();
                return;
            }
            this.loadTexture(item.image_full, FULL_MAX_PX).then((tex) => this.showStill(card, tex, true)).catch(() => {
                p.quality = '';
                this.updateInfo();
            });
        };
        if (large) {
            (ready || this.loadTexture(large, 1600)).then((tex) => {
                this.showStill(card, tex, false);
                loadFull();
            }).catch(loadFull);
        } else {
            loadFull();
        }
    }

    /**
     * Decodes the sharp image (1600 px; the poster for videos) of the next PREFETCH_AHEAD
     * pins in the list being viewed, so stepping or a slideshow shows them at once. Only
     * that window is kept: anything that falls out of it is disposed, never accumulated.
     */
    prefetchAround(card) {
        const list = card.list || this.cards;
        const wanted = [];
        for (let i = list.indexOf(card) + 1; i < list.length && wanted.length < PREFETCH_AHEAD; i++) {
            const it = list[i].item;
            if (it.kind === 'collection' || it.kind === 'tag') continue;
            const url = it.image_focus || it.image;
            if (url) wanted.push([it.id, url]);
        }
        const keep = new Set(wanted.map(([id]) => id));
        for (const [id, entry] of this.prefetched) {
            if (!keep.has(id)) this.dropPrefetched(id, entry);
        }
        for (const [id, url] of wanted) {
            if (this.prefetched.has(id)) continue;
            const entry = { tex: null, dropped: false, promise: null };
            entry.promise = this.loadTexture(url, 1600).then((tex) => {
                if (entry.dropped) {
                    disposeTexture(tex);
                    throw new Error('dropped');
                }
                entry.tex = tex;
                return tex;
            });
            entry.promise.catch(() => { if (this.prefetched.get(id) === entry) this.prefetched.delete(id); });
            this.prefetched.set(id, entry);
        }
    }

    /** Hands over a prefetched texture (the caller then owns and disposes it), or null. */
    takePrefetched(item) {
        const entry = this.prefetched.get(item.id);
        if (!entry) return null;
        this.prefetched.delete(item.id);
        return entry.tex ? Promise.resolve(entry.tex) : entry.promise;
    }

    dropPrefetched(id, entry) {
        entry.dropped = true;
        disposeTexture(entry.tex);
        entry.tex = null;
        this.prefetched.delete(id);
    }

    clearPrefetched() {
        for (const [id, entry] of this.prefetched) this.dropPrefetched(id, entry);
    }

    sizeViewer(aspect) {
        const p = this.preview;
        let h = this.presenting ? VIEWER_H_XR : VIEWER_H_PAGE;
        let w = h * aspect;
        if (w > VIEWER_MAX_W) { w = VIEWER_MAX_W; h = w / aspect; }
        p.w = w;
        p.h = h;
        p.zoom = p.targetZoom = 1;
        p.panX = p.panY = 0;
        p.image.geometry.dispose();
        p.image.geometry = new PlaneGeometry(w, h);

        p.column.position.x = w / 2 + 0.34;
        p.info.position.set(0, 0.34, 0);
        this.layoutColumn();

        p.side.position.x = -(w / 2 + 0.3);

        p.progress.position.y = -h / 2 - 0.045;
        p.progress.children[0].scale.x = w;
        p.progress.children[1].scale.x = 0.0001;
        p.progressHit.scale.x = w;
        p.knob.position.x = -w / 2;
        this.layoutControls();
        this.layoutStrip();
    }

    /** One centred row under the picture: the shown control buttons, then the time. */
    layoutControls() {
        const p = this.preview;
        const shown = p.controlButtons.filter((b) => b.visible);
        const widths = shown.map((b) => (b.userData.width / 1000) * 0.8);
        const timeW = 0.22;
        const total = widths.reduce((a, b) => a + b, 0) + 0.03 * widths.length + timeW;
        let x = -total / 2;
        shown.forEach((b, i) => {
            b.position.set(x + widths[i] / 2, -p.h / 2 - 0.15, 0.001);
            x += widths[i] + 0.03;
        });
        p.timeText.position.set(x + timeW / 2, -p.h / 2 - 0.15, 0.001);
    }

    /** Shows a loaded still if it still belongs to the open pin; `original` marks the full upload. */
    showStill(card, tex, original) {
        const p = this.preview;
        if (!p || p.card !== card) {
            disposeTexture(tex);
            return;
        }
        disposeTexture(p.largeTex);
        p.largeTex = tex;
        p.image.material.map = tex;
        p.image.material.needsUpdate = true;
        const w = card.item.width || tex.image.width;
        const h = card.item.height || tex.image.height;
        p.quality = original
            ? this.strings.quality_original.replace(':w', String(w)).replace(':h', String(h))
            : this.strings.quality_loading;
        this.updateInfo();
    }

    updateInfo() {
        const p = this.preview;
        if (!p) return;
        const { item } = p.card;
        disposeTexture(p.infoTex);
        // A long status (e.g. the embed notice) wraps onto two lines at its dash.
        const status = p.quality ? String(p.quality).split(/ — /) : [];
        let lines;
        let sizes;
        let colors;
        let weights;
        const fields = this.view.panel.fields;
        if (fields || this.hooks.panel) {
            // The site's fields (or its hook), drawn with fixed sizes: only the content is the site's.
            let styled = fields ? panelLines(item, fields, this.view.panel.metaLabels) : this.defaultPanelLines(item);
            if (this.hooks.panel) styled = hookLines(this.hooks.panel(item, styled.map((l) => ({ ...l })))) || styled;
            if (!styled.length) styled = [{ text: ' ', style: 'title' }];
            const look = { title: [38, COLORS.text, 700], soft: [28, COLORS.textSoft, 500], body: [26, COLORS.text, 500], accent: [26, COLORS.accent, 600] };
            lines = styled.map((l) => l.text);
            sizes = styled.map((l) => look[l.style][0]);
            colors = styled.map((l) => look[l.style][1]);
            weights = styled.map((l) => look[l.style][2]);
        } else {
            const meta = [item.likes ? '♥ ' + item.likes : null, descriptionOf(item) || null].filter(Boolean).join(' · ');
            lines = [item.title || ' ', creatorName(item.creator) || ' '];
            sizes = [38, 28];
            colors = [COLORS.text, COLORS.textSoft];
            if (meta) {
                lines.push(meta);
                sizes.push(24);
                colors.push(COLORS.muted);
            }
        }
        status.forEach((line) => {
            lines.push(line);
            sizes.push(26);
            colors.push(COLORS.accent);
        });
        this.lastPanelLines = lines;
        const info = textTexture(lines, {
            width: 600, height: 90 + lines.length * 36, sizes, colors, ...(weights ? { weights: [...weights, ...status.map(() => 600)] } : {}), background: panelBg(0.78), radius: 28,
        });
        p.infoTex = info.texture;
        p.info.material.map = info.texture;
        p.info.material.needsUpdate = true;
        p.info.geometry.dispose();
        p.info.geometry = new PlaneGeometry(info.w * 0.8, info.h * 0.8);
    }

    /**
     * Plays a GIF's MP4 (looping, silent) or a native video (with sound, controls) as a
     * texture on the viewer plane. The press that opened the viewer counts as a user
     * gesture, so sound is allowed; if the browser still refuses, it starts muted.
     */
    startMedia(item, resumeAt = 0) {
        const p = this.preview;
        const isGif = mediaTypeOf(item) === 'gif';
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.playsInline = true;
        video.preload = 'auto';
        video.loop = isGif;
        video.muted = isGif;
        this.trackVideo(video);
        const media = { video, texture: null, failed: false, isGif, source: null, immersive: null };
        p.media = media;

        const fail = (message) => {
            if (p.media !== media || media.failed) return;
            media.failed = true;
            p.quality = this.strings.video_unavailable;
            // Offer the 2D page, where the same video plays without CORS.
            this.setButton(p.openBtn, '▶ ' + this.strings.watch_in_browser, true);
            this.layoutColumn();
            this.updateInfo();
            this.track('xr_error', { props: { name: 'video', message: String(message).slice(0, 120), surface: 'gallery' } });
        };
        video.addEventListener('loadeddata', () => {
            if (p.media !== media) return;
            if (resumeAt > 0) video.currentTime = resumeAt;
            media.texture = new VideoTexture(video);
            media.texture.colorSpace = SRGBColorSpace;
            if (!isGif && isImmersive(item)) {
                this.enterImmersive(media, item);
                return;
            }
            if (video.videoWidth && video.videoHeight) this.sizeViewer(video.videoWidth / video.videoHeight);
            p.image.material.map = media.texture;
            p.image.material.needsUpdate = true;
        }, { once: true });
        video.addEventListener('error', () => fail(video.error && video.error.code));
        video.addEventListener('play', () => this.syncMediaButtons());
        video.addEventListener('pause', () => this.syncMediaButtons());
        video.addEventListener('volumechange', () => this.syncMediaButtons());
        // The automatic quality's current height is shown on the quality button.
        video.addEventListener('resize', () => { if (p.media === media) this.syncQualityButton(); });

        const play = () => video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => {});
        });
        if (isGif) {
            // A GIF may come as video_sources only.
            video.src = this.textureUrl(gifSource(item));
            play();
            return;
        }
        // Files keep the ?xr= marker (pre-CORS cache); HLS/DASH URLs are used as given.
        media.source = attachVideo(video, item, {
            inXr: this.presenting,
            maxHeight: this.videoOptions.maxHeight,
            libs: this.videoOptions.libs,
            fileUrl: (u) => this.textureUrl(u),
            onLevels: () => {
                if (p.media !== media) return;
                this.syncQualityButton();
                this.applyViewerChrome();
            },
            onError: fail,
        });
        if (media.source.attached) play();
        media.source.ready.then(() => {
            if (p.media !== media) return;
            if (!media.source.attached) play();
            this.syncQualityButton();
        }, (e) => fail(e && e.message));
        this.spatialize(media);
    }

    /** Keeps the last few video elements (detached, small) so state() can show none still holds a source. */
    trackVideo(video) {
        this.recentVideos.push(video);
        if (this.recentVideos.length > 8) this.recentVideos.shift();
    }

    isLive(media) {
        return !!media && !media.isGif && (!!(media.source && media.source.live) || media.video.duration === Infinity);
    }

    /** "Quality: Auto · 720p" / "Quality: 1080p", only when the source offers a choice. */
    syncQualityButton() {
        const p = this.preview;
        if (!p) return;
        const source = p.media && p.media.source;
        const levels = source ? source.levels() : [];
        const show = levels.length > 1;
        const changed = p.qualityBtn.visible !== show;
        p.qualityBtn.visible = show;
        if (show) {
            const level = source.level();
            const h = p.media.video.videoHeight;
            const name = level === 'auto' ? this.strings.quality_auto + (h ? ' · ' + h + 'p' : '') : (levels.find((l) => l.id === level) || { label: String(level) }).label;
            const text = this.strings.quality + ': ' + name;
            if (p.qualityBtn.userData.label !== text) this.setButton(p.qualityBtn, text, level !== 'auto');
        }
        if (changed) this.layoutControls();
    }

    /** Auto → highest → … → lowest → Auto. Time and play state are kept by the source. */
    cycleQuality() {
        const source = this.preview && this.preview.media && this.preview.media.source;
        if (!source) return;
        const order = ['auto', ...source.levels().map((l) => l.id)];
        const next = order[(order.indexOf(source.level()) + 1) % order.length];
        source.setLevel(next);
        this.syncQualityButton();
        this.announce(this.preview.qualityBtn.userData.label);
    }

    /** Head position and the yaw it faces (0 = −Z, the page camera's default). */
    headPose() {
        const cam = this.presenting ? this.renderer.xr.getCamera() : this.camera;
        cam.getWorldPosition(_immPos);
        cam.getWorldDirection(_immDir);
        return { pos: _immPos, yaw: Math.atan2(-_immDir.x, -_immDir.z) };
    }

    /**
     * 360°/180°: the video surrounds the viewer. The wall, the environment and the viewer's picture
     * and columns hide; the controls row stays as a small panel in front (recalled by a press on
     * empty space); "Exit to the wall" closes the viewer.
     */
    enterImmersive(media, item) {
        const p = this.preview;
        const head = this.headPose();
        media.immersive = createImmersive({ texture: media.texture, projection: item.projection, stereo: item.stereo, yaw: head.yaw });
        this.scene.add(media.immersive.group);
        media.immersive.update(this.camera, this.presenting, head.pos);
        if (!this.presenting) p.savedCamera = this.camera.quaternion.clone();
        this.environment.visible = false;
        p.immersive = true;
        p.panelHidden = false;
        p.image.visible = false;
        p.cinemaBtn.visible = false;
        p.immersiveExitBtn.visible = true;
        this.sizeViewer(IMMERSIVE_PANEL_ASPECT);
        this.applyViewerChrome();
        this.placePreview();
        if (!this.presenting) this.announce(this.strings.look_around);
    }

    exitImmersive(immersive) {
        immersive.dispose(this.camera);
        // As setPassthrough left it: hidden only in mixed reality.
        this.environment.visible = !this.passthrough;
        const p = this.preview;
        if (!p) return;
        if (!this.presenting && p.savedCamera) this.camera.quaternion.copy(p.savedCamera);
        p.savedCamera = null;
        p.immersive = false;
        p.panelHidden = false;
        p.image.visible = true;
        p.cinemaBtn.visible = true;
        p.immersiveExitBtn.visible = false;
        this.applyViewerChrome();
    }

    toggleImmersivePanel() {
        const p = this.preview;
        p.panelHidden = !p.panelHidden;
        if (!p.panelHidden) this.placePreview();
        this.applyViewerChrome();
    }

    /** Every frame while immersive: the sphere stays on the head; the page camera sees the left eye. */
    updateImmersive() {
        const media = this.preview && this.preview.media;
        if (media && media.immersive) media.immersive.update(this.camera, this.presenting, this.headPose().pos);
    }

    // ------------------------------------------------------- embed overlay

    /** The overlay URL for an allowlisted YouTube/Vimeo item outside VR, else null. */
    embedFor(item) {
        if (!this.videoOptions.embeds || this.presenting || !item || !item.unplayable) return null;
        return embedUrl(item.unplayable.embed);
    }

    showEmbed(item) {
        const url = this.embedFor(item);
        if (!url) return;
        this.closeEmbed();
        const handle = openEmbed({
            mount: this.container,
            url,
            title: item.title || item.unplayable.provider,
            labels: { close: this.strings.close, dialog: this.strings.embed_dialog },
            onClose: () => { if (this.embed === handle) this.embed = null; },
        });
        this.embed = handle;
    }

    closeEmbed() {
        const e = this.embed;
        this.embed = null;
        if (e) e.close();
    }

    /** Wall.destroy(): no stream player, video source or overlay outlives the wall. */
    dispose() {
        this.closeEmbed();
        this.stopHoverPlay();
        this.closePreview(false);
    }

    /**
     * Video sound comes from where the picture is (HRTF panner), in VR only and only once
     * the audio context already runs after a press — otherwise the element plays its sound
     * as before, so a suspended context can never silence a video.
     */
    spatialize(media) {
        if (!this.presenting || this.settings.spatialAudio === false) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        try {
            if (!this.audio && Ctx) this.audio = new Ctx();
            const ctx = this.audio;
            if (!ctx || ctx.state !== 'running') return;
            const source = ctx.createMediaElementSource(media.video);
            const panner = ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = VIEWER_DISTANCE;
            source.connect(panner).connect(ctx.destination);
            media.audio = { source, panner };
            this.placeAudio(media);
        } catch (e) {
            media.audio = null;
        }
    }

    /** Keeps the panner on the picture and the listener on the head (every frame while a video plays). */
    placeAudio(media) {
        const ctx = this.audio;
        const p = this.preview;
        if (!ctx || !media.audio || !p) return;
        const set = (param, value) => { if (param) param.value = value; };
        p.image.getWorldPosition(_audioPos);
        const { panner } = media.audio;
        if (panner.positionX) {
            set(panner.positionX, _audioPos.x); set(panner.positionY, _audioPos.y); set(panner.positionZ, _audioPos.z);
        } else {
            panner.setPosition(_audioPos.x, _audioPos.y, _audioPos.z);
        }
        const l = ctx.listener;
        this.camera.getWorldPosition(_audioPos);
        this.camera.getWorldDirection(_audioDir);
        if (l.positionX) {
            set(l.positionX, _audioPos.x); set(l.positionY, _audioPos.y); set(l.positionZ, _audioPos.z);
            set(l.forwardX, _audioDir.x); set(l.forwardY, _audioDir.y); set(l.forwardZ, _audioDir.z);
            set(l.upX, 0); set(l.upY, 1); set(l.upZ, 0);
        } else {
            l.setPosition(_audioPos.x, _audioPos.y, _audioPos.z);
            l.setOrientation(_audioDir.x, _audioDir.y, _audioDir.z, 0, 1, 0);
        }
    }

    stopMedia() {
        const p = this.preview;
        if (!p || !p.media) return;
        const { video, texture, audio, source, immersive } = p.media;
        p.media = null;
        if (immersive) this.exitImmersive(immersive);
        if (audio) {
            try { audio.source.disconnect(); audio.panner.disconnect(); } catch (e) {}
        }
        // The source's destroy also ends hls.js / dash.js before emptying the element.
        if (source) source.destroy();
        else {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
        if (texture) {
            if (p.image.material.map === texture) p.image.material.map = this.placeholder;
            texture.dispose();
        }
        if (p.qualityBtn.visible) {
            p.qualityBtn.visible = false;
            this.layoutControls();
        }
    }

    onImageSelect() {
        if (this.preview && this.preview.card.item.unplayable) {
            const item = this.preview.card.item;
            if (this.embedFor(item)) this.showEmbed(item);
            else this.openPin(item);
            return;
        }
        if (this.preview) this.setFocusMode(!this.preview.focus);
    }

    followLabel(item) {
        return item.collection.following ? '✓ ' + this.strings.following_board : '★ ' + this.strings.follow_board;
    }

    toggleFollow(item, btn, ensure = false) {
        if (this.hasAccount && !this.authed) {
            // `ensure`: Follow toggles too, and the account may already follow this board.
            this.signInFor('follow', () => this.toggleFollow(item, this.preview && this.preview.followBtn, true));
            return;
        }
        this.adapter.action('follow', item).then((res) => {
            if (!res.ok) {
                // Without an account the site's answer is shown, as for every other action.
                if (!this.hasAccount) this.actionFailed('follow', item, btn, res);
                return;
            }
            const body = res.state || {};
            // A site without an account may answer a toggle without `following`: flip it.
            if (!this.hasAccount && !('following' in body)) body.following = !item.collection.following;
            if (ensure && !body.following) {
                // It was followed already and this press unfollowed it: follow again.
                this.toggleFollow(item, btn);
                return;
            }
            // Every card from the same board shares the new state.
            this.cards.forEach((c) => { if (c.item.collection && c.item.collection.id === item.collection.id) c.item.collection.following = !!body.following; });
            item.collection.following = !!body.following;
            if (this.preview && this.preview.card.item === item) this.setButton(btn, this.followLabel(item), item.collection.following, 440);
            this.announce(this.followLabel(item));
        }).catch((e) => { if (!this.hasAccount) this.actionFailed('follow', item, btn, { ok: false, reason: 'error', message: String(e && e.message) }); });
    }

    // ------------------------------------------------------- watch later

    inQueue(item) {
        return this.queue.some((it) => it.id === item.id);
    }

    /** Adds/removes the pin from the watch-later queue kept in this browser. */
    toggleQueue(item) {
        if (this.inQueue(item)) this.queue = this.queue.filter((it) => it.id !== item.id);
        else this.queue = [...this.queue, { ...item, _liked: undefined }].slice(-QUEUE_MAX);
        try {
            localStorage.setItem(this.storageKeys.queue, JSON.stringify(this.queue));
        } catch (e) {
            // storage full or blocked: the queue lasts for this visit
        }
        this.syncViewerButtons();
        this.announce(this.inQueue(item) ? this.strings.in_queue : this.strings.watch_later);
    }

    /** Opens the first queued pin and plays the queue as a slideshow. */
    playAll() {
        const first = this.cards.find((c) => c.item.kind !== 'collection' && c.item.kind !== 'tag');
        if (!first) return;
        this.openPreview(first);
        this.startSlideshow();
    }

    syncViewerButtons() {
        const p = this.preview;
        if (!p) return;
        const queued = this.inQueue(p.card.item);
        this.setButton(p.laterBtn, (queued ? '✓ ' + this.strings.in_queue : '＋ ' + this.strings.watch_later), queued);
        this.setButton(p.slideBtn, this.slideshow ? '❚❚ ' + this.strings.slideshow_stop : '▶ ' + this.strings.slideshow, this.slideshow);
    }

    // -------------------------------------------------------- slideshow

    toggleSlideshow() {
        if (this.slideshow) this.stopSlideshow();
        else this.startSlideshow();
    }

    /** Hands-free: photos/GIFs stay the set seconds, videos play to the end (or the set limit). */
    startSlideshow() {
        if (!this.preview) return;
        this.slideshow = true;
        this.preview.slideT = 0;
        this.setFocusMode(true);
        this.syncViewerButtons();
        this.announce(this.strings.slideshow);
    }

    stopSlideshow() {
        this.slideshow = false;
        this.syncViewerButtons();
    }

    updateSlideshow(dt) {
        const p = this.preview;
        if (!this.slideshow || !p || this.hiddenAll || this.scrub || this.menu) return;
        const media = p.media;
        const isVideo = media && !media.isGif && !media.failed;
        if (isVideo) {
            if (media.video.paused && !media.video.ended) return; // user paused: wait
            const limit = this.settings.slideVideo;
            if (media.video.ended || (limit && media.video.currentTime >= limit)) this.advanceSlideshow();
            return;
        }
        p.slideT += dt;
        if (p.slideT >= this.settings.slidePhoto) this.advanceSlideshow();
    }

    /** Share of this pin's slideshow time already used (0…1), or null outside a slideshow. */
    slideFraction() {
        const p = this.preview;
        if (!this.slideshow || !p) return null;
        const media = p.media;
        if (media && !media.isGif && !media.failed) {
            const d = media.video.duration;
            if (!Number.isFinite(d) || d <= 0) return 0;
            const limit = this.settings.slideVideo ? Math.min(d, this.settings.slideVideo) : d;
            return Math.min(1, media.video.currentTime / limit);
        }
        return Math.min(1, p.slideT / this.settings.slidePhoto);
    }

    updateSlideBar() {
        const p = this.preview;
        const f = this.slideFraction();
        p.slideBar.visible = f !== null && !this.hiddenAll;
        if (!p.slideBar.visible) return;
        // Follows the picture through focus/cinema scaling; sits just above its top edge.
        const s = p.focusScale || 1;
        const w = p.w * s;
        const hBar = 0.012 * Math.max(1, s * 0.9);
        p.slideBar.position.set(0, (p.h * s) / 2 + (p.focusDrop || 0) + 0.025, -(p.push || 0) + 0.004);
        p.slideTrack.scale.set(w, hBar, 1);
        p.slideFill.scale.set(Math.max(0.0001, w * f), hBar, 1);
        p.slideFill.position.set(-w / 2 + (w * f) / 2, 0, 0.001);
    }

    advanceSlideshow() {
        const p = this.preview;
        p.slideT = 0;
        const before = p.card;
        this.stepPreview(1);
        if (this.preview && this.preview.card !== before) return;
        // End of what is loaded: fetch more, or stop at the real end.
        if (!before.list && !this.feed.done) {
            this.loadMore();
            p.slideT = this.settings.slidePhoto - 1; // retry in a second
            return;
        }
        this.stopSlideshow();
        this.setFocusMode(false);
    }

    // ------------------------------------------------------------ cinema

    /** Video on a big screen further away, the floor grid dimmed; press the picture to leave. */
    toggleCinema() {
        const p = this.preview;
        if (!p) return;
        p.cinema = !p.cinema;
        if (p.cinema) this.setFocusMode(true);
        this.grid.visible = !p.cinema;
        this.ring.visible = !p.cinema;
    }

    /**
     * Focus mode: only the picture (or video) stays; the action column, context column,
     * similar strip and video controls hide. Another press on the picture, B or Esc
     * brings them back. It carries over when stepping to the next pin.
     */
    setFocusMode(on) {
        const p = this.preview;
        if (!p) return;
        p.focus = on;
        if (!on && p.cinema) {
            p.cinema = false;
            this.grid.visible = true;
            this.ring.visible = true;
        }
        this.applyViewerChrome();
        this.announce(on ? this.strings.focus_on : this.strings.focus_off);
    }

    applyViewerChrome() {
        const p = this.preview;
        const ui = !p.focus;
        // Inside a 360°/180° video only the controls row is left (and it can be hidden with a press).
        const flat = !p.immersive;
        p.column.visible = ui && flat;
        p.side.visible = ui && flat;
        p.strip.visible = ui && flat;
        p.controls.visible = ui && p.hasControls && !p.panelHidden;
        // A live stream has no timeline: "LIVE" stands where the time would be.
        p.progress.visible = p.controls.visible && !this.isLive(p.media);
        if (!ui) {
            this.scrub = null;
            p.hoverTime.visible = false;
        }
    }

    // ------------------------------------------------------------ timeline

    /** Timeline position (0…1) of a ray hit on the bar. */
    timelineFraction(hit) {
        const p = this.preview;
        const local = p.progressHit.worldToLocal(hit.point.clone());
        return Math.min(1, Math.max(0, local.x + 0.5));
    }

    seekToHit(hit) {
        const media = this.preview && this.preview.media;
        if (!hit || !media || this.isLive(media) || !Number.isFinite(media.video.duration)) return;
        this.seekTo(this.timelineFraction(hit) * media.video.duration);
    }

    /** Seeks, coalescing requests while the video is still seeking (scrubbing fires every frame). */
    seekTo(seconds) {
        const media = this.preview && this.preview.media;
        if (!media) return;
        media.seekTarget = seconds;
        if (!media.video.seeking) {
            media.video.currentTime = seconds;
            media.seekTarget = null;
        }
    }

    /**
     * A press that lands on the timeline scrubs instead of dragging: `ray()` returns the
     * pointer's raycaster (controller or mouse) and is re-read every frame until release.
     */
    startScrub(ray, controller = null) {
        const p = this.preview;
        if (!p || !p.media || !p.progress.visible || this.menu) return false;
        const hit = ray().intersectObject(p.progressHit, false)[0];
        if (!hit) return false;
        this.scrub = { ray, controller };
        this.seekToHit(hit);
        return true;
    }

    updateScrub() {
        const p = this.preview;
        if (!this.scrub || !p || !p.media) {
            this.scrub = null;
            return;
        }
        // Past the ends of the bar the ray still counts: project it onto the bar's plane.
        const ray = this.scrub.ray().ray;
        const normal = new Vector3(0, 0, 1).applyQuaternion(p.progressHit.getWorldQuaternion(new Quaternion()));
        const origin = p.progressHit.getWorldPosition(new Vector3());
        const denom = normal.dot(ray.direction);
        if (Math.abs(denom) < 1e-4) return;
        const t = normal.dot(origin.clone().sub(ray.origin)) / denom;
        if (t <= 0) return;
        this.seekToHit({ point: ray.origin.clone().addScaledVector(ray.direction, t) });
    }

    /** Playhead knob, "1:23 / 5:40" beside the buttons, and the time under a pointer on the bar. */
    updateTimeline(hoverHit) {
        const p = this.preview;
        const video = p.media && p.media.video;
        const live = this.isLive(p.media);
        const duration = !live && video && Number.isFinite(video.duration) ? video.duration : 0;
        if (p.media && p.media.seekTarget != null && !video.seeking) this.seekTo(p.media.seekTarget);
        const f = duration ? Math.min(1, video.currentTime / duration) : 0;
        p.knob.position.x = -p.w / 2 + f * p.w;
        const text = live ? '● ' + this.strings.live : duration ? formatTime(video.currentTime) + ' / ' + formatTime(duration) : '';
        if (text !== p.timeTextValue) {
            p.timeTextValue = text;
            this.setMeshText(p.timeText, text, { width: 280, height: 80, sizes: [30], colors: [COLORS.textSoft], align: 'center', background: null }, 0.8);
        }
        const show = !!(hoverHit && duration);
        p.hoverTime.visible = show;
        if (!show) return;
        const hf = this.timelineFraction(hoverHit);
        const label = formatTime(hf * duration);
        if (label !== p.hoverTimeText) {
            p.hoverTimeText = label;
            this.setMeshText(p.hoverTime, label, { width: 200, height: 72, sizes: [34], colors: [COLORS.text], align: 'center', background: panelBg(0.9), radius: 36 }, 0.8);
        }
        p.hoverTime.position.set(-p.w / 2 + hf * p.w, 0.075, 0.004);
    }

    setMeshText(mesh, text, opts, scale) {
        disposeTexture(mesh.material.map);
        if (!text) {
            mesh.material.map = null;
            mesh.visible = false;
            return;
        }
        const t = textTexture(text, opts);
        mesh.material.map = t.texture;
        mesh.material.needsUpdate = true;
        mesh.scale.set(t.w * scale, t.h * scale, 1);
        mesh.visible = true;
    }

    togglePlay() {
        const media = this.preview && this.preview.media;
        if (!media) return;
        if (media.video.paused) media.video.play().catch(() => {});
        else media.video.pause();
    }

    toggleSound() {
        const media = this.preview && this.preview.media;
        if (!media) return;
        media.video.muted = !media.video.muted;
    }

    seekBy(seconds) {
        const media = this.preview && this.preview.media;
        if (!media || this.isLive(media) || !Number.isFinite(media.video.duration)) return;
        this.seekTo(Math.min(media.video.duration, Math.max(0, media.video.currentTime + seconds)));
    }

    syncMediaButtons() {
        const p = this.preview;
        if (!p || !p.media) return;
        const { video } = p.media;
        this.setButton(p.playBtn, video.paused ? '▶ ' + this.strings.play : '❚❚ ' + this.strings.pause, false, 300);
        this.setButton(p.soundBtn, video.muted ? '🔇 ' + this.strings.sound_off : '🔊 ' + this.strings.sound_on, false, 300);
    }

    /** Session start/end changes the viewer size and adds/removes "Exit VR". */
    rebuildPreview() {
        const card = this.preview.card;
        const at = this.preview.media ? this.preview.media.video.currentTime : 0;
        this.closePreview(false);
        this.openPreview(card);
        if (at > 0 && this.preview.media) this.swapPreview(card, at);
    }

    // ------------------------------------------------------------- actions

    /** The adapter declared this action. */
    declares(id) {
        return (this.adapter.capabilities().actions || []).includes(id);
    }

    /**
     * Whether the wall may open a scope of this kind. A site with its own account is a
     * full app whose adapter serves every scope; any other site only those it declares.
     */
    canScope(kind) {
        return this.hasAccount || !!(this.adapter.capabilities().scopes || {})[kind];
    }

    /** The corner mark of a card: the state of `view.wall.indicator` (like by default). */
    indicatorOn(item) {
        const id = this.view.wall.indicator;
        return !!id && isActive(item, id, this.view.actions[id]);
    }

    refreshIndicator(item) {
        const card = this.cardsById.get(item.id);
        if (card) this.setHeart(card, this.indicatorOn(item));
    }

    /** Builds the column's action buttons for this item: the site's actions, in its order and placement. */
    buildActionButtons(item) {
        const p = this.preview;
        for (const b of p.actionButtons) {
            p.column.remove(b);
            b.geometry.dispose();
            b.material.dispose();
            this.hovered.delete(b);
        }
        p.actionDisposables.forEach(disposeTexture);
        p.actionDisposables = [];
        const views = this.view.actions;
        const ids = actionIds(this.adapter.capabilities().actions || [], item, views, this.hooks.actions);
        const { primary, more } = placeActions(ids, views);
        const make = (id, placement) => {
            const face = actionFace(id, item, views[id], this.strings, this.hooks.actionLabel);
            const t = buttonTexture(face.label, { active: face.filled, width: 520, height: 104 });
            p.actionDisposables.push(t.texture);
            const btn = new Mesh(new PlaneGeometry(t.w * 0.8, t.h * 0.8), new MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false }));
            btn.renderOrder = 21;
            btn.userData = { onSelect: () => this.pressAction(id, btn), hoverScale: 1.06, label: face.label, width: 520, active: face.filled, actionId: id, placement };
            p.column.add(btn);
            return btn;
        };
        p.primaryActions = primary.map((id) => make(id, 'primary'));
        p.moreActions = more.map((id) => make(id, 'more'));
        p.actionButtons = [...p.primaryActions, ...p.moreActions];
        p.likeBtn = p.actionButtons.find((b) => b.userData.actionId === 'like') || null;
        p.buttons = [...p.actionButtons, ...p.staticButtons];
        p.baseTargets = [...p.actionButtons, ...p.staticTargets];
        this.refreshPreviewTargets();
    }

    /** Redraws the action buttons of the open item (a result may change several states). */
    refreshActionButtons(item) {
        const p = this.preview;
        if (!p || p.card.item !== item) return;
        for (const btn of p.actionButtons) {
            if (p.confirm && p.confirm.btn === btn) continue;
            const id = btn.userData.actionId;
            const face = actionFace(id, item, this.view.actions[id], this.strings, this.hooks.actionLabel);
            this.setButton(btn, face.label, face.filled);
            btn.userData.onSelect = () => this.pressAction(id, btn);
        }
    }

    /**
     * One press on an action button. like and save-to-a-board of a site with an account keep their own
     * flows; everything else goes to the adapter. Actions that open a page ask for a second press.
     */
    pressAction(id, btn) {
        const p = this.preview;
        if (!p) return;
        const item = p.card.item;
        if (id === 'like' && this.hasAccount) return this.like(item, btn);
        if (id === 'save' && typeof this.adapter.targets === 'function') return this.openSavePanel(p.card);
        const link = (this.adapter.capabilities().links || []).includes(id);
        if (link || (this.view.actions[id] || {}).confirm) {
            this.confirmSelect(btn, () => this.runAction(id, item, btn, true));
            return;
        }
        this.runAction(id, item, btn, false);
    }

    runAction(id, item, btn, confirmed) {
        if (this.hasAccount && !this.authed) {
            this.signInFor(id, () => this.runAction(id, item, this.actionButton(id), confirmed));
            return;
        }
        if (typeof this.adapter.action !== 'function') return;
        this.adapter.action(id, item)
            .then((res) => {
                if (!res || !res.ok) return this.actionFailed(id, item, btn, res || { ok: false, reason: 'error' });
                const { deeplink, ...state } = res.state || {};
                item.state = { ...(item.state || {}), ...state };
                if ('liked' in state) item._liked = !!state.liked;
                this.refreshIndicator(item);
                this.refreshActionButtons(item);
                if (typeof deeplink === 'string') {
                    if (confirmed) this.openLink(deeplink);
                    else if (btn && this.preview && this.preview.card.item === item) this.confirmSelect(btn, () => this.openLink(deeplink));
                }
                return undefined;
            })
            .catch((e) => this.actionFailed(id, item, btn, { ok: false, reason: 'error', message: String(e && e.message) }));
    }

    actionButton(id) {
        const p = this.preview;
        return p ? p.actionButtons.find((b) => b.userData.actionId === id) || null : null;
    }

    /**
     * "Not signed in": on a site with an account the phone sign-in; on any other site a notice,
     * and the button turns into a link to the site's sign-in page (still two presses).
     * Errors: a notice; a site with an account keeps the silent failure (telemetry only).
     */
    actionFailed(id, item, btn, res) {
        if (res.reason === 'auth') {
            if (this.hasAccount) {
                this.signInFor(id, () => this.runAction(id, item, this.actionButton(id), false));
                return;
            }
            this.track('xr_signin_prompt', { props: { name: id, surface: 'gallery' } });
            this.viewerNotice((this.strings.signin_on_site || 'Sign in on :site first').replace(':site', this.siteName()));
            const login = this.adapter.login;
            if (login && btn && this.preview && this.preview.card.item === item) {
                this.setButton(btn, '↪ ' + (this.strings.open_signin || 'Open the sign-in page'), true);
                btn.userData.onSelect = () => this.confirmSelect(btn, () => this.openLink(login));
            }
            return;
        }
        this.track('xr_error', { props: { name: id, message: String(res.message || res.reason || 'error').slice(0, 180), surface: 'gallery' } });
        if (!this.hasAccount) this.viewerNotice(this.strings.action_failed || 'That did not work. Try again later.');
    }

    siteName() {
        return this.brandName || this.adapter.id || location.hostname;
    }

    /** Opens a page of the site (a deeplink or the sign-in page), leaving VR first. Only http(s). */
    openLink(url) {
        let u;
        try {
            u = new URL(url, location.href);
        } catch (e) {
            return;
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
        const go = () => navigateTo(u.href, this.track);
        const session = this.renderer.xr.getSession();
        this.exitBy = 'app';
        if (session) session.end().then(go, go);
        else go();
    }

    /** A short message over the hint panel, for four seconds. */
    viewerNotice(text) {
        const p = this.preview;
        if (!p) return;
        this.clearNotice(p);
        const t = textTexture(text, { width: 560, height: 100, sizes: [30], weights: [600], colors: [COLORS.text], background: panelBg(0.92), radius: 24, align: 'center' });
        const mesh = new Mesh(new PlaneGeometry(t.w * 0.8, t.h * 0.8), new MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false }));
        mesh.renderOrder = 22;
        mesh.position.set(p.hintMesh.position.x, p.hintMesh.position.y, 0.004);
        p.column.add(mesh);
        p.notice = mesh;
        p.noticeText = text;
        this.announce(text);
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => { if (this.preview === p) this.clearNotice(p); }, 4000);
    }

    clearNotice(p) {
        if (!p.notice) return;
        p.column.remove(p.notice);
        p.notice.geometry.dispose();
        disposeTexture(p.notice.material.map);
        p.notice.material.dispose();
        p.notice = null;
        p.noticeText = null;
    }

    /** The shipped panel lines as styled lines, for a panel hook without `fields`. */
    defaultPanelLines(item) {
        const meta = [item.likes ? '♥ ' + item.likes : null, descriptionOf(item) || null].filter(Boolean).join(' · ');
        const when = [shortDate(item.date, this.locale), sourceHost(item.link)].filter(Boolean).join(' · ');
        return [
            { text: item.title || ' ', style: 'title' },
            ...(item.creator ? [{ text: creatorName(item.creator), style: 'soft' }] : []),
            ...(when ? [{ text: when, style: 'soft' }] : []),
            ...(meta ? [{ text: meta, style: 'body' }] : []),
        ];
    }

    /** Test hook (harness): the open item, its action buttons and notice, and the wall's shape. */
    viewerState() {
        const p = this.preview;
        return {
            open: !!p,
            item: p ? p.card.item.id : null,
            buttons: p ? p.actionButtons.map((b) => ({ id: b.userData.actionId, label: b.userData.label, filled: !!b.userData.active, placement: b.userData.placement, visible: b.visible })) : [],
            more: p ? p.moreOpen : false,
            notice: p ? p.noticeText : null,
            chrome: { discover: !!this.discoverButton, user: !!this.userButton },
            layout: { rows: ROWS, radius: RADIUS, arc: Math.round((ARC * 180) / Math.PI), cardW: CARD_MAX_W, cardH: CARD_MAX_H },
            environment: this.settings.environment,
            panel: p ? this.lastPanelLines || null : null,
        };
    }

    /** Puts a panel straight ahead of wherever the user is looking (yaw only). */
    placeInFront(group, sideShift = 0, lift = 0) {
        const cam = this.presenting ? this.renderer.xr.getCamera() : this.camera;
        const pos = new Vector3();
        cam.getWorldPosition(pos);
        const dir = new Vector3();
        cam.getWorldDirection(dir);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
        dir.normalize();
        const y = (this.presenting ? pos.y : EYE_Y) + lift;
        const side = new Vector3(-dir.z, 0, dir.x).multiplyScalar(sideShift);
        group.position.set(pos.x + dir.x * VIEWER_DISTANCE + side.x, y, pos.z + dir.z * VIEWER_DISTANCE + side.z);
        group.lookAt(group.position.x - dir.x, y, group.position.z - dir.z);
    }

    placePreview() {
        // Context column left, actions right: the picture itself is centred.
        if (!this.preview) return;
        this.preview.lift = this.presenting ? VIEWER_LIFT_XR : 0.15;
        this.placeInFront(this.preview.group, 0, this.preview.lift);
    }

    toggleZoom() {
        if (!this.preview) return;
        const p = this.preview;
        p.targetZoom = p.targetZoom > 1.4 ? 1 : 2.2;
        if (p.targetZoom === 1) { p.panX = 0; p.panY = 0; }
    }

    zoomBy(factor) {
        if (!this.preview) return;
        const p = this.preview;
        p.targetZoom = Math.min(this.profile.zoomMax, Math.max(this.profile.zoomMin, p.targetZoom * factor));
    }

    panBy(dx, dy) {
        if (!this.preview) return;
        this.preview.panX += dx;
        this.preview.panY += dy;
    }

    /** Eases zoom toward its target, clamps panning, advances the video progress bar. */
    updateViewer(dt) {
        const p = this.preview;
        if (!p) return;
        if (p.confirm && performance.now() / 1000 >= p.confirm.until) this.cancelConfirm();
        p.zoom += (p.targetZoom - p.zoom) * Math.min(1, dt * 10);
        // Focus mode: the picture grows a little and drops back to eye level (the group is
        // lifted to make room for the similar strip, which is hidden now).
        const ease = Math.min(1, dt * 8);
        const targetScale = p.cinema ? CINEMA_SCALE : p.focus ? FOCUS_SCALE : 1;
        p.focusScale = (p.focusScale || 1) + (targetScale - (p.focusScale || 1)) * ease;
        p.push = (p.push || 0) + ((p.cinema ? CINEMA_PUSH : 0) - (p.push || 0)) * ease;
        p.focusDrop = (p.focusDrop || 0) + ((p.focus ? -(p.lift || 0) : 0) - (p.focusDrop || 0)) * ease;
        const z = p.zoom * p.focusScale;
        const maxX = Math.max(0, (p.w * z - p.w * p.focusScale) / 2);
        const maxY = Math.max(0, (p.h * z - p.h * p.focusScale) / 2);
        p.panX = Math.min(maxX, Math.max(-maxX, p.panX));
        p.panY = Math.min(maxY, Math.max(-maxY, p.panY));
        p.image.scale.set(z, z, 1);
        p.image.position.set(p.panX, p.panY + p.focusDrop, -p.push);
        this.updateSlideBar();
        if (p.media && p.progress.visible) {
            const { video } = p.media;
            const f = video.duration ? Math.min(1, video.currentTime / video.duration) : 0;
            p.progressFill.scale.x = Math.max(0.0001, f * p.w);
            p.progressFill.position.x = -p.w / 2 + (f * p.w) / 2;
        }
    }

    stepPreview(delta) {
        if (!this.preview) return;
        const { card } = this.preview;
        // A pin opened from the similar strip steps through that list; wall pins through the wall.
        const list = card.list || this.cards;
        let next = list[list.indexOf(card) + delta];
        while (next && (next.item.kind === 'collection' || next.item.kind === 'tag')) next = list[list.indexOf(next) + delta];
        if (!next) return;
        if (list === this.cards) {
            // Keep the wall in step so going back lands next to the pin just viewed.
            this.scroll = clampScroll(columnOf(next.index) * COL_ANGLE, this.cards.length);
            this.focusIndex = next.index;
            this.dirty = true;
        }
        this.swapPreview(next);
    }

    closePreview(showWall = true) {
        if (!this.preview) return;
        this.closeEmbed();
        this.stopMedia();
        this.clearPrefetched();
        if (showWall) this.slideshow = false;
        this.grid.visible = true;
        this.ring.visible = true;
        const p = this.preview;
        this.scene.remove(p.group);
        p.group.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        p.disposables.forEach(disposeTexture);
        p.actionDisposables.forEach(disposeTexture);
        clearTimeout(this.noticeTimer);
        this.clearNotice(p);
        p.sideDisposables.forEach(disposeTexture);
        p.stripDisposables.forEach(disposeTexture);
        disposeTexture(p.hoverTime.material.map);
        disposeTexture(p.timeText.material.map);
        disposeTexture(p.infoTex);
        disposeTexture(p.largeTex);
        p.targets.forEach((o) => this.hovered.delete(o));
        this.preview = null;
        if (showWall) this.setWallVisible(true);
    }

    setWallVisible(on) {
        this.world.visible = on && !this.hiddenAll;
        this.wall.visible = true;
        this.chrome.visible = true;
        if (!on) this.hoverLabels.forEach((l) => { l.visible = false; });
    }

    openPin(item) {
        const go = () => this.openItem(item);
        const session = this.renderer.xr.getSession();
        this.exitBy = 'app';
        if (session) session.end().then(go, go);
        else go();
    }

    like(item, btn, ensure = false) {
        if (!this.authed) {
            // `ensure`: the account that signs in may already like this pin, and Like toggles.
            this.signInFor('like', () => this.like(item, this.preview && this.preview.likeBtn, true));
            return;
        }
        this.adapter.action('like', item)
            .then((res) => (res.ok ? res.state || {} : Promise.reject(new Error(res.message || 'like'))))
            .then((data) => {
                if (ensure && !data.liked) {
                    // It was liked already and this press unliked it: like it again.
                    this.like(item, btn);
                    return;
                }
                item._liked = !!data.liked;
                this.refreshIndicator(item);
                this.refreshActionButtons(item);
            })
            .catch((e) => this.track('xr_error', { props: { name: 'like', message: String(e && e.message).slice(0, 180), surface: 'gallery' } }));
    }

    setButton(btn, label, active, width = 520) {
        if (!btn) return;
        const w = btn.userData.width || width;
        const t = buttonTexture(label, { active, width: w, height: 104 });
        const old = btn.material.map;
        btn.material.map = t.texture;
        btn.material.needsUpdate = true;
        btn.userData.label = label;
        btn.userData.active = active;
        // Whichever panel owns the old face takes the new one, so it is freed with the panel.
        const p = this.preview;
        const bags = [p && p.disposables, p && p.actionDisposables, p && p.sideDisposables, p && p.stripDisposables, this.menu && this.menu.disposables].filter(Boolean);
        const bag = bags.find((b) => b.includes(old));
        if (bag) bag[bag.indexOf(old)] = t.texture;
        disposeTexture(old);
    }

    // ----------------------------------------------------------------- menu

    /**
     * Profile menu. Signed out: sign in by approving a code on a phone (QR or typed
     * URL) — no password typing in the headset. Signed in: liked pins, sign out.
     */
    /**
     * A guest pressed Like / Save / Follow: say why sign-in is needed, and finish the action
     * once the phone approves. Closing the panel forgets it. The viewer the guest was in is
     * reopened first, so the action lands on fresh buttons.
     */
    signInFor(reason, action) {
        const card = this.preview ? this.preview.card : null;
        this.openMenu(this.strings['signin_to_' + reason] || null);
        this.pendingSignIn = { reason, card, action };
        this.track('xr_signin_prompt', { props: { name: reason, surface: 'gallery' } });
    }

    openMenu(reason = null) {
        const ui = this.startPanel('account', 1.5, 1.05);
        const { panel, button } = ui;
        const L = this.strings;
        if (this.authed) {
            const s = this.scope;
            const mine = (section) => s.kind === 'user' && s.id === this.userId && s.section === section;
            panel(textTexture(['@' + (this.userName || ''), L.user_menu], { width: 1100, height: 150, sizes: [52, 30], align: 'center', colors: [COLORS.text, COLORS.textSoft] }), 0, 0.4);
            const items = [
                ['📌 ' + L.my_pins, () => this.openProfile('pins'), mine('pins')],
                ['▦ ' + L.my_boards, () => this.openProfile('boards'), mine('boards')],
                ['↻ ' + L.section_repins, () => this.openProfile('repins'), mine('repins')],
                ['♥ ' + L.filter_liked, () => this.openProfile('likes'), mine('likes')],
                ['★ ' + L.following, () => this.navigate({ kind: 'following', section: 'pins' }), s.kind === 'following'],
                ['⏱ ' + L.queue + ' (' + this.queue.length + ')', () => this.navigate({ kind: 'queue' }), s.kind === 'queue'],
                ['# ' + L.discover, () => this.navigate({ kind: 'discover' }), s.kind === 'discover'],
                ['🔍 ' + L.search_phone, () => this.openSearchPanel(), s.kind === 'search'],
                ['⌂ ' + L.home, () => this.goHome(), s.kind === 'home'],
                ['⚙ ' + L.settings, () => this.openSettings(), false],
            ];
            items.forEach(([label, fn, active], i) => {
                button(label, fn, i % 2 ? 0.25 : -0.25, 0.22 - Math.floor(i / 2) * 0.105, active);
            });
            button(L.logout, () => this.logout(), -0.25, -0.38);
            button(L.close, () => this.closeMenu(), 0.25, -0.38);
        } else {
            panel(textTexture(reason || L.login_with_phone, { width: 1300, height: 90, sizes: [50], align: 'center' }), 0, 0.42);
            const host = this.account.linkPageUrl.replace(/^https?:\/\//, '');
            panel(textTexture([L.login_step1.replace(':url', host), L.login_step2], { width: 760, height: 140, sizes: [34, 34], colors: [COLORS.textSoft, COLORS.textSoft] }), -0.3, 0.26);
            this.menu.codeMesh = panel(textTexture('— — — —', { width: 760, height: 150, sizes: [96], weights: [800], colors: [COLORS.text] }), -0.3, 0.08);
            this.menu.qrMesh = ui.add(new Mesh(new PlaneGeometry(0.42, 0.42), new MeshBasicMaterial({ color: 0xffffff })));
            this.menu.qrMesh.position.set(0.44, 0.14, 0.01);
            panel(textTexture(L.login_or_scan, { width: 560, height: 72, sizes: [34], align: 'center', colors: [COLORS.muted] }), 0.44, -0.12);
            this.menu.statusMesh = panel(textTexture(L.login_waiting, { width: 860, height: 76, sizes: [34], colors: [COLORS.accent] }), -0.34, -0.07);
            button(L.new_code, () => this.startLink(), -0.46, -0.33, false, 340);
            // Discover is on the top row already; guests get search here instead.
            button('🔍 ' + L.search, () => this.openSearchKeyboard(), 0, -0.33, false, 340);
            button(L.close, () => this.closeMenu(), 0.46, -0.33, false, 340);
            this.startLink();
        }
        this.showPanel(ui);
    }

    /**
     * Shared scaffolding for the floating panels (account, settings, phone search, save
     * to board): background, text panels, buttons. `returnTo` reopens that pin when the
     * panel closes, so saving from the viewer lands back in the viewer.
     */
    startPanel(kind, width, height, returnTo = null) {
        this.closePreview(false);
        this.closeMenu(false);
        const group = new Group();
        const disposables = [];
        const targets = [];
        const add = (mesh) => { group.add(mesh); return mesh; };
        const panel = (tex, x, y, scale = 0.8) => {
            disposables.push(tex.texture);
            const m = new Mesh(new PlaneGeometry(tex.w * scale, tex.h * scale), new MeshBasicMaterial({ map: tex.texture, transparent: true, depthWrite: false }));
            m.position.set(x, y, 0.01);
            m.renderOrder = 20;
            return add(m);
        };
        const button = (label, fn, x, y, active = false, width = 440) => {
            const t = buttonTexture(label, { active, width, height: 104 });
            const m = panel(t, x, y);
            m.userData = { onSelect: fn, hoverScale: 1.06, width, label };
            targets.push(m);
            return m;
        };
        add(new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ color: 0x141417, alphaMap: this.mask, alphaToCoverage: true })));
        this.menu = { kind, group, disposables, targets, poll: null, statusMesh: null, codeMesh: null, qrMesh: null, returnTo };
        return { group, add, panel, button };
    }

    showPanel(ui, pose = null) {
        this.scene.add(ui.group);
        if (pose) {
            ui.group.position.copy(pose.position);
            ui.group.quaternion.copy(pose.quaternion);
        } else {
            this.placeInFront(ui.group);
            // New panels ease in; ones rebuilt in place (keepPose: settings, keyboard) do not.
            this.appear(ui.group);
        }
        ui.group.visible = !this.hiddenAll;
        this.setWallVisible(false);
    }

    /** Comfort and slideshow settings; values change in place (`keepPose` keeps the panel still). */
    openSettings(keepPose = false) {
        const pose = keepPose && this.menu && this.menu.kind === 'settings'
            ? { position: this.menu.group.position.clone(), quaternion: this.menu.group.quaternion.clone() }
            : null;
        const returnTo = pose ? this.menu.returnTo : null;
        const L = this.strings;
        const st = this.settings;
        const natural = st.handMode === 'natural';
        const how = String(natural ? L.hand_natural_hint : L.quick_hide_hint).split(' · ');
        const howTex = textTexture(how, { width: 1800, height: 36 + how.length * 44, sizes: [34], colors: [COLORS.muted], align: 'center' });
        const howH = howTex.h * 0.8;
        const height = 1.64 + 0.34 + howH + (natural ? 0.13 : 0.02);
        const ui = this.startPanel('settings', 1.5, height, returnTo);
        const { panel, button } = ui;
        const text = (t, x, y, w = 560, color = COLORS.textSoft, align = 'left') => panel(textTexture(t, { width: w, height: 70, sizes: [32], colors: [color], align }), x, y);
        let y = height / 2 - 0.1;
        panel(textTexture('⚙ ' + L.settings, { width: 1100, height: 90, sizes: [50], align: 'center' }), 0, y);
        y -= 0.14;
        button('⟲ ' + L.recenter, () => { this.recenter(); this.closeMenu(); }, 0, y, true, 620);
        y -= 0.14;
        const row = (label, value, key, step) => {
            text(label, -0.36, y);
            button('−', () => this.changeSetting(key, -step), 0.14, y, false, 120);
            // 270 px with a small padding still fits between − and +, and holds "jusqu’à la fin".
            panel(textTexture(value, { width: 270, height: 70, sizes: [30], colors: [COLORS.text], align: 'center', padding: 8 }), 0.3, y);
            button('+', () => this.changeSetting(key, step), 0.46, y, false, 120);
            y -= 0.11;
        };
        const toggle = (label, on, key) => {
            text(label, -0.36, y);
            button(on ? L.debug_on : L.debug_off, () => this.changeSetting(key, 1), 0.3, y, on, 300);
            y -= 0.11;
        };
        const cm = (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + ' cm';
        row(L.height, cm(st.height), 'height', 0.05);
        row(L.distance, Math.round(st.distance * 100) + '%', 'distance', 0.1);
        row(L.curve, curveOf(st, this.view).toFixed(1) + ' m', 'curve', 1);
        row(L.rows, String(rowsOf(st, this.view)), 'rows', 1);
        row(L.slide_photo, L.seconds.replace(':n', String(st.slidePhoto)), 'slidePhoto', 1);
        row(L.slide_video, st.slideVideo ? L.seconds.replace(':n', String(st.slideVideo)) : L.video_to_end, 'slideVideo', 1);
        toggle('♪ ' + (L.sounds || 'Sounds'), !!st.sounds, 'sounds');
        toggle('🔊 ' + (L.spatial_audio || 'Sound from the picture'), st.spatialAudio !== false, 'spatialAudio');
        row(L.environment || 'Environment', L['env_' + st.environment] || st.environment, 'environment', 1);
        row(L.resume || 'Resume session', st.resumeHours ? (L.hours || ':n h').replace(':n', String(st.resumeHours)) : L.debug_off, 'resumeHours', 1);
        // Active hand: tap cycles Auto → Right → Left → Both.
        text(L.active_hand || 'Active hand', -0.36, y);
        button(L['active_hand_' + st.activeHand] || st.activeHand, () => this.changeSetting('activeHand', 1), 0.3, y, st.activeHand !== 'both', 300);
        y -= 0.11;
        // Hand controls: pinch (default) or natural gestures (point-and-hold, fist-drag).
        text(L.hand_mode, -0.36, y);
        button(L.hand_pinch, () => { if (natural) this.changeSetting('handMode', 1); }, 0.12, y, !natural, 300);
        button(L.hand_natural, () => { if (!natural) this.changeSetting('handMode', 1); }, 0.42, y, natural, 340);
        y -= 0.075 + howH / 2;
        panel(howTex, 0, y);
        y -= howH / 2 + 0.075;
        if (natural) toggle(L.hand_debug, !!st.handDebug, 'handDebug');
        y -= 0.02;
        button('↺ ' + L.reset_comfort, () => this.changeSetting('resetComfort', 0), 0, y, false, 620);
        y -= 0.12;
        button(L.close, () => this.closeMenu(), 0, y);
        this.showPanel(ui, pose);
    }

    /** Search typed in VR (anyone; signed-in users can also type on the phone). */
    openSearchKeyboard() {
        const L = this.strings;
        this.openKeyboard({
            title: '🔍 ' + L.search, maxLength: 100, submitLabel: L.search,
            onSubmit: (q) => this.navigate({ kind: 'search', q }),
        });
    }

    /**
     * A keyboard panel in VR (keyboard.js holds the layouts and editing). Only the text field
     * is redrawn per key; the keys are rebuilt when shift or the layout changes.
     */
    openKeyboard(opts, state = null, keepPose = false) {
        const pose = keepPose && this.menu && this.menu.kind === 'keyboard'
            ? { position: this.menu.group.position.clone(), quaternion: this.menu.group.quaternion.clone() }
            : null;
        const L = this.strings;
        const st = state || keyboardState({ capitalize: !!opts.capitalize, maxLength: opts.maxLength || 100, layout: this.settings.keyboardLayout });
        const ui = this.startPanel('keyboard', 1.5, 0.98, opts.returnTo || null);
        const { panel, button } = ui;
        this.keyboard = { opts, state: st, submitting: false };
        panel(textTexture(opts.title, { width: 1300, height: 80, sizes: [44], align: 'center' }), 0, 0.42);
        this.menu.fieldMesh = panel(this.keyboardField(st), 0, 0.31);
        keyboardRows(st).forEach((row, r) => row.forEach((ch, i) => {
            button(ch, () => this.keyboardKey(ch), (i - (row.length - 1) / 2) * 0.125, 0.18 - r * 0.1, false, 140);
        }));
        const y = -0.22;
        button(st.layout === 'latin' ? 'АБВ' : 'ABC', () => this.keyboardKey(KEY.LAYOUT), -0.56, y, false, 200);
        // Labels in glyphs every headset font has (⇧/⌫ are not guaranteed); the keys stay KEY.*.
        button('Aa', () => this.keyboardKey(KEY.SHIFT), -0.38, y, st.shift, 160);
        button(L.space || '␣', () => this.keyboardKey(KEY.SPACE), 0, y, false, 440);
        button('←', () => this.keyboardKey(KEY.BACKSPACE), 0.37, y, false, 200);
        // Saving / error line for the board name (setMenuStatus), between the keys and the actions.
        this.menu.statusMesh = panel(textTexture(' ', { width: 1100, height: 40, sizes: [28], colors: [COLORS.accent], align: 'center' }), 0, -0.29);
        button('✕ ' + L.cancel, () => this.keyboardKey(KEY.CANCEL), -0.3, -0.37, false, 440);
        button('✓ ' + (opts.submitLabel || L.search), () => this.keyboardKey(KEY.SUBMIT), 0.3, -0.37, true, 440);
        this.showPanel(ui, pose);
    }

    keyboardField(state) {
        return textTexture((state.text || '') + '▏', { width: 1300, height: 90, sizes: [46], colors: [COLORS.text], background: COLORS.surface, radius: 20, padding: 24 });
    }

    keyboardKey(key) {
        const kb = this.keyboard;
        if (!kb || !this.menu || this.menu.kind !== 'keyboard') return;
        // While a submit is in flight only Cancel works: no rebuild may replace the panel that
        // is waiting for the result (afterSave reports to that panel only).
        if (kb.submitting && key !== KEY.CANCEL) return;
        const prev = kb.state;
        const next = keyboardPress(prev, key);
        if (next.done === 'cancel') {
            this.closeMenu();
            return;
        }
        if (key === KEY.SUBMIT) {
            const min = kb.opts.minLength || 1;
            const verdict = canSubmit(next, { minLength: min, submitting: kb.submitting });
            if (verdict === 'too_short') this.setMenuStatus((this.strings.too_short || 'At least :n characters').replace(':n', String(min)));
            if (verdict !== 'ok') return;
            kb.submitting = true;
            kb.opts.onSubmit(next.text.trim());
            return;
        }
        kb.state = next;
        if (key === KEY.LAYOUT) {
            this.settings.keyboardLayout = next.layout;
            this.saveSettings();
        }
        // Keys change face with shift and layout; otherwise only the text field is redrawn.
        if (next.shift !== prev.shift || next.layout !== prev.layout) this.openKeyboard(kb.opts, next, true);
        else this.replacePanelText(this.menu.fieldMesh, this.keyboardField(next));
    }

    /** Search typed on the phone (signed-in users): QR to /s, then poll for the query. */
    openSearchPanel() {
        if (!this.authed) {
            // Phone search is tied to an account; typing in VR is not.
            this.openSearchKeyboard();
            return;
        }
        const ui = this.startPanel('search', 1.5, 0.95);
        const { panel, button } = ui;
        const L = this.strings;
        const host = this.account.phoneSearchUrl.replace(/^https?:\/\//, '');
        panel(textTexture('🔍 ' + L.search_phone, { width: 1300, height: 90, sizes: [50], align: 'center' }), 0, 0.36);
        panel(textTexture([L.search_step.replace(':url', host), L.search_step2], { width: 760, height: 150, sizes: [34, 34], colors: [COLORS.textSoft, COLORS.muted] }), -0.3, 0.16);
        this.menu.qrMesh = ui.add(new Mesh(new PlaneGeometry(0.42, 0.42), new MeshBasicMaterial({ color: 0xffffff })));
        this.menu.qrMesh.position.set(0.44, 0.06, 0.01);
        this.menu.statusMesh = panel(textTexture(L.search_waiting, { width: 860, height: 76, sizes: [34], colors: [COLORS.accent] }), -0.34, -0.04);
        button('⌨ ' + L.type_here, () => this.openSearchKeyboard(), -0.3, -0.34);
        button(L.close, () => this.closeMenu(), 0.3, -0.34);
        this.showPanel(ui);
        this.drawQr(this.account.phoneSearchUrl);
        const m = this.menu;
        const tick = () => {
            this.account.phoneSearchPoll()
                .then((q) => {
                    if (this.menu !== m) return;
                    if (q) this.navigate({ kind: 'search', q });
                    else m.poll = setTimeout(tick, 2000);
                })
                .catch(() => { if (this.menu === m) m.poll = setTimeout(tick, 4000); });
        };
        m.poll = setTimeout(tick, 1500);
    }

    /**
     * "Save to board": the user's boards (✓ where the pin already is) and new-board names
     * suggested from the pin (its board, its tags, "VR favourites") — no typing in VR.
     */
    openSavePanel(card) {
        // Only an account can sign in from here; without one the site answers for its own session.
        if (this.hasAccount && !this.authed) {
            this.signInFor('save', () => this.openSavePanel(card));
            return;
        }
        const ui = this.startPanel('save', 1.5, 1.12, card);
        const { panel, button } = ui;
        const L = this.strings;
        const { item } = card;
        panel(textTexture(['📌 ' + L.save_to_board, item.title || ' '], { width: 1300, height: 130, sizes: [46, 28], align: 'center', colors: [COLORS.text, COLORS.textSoft] }), 0, 0.44);
        this.menu.statusMesh = panel(textTexture(L.loading, { width: 1100, height: 70, sizes: [34], colors: [COLORS.accent], align: 'center' }), 0, 0.32);
        button('← ' + L.back_to_pin, () => this.closeMenu(), 0, -0.46, false, 520);
        this.showPanel(ui);
        const m = this.menu;
        this.adapter.targets('save', item)
            .then((boards) => {
                if (this.menu !== m) return;
                this.setMenuStatus(boards.length ? L.pick_board : L.no_boards_yet);
                boards.slice(0, 8).forEach((b, i) => {
                    const btn = button((b.selected ? '✓ ' : '▦ ') + b.label, () => this.saveTo(card, b), i % 2 ? 0.25 : -0.25, 0.2 - Math.floor(i / 2) * 0.1, b.selected);
                    btn.userData.board = b;
                });
                const existing = new Set(boards.map((b) => b.label.toLowerCase()));
                const names = [item.collection && item.collection.label, ...(item.tags || []).map((t) => t.charAt(0).toUpperCase() + t.slice(1)), L.vr_favorites]
                    .filter((n) => n && n.length >= 3 && !existing.has(n.toLowerCase()));
                const unique = [...new Set(names)].slice(0, 3);
                panel(textTexture(L.new_board, { width: 560, height: 66, sizes: [34], colors: [COLORS.muted], align: 'center' }), -0.3, -0.24);
                button('⌨ ' + L.other_name, () => this.openKeyboard({
                    title: '▦ ' + L.new_board, capitalize: true, maxLength: 60, minLength: 3,
                    submitLabel: L.create_and_save, returnTo: card,
                    // The status (saving / saved / error) shows on the keyboard panel; on success it closes back to the pin.
                    onSubmit: (name) => { this.setMenuStatus(L.loading); this.createBoardAndSave(card, name); },
                }), 0.3, -0.24, false, 420);
                if (unique.length) {
                    unique.forEach((name, i) => {
                        button('＋ ' + name, () => this.createBoardAndSave(card, name), (i - (unique.length - 1) / 2) * 0.46, -0.33, false, 420);
                    });
                }
            })
            .catch(() => this.setMenuStatus(L.error));
    }

    saveTo(card, board) {
        if (board.selected) return;
        const menu = this.menu; // the panel that sent it: only it shows the result and closes
        this.adapter.action('save', card.item, { target: board.id }).then((res) => {
            this.afterSave(card, res.ok, (res.state && res.state.target) || board.label, res.message, menu);
        }).catch(() => this.afterSave(card, false, null, null, menu));
    }

    createBoardAndSave(card, name) {
        const menu = this.menu;
        this.adapter.action('create-and-save', card.item, { name }).then((res) => {
            this.afterSave(card, res.ok, res.state && res.state.target, res.message, menu);
        }).catch(() => this.afterSave(card, false, null, null, menu));
    }

    afterSave(card, ok, boardName, message, menu = this.menu) {
        const L = this.strings;
        const text = ok ? L.saved_to.replace(':board', boardName || '') : (message || L.save_failed);
        const current = !!menu && this.menu === menu;
        if (current) this.setMenuStatus(text);
        this.announce(text);
        if (!ok && this.keyboard) this.keyboard.submitting = false;
        if (ok) {
            card.item._saved = true;
            setTimeout(() => { if (this.menu && this.menu === menu) this.closeMenu(); }, 1100);
        }
    }

    closeMenu(showWall = true) {
        if (!this.menu) return;
        const m = this.menu;
        // Closing the sign-in panel (before or after the phone approved) drops the pending
        // action; onSignedIn takes it off this.pendingSignIn before it closes the panel itself.
        if (m.kind === 'account') this.pendingSignIn = null;
        clearTimeout(m.poll);
        // A panel opened from the viewer (save to board) closes back into it.
        if (showWall && m.returnTo) {
            this.closeMenu(false);
            this.openPreview(m.returnTo);
            return;
        }
        this.scene.remove(m.group);
        m.group.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        m.disposables.forEach(disposeTexture);
        m.targets.forEach((o) => this.hovered.delete(o));
        this.menu = null;
        if (showWall) this.setWallVisible(true);
    }

    replacePanelText(mesh, tex) {
        const m = this.menu;
        const old = mesh.material.map;
        mesh.material.map = tex.texture;
        mesh.material.needsUpdate = true;
        mesh.geometry.dispose();
        mesh.geometry = new PlaneGeometry(tex.w * 0.8, tex.h * 0.8);
        const i = m.disposables.indexOf(old);
        if (i >= 0) m.disposables[i] = tex.texture;
        else m.disposables.push(tex.texture);
        disposeTexture(old);
    }

    setMenuStatus(text) {
        if (!this.menu || !this.menu.statusMesh) return;
        const wide = this.menu.kind === 'save' || this.menu.kind === 'keyboard';
        this.replacePanelText(this.menu.statusMesh, textTexture(text, { width: wide ? 1100 : 860, height: wide ? 70 : 76, sizes: [34], colors: [COLORS.accent], align: wide ? 'center' : 'left' }));
    }

    /** Asks the server for a fresh code, draws it with its QR, then polls every 2 s. */
    startLink() {
        const m = this.menu;
        if (!m) return;
        clearTimeout(m.poll);
        this.setMenuStatus(this.strings.login_waiting);
        this.account.linkStart().then((body) => {
            if (this.menu !== m) return;
            this.replacePanelText(m.codeMesh, textTexture(body.code, { width: 760, height: 150, sizes: [96], weights: [800], colors: [COLORS.text] }));
            this.announce(this.strings.login_step1.replace(':url', this.account.linkPageUrl) + ' · ' + body.code);
            this.drawQr(body.url);
            const tick = () => {
                this.account.linkPoll().then((r) => {
                    if (this.menu !== m) return;
                    if (r.status === 'approved') {
                        this.onSignedIn(r.user && r.user.name, r.user && r.user.id);
                    } else if (r.status === 'pending') {
                        m.poll = setTimeout(tick, 2000);
                    } else {
                        this.setMenuStatus(this.strings.login_expired);
                    }
                }).catch(() => { if (this.menu === m) m.poll = setTimeout(tick, 4000); });
            };
            m.poll = setTimeout(tick, 2000);
        }).catch(() => this.setMenuStatus(this.strings.login_error));
    }

    async drawQr(url) {
        const m = this.menu;
        try {
            const { toCanvas } = await import('qrcode');
            const canvas = document.createElement('canvas');
            await toCanvas(canvas, url, { width: 512, margin: 2, errorCorrectionLevel: 'M', color: { dark: COLORS.bg, light: '#ffffff' } });
            if (this.menu !== m) return;
            const tex = new CanvasTexture(canvas);
            tex.colorSpace = SRGBColorSpace;
            const old = m.qrMesh.material.map;
            m.qrMesh.material.map = tex;
            m.qrMesh.material.needsUpdate = true;
            m.disposables.push(tex);
            disposeTexture(old);
        } catch (e) {
            // The typed URL + code still work without the QR.
        }
    }

    onSignedIn(name, id) {
        this.authed = true;
        this.userName = name || this.userName;
        this.userId = id || this.userId;
        this.setMenuStatus(this.strings.logged_in_as.replace(':name', this.userName || ''));
        this.announce(this.strings.logged_in_as.replace(':name', this.userName || ''));
        this.refreshUserButton();
        this.onAuthChange({ authed: true, name: this.userName });
        const pending = this.pendingSignIn;
        if (pending) {
            // Signed in to like / save / follow: do it, back where the guest was.
            this.track('xr_signin_done', { props: { name: pending.reason, surface: 'gallery' } });
            setTimeout(() => {
                // Gone if the user moved on meanwhile (closed the panel, opened another scope).
                if (this.pendingSignIn !== pending) return;
                this.pendingSignIn = null;
                this.closeMenu(!pending.card);
                if (pending.card) this.openPreview(pending.card);
                pending.action();
            }, 1200);
            return;
        }
        // Reopen as the account menu: its buttons (my pins, boards, liked…) are what comes next.
        setTimeout(() => { if (this.menu) this.openMenu(); }, 1500);
    }

    logout() {
        // The next person on this headset must not land in this account's wall.
        this.leaving = true;
        const storage = this.storage();
        if (storage) clearResume(storage, this.storageKeys.resume);
        this.account.logout().finally(() => {
            const session = this.renderer.xr.getSession();
            const reload = () => window.location.reload();
            this.exitBy = 'app';
            if (session) session.end().then(reload, reload);
            else reload();
        });
    }

    // ----------------------------------------------------------------- loop

    layoutWall() {
        const n = this.cards.length;
        const keep = visibleItems(this.scroll, n, 2);
        const show = visibleItems(this.scroll, n, 0);
        const centreCol = this.scroll / COL_ANGLE;
        this.visibleImages = [];
        this.cards.forEach((card, i) => {
            const inScene = i >= keep.first && i <= keep.last;
            if (!inScene) {
                if (card.group && card.group.parent) this.wall.remove(card.group);
                if (card.group && Math.abs(columnOf(i) - centreCol) > RELEASE_COLUMNS) this.releaseMeshes(card);
                return;
            }
            this.ensureMeshes(card);
            if (!card.group.parent) this.wall.add(card.group);
            const t = itemTransform(i, this.scroll);
            card.group.position.set(t.x, t.y, t.z);
            card.group.rotation.set(0, t.rotationY, 0);
            const s = wallZoom * (this.hovered.has(card.image) ? card.image.userData.hoverScale : 1);
            card.group.scale.set(s, s, 1);
            // Beyond the arc the wall fades into the fog; only on-arc cards are pickable.
            if (i >= show.first && i <= show.last && Math.abs(t.angle) < Math.PI * 0.42) this.visibleImages.push(card.image);
        });
        const p = scrollProgress(this.scroll, n);
        this.progressThumb.position.x = (p - 0.5) * (1.4 - 0.18);
        this.scheduleTextures(visibleItems(this.scroll, n, 1));
        if (nearEnd(this.scroll, n)) this.loadMore();
    }

    /** Hover per pointer: each controller (plus the mouse or keyboard focus) gets its own label. */
    updateHover() {
        const rays = [null, null, null];
        const targets = this.targets();
        if (this.presenting) {
            this.controllers.forEach((c, i) => {
                const reticle = c.userData.reticle;
                if (!c.userData.inputSource || !this.handActive(c)) {
                    reticle.visible = false;
                    return;
                }
                this.raycaster.setFromXRController(c);
                const hit = this.raycaster.intersectObjects(targets, false)[0];
                c.userData.line.scale.z = hit ? hit.distance : 3;
                reticle.visible = !!hit;
                if (hit) {
                    reticle.position.copy(hit.point).addScaledVector(this.raycaster.ray.direction, -0.01);
                    reticle.lookAt(this.raycaster.ray.origin);
                }
                rays[i] = hit ? { object: hit.object, controller: c, hit } : null;
            });
        } else if (!this.drag) {
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const hit = this.pickHit(this.raycaster);
            const object = hit ? hit.object : null;
            rays[0] = object ? { object, hit } : null;
            this.renderer.domElement.style.cursor = object ? 'pointer' : 'grab';
            const focused = this.cards[this.focusIndex];
            if (!this.preview && focused && focused.image && !object) rays[2] = { object: focused.image };
        }

        const now = new Set(rays.filter(Boolean).map((r) => r.object));
        for (const obj of this.hovered) if (!now.has(obj)) this.setHover(obj, false);
        rays.forEach((r) => {
            if (r && !this.hovered.has(r.object)) {
                this.setHover(r.object, true);
                if (r.controller) this.pulse(r.controller, 0.15, 12);
            }
        });
        rays.forEach((r, i) => this.showHoverLabel(i, r && r.object.userData.card));
        if (this.preview) {
            const onBar = rays.find((r) => r && r.object === this.preview.progressHit);
            this.updateTimeline(onBar ? onBar.hit : null);
        }
        const pointed = rays.find((r) => r && r.object.userData.card);
        this.updateHoverPlay(pointed ? pointed.object.userData.card : null);
    }

    /**
     * A GIF or video card pointed at for profile.hoverPlayDelay starts playing silently in
     * place; one at a time, stopped as soon as the pointer leaves.
     */
    updateHoverPlay(card) {
        // Files only: an HLS/DASH card keeps its poster (no stream player per pointed card).
        const src = card && !this.preview && !this.menu ? hoverSource(card.item) : null;
        const playable = !!src;
        const hp = this.hoverPlay;
        if (hp && hp.card !== (playable ? card : null)) this.stopHoverPlay();
        if (!playable) return;
        const now = performance.now() / 1000;
        if (!this.hoverPlay) {
            this.hoverPlay = { card, since: now, video: null, texture: null };
            return;
        }
        if (this.hoverPlay.video || now - this.hoverPlay.since < this.profile.hoverPlayDelay) return;
        const state = this.hoverPlay;
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'auto';
        state.video = video;
        this.trackVideo(video);
        video.addEventListener('loadeddata', () => {
            if (this.hoverPlay !== state || !card.image) return;
            state.texture = new VideoTexture(video);
            state.texture.colorSpace = SRGBColorSpace;
            card.image.material.map = state.texture;
            card.image.material.needsUpdate = true;
        }, { once: true });
        video.addEventListener('error', () => { if (this.hoverPlay === state) state.failed = true; }, { once: true });
        video.src = this.textureUrl(src);
        video.play().catch(() => {});
    }

    stopHoverPlay() {
        const hp = this.hoverPlay;
        if (!hp) return;
        this.hoverPlay = null;
        if (hp.video) {
            hp.video.pause();
            hp.video.removeAttribute('src');
            hp.video.load();
        }
        if (hp.texture) {
            if (hp.card.image && hp.card.image.material.map === hp.texture) {
                hp.card.image.material.map = this.textures.get(hp.card.item.id) || this.placeholder;
                hp.card.image.material.needsUpdate = true;
            }
            hp.texture.dispose();
        }
    }

    setHover(obj, on) {
        if (on) this.hovered.add(obj);
        else this.hovered.delete(obj);
        // The timeline's hit area is stretched to the picture width; hover must not rescale it.
        if (obj.userData.timeline) return;
        const card = obj.userData.card;
        const target = card ? card.group : obj;
        if (!target) return;
        const s = (on ? (obj.userData.hoverScale || 1.05) : 1) * (card ? wallZoom : 1);
        target.scale.set(s, s, 1);
        if (card && card.frame) card.frame.material.color.copy(on ? ACCENT : FRAME);
    }

    labelFor(card) {
        let label = this.labelCache.get(card.item.id);
        const w = this.view.wall;
        if (!label && (this.hooks.cardLabel || w.labelFields.join() !== 'title,creator,count')) {
            let lines = cardLabelLines(card.item, w.labelFields, this.view.panel.metaLabels, this.strings.pins_count || ':n');
            if (this.hooks.cardLabel) {
                const out = this.hooks.cardLabel(card.item, [...lines]);
                if (Array.isArray(out)) lines = out.filter((l) => typeof l === 'string').slice(0, 3);
            }
            label = textTexture(lines.length ? lines : [' '], { width: 640, height: 60 + 36 * Math.max(1, lines.length), sizes: [40, 30, 30], background: panelBg(0.9), radius: 26 });
            this.labelCache.set(card.item.id, label);
        }
        if (!label) {
            const board = card.item.kind === 'collection' || card.item.kind === 'tag';
            const second = [creatorName(card.item.creator) || null, board ? (this.strings.pins_count || ':n').replace(':n', String(card.item.count || 0)) : null].filter(Boolean).join(' · ');
            label = textTexture([card.item.title || ' ', second || null], {
                width: 640, height: 132, sizes: [40, 30], background: panelBg(0.9), radius: 26,
            });
            this.labelCache.set(card.item.id, label);
        }
        return label;
    }

    showHoverLabel(i, card) {
        const mesh = this.hoverLabels[i];
        if (!card || !card.group || this.preview || this.menu || this.view.wall.label === 'none') {
            mesh.visible = false;
            return;
        }
        const t = this.labelFor(card);
        if (mesh.material.map !== t.texture) {
            mesh.material.map = t.texture;
            mesh.material.needsUpdate = true;
        }
        mesh.scale.set(t.w, t.h, 1);
        const p = card.group.position.clone().multiplyScalar(0.95);
        // Under the card, except on the bottom row, where the navigation band sits below it.
        const edge = (card.h * wallZoom) / 2 + 0.05;
        mesh.position.set(p.x, p.y + this.wall.position.y + (rowOf(card.index) === ROWS - 1 ? edge : -edge), p.z);
        mesh.rotation.copy(card.group.rotation);
        mesh.visible = true;
    }

    /**
     * One frame. A throw inside the update must not skip the render: in the headset a frame
     * with nothing drawn is an empty room, and a bug that throws every frame looked like a crash.
     */
    tick() {
        try {
            this.frame();
        } catch (e) {
            this.reportError('tick', e);
            try {
                this.renderer.render(this.scene, this.camera);
            } catch (e2) {
                this.reportError('render', e2);
            }
        }
    }

    /** Sends each distinct runtime error once (at most MAX_ERROR_REPORTS per page). */
    reportError(name, e) {
        const message = String((e && e.message) || e).slice(0, 120);
        this.errorsSent = this.errorsSent || new Set();
        if (this.errorsSent.has(name + message) || this.errorsSent.size >= MAX_ERROR_REPORTS) return;
        this.errorsSent.add(name + message);
        const where = String((e && e.stack) || '').split('\n').slice(1, 3).map((l) => l.trim()).join(' | ').slice(0, 190);
        this.track('xr_error', { props: { name, message, where, surface: 'gallery' } });
        console.error(e);
    }

    frame() {
        const dt = Math.min(0.05, this.clock.getDelta());
        if (this.appearing.length) this.stepAppear();
        if (this.preview && this.preview.media && this.preview.media.audio) this.placeAudio(this.preview.media);
        this.updateImmersive();
        if (this.frameStats && this.presenting) {
            const now = performance.now();
            this.frameStats.tick(now);
            if (now - this.perfSentAt >= PERF_INTERVAL_MS) this.sendPerf();
        }
        this.updateActiveHands();
        this.readControllers(dt);
        this.updateWallZoom(dt);
        if (this.alignPending && this.presenting) this.alignToHead();

        this.maybeShowHandIntro();
        this.updateNaturalHands(dt);
        this.placeHandDebug();
        this.placeHiddenHint();
        if (this.scrub) this.updateScrub();
        this.checkEmptyHold();
        if (this.exitConfirmUntil && performance.now() > this.exitConfirmUntil) this.setExitButton(false);
        for (const press of this.presses.values()) this.dragTick(press, dt);
        if (this.grab) this.dragTick(this.grab, dt);
        const dragging = this.grab || [...this.presses.values()].some((p) => p.moved);

        if (!dragging && this.velocity !== 0 && !this.drag) {
            const next = stepInertia(this.scroll, this.velocity, dt, this.cards.length);
            this.dirty = this.dirty || next.scroll !== this.scroll;
            this.scroll = next.scroll;
            this.velocity = next.velocity;
        }

        if (this.dirty) {
            this.dirty = false;
            this.layoutWall();
        } else if (this.loadsInFlight < MAX_PARALLEL_LOADS) {
            this.scheduleTextures(visibleItems(this.scroll, this.cards.length, 1));
        }
        this.updateViewer(dt);
        this.updateSlideshow(dt);
        this.updateHover();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Centre the wall on the viewer's real eye height once the headset reports a pose,
     * so a seated user is not craning up at the top row (and a tall one not down).
     */
    alignToHead() {
        if (!this.recenter()) return; // no pose yet
        this.alignPending = false;
    }

    /**
     * "Centre in front of me": the wall turns to where the user looks, its axis moves to
     * the head and its middle row to eye level (plus the user's height preference).
     */
    recenter() {
        if (!this.presenting) return false;
        const cam = this.renderer.xr.getCamera();
        const head = new Vector3();
        cam.getWorldPosition(head);
        if (head.y <= 0.3) return false;
        const dir = new Vector3();
        cam.getWorldDirection(dir);
        this.comfortPose = {
            yaw: Math.atan2(-dir.x, -dir.z),
            x: head.x,
            z: head.z,
            eyeOffset: Math.min(0.45, Math.max(-0.6, head.y - EYE_Y)),
        };
        this.applyComfort();
        return true;
    }

    /** Places the world group from the head pose and the saved height/distance settings. */
    applyComfort() {
        const pose = this.presenting ? this.comfortPose : null;
        const s = this.settings;
        const h = pose ? pose.eyeOffset + s.height : 0;
        const d = pose ? s.distance : 1;
        this.wall.position.y = h;
        this.chrome.position.y = h;
        this.world.rotation.set(0, pose ? pose.yaw : 0, 0);
        this.world.scale.setScalar(d);
        // Scale about the eye so a nearer/farther wall keeps its middle row at eye level.
        this.world.position.set(pose ? pose.x : 0, (EYE_Y + h) * (1 - d), pose ? pose.z : 0);
        this.dirty = true;
    }

    setHeightOffset(dy) {
        // Leaving VR: back to the page layout.
        if (dy === 0) this.comfortPose = null;
        this.applyComfort();
    }

    // -------------------------------------------------------------- settings

    loadSettings() {
        const defaults = { height: 0, distance: 1, slidePhoto: 8, slideVideo: 0, handMode: 'pinch', activeHand: 'auto', handDebug: false, sounds: true, handIntroSeen: false, controllerIntroSeen: false, resumeHours: 24, spatialAudio: true, environment: this.environments.site ? 'site' : 'studio', curve: null, rows: null };
        try {
            const saved = JSON.parse(localStorage.getItem(this.storageKeys.settings) || '{}');
            const s = saved && typeof saved === 'object' ? { ...saved } : {};
            // Every save stores the whole object, so a saved 'studio' is usually the old default, not a
            // choice: it must not hide the site's environment. A choice made in settings is flagged.
            if (this.environments.site && s.environment === 'studio' && !s.environmentChosen) delete s.environment;
            return { ...defaults, ...s };
        } catch (e) {
            return defaults;
        }
    }

    saveSettings() {
        try {
            localStorage.setItem(this.storageKeys.settings, JSON.stringify(this.settings));
        } catch (e) {
            // private mode: settings last for this visit only
        }
    }

    changeSetting(key, delta) {
        const s = this.settings;
        if (key === 'height') s.height = Math.round(Math.min(0.4, Math.max(-0.4, s.height + delta)) * 100) / 100;
        if (key === 'distance') s.distance = Math.round(Math.min(1.5, Math.max(0.7, s.distance + delta)) * 10) / 10;
        if (key === 'curve' || key === 'rows' || key === 'resetComfort') {
            if (key === 'curve') s.curve = stepCurve(s, this.view, delta);
            else if (key === 'rows') s.rows = stepRows(s, this.view, delta);
            else { s.curve = null; s.rows = null; }
            this.applyShape();
        }
        if (key === 'slidePhoto') s.slidePhoto = cycle(SLIDE_PHOTO_STEPS, s.slidePhoto, delta);
        if (key === 'slideVideo') s.slideVideo = cycle(SLIDE_VIDEO_STEPS, s.slideVideo, delta);
        if (key === 'handDebug') s.handDebug = !s.handDebug;
        if (key === 'sounds') s.sounds = !s.sounds;
        if (key === 'spatialAudio') s.spatialAudio = !s.spatialAudio;
        if (key === 'environment') {
            s.environment = cycle(this.environmentSteps, s.environment, delta);
            s.environmentChosen = true;
            this.applyEnvironment();
        }
        if (key === 'resumeHours') {
            s.resumeHours = cycle(RESUME_HOURS_STEPS, s.resumeHours, delta);
            const storage = this.storage();
            if (!s.resumeHours && storage) clearResume(storage, this.storageKeys.resume);
        }
        if (key === 'activeHand') s.activeHand = ACTIVE_HAND_STEPS[(ACTIVE_HAND_STEPS.indexOf(s.activeHand) + 1) % ACTIVE_HAND_STEPS.length];
        if (key === 'handMode') this.setHandMode(s.handMode === 'natural' ? 'pinch' : 'natural');
        this.saveSettings();
        this.applyComfort();
        this.openSettings(true);
    }

    setHandMode(mode) {
        if (this.settings.handMode === mode) return;
        this.settings.handMode = mode;
        // Drop any half-finished hand press/scrub/dwell from the other mode; its end event
        // would be ignored by the new mode, leaving it stuck. Controllers are not affected.
        if (this.scrub && this.isHand(this.scrub.controller)) this.scrub = null;
        this.controllers.forEach((c) => {
            if (this.isHand(c)) this.presses.delete(c);
            if (c.userData.natural) this.resetDwell(c, c.userData.natural);
            c.userData.natural = null;
        });
        this.applyScopeChrome();
    }

    /**
     * One-time card the first time tracked hands appear in a headset: the three main
     * gestures of the current hand mode, a mode switch and "Got it". Waits until no
     * panel or pin is open; controller-only users never see it.
     */
    /** First time hands — or controllers — show up in VR: a short, skippable how-to. */
    maybeShowHandIntro() {
        if (!this.presenting || this.alignPending) return;
        if (this.menu || this.preview || this.hiddenAll) return;
        const intro = introToShow(this.controllers, this.settings, (c) => this.isHand(c));
        if (intro === 'hands') {
            this.settings.handIntroSeen = true;
            this.saveSettings();
            this.openHandIntro();
            this.track('xr_intro', { props: { name: 'hands', by: 'shown', surface: 'gallery' } });
        } else if (intro === 'controllers') {
            this.settings.controllerIntroSeen = true;
            this.saveSettings();
            this.openControllerIntro();
            this.track('xr_intro', { props: { name: 'controllers', by: 'shown', surface: 'gallery' } });
        }
    }

    openControllerIntro() {
        const L = this.strings;
        const steps = String(L.controller_intro || '').split(' · ').slice(0, 8);
        // Text is 0.8 mm per texture pixel (panel() scale); the panel grows with the list.
        const stepsH = (40 + steps.length * 52) * 0.0008;
        const height = 0.46 + stepsH;
        const top = height / 2;
        const ui = this.startPanel('controllers', 1.5, height);
        const { panel, button } = ui;
        panel(textTexture('🎮 ' + (L.controller_intro_title || 'Using the controllers'), { width: 1300, height: 90, sizes: [50], align: 'center' }), 0, top - 0.1);
        panel(textTexture(steps, { width: 1800, height: 40 + steps.length * 52, sizes: [40], weights: [600], colors: [COLORS.text], align: 'center' }), 0, top - 0.2 - stepsH / 2);
        button(L.got_it || 'Got it', () => {
            this.track('xr_intro', { props: { name: 'controllers', by: 'got_it', surface: 'gallery' } });
            this.closeMenu();
        }, 0, top - 0.2 - stepsH - 0.13, true, 440);
        this.showPanel(ui);
    }

    openHandIntro(keepPose = false) {
        const pose = keepPose && this.menu && this.menu.kind === 'hands'
            ? { position: this.menu.group.position.clone(), quaternion: this.menu.group.quaternion.clone() }
            : null;
        const L = this.strings;
        const natural = this.settings.handMode === 'natural';
        const steps = String(natural ? L.hint_natural : L.hint).split(' · ').slice(0, 3);
        const ui = this.startPanel('hands', 1.5, 0.98);
        const { panel, button } = ui;
        panel(textTexture('✋ ' + (L.hand_intro_title || 'Using your hands'), { width: 1300, height: 90, sizes: [50], align: 'center' }), 0, 0.38);
        panel(textTexture(steps, { width: 1800, height: 40 + steps.length * 52, sizes: [40], weights: [600], colors: [COLORS.text], align: 'center' }), 0, 0.17);
        panel(textTexture(L.hand_mode, { width: 560, height: 70, sizes: [34], colors: [COLORS.textSoft], align: 'center' }), 0, -0.04);
        const pick = (mode) => () => {
            this.setHandMode(mode);
            this.saveSettings();
            this.openHandIntro(true);
        };
        button(L.hand_pinch, pick('pinch'), -0.2, -0.15, !natural, 340);
        button(L.hand_natural, pick('natural'), 0.2, -0.15, natural, 340);
        button(L.got_it || 'Got it', () => {
            this.track('xr_intro', { props: { name: 'hands', by: 'got_it', surface: 'gallery' } });
            this.closeMenu();
        }, 0, -0.34, true, 440);
        this.showPanel(ui, pose);
    }

    // ------------------------------------------------------------ quick hide

    /**
     * Instantly swaps the scene for an empty room (both grips held, or H) and pauses any
     * video; the same gesture brings everything back as it was.
     */
    toggleHidden(source = 'key') {
        this.hiddenAll = !this.hiddenAll;
        this.hiddenAt = performance.now() / 1000;
        this.track('xr_hide', { props: { state: this.hiddenAll ? 'hidden' : 'shown', source, mode: this.settings.handMode || 'pinch', surface: 'gallery' } });
        const media = this.preview && this.preview.media;
        if (this.hiddenAll) {
            this.resumeAfterHide = !!(media && !media.video.paused);
            if (media) media.video.pause();
            this.stopHoverPlay();
        } else if (media && this.resumeAfterHide) {
            media.video.play().catch(() => {});
        }
        this.world.visible = !this.hiddenAll && !this.preview && !this.menu;
        if (this.preview) this.preview.group.visible = !this.hiddenAll;
        // A 360°/180° sphere is its own scene object: the empty room hides it too.
        if (media && media.immersive) media.immersive.group.visible = !this.hiddenAll;
        if (this.menu) this.menu.group.visible = !this.hiddenAll;
        this.hoverLabels.forEach((l) => { l.visible = false; });
        this.hovered.forEach((o) => this.setHover(o, false));
        this.announce(this.hiddenAll ? this.hiddenHintText() : '');
        if (this.hiddenAll) this.drawHiddenHint();
    }

    hiddenHintText() {
        return this.presenting && this.settings.handMode === 'natural' ? this.strings.hidden_hint_natural : this.strings.hidden_hint;
    }

    /**
     * An empty room with no way back looks like a crash, so while everything is hidden a small
     * hint low in front of the head says how to bring it back; it dims after a few seconds.
     */
    drawHiddenHint() {
        if (!this.hiddenHint) {
            this.hiddenHint = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
            this.hiddenHint.renderOrder = 60;
            this.scene.add(this.hiddenHint);
        }
        const text = this.hiddenHintText();
        const cut = text.indexOf('. ');
        const lines = cut > 0 ? [text.slice(0, cut + 1), text.slice(cut + 2)] : [text];
        const t = textTexture(lines, { width: 1200, height: 130, align: 'center', sizes: [34, 30], background: panelBg(0.8), radius: 28 });
        disposeTexture(this.hiddenHint.material.map);
        this.hiddenHint.material.map = t.texture;
        this.hiddenHint.material.needsUpdate = true;
        this.hiddenHint.scale.set(t.w * 0.4, t.h * 0.4, 1);
    }

    placeHiddenHint() {
        const m = this.hiddenHint;
        if (!m) return;
        m.visible = !!this.hiddenAll && this.presenting;
        if (!m.visible) return;
        m.material.opacity = performance.now() / 1000 - this.hiddenAt < HIDDEN_HINT_BRIGHT ? 1 : 0.35;
        const cam = this.renderer.xr.getCamera();
        const pos = cam.getWorldPosition(new Vector3());
        const dir = cam.getWorldDirection(new Vector3());
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
        dir.normalize();
        m.position.set(pos.x + dir.x * 0.9, pos.y - 0.38, pos.z + dir.z * 0.9);
        m.lookAt(pos.x, pos.y - 0.38, pos.z);
    }

    mediaState(media) {
        const { video, source, immersive } = media;
        const d = video.duration;
        return {
            playing: !video.paused,
            failed: media.failed,
            gif: media.isGif,
            time: Number(video.currentTime.toFixed(1)),
            duration: Number.isFinite(d) ? Number((d || 0).toFixed(1)) : d === Infinity ? -1 : 0,
            kind: source ? source.kind : 'gif',
            levels: source ? source.levels().map((l) => l.height) : [],
            level: source ? source.level() : null,
            live: this.isLive(media),
            ignoredErrors: source && source.ignoredErrors ? [...source.ignoredErrors] : [],
            height: video.videoHeight,
            immersive: immersive ? { meshes: immersive.meshes.map((m) => m.layers.mask), cameraLayer1: this.camera.layers.isEnabled(1) } : null,
        };
    }

    /**
     * Video diagnostics for the harness. state() keeps its fixed set of top-level keys (P-18); its `media`
     * entry carries the player fields (kind, levels, live, …) too. Everything else about video is here.
     */
    videoState() {
        const p = this.preview;
        return {
            media: p && p.media ? this.mediaState(p.media) : null,
            immersive: !!(p && p.immersive),
            panelShown: !!(p && p.controls.visible),
            environment: this.environment.visible,
            wallVisible: this.world.visible,
            embed: this.embed ? this.embed.iframe.src : null,
            streams: activeStreams(),
            // A source left on an element: a src attribute, a stream object, or a resource still idle/loading
            // (right after load() without a source the state is NO_SOURCE, then EMPTY; currentSrc is kept by Chrome).
            videosWithSource: this.recentVideos.filter((v) => v.getAttribute('src') || v.srcObject || v.networkState === 1 || v.networkState === 2).length,
            videos: this.recentVideos.map((v) => ({ src: v.getAttribute('src'), currentSrc: v.currentSrc, network: v.networkState })),
            qualityLabel: p && p.qualityBtn.visible ? p.qualityBtn.userData.label : null,
            timeText: p ? p.timeTextValue : '',
        };
    }

    /** Debug/QA snapshot (also used by the harness). */
    state() {
        return {
            cards: this.cards.length,
            inScene: this.wall.children.length,
            withMeshes: this.cards.filter((c) => c.group).length,
            textures: this.textures.size,
            ready: this.cards.filter((c) => c.state === 'ready').length,
            errors: this.cards.filter((c) => c.state === 'error').length,
            scroll: Number(this.scroll.toFixed(3)),
            preview: this.preview ? this.preview.card.item.id : null,
            zoom: this.preview ? Number(this.preview.zoom.toFixed(2)) : null,
            wallVisible: this.world.visible,
            wallZoom: Number(wallZoom.toFixed(2)),
            focus: this.focusIndex,
            focusMode: !!(this.preview && this.preview.focus),
            prefetched: [...this.prefetched.keys()],
            handMode: this.settings.handMode,
            activeHand: this.settings.activeHand,
            active: this.controllers.map((c) => c.userData.active !== false),
            natural: this.controllers.map((c) => (c.userData.natural ? { fist: c.userData.natural.fist, dwell: Number(c.userData.natural.dwellT.toFixed(2)), fired: c.userData.natural.fired } : null)),
            slideProgress: this.slideFraction() === null ? null : Number(this.slideFraction().toFixed(2)),
            filters: { ...this.filters },
            menu: this.menu ? (this.menu.kind === 'account' ? (this.authed ? 'account' : 'login') : this.menu.kind) : null,
            hidden: this.hiddenAll,
            slideshow: this.slideshow,
            cinema: !!(this.preview && this.preview.cinema),
            queue: this.queue.length,
            settings: { ...this.settings },
            hoverPlaying: this.hoverPlay && this.hoverPlay.texture ? this.hoverPlay.card.item.id : null,
            authed: this.authed,
            media: this.preview && this.preview.media ? this.mediaState(this.preview.media) : null,
            scope: { ...this.scope },
            stack: this.scopeStack.length,
            context: this.preview ? this.preview.sideTargets.length : 0,
            strip: this.preview ? this.preview.stripTargets.length : 0,
            scrubbing: !!this.scrub,
            presenting: this.presenting,
        };
    }
}
