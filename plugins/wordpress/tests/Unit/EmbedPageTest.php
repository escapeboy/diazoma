<?php
namespace Diazoma\Wall\Tests\Unit;

use Brain\Monkey\Functions;
use Diazoma\Wall\EmbedPage;

final class EmbedPageTest extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Functions\stubs( array( 'esc_url', 'esc_attr', 'esc_html', 'esc_html__' ) );
	}

	public function test_prints_script_tag_with_data_attributes(): void {
		$html = EmbedPage::render( 'https://cdn.example.com/diazoma/', 'https://example.com/.well-known/wall.json', 'Site' );
		$this->assertStringContainsString(
			'<script src="https://cdn.example.com/diazoma/diazoma-embed.js" data-manifest="https://example.com/.well-known/wall.json" data-route="/xr" data-core="https://cdn.example.com/diazoma/wall.iife.js"></script>',
			$html
		);
	}

	public function test_hosted_files_without_url(): void {
		$html = EmbedPage::render( '', 'https://example.com/m', 'Site' );
		$this->assertStringContainsString( 'src="https://diazoma.app/wall/0.1.0/diazoma-embed.js"', $html );
		$this->assertStringContainsString( 'data-core="https://diazoma.app/wall/0.1.0/wall.iife.js"', $html );
	}
}
