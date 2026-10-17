<?php
/**
 * WCAG contrast ratio helper.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Pure WCAG 2.x contrast computation.
 */
final class Contrast {

	public const MINIMUM = 4.5;

	/**
	 * Contrast ratio between two #rrggbb / #rgb colours, or null if either is invalid.
	 */
	public static function ratio( string $a, string $b ): ?float {
		$la = self::luminance( $a );
		$lb = self::luminance( $b );
		if ( null === $la || null === $lb ) {
			return null;
		}
		$hi = max( $la, $lb );
		$lo = min( $la, $lb );
		return ( $hi + 0.05 ) / ( $lo + 0.05 );
	}

	/**
	 * True when the pair meets the 4.5:1 minimum.
	 */
	public static function passes( string $a, string $b ): bool {
		$ratio = self::ratio( $a, $b );
		return null !== $ratio && $ratio >= self::MINIMUM;
	}

	/**
	 * Relative luminance of a hex colour.
	 */
	private static function luminance( string $hex ): ?float {
		if ( 1 !== preg_match( '/^#([0-9a-f]{3}|[0-9a-f]{6})$/i', $hex, $m ) ) {
			return null;
		}
		$h = $m[1];
		if ( 3 === strlen( $h ) ) {
			$h = $h[0] . $h[0] . $h[1] . $h[1] . $h[2] . $h[2];
		}
		$channels = array();
		foreach ( str_split( $h, 2 ) as $pair ) {
			$c          = hexdec( $pair ) / 255;
			$channels[] = $c <= 0.03928 ? $c / 12.92 : pow( ( $c + 0.055 ) / 1.055, 2.4 );
		}
		return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
	}
}
