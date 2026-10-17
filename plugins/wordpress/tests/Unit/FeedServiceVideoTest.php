<?php
namespace Diazoma\Wall\Tests\Unit;

use Brain\Monkey\Functions;
use Diazoma\Wall\FeedService;

final class FeedServiceVideoTest extends TestCase {

	/**
	 * Call the private FeedService::video_of().
	 *
	 * @param object $post Post.
	 * @return array{0:?array<string,mixed>,1:string,2:int}
	 */
	private function video_of( object $post ): array {
		$method = new \ReflectionMethod( FeedService::class, 'video_of' );
		return $method->invoke( new FeedService(), $post );
	}

	public function test_media_library_video_gives_attachment_url_duration_and_poster_id(): void {
		Functions\when( 'parse_blocks' )->justReturn(
			array(
				array(
					'blockName' => 'core/video',
					'attrs'     => array( 'id' => 77 ),
					'innerHTML' => '<video poster="https://example.com/p.jpg" src="https://example.com/old.mp4"></video>',
				),
			)
		);
		Functions\when( 'wp_attachment_is' )->justReturn( true );
		Functions\when( 'wp_get_attachment_url' )->justReturn( 'https://example.com/wp-content/uploads/clip.mp4' );
		Functions\when( 'wp_get_attachment_metadata' )->justReturn( array( 'length' => 94 ) );
		Functions\when( 'attachment_url_to_postid' )->justReturn( 55 );

		$out = $this->video_of( (object) array( 'post_content' => 'x' ) );

		$this->assertSame(
			array(
				'url'      => 'https://example.com/wp-content/uploads/clip.mp4',
				'duration' => 94,
			),
			$out[0]
		);
		$this->assertSame( '', $out[1] );
		$this->assertSame( 55, $out[2] );
	}

	public function test_block_without_attachment_uses_markup_src_and_has_no_duration(): void {
		Functions\when( 'parse_blocks' )->justReturn(
			array(
				array(
					'blockName' => 'core/video',
					'attrs'     => array(),
					'innerHTML' => '<video src="https://example.com/v.m3u8"></video>',
				),
			)
		);

		$this->assertSame( array( array( 'url' => 'https://example.com/v.m3u8' ), '', 0 ), $this->video_of( (object) array( 'post_content' => 'x' ) ) );
	}

	public function test_embed_block_and_plain_post(): void {
		Functions\when( 'parse_blocks' )->justReturn(
			array(
				array(
					'blockName' => 'core/embed',
					'attrs'     => array( 'url' => 'https://youtu.be/dQw4w9WgXcQ' ),
					'innerHTML' => '',
				),
			)
		);
		$this->assertSame( array( null, 'https://youtu.be/dQw4w9WgXcQ', 0 ), $this->video_of( (object) array( 'post_content' => 'x' ) ) );

		Functions\when( 'parse_blocks' )->justReturn( array() );
		$this->assertSame( array( null, '', 0 ), $this->video_of( (object) array( 'post_content' => '' ) ) );
	}
}
