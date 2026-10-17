# @diazoma/wall

The wall: a curved, searchable grid of a site's items in a VR headset, and a "magic window" in the
page on desktop and phone. Three.js, no framework. Everything the wall knows about a site comes from a
`FeedAdapter` (`@diazoma/adapters` has them for manifests, recipes, pages and RSS).

```js
import { Wall } from '@diazoma/wall';

const wall = new Wall({ mount: document.getElementById('diazoma'), adapter }).mount();
```

Builds: `dist/wall.esm.js` (three as a peer), `dist/wall.iife.js` (`window.Diazoma`, three bundled) and
`dist/loader.js` (≤ 3 KB gz: the Enter VR card; loads the core only when it is needed). The IIFE build
also ships `dist/wall-hls.js` (hls.js light) and `dist/wall-dash.js` (dash.js): serve them next to
`wall.iife.js`; the core loads one only when an HLS or DASH video opens. The ESM build imports the optional
peers `hls.js` / `dashjs` instead (dynamic `import('hls.js/light')` / `import('dashjs')`), as it does `qrcode`.
An app that bundles the ESM build must therefore either install `hls.js` and `dashjs`, or mark them external
in its bundler, or alias them away and pass `videoLibs: { hls: false, dash: false }` (or loader functions) —
otherwise its bundler fails to resolve them or inlines them.

## Options

| Option | What it does |
|---|---|
| `adapter` | Where items, actions, filters and the site's `view` come from. |
| `account` | The site's own sign-in for the wall (phone link, user menu). Without it the wall has no account menu, and actions go straight to the site with the visitor's session. |
| `view` | How the wall looks. Same shape as the manifest's `view`; wins over `adapter.view`. |
| `hooks` | Code that returns data: `actions(item, ids)`, `actionLabel(id, item, active)`, `panel(item, lines)`, `cardLabel(item, lines)`, `openItem(item)`. |
| `brand`, `strings`, `locale` | Colours and texts. `view.theme` and `view.strings` sit on top of `brand` and the locale; `strings` wins over both. |
| `telemetry` | A function, or `{ endpoint, sample, prefix }`. |
| `videoLibs` | `{ hls, dash }`: a script URL that sets `window.Hls` / `window.dashjs`, a function resolving to the library (e.g. `() => import(url).then((m) => m.default)` in an extension content script), or `false` to never load it (streams then offer "watch in the browser"). |
| `embeds` | `false` turns off the YouTube/Vimeo overlay outside VR (on by default; the host's CSP needs `frame-src` for those hosts). |
| `maxVideoHeight` | Highest height the automatic quality picks (default 2160 on headsets, the screen height elsewhere). |
| `storageKeys`, `initialItem`, `inputProfile`, `features`, `announce`, `on*` | See `src/types.ts`. |

`wall.on('open', fn)` and `wall.on('action', fn)` report what the visitor does.

## View

The full description, with the limits, is in the spec: [`packages/spec/spec/v1.md`](../spec/spec/v1.md),
section 3.2.2. In short:

- **actions**: one button per action the site declares, narrowed by `item.actions`. Label, active
  label, icon, order, `primary` / `more` / `hidden`, style, count. At most three in the column.
- **panel**: the lines of the info panel (`title`, `meta.price`, …) and the links beside the picture.
- **wall**: rows (1–5), radius, arc, card size, the label of the focused card, badges, the corner mark.
- **theme**: every colour, the panel colour, the font, the environment (colours or a panorama).
- **strings**: any built-in text.

The wall clamps what is out of range and writes a `[diazoma] view:` warning. Text sizes cannot be
changed, text colours are kept at 4.5:1 contrast, and anything that leaves VR asks for a second press.

## Tests

```
pnpm test                       # vitest
pnpm harness --site harness/sites/fixture --hook __diazoma --out /tmp/fixture.json
```

The harness runs the parity scenarios P-01…P-18 in headless Chrome. P-19 and P-20 (site actions and
view) need a site with `"features": ["actions"]` in its `site.json`, such as
`packages/adapters/fixtures/level2-actions`. `window.__diazoma.scene.viewerState()` shows the open item's
buttons, the notice and the wall's shape. The video scenarios (P-26…P-34) need `"features": ["video"]`
and play the fixtures in `harness/fixture/video` (made by `make.sh` with ffmpeg);
`window.__diazoma.scene.videoState()` shows the player, its levels, the 360° meshes and the overlay.
