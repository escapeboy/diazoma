<?php
/**
 * Keyset cursor: base64url JSON {d: post_date_gmt, id: ID}.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Encodes and decodes feed cursors. Pure logic, no WordPress calls.
 */
final class Cursor {

	/**
	 * Encode a cursor.
	 *
	 * @param string $date_gmt post_date_gmt of the last row (Y-m-d H:i:s).
	 * @param int    $id       Post ID of the last row.
	 */
	public static function encode( string $date_gmt, int $id ): string {
		$json = json_encode( array( 'd' => $date_gmt, 'id' => $id ) );
		return rtrim( strtr( base64_encode( (string) $json ), '+/', '-_' ), '=' );
	}

	/**
	 * Decode a cursor. Anything malformed yields null (= first page).
	 *
	 * @param string|null $cursor Raw cursor from the request.
	 * @return array{d:string,id:int}|null
	 */
	public static function decode( ?string $cursor ): ?array {
		if ( null === $cursor || '' === $cursor || ! preg_match( '/^[A-Za-z0-9_-]+$/', $cursor ) ) {
			return null;
		}
		$raw = base64_decode( strtr( $cursor, '-_', '+/' ), true );
		if ( false === $raw ) {
			return null;
		}
		$data = json_decode( $raw, true );
		if ( ! is_array( $data ) || ! isset( $data['d'], $data['id'] ) ) {
			return null;
		}
		if ( ! is_string( $data['d'] ) || 1 !== preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $data['d'] ) ) {
			return null;
		}
		if ( ! is_int( $data['id'] ) || $data['id'] < 1 ) {
			return null;
		}
		return array(
			'd'  => $data['d'],
			'id' => $data['id'],
		);
	}
}
