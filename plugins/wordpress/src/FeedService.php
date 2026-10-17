<?php
/**
 * WordPress-facing feed query: keyset pagination on post_date_gmt + ID.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Gathers posts (or WooCommerce products) and hands plain data to ItemMapper.
 */
final class FeedService {

	/**
	 * One page of the feed.
	 *
	 * @param string                    $type   Post type slug (already validated).
	 * @param array{d:string,id:int}|null $cursor Decoded cursor.
	 * @param string                    $search Search string.
	 * @param int                       $limit  Page size.
	 * @return array{items:array<int,array<string,mixed>>,next:?string}
	 */
	public function page( string $type, ?array $cursor, string $search, int $limit ): array {
		$use_woo = 'product' === $type && function_exists( 'wc_get_products' );

		$where   = $this->where_filter( $cursor );
		$orderby = static function (): string {
			global $wpdb;
			return "{$wpdb->posts}.post_date_gmt DESC, {$wpdb->posts}.ID DESC";
		};
		add_filter( 'posts_where', $where, 10, 1 );
		add_filter( 'posts_orderby', $orderby, 10, 0 );

		try {
			{
				$query = new \WP_Query(
					array(
						'post_type'           => $type,
						'post_status'         => 'publish',
						'has_password'        => false,
						'posts_per_page'      => $limit + 1,
						'no_found_rows'       => true,
						'ignore_sticky_posts' => true,
						's'                   => $search,
						'suppress_filters'    => false,
					)
				);
				// Products go through WP_Query like any post type so the keyset filters
				// are guaranteed to apply; WooCommerce is only asked for price and sale state.
				$rows = array_map(
					static fn( $post ) => array( $post, $use_woo ? ( wc_get_product( $post->ID ) ?: null ) : null ),
					$query->posts
				);
			}
		} finally {
			remove_filter( 'posts_where', $where, 10 );
			remove_filter( 'posts_orderby', $orderby, 10 );
		}

		$next = null;
		if ( count( $rows ) > $limit ) {
			$rows = array_slice( $rows, 0, $limit );
			$last = $rows[ $limit - 1 ][0];
			$next = Cursor::encode( $last->post_date_gmt, (int) $last->ID );
		}

		$items = array();
		foreach ( $rows as $row ) {
			$item = ItemMapper::map( $this->describe( $row[0], $row[1] ) );
			if ( null !== $item ) {
				$items[] = $item;
			}
		}

		return array(
			'items' => $items,
			'next'  => $next,
		);
	}

	/**
	 * Build the posts_where callback for the keyset condition.
	 *
	 * @param array{d:string,id:int}|null $cursor Decoded cursor.
	 */
	private function where_filter( ?array $cursor ): callable {
		return static function ( string $where ) use ( $cursor ): string {
			if ( null === $cursor ) {
				return $where;
			}
			global $wpdb;
			return $where . $wpdb->prepare(
				" AND ({$wpdb->posts}.post_date_gmt < %s OR ({$wpdb->posts}.post_date_gmt = %s AND {$wpdb->posts}.ID < %d))",
				$cursor['d'],
				$cursor['d'],
				$cursor['id']
			);
		};
	}

	/**
	 * Name of the post's first category (a product's first product category), or ''.
	 *
	 * @param \WP_Post $post Post.
	 */
	private function first_category( $post ): string {
		$taxonomy = 'product' === $post->post_type ? 'product_cat' : 'category';
		if ( ! is_object_in_taxonomy( $post->post_type, $taxonomy ) ) {
			return '';
		}
		$terms = get_the_terms( $post, $taxonomy );
		if ( ! is_array( $terms ) || array() === $terms ) {
			return '';
		}
		$first = reset( $terms );
		return is_object( $first ) ? html_entity_decode( (string) $first->name, ENT_QUOTES, 'UTF-8' ) : '';
	}

