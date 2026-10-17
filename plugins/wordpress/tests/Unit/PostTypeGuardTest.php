<?php
namespace Diazoma\Wall\Tests\Unit;

use Brain\Monkey\Functions;
use Diazoma\Wall\PostTypeGuard;

final class PostTypeGuardTest extends TestCase {

	public function test_public_type_is_allowed(): void {
		Functions\when( 'get_post_type_object' )->justReturn( (object) array( 'public' => true ) );
		$this->assertNull( PostTypeGuard::check( 'post' ) );
	}

	public function test_non_public_type_is_forbidden(): void {
		Functions\when( 'get_post_type_object' )->justReturn( (object) array( 'public' => false ) );
		$this->assertSame( array( 'code' => 'diazoma_forbidden_type', 'status' => 403 ), PostTypeGuard::check( 'shop_order' ) );
	}

	public function test_unknown_type_is_bad_request(): void {
		Functions\when( 'get_post_type_object' )->justReturn( null );
		$this->assertSame( array( 'code' => 'diazoma_invalid_type', 'status' => 400 ), PostTypeGuard::check( 'nope' ) );
	}

	public function test_empty_type_is_bad_request_without_lookup(): void {
		Functions\expect( 'get_post_type_object' )->never();
		$this->assertSame( 400, PostTypeGuard::check( '' )['status'] );
	}
}
