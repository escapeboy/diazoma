/** The contract between the wall and everything that feeds it. */

export type CardKind = 'item' | 'collection' | 'tag';

export interface Item {
    id: string;
    link: string;
    /** Absent on a text card, which the wall draws itself from `title` and the fields below. */
    image?: string;
    /** Required with `image`; a text card may omit it (the wall then uses 0.75). */
    aspect?: number;
    title?: string;
    subtitle?: string;
    image_focus?: string;
    image_full?: string;
    /** mp4/webm file, HLS `.m3u8` or DASH `.mpd`: the default source. */
    video?: string;
    /** Absent: from the path (`.m3u8` → hls, `.mpd` → dash, else file). */
    video_type?: VideoType;
    /** Alternative renditions (at most 8): files at several heights, or AV1 and H.264 streams. */
    video_sources?: VideoSource[];
    /** Seconds; drawn on the card as m:ss. */
    duration?: number;
    projection?: 'flat' | 'equirect180' | 'equirect360';
    stereo?: 'mono' | 'sbs' | 'tb';
    badges?: string[];
    blurhash?: string;
    meta?: Record<string, string>;
    // Optional extensions found in the shipped scene.
    kind?: CardKind;
    media_type?: 'photo' | 'gif' | 'video';
    /** A video the wall cannot play itself; `embed` (YouTube/Vimeo embed URL on the allowlist) plays in an overlay outside VR. */
    unplayable?: { provider: string; embed?: string };
    creator?: { id: string; label: string };
    collection?: { id: string; label: string; following?: boolean };
    tags?: string[];
    count?: number;
    width?: number;
    height?: number;
    /** The viewer's state per action (`liked`, `in_cart`, …) and counts; set by the feed and by action results. */
    state?: { liked?: boolean; [key: string]: boolean | number | string | undefined };
    /** Narrows the site's actions for this item; absent means all of them. */
    actions?: string[];
    likes?: number;
    description?: string;
    tag?: string;
    /** Plain text, up to 500 characters, drawn on a text card; the viewer shows it when `description` is absent. */
    excerpt?: string;
    /** ISO 8601 date or date-time, drawn small on the card. */
    date?: string;
    /** `#rgb` or `#rrggbb`: colour of the text card's top band. */
    accent?: string;
}

export type VideoType = 'file' | 'hls' | 'dash';

/** A stream library source for `videoLibs`: script URL, loader function, or false (never load). */
export type VideoLib = string | false | (() => Promise<unknown>);

export interface VideoSource {
    src: string;
    type?: VideoType;
    /** Pixels; renditions without it are used only when none is sized. */
    height?: number;
    /** RFC 6381 codecs, e.g. `avc1.640028` or `av01.0.08M.08`. */
    codecs?: string;
    bitrate?: number;
}

export interface Filter {
    key: string;
    values: { value: string; label?: string }[];
}

export type ActionId = 'like' | 'follow' | 'save' | 'create-and-save' | (string & {});

/** Scope kinds keep the shipped names: saved places in users' storage use them. */
export type Scope = {
    kind: 'home' | 'user' | 'following' | 'board' | 'tag' | 'related' | 'discover' | 'search' | 'queue';
    [k: string]: unknown;
};

export interface Capabilities {
    search: boolean;
    filters: Filter[];
    actions: ActionId[];
    projections?: string[];
    /** Actions that open a page of the site instead of sending a request (manifest `mode: deeplink`). */
    links?: ActionId[];
    /** Which scopes the site has; absent means home, search and queue. */
    scopes?: Partial<Record<Scope['kind'], { sections?: string[] }>>;
}

export interface FeedRequest {
    cursor?: string;
    query?: string;
    filter?: Record<string, string>;
    scope?: Scope;
}

export interface FeedAdapter {
    /** Site key: storage namespace and the `adapter` field of telemetry. */
    id: string;
    capabilities(): Capabilities;
    page(req: FeedRequest): Promise<{ items: Item[]; next?: string }>;
    action?(id: ActionId, item: Item, args?: Record<string, unknown>): Promise<ActionResult>;
    targets?(id: ActionId, item: Item): Promise<{ id: string; label: string; selected?: boolean }[]>;
    resolveMedia?(item: Item, want: 'thumb' | 'focus' | 'full' | 'video'): Promise<string | undefined>;
    /** How the site wants the wall to look (manifest, recipe or page `view`). `new Wall({ view })` wins over it. */
    view?: ViewConfig;
    /** The site's sign-in page, offered when an action answers "not signed in". */
    login?: string;
}

