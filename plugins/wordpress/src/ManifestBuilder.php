<?php
/**
 * Builds the .well-known/wall.json manifest from settings.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Pure manifest assembly.
 */
final class ManifestBuilder {

	/**
	 * Build the manifest array.
	 *
	 * @param array<string,mixed> $settings    Settings with defaults applied.
	 * @param string              $site_name   Site title.
	 * @param string              $feed_url    Absolute URL of the feed route (may already contain "?").
	 * @param array<string,string> $type_labels Post type slug => label, for the enabled types, in order.
	 * @return array<string,mixed>
	 */
	public static function build( array $settings, string $site_name, string $feed_url, array $type_labels ): array {
		$sep   = false !== strpos( $feed_url, '?' ) ? '&' : '?';
		$feeds = array();

		foreach ( $type_labels as $slug => $label ) {
			$feeds[] = array(
				'id'     => (string) $slug,
				'title'  => (string) $label,
				'url'    => $feed_url . $sep . 'type=' . rawurlencode( (string) $slug ),
				'cursor' => true,
			);
		}

		if ( array() !== $type_labels ) {
			$first   = (string) array_key_first( $type_labels );
			$feeds[] = array(
				'id'   => 'search',
				'type' => 'search',
				// {query} is a literal template placeholder, not URL-encoded.
				'url'  => $feed_url . $sep . 'type=' . rawurlencode( $first ) . '&q={query}',
			);
		}

		$manifest = array(
			'version' => 1,
			'policy'  => (string) ( $settings['policy'] ?? 'allow' ),
			'name'    => $site_name,
			'brand'   => array( 'accent' => (string) ( $settings['accent'] ?? '' ) ),
			'feeds'   => $feeds,
		);

		if ( ! empty( $settings['xr_enabled'] ) ) {
			$manifest['embed'] = array( 'route' => '/xr' );
		}

		return $manifest;
	}
}
