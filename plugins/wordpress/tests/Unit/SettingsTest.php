<?php
namespace Diazoma\Wall\Tests\Unit;

use Brain\Monkey\Functions;
use Diazoma\Wall\Contrast;
use Diazoma\Wall\Settings;

final class SettingsTest extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Functions\when( 'esc_url_raw' )->alias(
			static fn( string $u, ?array $protocols = null ): string => preg_match( '#^https?://#', $u ) ? $u : ''
		);
		Functions\when( '__' )->returnArg();
	}

	public function test_valid_input_is_kept(): void {
		$out = Settings::sanitize(
			array(
				'post_types' => array( 'post', 'product', 'post' ),
				'accent'     => '#FFAA00',
				'policy'     => 'deny',
				'xr_enabled' => '1',
				'base_url' => ' https://cdn.example.com/diazoma ',
			),
			array( 'post', 'page', 'product' )
		);
		$this->assertSame(
			array(
				'post_types' => array( 'post', 'product' ),
				'accent'     => '#ffaa00',
				'policy'     => 'deny',
				'xr_enabled' => true,
				'base_url' => 'https://cdn.example.com/diazoma',
			),
			$out
		);
	}

	public function test_invalid_input_falls_back_to_defaults(): void {
		$out = Settings::sanitize(
			array(
				'post_types' => array( 'shop_order', array( 'x' ), 'post' ),
				'accent'     => 'red; background:url(x)',
				'policy'     => 'anything',
				'base_url' => 'javascript:alert(1)',
			),
			array( 'post' )
		);
		$this->assertSame( array( 'post' ), $out['post_types'] );
		$this->assertSame( '#c9334f', $out['accent'] );
		$this->assertSame( 'allow', $out['policy'] );
		$this->assertFalse( $out['xr_enabled'] );
		$this->assertSame( '', $out['base_url'] );
	}

	public function test_non_array_input(): void {
		$out = Settings::sanitize( 'junk', array( 'post' ) );
		$this->assertSame( array(), $out['post_types'] );
		$this->assertSame( Settings::defaults()['accent'], $out['accent'] );
	}

	public function test_with_defaults_merges(): void {
		$this->assertSame( 'deny', Settings::with_defaults( array( 'policy' => 'deny' ) )['policy'] );
		$this->assertSame( Settings::defaults(), Settings::with_defaults( false ) );
	}

	public function test_contrast_warning(): void {
		$this->assertNull( Settings::contrast_warning( '#ffffff' ) );
		$this->assertIsString( Settings::contrast_warning( '#111111' ) );
	}

	public function test_contrast_ratio_known_values(): void {
		$this->assertEqualsWithDelta( 21.0, Contrast::ratio( '#000000', '#ffffff' ), 0.001 );
		$this->assertEqualsWithDelta( 21.0, Contrast::ratio( '#fff', '#000' ), 0.001 );
		$this->assertEqualsWithDelta( 1.0, Contrast::ratio( '#777777', '#777777' ), 0.001 );
		$this->assertEqualsWithDelta( 4.54, Contrast::ratio( '#767676', '#ffffff' ), 0.01 );
		$this->assertNull( Contrast::ratio( 'blue', '#fff' ) );
	}

	public function test_contrast_threshold(): void {
		$this->assertTrue( Contrast::passes( '#767676', '#ffffff' ) );
		$this->assertFalse( Contrast::passes( '#777777', '#ffffff' ) );
		$this->assertFalse( Contrast::passes( 'nope', '#ffffff' ) );
	}
}