/** How one action's button looks. Transport (URL, method, auth) stays in the adapter. */
export interface ActionView {
    label?: string;
    /** Label while the action's state is on (liked, in the cart, …). */
    labelActive?: string;
    /** One or two characters (an emoji or a symbol). */
    icon?: string;
    iconActive?: string;
    /** primary: in the column; more: behind "More"; hidden: no button. At most 3 primary. */
    placement?: 'primary' | 'more' | 'hidden';
    order?: number;
    /** primary: always a filled button. secondary (default): filled only while active. */
    style?: 'primary' | 'secondary';
    /** Ask for a second press. Always on for actions that open a page. */
    confirm?: boolean;
    /** Key in `item.state` that says the action is on; default `liked` for like, else the action id. */
    state?: string;
    /** Item field or `item.state` key with a number shown after the label. */
    count?: string;
}

export type PanelField = 'title' | 'subtitle' | 'creator' | 'collection' | 'description' | 'likes' | 'tags' | 'badges' | 'meta' | `meta.${string}`;
export type LabelField = 'title' | 'subtitle' | 'creator' | 'count' | `meta.${string}`;

export interface ThemeColors {
    bg: string;
    surface: string;
    surfaceHi: string;
    text: string;
    textSoft: string;
    muted: string;
    accent: string;
    accentStrong: string;
    accentText: string;
    /** Background of the info panel, hints, labels and notices. */
    panel: string;
}

export interface EnvironmentView {
    preset?: 'studio' | 'night' | 'plain';
    top?: string;
    horizon?: string;
    bottom?: string;
    floor?: string;
    stars?: boolean;
    /** Equirectangular image around the viewer (http(s), CORS). */
    panorama?: string;
    /** How much the panorama is darkened, 0..0.8 (default 0.35). */
    dim?: number;
}

/** The site's view. Same shape in the manifest, a recipe, a page's `data-wall-view` script and `new Wall({ view })`. */
export interface ViewConfig {
    actions?: Record<string, ActionView>;
    panel?: {
        /** Lines of the info panel, in order. Absent: title, creator, likes · description. */
        fields?: PanelField[];
        /** Which links the column left of the picture shows (default all three). */
        side?: ('creator' | 'collection' | 'tags')[];
        /** Labels for `meta` keys. */
        metaLabels?: Record<string, string>;
    };
    wall?: {
        rows?: number;
        /** Metres. */
        radius?: number;
        /** Degrees. */
        arc?: number;
        /** Metres, before the user's zoom. */
        card?: { width?: number; height?: number };
        /** The label shown on the focused card. */
        label?: 'hover' | 'none';
        labelFields?: LabelField[];
        /** Draw `item.badges[0]` on cards without a media badge (default true). */
        badges?: boolean;
        /** Which action's state draws the corner mark (default like; null for none). */
        indicator?: string | null;
    };
    theme?: { colors?: Partial<ThemeColors>; font?: string; environment?: EnvironmentView };
    strings?: Strings;
}

export interface PanelLine {
    text: string;
    style?: 'title' | 'body' | 'soft' | 'accent';
}

/** Level 3 only: code that returns data; the wall still draws it and applies the limits. */
export interface ViewHooks {
    openItem?: (item: Item) => void;
    /** Which actions this item shows, in order. */
    actions?: (item: Item, ids: ActionId[]) => ActionId[];
    actionLabel?: (id: ActionId, item: Item, active: boolean) => string | undefined;
    panel?: (item: Item, lines: PanelLine[]) => PanelLine[];
    cardLabel?: (item: Item, lines: string[]) => string[];
}

export type ActionResult =
    | { ok: true; state?: Record<string, unknown>; message?: string }
    | { ok: false; reason: 'auth' | 'error'; message?: string };

export interface AccountAdapter {
    state(): { authed: boolean; userId?: string; name?: string };
    linkStart?(): Promise<{ code: string; url: string }>;
    linkPoll?(): Promise<{ status: 'pending' | 'approved' | 'expired'; user?: { id: string; name: string } }>;
    phoneSearchPoll?(): Promise<string | null>;
    phoneSearchUrl?: string;
    linkPageUrl?: string;
    logout?(): Promise<void>;
}

