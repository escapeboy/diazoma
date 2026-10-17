<?php
namespace Diazoma\Wall\Tests\Unit;

use Diazoma\Wall\ItemMapper;
use Diazoma\Wall\Tests\Support\SpecShape;

final class ItemMapperTest extends TestCase {

	/** @return array<string,mixed> */
	private function post(): array {
		return array(
			'id'      => 42,
			'link'    => 'https://example.com/hello/',
			'title'   => 'Hello',
			'author'  => 'Ana',
			'date'    => '1 March 2026',
			'summary' => 'Short text',
			'image'   => array(
				'card'   => 'https://example.com/u/h-768.jpg',
				'focus'  => 'https://example.com/u/h-1024.jpg',
				'full'   => 'https://example.com/u/h.jpg',
				'width'  => 3000,
				'height' => 2000,
			),
		);
	}

	public function test_post_with_featured_image(): void {
		$item = ItemMapper::map( $this->post() );

		$this->assertSame( '42', $item['id'] );
		$this->assertSame( 'https://example.com/hello/', $item['link'] );
		$this->assertSame( 'https://example.com/u/h-768.jpg', $item['image'] );
		$this->assertSame( 'https://example.com/u/h-1024.jpg', $item['image_focus'] );
		$this->assertSame( 'https://example.com/u/h.jpg', $item['image_full'] );
		$this->assertSame( 1.5, $item['aspect'] );
		$this->assertSame( 'Ana · 1 March 2026', $item['subtitle'] );
		$this->assertSame( array( 'summary' => 'Short text' ), $item['meta'] );
		$this->assertArrayNotHasKey( 'badges', $item );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ), 'next' => 'abc' ) ) );
	}

	public function test_post_without_featured_image_is_a_text_card(): void {
		$post                = $this->post();
		$post['image']       = null;
		$post['date_iso']    = '2026-03-01T10:00:00Z';
		$post['category']    = 'News';
		$item                = ItemMapper::map( $post );

		$this->assertSame( '42', $item['id'] );
		$this->assertSame( 'Hello', $item['title'] );
		$this->assertSame( 'Ana', $item['subtitle'] );
		$this->assertSame( array( 'News' ), $item['badges'] );
		$this->assertSame( 'Short text', $item['excerpt'] );
		$this->assertSame( '2026-03-01T10:00:00Z', $item['date'] );
		$this->assertArrayNotHasKey( 'image', $item );
		$this->assertArrayNotHasKey( 'aspect', $item );
		$this->assertArrayNotHasKey( 'meta', $item );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ) ) ) );
	}

	public function test_image_without_dimensions_becomes_a_text_card(): void {
		$post                    = $this->post();
		$post['image']['width']  = 0;
		$item                    = ItemMapper::map( $post );

		$this->assertArrayNotHasKey( 'image', $item );
		$this->assertSame( 'Hello', $item['title'] );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ) ) ) );
	}

	public function test_post_with_neither_image_nor_title_is_skipped(): void {
		$post          = $this->post();
		$post['image'] = null;
		$post['title'] = '  ';
		$this->assertNull( ItemMapper::map( $post ) );
	}

	public function test_text_card_without_category_has_no_badge_and_a_product_keeps_its_price(): void {
		$post            = $this->post();
		$post['image']   = null;
		$post['price']   = '€12.50';
		$post['on_sale'] = true;
		$item            = ItemMapper::map( $post );

		$this->assertSame( array( 'sale' ), $item['badges'] );
		$this->assertSame( array( 'price' => '€12.50' ), $item['meta'] );
	}

	public function test_text_card_excerpt_is_cut_to_500_characters(): void {
		$post            = $this->post();
		$post['image']   = null;
		$post['summary'] = str_repeat( 'ж', 800 );
		$item            = ItemMapper::map( $post );

		$this->assertSame( 500, mb_strlen( $item['excerpt'] ) );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ) ) ) );
	}

	public function test_product_on_sale(): void {
		$post            = $this->post();
		$post['price']   = '€12.50';
		$post['on_sale'] = true;
		$item            = ItemMapper::map( $post );

		$this->assertSame( array( 'sale' ), $item['badges'] );
		$this->assertSame( '€12.50', $item['meta']['price'] );
		$this->assertSame( 'Short text', $item['meta']['summary'] );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ) ) ) );
	}

	public function test_product_not_on_sale_has_no_badge(): void {
		$post            = $this->post();
		$post['price']   = '€20.00';
		$post['on_sale'] = false;
		$this->assertArrayNotHasKey( 'badges', ItemMapper::map( $post ) );
	}

	public function test_empty_optional_fields_are_dropped(): void {
		$post = $this->post();
		unset( $post['author'], $post['date'], $post['summary'] );
		$item = ItemMapper::map( $post );
		$this->assertArrayNotHasKey( 'subtitle', $item );
		$this->assertArrayNotHasKey( 'meta', $item );
	}

	public function test_decode_text_turns_html_entities_into_characters(): void {
		$this->assertSame( "It\u{2019}s a test\u{2026} \"x\" & 'y'", ItemMapper::decode_text( 'It&#8217;s a test&hellip; &quot;x&quot; &amp; &#039;y&#039;' ) );
		$this->assertSame( 'Plain', ItemMapper::decode_text( 'Plain' ) );
		$this->assertSame( 'A bold <word>', ItemMapper::decode_text( 'A <em>bold</em> &lt;word&gt;' ) );
	}

	public function test_file_video_with_an_image_is_a_video_card(): void {
		$post          = $this->post();
		$post['video'] = array(
			'url'      => 'https://example.com/u/clip.m3u8',
			'duration' => 61,
		);
		$item          = ItemMapper::map( $post );

		$this->assertSame( 'https://example.com/u/clip.m3u8', $item['video'] );
		$this->assertSame( 'hls', $item['video_type'] );
		$this->assertSame( 'video', $item['media_type'] );
		$this->assertSame( 61, $item['duration'] );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ) ) ) );
	}

	public function test_file_video_without_an_image_stays_a_text_card_without_video(): void {
		$post          = $this->post();
		$post['image'] = null;
		$post['video'] = array( 'url' => 'https://example.com/u/clip.mp4' );
		$item          = ItemMapper::map( $post );

		$this->assertArrayNotHasKey( 'video', $item );
		$this->assertArrayNotHasKey( 'media_type', $item );
	}

	public function test_bad_video_url_and_duration_are_dropped(): void {
		$post          = $this->post();
		$post['video'] = array( 'url' => 'javascript:alert(1)' );
		$this->assertArrayNotHasKey( 'video', ItemMapper::map( $post ) );

		$post['video'] = array(
			'url'      => 'https://example.com/u/clip.mp4',
			'duration' => -3,
		);
		$item          = ItemMapper::map( $post );
		$this->assertSame( 'file', $item['video_type'] );
		$this->assertArrayNotHasKey( 'duration', $item );
	}

	public function test_youtube_embed_keeps_the_featured_image(): void {
		$post          = $this->post();
		$post['embed'] = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
		$item          = ItemMapper::map( $post );

		$this->assertSame( 'https://example.com/u/h-768.jpg', $item['image'] );
		$this->assertSame( 'video', $item['media_type'] );
		$this->assertSame(
			array(
				'provider' => 'YouTube',
				'embed'    => 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
			),
			$item['unplayable']
		);
		$this->assertArrayNotHasKey( 'video', $item );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ) ) ) );
	}

	public function test_youtube_embed_without_an_image_gets_the_youtube_poster(): void {
		$post          = $this->post();
		$post['image'] = null;
		$post['embed'] = 'https://youtu.be/dQw4w9WgXcQ';
		$item          = ItemMapper::map( $post );

		$this->assertSame( 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', $item['image'] );
		$this->assertEqualsWithDelta( 16 / 9, $item['aspect'], 0.0001 );
		$this->assertSame( 'YouTube', $item['unplayable']['provider'] );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ) ) ) );
	}

	public function test_vimeo_embed_without_an_image_is_a_text_card_that_keeps_the_provider(): void {
		$post          = $this->post();
		$post['image'] = null;
		$post['embed'] = 'https://vimeo.com/76979871/abcdef1234';
		$item          = ItemMapper::map( $post );

		$this->assertArrayNotHasKey( 'image', $item );
		$this->assertSame( 'Hello', $item['title'] );
		$this->assertSame( 'video', $item['media_type'] );
		$this->assertSame( 'https://player.vimeo.com/video/76979871?h=abcdef1234', $item['unplayable']['embed'] );
		$this->assertSame( array(), SpecShape::feed_page( array( 'items' => array( $item ) ) ) );
	}

	public function test_a_lookalike_embed_is_ignored(): void {
		$post          = $this->post();
		$post['embed'] = 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ';
		$item          = ItemMapper::map( $post );

		$this->assertArrayNotHasKey( 'unplayable', $item );
		$this->assertArrayNotHasKey( 'media_type', $item );
	}

	public function test_first_video_block_reads_core_video(): void {
		$blocks = array(
			array(
				'blockName' => null,
				'attrs'     => array(),
				'innerHTML' => "\n\n",
			),
			array(
				'blockName' => 'core/video',
				'attrs'     => array( 'id' => 77 ),
				'innerHTML' => '<figure class="wp-block-video"><video controls poster="https://example.com/p.jpg?a=1&#038;b=2" src="https://example.com/v.mp4"></video></figure>',
			),
		);

		$this->assertSame(
			array(
				'kind'   => 'video',
				'id'     => 77,
				'src'    => 'https://example.com/v.mp4',
				'poster' => 'https://example.com/p.jpg?a=1&b=2',
			),
			ItemMapper::first_video_block( $blocks )
		);
	}

	public function test_first_video_block_reads_core_embed_and_only_the_first_real_block(): void {
		$embed = array(
			'blockName' => 'core/embed',
			'attrs'     => array( 'url' => 'https://youtu.be/dQw4w9WgXcQ' ),
			'innerHTML' => '',
		);
		$para  = array(
			'blockName' => 'core/paragraph',
			'attrs'     => array(),
			'innerHTML' => '<p>Intro</p>',
		);

		$this->assertSame(
			array(
				'kind' => 'embed',
				'url'  => 'https://youtu.be/dQw4w9WgXcQ',
			),
			ItemMapper::first_video_block( array( $embed ) )
		);
		$this->assertNull( ItemMapper::first_video_block( array( $para, $embed ) ) );
		$this->assertNull( ItemMapper::first_video_block( array() ) );
	}
}
