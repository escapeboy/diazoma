<?php
/**
 * YouTube and Vimeo recognition and the embed allowlist of the Diazoma spec (3.4.1).
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Hosts are matched exactly, so youtube.com.evil.example and evilyoutube.com are not YouTube.
 */
final class VideoUrl {

	private const YT_ID      = '/^[A-Za-z0-9_-]{11}$/D';
	private const VIMEO_ID   = '/^\d+$/D';
	private const VIMEO_HASH = '/^[A-Za-z0-9]{1,32}$/D';

	/**
	 * Recognise a YouTube or Vimeo URL.
	 *
	 * @param string $url Absolute URL.
	 * @return array{provider:string,embed:string,poster?:string}|null
	 */
	public static function hosted( string $url ): ?array {
		$url = trim( $url );
		if ( str_contains( $url, '\\' ) ) {
			return null;
		}
		$parts = parse_url( $url );
		if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'] ) || ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) ) {
			return null;
		}

		$host = strtolower( $parts['host'] );
		$path = self::path_parts( $parts['path'] ?? '' );
		$vs = self::query_values( $parts['query'] ?? '', 'v' );
		$hs = self::query_values( $parts['query'] ?? '', 'h' );
		// A repeated v or h is ambiguous, so the URL is not recognised.
		if ( count( $vs ) > 1 || count( $hs ) > 1 ) {
			return null;
		}
		$v = $vs[0] ?? null;
		$h = $hs[0] ?? null;

		if ( 'youtu.be' === $host ) {
			return 1 === count( $path ) && self::is_youtube_id( $path[0] ) ? self::youtube( $path[0] ) : null;
		}

		if ( in_array( $host, array( 'youtube.com', 'www.youtube.com', 'm.youtube.com' ), true ) ) {
			if ( 1 === count( $path ) && 'watch' === $path[0] && is_string( $v ) && self::is_youtube_id( $v ) ) {
				return self::youtube( $v );
			}
			if ( 'm.youtube.com' !== $host && 2 === count( $path ) && in_array( $path[0], array( 'shorts', 'embed' ), true ) && self::is_youtube_id( $path[1] ) ) {
				return self::youtube( $path[1] );
			}
			return null;
		}

		if ( in_array( $host, array( 'youtube-nocookie.com', 'www.youtube-nocookie.com' ), true ) ) {
			return 2 === count( $path ) && 'embed' === $path[0] && self::is_youtube_id( $path[1] ) ? self::youtube( $path[1] ) : null;
		}

		if ( in_array( $host, array( 'vimeo.com', 'www.vimeo.com' ), true ) ) {
			if ( count( $path ) >= 1 && count( $path ) <= 2 && preg_match( self::VIMEO_ID, $path[0] ) && ( 1 === count( $path ) || preg_match( self::VIMEO_HASH, $path[1] ) ) ) {
				return self::vimeo( $path[0], $path[1] ?? null );
			}
			return null;
		}

		if ( 'player.vimeo.com' === $host ) {
			return 2 === count( $path ) && 'video' === $path[0] && preg_match( self::VIMEO_ID, $path[1] ) ? self::vimeo( $path[1], is_string( $h ) ? $h : null ) : null;
		}

		return null;
	}

	/**
	 * The canonical embed URL when the value is on the embed allowlist (https only), else null.
	 *
	 * @param mixed $value Candidate embed URL.
	 */
	public static function allowed_embed( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = trim( $value );
		if ( str_contains( $value, '\\' ) ) {
			return null;
		}
		$parts = parse_url( $value );
		if ( ! is_array( $parts ) || 'https' !== strtolower( $parts['scheme'] ?? '' ) || ! isset( $parts['host'] ) ) {
			return null;
		}

		$host = strtolower( $parts['host'] );
		$path = self::path_parts( $parts['path'] ?? '' );
		$hs = self::query_values( $parts['query'] ?? '', 'h' );
		if ( count( $hs ) > 1 ) {
			return null;
		}

		if ( in_array( $host, array( 'www.youtube-nocookie.com', 'www.youtube.com' ), true ) && 2 === count( $path ) && 'embed' === $path[0] && self::is_youtube_id( $path[1] ) ) {
			return self::youtube( $path[1] )['embed'];
		}
		if ( 'player.vimeo.com' === $host && 2 === count( $path ) && 'video' === $path[0] && preg_match( self::VIMEO_ID, $path[1] ) ) {
			return self::vimeo( $path[1], $hs[0] ?? null )['embed'];
		}
		return null;
	}

	/**
	 * Kind of a video URL: hls for .m3u8, dash for .mpd, else file.
	 *
	 * @param string $url Video URL.
	 */
	public static function kind( string $url ): string {
		$path = strtolower( (string) parse_url( $url, PHP_URL_PATH ) );
		if ( str_ends_with( $path, '.m3u8' ) ) {
			return 'hls';
		}
		return str_ends_with( $path, '.mpd' ) ? 'dash' : 'file';
	}

	/**
	 * True for an http(s) URL.
	 *
	 * @param string $url URL.
	 */
	public static function is_http_url( string $url ): bool {
		$parts = parse_url( $url );
		return is_array( $parts ) && isset( $parts['scheme'], $parts['host'] ) && in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true );
	}

	/**
	 * Decoded values of every query parameter with this name.
	 *
	 * @param string $query Query string.
	 * @param string $name  Parameter name.
	 * @return string[]
	 */
	private static function query_values( string $query, string $name ): array {
		$out = array();
		foreach ( explode( '&', $query ) as $pair ) {
			$kv = explode( '=', $pair, 2 );
			if ( urldecode( $kv[0] ) === $name ) {
				$out[] = urldecode( $kv[1] ?? '' );
			}
		}
		return $out;
	}

	/**
	 * Path segments without the leading and one trailing slash.
	 *
	 * @param string $path URL path.
	 * @return string[]
	 */
	private static function path_parts( string $path ): array {
		$parts = explode( '/', $path );
		array_shift( $parts );
		if ( count( $parts ) > 1 && '' === end( $parts ) ) {
			array_pop( $parts );
		}
		return $parts;
	}

	/**
	 * Whether the string is a YouTube video id.
	 *
	 * @param string $id Candidate.
	 */
	private static function is_youtube_id( string $id ): bool {
		return 1 === preg_match( self::YT_ID, $id );
	}

	/**
	 * Descriptor of a YouTube video.
	 *
	 * @param string $id Video id.
	 * @return array{provider:string,embed:string,poster:string}
	 */
	private static function youtube( string $id ): array {
		return array(
			'provider' => 'YouTube',
			'embed'    => "https://www.youtube-nocookie.com/embed/$id",
			'poster'   => "https://i.ytimg.com/vi/$id/hqdefault.jpg",
		);
	}

	/**
	 * Descriptor of a Vimeo video.
	 *
	 * @param string      $id   Video id.
	 * @param string|null $hash Privacy hash.
	 * @return array{provider:string,embed:string}
	 */
	private static function vimeo( string $id, ?string $hash ): array {
		$query = null !== $hash && 1 === preg_match( self::VIMEO_HASH, $hash ) ? "?h=$hash" : '';
		return array(
			'provider' => 'Vimeo',
			'embed'    => "https://player.vimeo.com/video/$id$query",
		);
	}
}