export interface Brand {
    name?: string;
    logo?: string;
    /** Canvas font stack. */
    font?: string;
    accent?: string;
    /** Fill of active buttons; derived from `accent` when absent. */
    accentStrong?: string;
    /** Text on `accentStrong`; defaults to `text`. */
    accentText?: string;
    bg?: string;
    surface?: string;
    surfaceHi?: string;
    text?: string;
    textSoft?: string;
    muted?: string;
}

/** Brand after validateBrand(): every colour token present. */
export type ResolvedBrand = Required<Pick<Brand, 'accent' | 'accentStrong' | 'accentText' | 'bg' | 'surface' | 'surfaceHi' | 'text' | 'textSoft' | 'muted' | 'font'>> & Pick<Brand, 'name' | 'logo'>;

export type Strings = Record<string, string>;

export interface TelemetryConfig {
    endpoint: string;
    /** Share of events sent, 0..1 (default 1). */
    sample?: number;
    /** Replaces the `xr_` start of the shipped event names (default `xr_`). */
    prefix?: string;
}

export interface TelemetryData {
    value?: number;
    pin_id?: string;
    props?: Record<string, string>;
}

export type TelemetrySink = (name: string, data?: TelemetryData) => void;

export interface Features {
    /** Write the `xr_caps=none` cookie when the headset refuses a session (default off). */
    capsCookie?: boolean;
    /** Forward window `error` and `unhandledrejection` to telemetry (default on). */
    captureErrors?: boolean;
    /** Call navigator.xr.offerSession from the loader (default on). */
    offerSession?: boolean;
}

export interface HandThresholds {
    curled: number;
    extended: number;
    release: number;
    fistMinGap: number;
}

/** Every threshold of the input code, as data. Seconds, radians or metres as named. */
export interface InputProfile {
    name: string;
    mode?: 'transient-pointer';
    thumbDeadzone: number;
    thumbSpeed: number;
    dragPxToRad: number;
    pressDragThreshold: number;
    pressDragThresholdHand: number;
    swipeRad: number;
    emptyHold: number;
    fistHideHold: number;
    dwellSelect: number;
    dwellRearmRad: number;
    dwellSteps: number;
    pullZoomGain: number;
    pullThreshold: number;
    zoomStep: number;
    zoomRepeat: number;
    fistHold: number;
    handDebugInterval: number;
    zoomMin: number;
    zoomMax: number;
    btnPrimary: number;
    btnSecondary: number;
    holdToOpen: number;
    confirmWindow: number;
    handRestDrop: number;
    handWakeDrop: number;
    hideHold: number;
    hoverPlayDelay: number;
    hand: HandThresholds;
}

export type ProfileName = 'meta-quest' | 'pico' | 'android-xr' | 'visionos' | 'desktop' | 'phone';

export interface StorageKeys {
    settings: string;
    queue: string;
    resume: string;
}

export interface WallOptions {
    mount: HTMLElement;
    adapter: FeedAdapter;
    account?: AccountAdapter;
    brand?: Brand;
    locale?: 'en' | 'bg';
    strings?: Strings;
    telemetry?: TelemetrySink | TelemetryConfig;
    features?: Features;
    inputProfile?: ProfileName | 'auto';
    storageKeys?: Partial<StorageKeys>;
    initialItem?: string | null;
    announce?: (text: string) => void;
    onScopeChange?: (s: unknown) => void;
    onFilterChange?: (f: unknown) => void;
    onAuthChange?: (a: { authed: boolean; name: string }) => void;
    /** The site's view; wins over `adapter.view`. */
    view?: ViewConfig;
    hooks?: ViewHooks;
    /** Site key for telemetry `site`; defaults to location.hostname. */
    site?: string;
    /**
     * Where the stream libraries come from: a script URL that sets window.Hls / window.dashjs, a
     * function that resolves to the library (the `Hls` class / the `dashjs` namespace), or false to
     * never load one. Default: the ESM build imports `hls.js/light` / `dashjs`; the IIFE build loads
     * wall-hls.js / wall-dash.js from the folder of wall.iife.js.
     */
    videoLibs?: { hls?: VideoLib; dash?: VideoLib };
    /** YouTube/Vimeo embeds in an overlay outside VR (default true). */
    embeds?: boolean;
    /** Highest video height the automatic quality picks (default 2160 on headsets, the screen height elsewhere). */
    maxVideoHeight?: number;
}
