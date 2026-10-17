<?php
namespace Diazoma\Wall\Tests\Unit;

use PHPUnit\Framework\Attributes\DataProvider;
use Diazoma\Wall\Cursor;
use Diazoma\Wall\FeedArgs;

final class CursorTest extends TestCase {

	public function test_roundtrip(): void {
		$cursor = Cursor::encode( '2026-03-01 12:30:45', 321 );
		$this->assertMatchesRegularExpression( '/^[A-Za-z0-9_-]+$/', $cursor );
		$this->assertSame( array( 'd' => '2026-03-01 12:30:45', 'id' => 321 ), Cursor::decode( $cursor ) );
	}

	public function test_payload_is_base64url_json_with_d_and_id(): void {
		$cursor = Cursor::encode( '2026-03-01 12:30:45', 7 );
		$json   = base64_decode( strtr( $cursor, '-_', '+/' ), true );
		$this->assertSame( array( 'd' => '2026-03-01 12:30:45', 'id' => 7 ), json_decode( (string) $json, true ) );
	}

	/** @return array<string,array{0:?string}> */
	public static function malformed(): array {
		$b64 = static fn( string $s ): string => rtrim( strtr( base64_encode( $s ), '+/', '-_' ), '=' );
		return array(
			'null'            => array( null ),
			'empty'           => array( '' ),
			'not base64'      => array( '!!!not base64!!!' ),
			'not json'        => array( $b64( 'hello' ) ),
			'json scalar'     => array( $b64( '5' ) ),
			'missing id'      => array( $b64( '{"d":"2026-03-01 12:30:45"}' ) ),
			'bad date'        => array( $b64( '{"d":"yesterday","id":3}' ) ),
			'string id'       => array( $b64( '{"d":"2026-03-01 12:30:45","id":"3"}' ) ),
			'zero id'         => array( $b64( '{"d":"2026-03-01 12:30:45","id":0}' ) ),
			'sql in date'     => array( $b64( '{"d":"2026-03-01 12:30:45\' OR 1=1","id":3}' ) ),
		);
	}

	#[DataProvider( 'malformed' )]
	public function test_malformed_returns_null( ?string $cursor ): void {
		$this->assertNull( Cursor::decode( $cursor ) );
	}

	public function test_limit_default_and_cap(): void {
		$this->assertSame( 50, FeedArgs::limit( null ) );
		$this->assertSame( 50, FeedArgs::limit( 'abc' ) );
		$this->assertSame( 100, FeedArgs::limit( '5000' ) );
		$this->assertSame( 1, FeedArgs::limit( -4 ) );
		$this->assertSame( 20, FeedArgs::limit( '20' ) );
	}
}
