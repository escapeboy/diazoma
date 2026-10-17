<?php
/**
 * Request argument normalisation for the feed endpoint.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Pure helpers for feed request arguments.
 */
final class FeedArgs {

	public const DEFAULT_LIMIT = 50;
	public const MAX_LIMIT     = 100;

	/**
	 * Clamp the requested page size to 1..100, default 50.
	 *
	 * @param mixed $raw Raw request value.
	 */
	public static function limit( $raw ): int {
		if ( null === $raw || '' === $raw || ! is_numeric( $raw ) ) {
			return self::DEFAULT_LIMIT;
		}
		return max( 1, min( self::MAX_LIMIT, (int) $raw ) );
	}
}
