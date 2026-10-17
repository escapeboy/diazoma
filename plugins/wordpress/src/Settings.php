<?php
/**
 * Plugin settings: defaults, sanitisation, contrast warning.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Settings logic. Only esc_url_raw() is taken from WordPress.
 */
final class Settings {

	public const OPTION = 'diazoma_wall_options';

	public const POLICIES = array( 'allow', 'deny', 'recipes-only' );

	/** Default wall background the accent is checked against. */
	public const BACKGROUND = '#0e0e10';

	/**
	 * Default option values.
	 *
	 * @return array<string,mixed>
	 */
	public static function defaults(): array {
		return array(
			'post_types' => array( 'post' ),
			'accent'     => '#c9334f',
			'policy'     => 'allow',
			'xr_enabled' => false,
			'base_url' => '',
		);
	}

	/**
	 * Stored options merged over defaults.
	 *
	 * @param mixed $stored Raw get_option() value.
	 * @return array<string,mixed>
	 */
	public static function with_defaults( $stored ): array {
		return array_merge( self::defaults(), is_array( $stored ) ? $stored : array() );
	}

	/**
	 * Sanitise submitted options.
	 *
	 * @param mixed    $input        Raw submitted value.
	 * @param string[] $public_types Slugs of public post types that may be enabled.
	 * @return array<string,mixed>
	 */
	public static function sanitize( $input, array $public_types ): array {
		$input    = is_array( $input ) ? $input : array();
		$defaults = self::defaults();

		$types = array();
		if ( isset( $input['post_types'] ) && is_array( $input['post_types'] ) ) {
			foreach ( $input['post_types'] as $slug ) {
				if ( is_string( $slug ) && in_array( $slug, $public_types, true ) && ! in_array( $slug, $types, true ) ) {
					$types[] = $slug;
				}
			}
		}

		$accent = isset( $input['accent'] ) && is_string( $input['accent'] ) ? trim( $input['accent'] ) : '';
		if ( 1 !== preg_match( '/^#([0-9a-f]{3}|[0-9a-f]{6})$/i', $accent ) ) {
			$accent = $defaults['accent'];
		}

		$policy = $input['policy'] ?? '';
		if ( ! is_string( $policy ) || ! in_array( $policy, self::POLICIES, true ) ) {
			$policy = $defaults['policy'];
		}

		$base_url = '';
		if ( isset( $input['base_url'] ) && is_string( $input['base_url'] ) && '' !== trim( $input['base_url'] ) ) {
			$base_url = esc_url_raw( trim( $input['base_url'] ), array( 'https', 'http' ) );
		}

		return array(
			'post_types' => $types,
			'accent'     => strtolower( $accent ),
			'policy'     => $policy,
			'xr_enabled' => ! empty( $input['xr_enabled'] ),
			'base_url' => $base_url,
		);
	}

	/**
	 * Warning text when the accent is below 4.5:1 against the wall background; null when fine.
	 */
	public static function contrast_warning( string $accent ): ?string {
		$ratio = Contrast::ratio( $accent, self::BACKGROUND );
		if ( null === $ratio || $ratio >= Contrast::MINIMUM ) {
			return null;
		}
		return sprintf(
			/* translators: 1: measured contrast ratio, 2: required ratio. */
			__( 'The accent colour has a contrast ratio of %1$s:1 against the wall background; at least %2$s:1 is recommended for readable text.', 'diazoma-wall' ),
			number_format( $ratio, 2, '.', '' ),
			number_format( Contrast::MINIMUM, 1, '.', '' )
		);
	}
}
