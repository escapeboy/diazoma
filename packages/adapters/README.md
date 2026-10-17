# @diazoma/adapters

Feed adapters for the Diazoma wall (`@diazoma/wall`). Each one implements `FeedAdapter` and only
fetches and parses: it never renders, and the cursors it returns are opaque strings.

| Adapter | Reads | Cursor |
|---|---|---|
| `JsonFeedAdapter({ url, search?, filters?, fetch? })` | a feed of the site-compatibility spec: `{ items, next }` | the server's `next`, verbatim |
| `WellKnownAdapter({ origin })` | `/.well-known/wall.json` (or `<link rel="wall-manifest">`); builds a `JsonFeedAdapter` per feed; exposes `brand`, `policy`, filters, actions | `base64url(JSON { f: feed id, c: server cursor })` |
| `DomAdapter({ root?, mode? })` | the page itself: `[data-wall-item]`, then JSON-LD, then clusters of similar siblings | `base64url(JSON { u: next url })` or `{ p: n }` for infinite scroll |
| `RssAdapter({ url })` | RSS 2.0 and Atom | none, unless the feed has `<atom:link rel="next">` |
| `RecipeAdapter({ recipe })` | a recipe from `@diazoma/recipe-schema`: a JSON API (JSONPath, no eval) or the DOM (CSS selectors) | `base64url(JSON { page })`, `{ t }` (continuation token) or `{ u }` |

```ts
import { WellKnownAdapter } from '@diazoma/adapters';

const adapter = await new WellKnownAdapter({ origin: location.origin }).ready();
new Wall({ mount, adapter, brand: adapter.brand });
```

`WellKnownAdapter.capabilities()` is synchronous, so call `ready()` before you pass it to the wall.

Every adapter that reads a site description also passes on the site's `view` (how the wall looks):
`WellKnownAdapter` from `manifest.view`, `RecipeAdapter` from `recipe.view`, `DomAdapter` from the first
`<script type="application/json" data-wall-view>` on the page. A panorama that is not an absolute
http(s) URL is dropped. `WellKnownAdapter` also sets `login` (from `auth.login`, offered when an action
answers "not signed in") and `capabilities().links` (actions with `mode: "deeplink"`, which open a page
of the site and always take two presses).
Every adapter also looks for smaller images when an item brings only `image` (spec section 3.5): a
`srcset` with widths, the site's `media.resize` rules (manifest or recipe; `RssAdapter` takes a
`sizes` function), then image hosts that resize by URL (Wikimedia, Cloudinary, imgix, Unsplash,
Contentful, Sanity, Shopify, WordPress.com, Squarespace, Flickr, Imgur). The card gets about 512 px, and
the URL found stays as `image_full` for the viewer.

Invalid items are dropped and reported through the `onWarning` option. A manifest with
`"policy": "deny"` makes `page()` reject with an `AdapterError` whose `code` is `policy-denied`.

Adapters use the global `DOMParser`. In a browser that is built in; in Node, call `installDom()` from
`@diazoma/adapters/node` first (it installs linkedom's).

## Recipe details

- **`re`** runs only on the extracted string. Refused: a backreference, a repeated group holding a quantifier or
  alternation, a pattern over 200 characters, text over 256 characters, and too many variable parts. A variable
  part is `*`, `+`, `?`, `{m,}`, `{m,n}` (n > m) or a group with `|`; `{3}` is fixed. At most one is allowed, or two
  when the pattern starts with `^` and has no top-level `|` (so every accepted pattern runs in well under 50 ms).
  The field is dropped and `onWarning` gets `{ code: 'bad-recipe' }` once per pattern.
- **`page.next`** needs `page.param`; a non-URL token without it ends the paging with a warning. Match patterns
  (`*` wildcards) are matched without RegExp, in bounded time.
- **`media.resize`**: `{url}` is the image URL percent-encoded (one query value), `{url_raw}` the URL as it is.
- **Wikimedia**: when the item's `width` is known and below 500 / 1280, no thumb that wide is requested; the
  original is kept for that size. Without a `width` nothing changes.
- **API fields** may be `{ "template": "https://x/{image_id}/512.jpg" }` (placeholders are item keys, dotted
  allowed, percent-encoded unless the template is one placeholder) and `aspect` may be
  `{ "w": "$.width", "h": "$.height" }` (w/h, dropped unless both are positive).
- **API paging**: `page: { "param": "offset", "start": 0, "step": 20 }` sends `start + (page-1)*step`;
  `page: { "param": "gsroffset", "next": "$.continue.gsroffset" }` follows a continuation token (or an absolute
  URL inside `match`) read from each response. See spec v1 section 3.6.

## Node entry: `@diazoma/adapters/node`

`runFixtures(recipe, dir)` replays each fixture of a recipe through `RecipeAdapter` with a
fixture-backed fetch, and checks at least one item with `id`, `link`, `image` and `aspect`. The
`diazoma-recipe run <recipe.json>` command does the same from a shell and exits 1 on a failure.

## One-tag embed: `diazoma-embed.js`

```html
<script src="https://cdn.example/diazoma-embed.js" data-manifest="/.well-known/wall.json" data-route="/xr"
        data-core="https://cdn.example/wall.iife.js" data-loader="https://cdn.example/loader.js"></script>
```
It builds a `WellKnownAdapter` from `data-manifest`, stops when the manifest says `policy: deny`, sets
`window.diazoma.options` (adapter and brand; options already set by the page win), creates the mount
element if there is none, and injects the wall loader with `data-core` passed through. The loader then
loads the core lazily. `data-core` and `data-loader` default to `wall.iife.js` and `loader.js` next to the
embed script; the core loads `wall-hls.js` / `wall-dash.js` from its own directory for HLS/DASH video. Optional: `data-mount` (default `#diazoma`), `data-locale` (`en` or `bg`), and the loader's
`data-title`, `data-body`, `data-enter`, `data-browse`. Until the wall mounts, `window.__diazoma` is
`{ version: 'pending', route }` with `route` from `data-route` (also passed on as `options.route`); the wall then replaces it
with `{ version, route, scope, state() }`.

## Browser bundle

`dist/adapters.iife.js` exposes `window.DiazomaAdapters` for pages without a bundler.

Licence: Apache-2.0.
