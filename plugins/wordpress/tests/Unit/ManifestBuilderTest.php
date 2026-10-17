<?php
namespace Diazoma\Wall\Tests\Unit;

use Brain\Monkey\Filters;
use Brain\Monkey\Functions;
use Diazoma\Wall\ManifestBuilder;
use Diazoma\Wall\Plugin;
use Diazoma\Wall\Settings;
use Diazoma\Wall\Tests\Support\SpecShape;

final class ManifestBuilderTest extends TestCase {

	public function test_feeds_per_type_plus_search(): void {
		$m = ManifestBuilder::build(
			array_merge( Settings::defaults(), array( 'policy' => 'recipes-only', 'accent' => '#ff8800' ) ),
			'My Site',
			'https://example.com/wp-json/diazoma/v1/feed',
			array( 'post' => 'Posts', 'product' => 'Products' )
		);

		$this->assertSame( array(), SpecShape::manifest( $m ) );
		$this->assertSame( 1, $m['version'] );
		$this->assertSame( 'recipes-only', $m['policy'] );
		$this->assertSame( 'My Site', $m['name'] );
		$this->assertSame( '#ff8800', $m['brand']['accent'] );
		$this->assertSame( array( 'post', 'product', 'search' ), array_column( $m['feeds'], 'id' ) );
		$this->assertSame( 'https://example.com/wp-json/diazoma/v1/feed?type=product', $m['feeds'][1]['url'] );
		$this->assertTrue( $m['feeds'][0]['cursor'] );
		$this->assertSame( 'search', $m['feeds'][2]['type'] );
		$this->assertSame( 'https://example.com/wp-json/diazoma/v1/feed?type=post&q={query}', $m['feeds'][2]['url'] );
		$this->assertArrayNotHasKey( 'embed', $m );
	}

	public function test_plain_permalinks_feed_url_uses_ampersand(): void {
		$m = ManifestBuilder::build( Settings::defaults(), 'S', 'https://example.com/?rest_route=/diazoma/v1/feed', array( 'post' => 'Posts' ) );
		$this->assertSame( 'https://example.com/?rest_route=/diazoma/v1/feed&type=post', $m['feeds'][0]['url'] );
	}

	public function test_no_types_means_no_feeds_and_no_search(): void {
		$m = ManifestBuilder::build( Settings::defaults(), 'S', 'https://example.com/f', array() );
		$this->assertSame( array(), $m['feeds'] );
	}

	public function test_embed_route_when_xr_enabled(): void {
		$m = ManifestBuilder::build( array_merge( Settings::defaults(), array( 'xr_enabled' => true ) ), 'S', 'https://example.com/f', array( 'post' => 'Posts' ) );
		$this->assertSame( array( 'route' => '/xr' ), $m['embed'] );
	}

	public function test_json_encodes_to_spec_shape(): void {
		$m    = ManifestBuilder::build( Settings::defaults(), 'S', 'https://example.com/f', array( 'post' => 'Posts' ) );
		$back = json_decode( (string) json_encode( $m ), true );
		$this->assertSame( array(), SpecShape::manifest( $back ) );
	}

	public function test_filter_can_add_a_view_and_the_result_stays_in_spec_shape(): void {
		Functions\when( 'get_bloginfo' )->justReturn( 'My Site' );
		Functions\when( 'rest_url' )->justReturn( 'https://example.com/wp-json/diazoma/v1/feed' );
		Functions\when( 'get_post_type_object' )->alias(
			static fn( $slug ) => (object) array(
				'public' => true,
				'labels' => (object) array( 'name' => 'Posts' ),
			)
		);
		// Brain Monkey does not run callbacks added with add_filter(); it answers apply_filters() itself.
		Filters\expectApplied( 'diazoma_wall_manifest' )->once()->andReturnUsing(
			static function ( array $manifest ): array {
				$manifest['view'] = array(
					'wall'    => array( 'rows' => 4, 'indicator' => null ),
					'actions' => array( 'cart' => array( 'label' => 'Add to cart', 'placement' => 'primary' ) ),
				);
				return $manifest;
			}
		);

		$m = Plugin::instance()->manifest( Settings::defaults() );

		$this->assertSame( 4, $m['view']['wall']['rows'] );
		$this->assertSame( array(), SpecShape::manifest( json_decode( (string) json_encode( $m ), true ) ) );
	}

	public function test_filter_result_outside_the_view_limits_is_reported_by_the_schema(): void {
		$m         = ManifestBuilder::build( Settings::defaults(), 'S', 'https://example.com/f', array( 'post' => 'Posts' ) );
		$m['view'] = array( 'wall' => array( 'rows' => 9 ) );

		$this->assertNotSame( array(), SpecShape::manifest( $m ) );
	}

	public function test_a_filter_that_returns_a_non_array_is_ignored(): void {
		Functions\when( 'get_bloginfo' )->justReturn( 'S' );
		Functions\when( 'rest_url' )->justReturn( 'https://example.com/f' );
		Functions\when( 'get_post_type_object' )->justReturn( null );
		Filters\expectApplied( 'diazoma_wall_manifest' )->once()->andReturn( 'broken' );

		$m = Plugin::instance()->manifest( Settings::defaults() );

		$this->assertSame( 1, $m['version'] );
	}
}
