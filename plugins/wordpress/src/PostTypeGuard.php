<?php
/**
 * Decides whether a post type may be served by the public feed.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Rejects unknown and non-public post types.
 */
final class PostTypeGuard {

	/**
	 * Check a post type slug.
	 *
	 * @param string $type Post type slug from the request.
	 * @return array{code:string,status:int}|null Error descriptor, or null when allowed.
	 */
	public static function check( string $type ): ?array {
		$object = '' === $type ? null : get_post_type_object( $type );
		if ( ! $object ) {
			return array(
				'code'   => 'diazoma_invalid_type',
				'status' => 400,
			);
		}
		if ( empty( $object->public ) ) {
			return array(
				'code'   => 'diazoma_forbidden_type',
				'status' => 403,
			);
		}
		return null;
	}
}
