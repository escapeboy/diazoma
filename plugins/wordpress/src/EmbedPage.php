<?php
/**
 * HTML of the optional /xr page.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Renders the embed document. Pure apart from esc_* helpers.
 */
final class EmbedPage {

	/**
	 * Hosted embed files of the wall version this plugin was tested with (see https://diazoma.app/docs/embed/).
	 */
	const HOSTED_BASE_URL = 'https://diazoma.app/wall/0.1.0';

	/**
	 * Render the page.
	 *
	 * @param string $base_url     Directory URL holding diazoma-embed.js, wall.iife.js and loader.js
	 *                             (plus wall-hls.js / wall-dash.js for HLS/DASH video).
	 * @param string $manifest_url Absolute URL of the manifest.
	 * @param string $title        Document title.
	 * @param string $route        Route the wall lives on.
	 */
	public static function render( string $base_url, string $manifest_url, string $title, string $route = '/xr' ): string {
		// Without a base URL, use the hosted files of the wall version this plugin was tested with.
		$base   = rtrim( '' === $base_url ? self::HOSTED_BASE_URL : $base_url, '/' );
		$script = sprintf(
			'<script src="%s" data-manifest="%s" data-route="%s" data-core="%s"></script>',
			esc_url( $base . '/diazoma-embed.js' ),
			esc_url( $manifest_url ),
			esc_attr( $route ),
			esc_url( $base . '/wall.iife.js' )
		);

		return '<!doctype html><html><head><meta charset="utf-8">'
			. '<meta name="viewport" content="width=device-width,initial-scale=1">'
			. '<title>' . esc_html( $title ) . '</title>'
			. '<style>html,body{margin:0;height:100%;background:#0e0e10;color:#fff}</style>'
			. '</head><body>' . $script . '</body></html>';
	}
}
