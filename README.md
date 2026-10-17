# Diazoma

Browse any list on the web (a feed, a catalog, a gallery, an archive) as a curved wall: a magic window on desktop
and phone, and a wall around you in a WebXR headset.

Website and documentation: https://diazoma.app

## What is here

| Path | Package | Licence |
|---|---|---|
| `packages/wall` | `@diazoma/wall`: the wall, the loader and the IIFE build | Apache-2.0 |
| `packages/adapters` | `@diazoma/adapters`: feed, page and recipe adapters, and `diazoma-embed.js` | Apache-2.0 |
| `packages/spec` | `@diazoma/spec`: the site compatibility spec v1, JSON Schemas and the `diazoma-spec` validator | text CC-BY-4.0, code and schemas Apache-2.0 |
| `packages/recipe-schema` | `@diazoma/recipe-schema`: JSON Schemas for recipes and views | Apache-2.0 |
| `plugins/wordpress` | WordPress plugin "Diazoma Wall" | GPL-2.0-or-later |
| `plugins/laravel` | `diazoma/laravel` (also at github.com/escapeboy/diazoma-laravel for Packagist) | Apache-2.0 |

The Diazoma Browser for Meta Quest is a separate project: github.com/escapeboy/wolvic, branch `diazoma` (MPL-2.0).
The Chrome extension, the marketplace and the web app are not open source.

## Use it without building

```html
<script src="https://diazoma.app/wall/0.1.0/diazoma-embed.js" data-manifest="/.well-known/wall.json" data-route="/xr"></script>
```

The files at `https://diazoma.app/wall/<version>/` never change once published. See https://diazoma.app/docs/embed/.

## Build and test

Node 22 or newer, pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
```

The plugins use Composer: `composer install && composer test` inside `plugins/wordpress` or `plugins/laravel`.

## Contributing

This repository is a mirror: the code is developed in a private repository and copied here on every release.
Issues are welcome. Pull requests are read, and a change that is accepted is applied upstream and comes back with
the next sync.
