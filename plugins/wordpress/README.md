# Diazoma Wall for WordPress

Publishes your posts (and WooCommerce products) as a Diazoma wall:

- `GET /wp-json/diazoma/v1/feed?type=post&cursor=&q=&limit=` feed (keyset paging, `limit` default 50, max 100)
- `/.well-known/wall.json` manifest built from the settings
- `<link rel="wall-manifest">` and `<link rel="wall-feed">` in `wp_head`
- optional `/xr` page that prints the embed `<script>` tag

Requires PHP 8.1+ and WordPress 6.0+.

## Install

1. Download https://diazoma.app/downloads/diazoma-wall-0.2.0.zip and upload it in Plugins -> Add New -> Upload Plugin,
   or copy this directory to `wp-content/plugins/diazoma-wall`.
2. If you cloned the repository, run `composer install --no-dev` inside it (without `vendor/` the plugin falls back to a built-in loader and still works).
3. Activate the plugin. Activation flushes rewrite rules.
4. Open Settings -> Diazoma Wall: pick post types, accent colour (a warning shows when contrast is below 4.5:1), policy, the `/xr` page and, optionally, the script base URL (empty uses the hosted files at `https://diazoma.app/wall/0.1.0`; otherwise the directory holding `diazoma-embed.js`, `wall.iife.js` and `loader.js`, plus `wall-hls.js` and `wall-dash.js` for HLS/DASH video; without those two, such videos offer "watch in the browser" and mp4 still plays).

Only public post types can be requested. Requesting a non-public type returns 403, an unknown one 400.

## Customizing the wall: `diazoma_wall_manifest`

The manifest passes through the `diazoma_wall_manifest` filter just before it is served. Use it to add a `view` (action buttons, info panel, rows, colours, texts). The shape and limits are in the spec's `view.schema.json`.

```php
add_filter( 'diazoma_wall_manifest', function ( array $manifest, array $settings ): array {
	$manifest['view'] = array(
		'wall'  => array( 'rows' => 4 ),
		'theme' => array( 'colors' => array( 'accent' => '#c9334f' ) ),
	);
	return $manifest;
}, 10, 2 );
```

A filter that does not return an array is ignored.

## nginx: allow `/.well-known`

Many nginx configs deny dotfiles with `location ~ /\. { deny all; }`, which also blocks `/.well-known/wall.json`. Add an exception before that rule:

```nginx
location ^~ /.well-known/ {
    try_files $uri /index.php?$args;
}
```

Apache needs no change with the standard WordPress `.htaccess`.

## Tests

```
composer install
composer test
```

PHPUnit 12 with Brain Monkey 2.7; no WordPress install needed. The spec-shape checks live in `tests/Support/SpecShape.php`; JSON Schema files can be dropped into `tests/schemas/` later.

## License

The plugin is GPL-2.0-or-later (see `LICENSE`), the usual choice for WordPress plugins. The wall core script it embeds (`wall.iife.js`) is a separate work licensed under Apache-2.0 and is not bundled here.