	/**
	 * Collect the plain data ItemMapper needs.
	 *
	 * @param \WP_Post $post    Post.
	 * @param mixed    $product WC_Product or null.
	 * @return array<string,mixed>
	 */
	private function describe( $post, $product ): array {
		$thumb_id = (int) get_post_thumbnail_id( $post );
		$image    = $thumb_id > 0 ? $this->image_for( $thumb_id ) : null;

		list( $video, $embed, $poster_id ) = $this->video_of( $post );
		if ( null === $image && $poster_id > 0 ) {
			$image = $this->image_for( $poster_id );
		}

		$timestamp = strtotime( $post->post_date_gmt . ' UTC' );
		$data      = array(
			'id'      => (int) $post->ID,
			'link'    => get_permalink( $post ),
			'title'   => ItemMapper::decode_text( get_the_title( $post ) ),
			'author'  => get_the_author_meta( 'display_name', (int) $post->post_author ),
			'date'    => false === $timestamp ? '' : wp_date( get_option( 'date_format' ), $timestamp ),
			'date_iso' => false === $timestamp ? '' : gmdate( 'Y-m-d\TH:i:s\Z', $timestamp ),
			'category' => $this->first_category( $post ),
			'summary' => ItemMapper::decode_text( wp_trim_words( wp_strip_all_tags( get_the_excerpt( $post ) ), 40 ) ),
			'image'   => $image,
		);
		if ( null !== $video ) {
			$data['video'] = $video;
		}
		if ( '' !== $embed ) {
			$data['embed'] = $embed;
		}

		if ( null !== $product ) {
			$data['price']   = html_entity_decode( wp_strip_all_tags( wc_price( (float) $product->get_price() ) ), ENT_QUOTES, 'UTF-8' );
			$data['on_sale'] = (bool) $product->is_on_sale();
		}

		return $data;
	}

	/**
	 * Card, focus and full sizes of an image attachment, with its pixel size.
	 *
	 * @param int $attachment_id Attachment id.
	 * @return array<string,mixed>|null
	 */
	private function image_for( int $attachment_id ): ?array {
		// The card is drawn at 512 px, so medium_large (768) is enough; large (1024) is the focused card.
		$card  = wp_get_attachment_image_src( $attachment_id, 'medium_large' );
		$focus = wp_get_attachment_image_src( $attachment_id, 'large' );
		$full  = wp_get_attachment_image_src( $attachment_id, 'full' );
		$meta  = wp_get_attachment_metadata( $attachment_id );
		if ( ! $card ) {
			return null;
		}
		return array(
			'card'   => $card[0],
			'focus'  => $focus ? $focus[0] : $card[0],
			'full'   => $full ? $full[0] : $card[0],
			'width'  => is_array( $meta ) && ! empty( $meta['width'] ) ? $meta['width'] : ( $full ? $full[1] : $card[1] ),
			'height' => is_array( $meta ) && ! empty( $meta['height'] ) ? $meta['height'] : ( $full ? $full[2] : $card[2] ),
		);
	}

	/**
	 * The video of a post: its first real block when that is core/video or a core/embed.
	 *
	 * @param \WP_Post $post Post.
	 * @return array{0:?array<string,mixed>,1:string,2:int} Video {url, duration?}, embed URL, attachment id of the poster.
	 */
	private function video_of( $post ): array {
		$block = ItemMapper::first_video_block( parse_blocks( (string) $post->post_content ) );
		if ( null === $block ) {
			return array( null, '', 0 );
		}
		if ( 'embed' === $block['kind'] ) {
			return array( null, (string) $block['url'], 0 );
		}

		$url      = (string) $block['src'];
		$duration = null;
		$id       = (int) $block['id'];
		if ( $id > 0 && wp_attachment_is( 'video', $id ) ) {
			$attached = wp_get_attachment_url( $id );
			$url      = $attached ? $attached : $url;
			$meta     = wp_get_attachment_metadata( $id );
			if ( is_array( $meta ) && isset( $meta['length'] ) && is_numeric( $meta['length'] ) ) {
				$duration = $meta['length'] + 0;
			}
		}
		if ( '' === $url ) {
			return array( null, '', 0 );
		}

		$poster_id = '' !== (string) $block['poster'] ? (int) attachment_url_to_postid( (string) $block['poster'] ) : 0;
		$video     = array( 'url' => $url );
		if ( null !== $duration ) {
			$video['duration'] = $duration;
		}
		return array( $video, '', $poster_id );
	}
}
