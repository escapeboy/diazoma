# Fixture sites

Neutral content only: 24 "botanical prints" with generated gradient images (`gen.mjs` writes them; no
third-party images). The `.html` and `.json` files are templates: `{{ORIGIN}}`, `{{HOST}}`,
`{{CDN_ORIGIN}}` and `{{CDN_HOST}}` are filled in with the real addresses when `lib/serve.mjs` or a
harness `mock.mjs` serves them.

| Dir | What it is | Expected result |
|---|---|---|
| `level1-listing/` | Level 1: an annotated listing, `index.html`, `page2.html`, `page3.html` (24 items each, `data-wall-next`), and `xr.html` that mounts `Wall` with `DomAdapter` | `diazoma-spec validate`: Level 1 PASS |
| `level2-feed/` | Level 2: `index.html` with `<link rel="wall-manifest">`, `.well-known/wall.json` (feeds latest, popular, search; one filter; `media.hosts` = the image host; brand accent 7.8:1; a `like` action with `session` auth), feed pages `wall/feed.json`, `feed.p2.json`, `feed.p3.json` (the cursor `p2` is served from `feed.p2.json`), and `xr.html` with `WellKnownAdapter` | Level 2 PASS |
| `level2-embed/` | Level 3 page: `xr.html` has only the one-tag `diazoma-embed.js` (no mounting script, no mount element); manifest and feeds are those of `level2-feed` (harness only) | wall harness P-12, P-01, P-16 pass |
| `level2-actions/` | A shop whose manifest declares its own actions (`favourite` toggle with session + CSRF, `cart` deeplink, `compare` answering 401, `enquire` answering 500, `follow` answering 200 without a state) and a full `view` (4 rows, radius 3 m, panel fields, environment colours). Items 1, 6, 11, … have `actions: []`, items 2, 7, 12, … only `cart`. The mock records each action call at `/__actions` (harness only) | wall harness P-19, P-20 pass |
| `broken/` | Level 2 on purpose broken: an item without `image`, an image host without CORS (`fixture.json` says `cdnCors: false`), a pale-yellow accent (1.59:1) | Level 2 FAIL with three failing checks |
| `recipes/` | Two sample recipes (`botanical-dom.json`, `botanical-api.json`) with their fixtures | `diazoma-recipe run` OK |
| `rss/` | An RSS 2.0 and an Atom feed for `RssAdapter` tests | |

Try one by hand (after `pnpm build` in `@diazoma/adapters` and `@diazoma/wall`):

```
node packages/adapters/fixtures/lib/serve.mjs packages/adapters/fixtures/level2-feed
npx @diazoma/spec validate http://127.0.0.1:<port printed>/
```

The `xr.html` pages need `/adapters.iife.js` and `/bundle/loader.js`, `/bundle/wall.iife.js`;
`serve.mjs` maps them to the built bundles.

## Harness

`level1-listing/` and `level2-feed/` also run under the wall harness (`site.json` and `mock.mjs`
are what `packages/wall/harness/run.mjs --site` reads). The mocks serve the same markup and manifest
but cut the content from the harness dataset (233 cards, 50 per page, images on the harness image
host), because the harness scenarios assert on that dataset. In the level 1 mock the images are
`data-src` (the lazy-loading pattern), so the listing page does not request them and only the wall
does.

```
pnpm --filter @diazoma/wall build && pnpm --filter @diazoma/adapters build
node packages/wall/harness/run.mjs --site packages/adapters/fixtures/level1-listing --hook __diazoma --scenarios P-12,P-01,P-16 --out <file>
node packages/wall/harness/run.mjs --site packages/adapters/fixtures/level2-feed --hook __diazoma --scenarios P-12,P-01,P-16 --out <file>
node packages/wall/harness/run.mjs --site packages/adapters/fixtures/level2-actions --scenarios P-19,P-20 --out <file>
```

## How long would the annotation or the feed take (an estimate, not a measurement)

These numbers come from the size of the change; nobody was timed.

**Level 1.** The minimum is one attribute per item: `data-wall-item` on the element of an item.
The adapter falls back to the first `<img>` and the first `<a href>` inside it, takes the id from
the link, and takes the aspect from the image's `width` and `height` or its natural size (a unit
test, "falls back to the first <img> and the first <a href>", covers exactly this). Add
`data-wall-next="a.pagination__next"` on the list and the wall pages. In `level1-listing/index.html`
the full annotation (item, id, link, aspect, badges, image, focus image, title, subtitle) is 8
attributes per item, 198 in the file, +4,778 bytes (10,274 against 5,496 for the same page without
them) and 97 of 146 lines touched, all in one template loop. A front-end developer who owns the
listing template changes one loop: for the minimal version that is a few minutes of editing, for the
full version still one loop. The 10 minute claim is plausible for a template the developer already
knows; it does not include deploying or reviewing.

**Level 2.** The work is one endpoint that returns the listing the site already has as
`{ items: [...], next }`, and a static `/.well-known/wall.json`. The fixture's manifest is 1,030
bytes; a feed page of 24 items is 9,990 bytes. For a site that already has a paged JSON API it is
a mapping function of about ten lines (id, link, image, aspect); for a site that has not, it is the
query it already runs for the listing, behind a JSON serializer. The 15 minute claim holds for the
first case; the second depends on how the listing query is exposed.
