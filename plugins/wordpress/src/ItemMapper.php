<?php
/**
 * Maps a plain post description to a spec feed item.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Pure mapping: WordPress data is gathered by FeedService, shaped here.
 */
final class ItemMapper {

	/** Longest excerpt the spec allows. */
	private const EXCERPT_MAX = 500;

	/**
	 * WordPress hands out titles and excerpts with tags (<em>) and entities (&#8217; &hellip;). The wall draws
	 * text as it is, so tags are removed and entities turned into characters before they go in the feed.
	 *
	 * @param string $text Text that may hold HTML entities.
	 */
	public static function decode_text( string $text ): string {
		return html_entity_decode( strip_tags( $text ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	}

	/**
	 * Map one post.
	 *
	 * Expected keys: id (int|string), link, title, author, date, date_iso (ISO 8601), category (first
	 * category name), summary, image {card, focus, full, width, height}|null, price|null, on_sale (bool).
	 * A post with a usable featured image becomes an image card. A post without one (or with an image
	 * of unknown size) becomes a text card: title, author, date, first category as the kicker and the
	 * summary as the excerpt. Returns null only when there is neither a usable image nor a title.
	 *
	 * Video: `video` {url, duration?} is a file or stream, `embed` is a core/embed URL. A YouTube or Vimeo
	 * URL in either becomes media_type video with unplayable {provider, embed}; a YouTube post without a
	 * usable image gets YouTube's thumbnail. A file video becomes a video card only when the post has an image.
	 *
	 * @param array<string,mixed> $post Plain post description.
	 * @return array<string,mixed>|null
	 */
	public static function map( array $post ): ?array {
		$video = self::video_fields( $post );
		$image = $post['image'] ?? null;
		$width  = is_array( $image ) ? (float) ( $image['width'] ?? 0 ) : 0.0;
		$height = is_array( $image ) ? (float) ( $image['height'] ?? 0 ) : 0.0;
		if ( ! is_array( $image ) || empty( $image['card'] ) || $width <= 0 || $height <= 0 ) {
			if ( isset( $video['poster'] ) ) {
				$image  = array(
					'card'  => $video['poster'],
					'focus' => $video['poster'],
					'full'  => $video['poster'],
				);
				$width  = 16.0;
				$height = 9.0;
			} else {
				$text_card = self::map_text_card( $post );
				// A file video needs a picture to be a card; an embed (Vimeo) keeps its provider on a text card.
				return null !== $text_card && isset( $video['unplayable'] ) ? self::compact( $text_card + $video['fields'] ) : $text_card;
			}
		}

		$subtitle = implode(
			' · ',
			array_filter(
				array( (string) ( $post['author'] ?? '' ), (string) ( $post['date'] ?? '' ) ),
				static fn( string $part ): bool => '' !== $part
			)
		);

		$meta = array();
		if ( ! empty( $post['price'] ) ) {
			$meta['price'] = (string) $post['price'];
		}
		if ( ! empty( $post['summary'] ) ) {
			$meta['summary'] = (string) $post['summary'];
		}

		$item = array(
			'id'          => (string) $post['id'],
			'link'        => (string) $post['link'],
			'title'       => (string) ( $post['title'] ?? '' ),
			'subtitle'    => $subtitle,
			'image'       => (string) $image['card'],
			'image_focus' => (string) ( $image['focus'] ?? $image['card'] ),
			'image_full'  => (string) ( $image['full'] ?? $image['card'] ),
			'aspect'      => round( $width / $height, 4 ),
			'badges'      => ! empty( $post['on_sale'] ) ? array( 'sale' ) : array(),
			'meta'        => $meta,
		);

		return self::compact( $item + $video['fields'] );
	}

	/**
	 * Video fields of a post.
	 *
	 * @param array<string,mixed> $post Plain post description.
	 * @return array{fields:array<string,mixed>,unplayable?:bool,poster?:string}
	 */
	private static function video_fields( array $post ): array {
		$none  = array( 'fields' => array() );
		$video = is_array( $post['video'] ?? null ) ? $post['video'] : array();
		$url   = (string) ( $video['url'] ?? '' );

		$hosted = '' !== (string) ( $post['embed'] ?? '' ) ? VideoUrl::hosted( (string) $post['embed'] ) : null;
		if ( null === $hosted && '' !== $url ) {
			$hosted = VideoUrl::hosted( $url );
		}
		if ( null !== $hosted ) {
			$out = array(
				'fields'     => array(
					'media_type' => 'video',
					'unplayable' => array(
						'provider' => $hosted['provider'],
						'embed'    => $hosted['embed'],
					),
				),
				'unplayable' => true,
			);
			if ( isset( $hosted['poster'] ) ) {
				$out['poster'] = $hosted['poster'];
			}
			return $out;
		}

		if ( '' === $url || ! VideoUrl::is_http_url( $url ) ) {
			return $none;
		}
		$fields = array(
			'video'      => $url,
			'video_type' => VideoUrl::kind( $url ),
			'media_type' => 'video',
		);
		if ( isset( $video['duration'] ) && is_numeric( $video['duration'] ) && (float) $video['duration'] >= 0 ) {
			$fields['duration'] = $video['duration'] + 0;
		}
		return array( 'fields' => $fields );
	}

	/**
	 * The first block that is a video or a YouTube/Vimeo embed, when it is the first real block of the post.
	 *
	 * Takes the list parse_blocks() returns. Returns {kind: 'video', id, src, poster} for core/video (id is the
	 * attachment id, 0 when absent; src and poster are read from the markup) or {kind: 'embed', url} for core/embed.
	 *
	 * @param array<int,array<string,mixed>> $blocks Blocks.
	 * @return array<string,mixed>|null
	 */
	public static function first_video_block( array $blocks ): ?array {
		foreach ( $blocks as $block ) {
			$name = (string) ( $block['blockName'] ?? '' );
			if ( '' === $name && '' === trim( (string) ( $block['innerHTML'] ?? '' ) ) ) {
				continue;
			}
			$attrs = is_array( $block['attrs'] ?? null ) ? $block['attrs'] : array();
			$html  = (string) ( $block['innerHTML'] ?? '' );
			if ( 'core/video' === $name ) {
				$src    = preg_match( '/<video\b[^>]*\bsrc=["\']([^"\']+)["\']/i', $html, $m ) ? html_entity_decode( $m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8' ) : '';
				$poster = preg_match( '/<video\b[^>]*\bposter=["\']([^"\']+)["\']/i', $html, $p ) ? html_entity_decode( $p[1], ENT_QUOTES | ENT_HTML5, 'UTF-8' ) : '';
				return array(
					'kind'   => 'video',
					'id'     => (int) ( $attrs['id'] ?? 0 ),
					'src'    => $src,
					'poster' => $poster,
				);
			}
			if ( 'core/embed' === $name && ! empty( $attrs['url'] ) ) {
				return array(
					'kind' => 'embed',
					'url'  => (string) $attrs['url'],
				);
			}
			return null;
		}
		return null;
	}

	/**
	 * A post without a picture, drawn by the wall from its text.
	 *
	 * @param array<string,mixed> $post Plain post description.
	 * @return array<string,mixed>|null
	 */
	private static function map_text_card( array $post ): ?array {
		$title = trim( (string) ( $post['title'] ?? '' ) );
		if ( '' === $title ) {
			return null;
		}

		$badges = array();
		if ( ! empty( $post['category'] ) ) {
			$badges[] = (string) $post['category'];
		}
		if ( ! empty( $post['on_sale'] ) ) {
			$badges[] = 'sale';
		}

		$meta = array();
		if ( ! empty( $post['price'] ) ) {
			$meta['price'] = (string) $post['price'];
		}

		$excerpt = trim( (string) ( $post['summary'] ?? '' ) );
		if ( function_exists( 'mb_strlen' ) && mb_strlen( $excerpt ) > self::EXCERPT_MAX ) {
			$excerpt = rtrim( mb_substr( $excerpt, 0, self::EXCERPT_MAX - 1 ) ) . '…';
		}

		return self::compact(
			array(
				'id'       => (string) $post['id'],
				'link'     => (string) $post['link'],
				'title'    => $title,
				'subtitle' => (string) ( $post['author'] ?? '' ),
				'badges'   => $badges,
				'excerpt'  => $excerpt,
				'date'     => (string) ( $post['date_iso'] ?? '' ),
				'meta'     => $meta,
			)
		);
	}

	/**
	 * Drop empty strings and empty lists.
	 *
	 * @param array<string,mixed> $item Item.
	 * @return array<string,mixed>
	 */
	private static function compact( array $item ): array {
		return array_filter(
			$item,
			static fn( $value ): bool => ! ( '' === $value || array() === $value )
		);
	}
}
