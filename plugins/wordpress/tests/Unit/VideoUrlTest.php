<?php
namespace Diazoma\Wall\Tests\Unit;

use Diazoma\Wall\VideoUrl;
use PHPUnit\Framework\Attributes\DataProvider;

final class VideoUrlTest extends TestCase {

	private const ID = 'dQw4w9WgXcQ';

	/** @return array<string,array{0:string}> */
	public static function youtube_urls(): array {
		$id = self::ID;
		return array(
			'watch'         => array( "https://www.youtube.com/watch?v=$id" ),
			'watch extras'  => array( "https://youtube.com/watch?v=$id&t=4s&list=PL1" ),
			'mobile'        => array( "https://m.youtube.com/watch?v=$id" ),
			'youtu.be'      => array( "https://youtu.be/$id?si=a" ),
			'shorts'        => array( "https://www.youtube.com/shorts/$id" ),
			'shorts slash'  => array( "https://youtube.com/shorts/$id/" ),
			'embed'         => array( "https://www.youtube.com/embed/$id" ),
			'nocookie'      => array( "https://www.youtube-nocookie.com/embed/$id" ),
			'http'          => array( "http://youtube.com/watch?v=$id" ),
		);
	}

	#[DataProvider( 'youtube_urls' )]
	public function test_recognises_youtube( string $url ): void {
		$this->assertSame(
			array(
				'provider' => 'YouTube',
				'embed'    => 'https://www.youtube-nocookie.com/embed/' . self::ID,
				'poster'   => 'https://i.ytimg.com/vi/' . self::ID . '/hqdefault.jpg',
			),
			VideoUrl::hosted( $url )
		);
	}

	/** @return array<string,array{0:string,1:string}> */
	public static function vimeo_urls(): array {
		return array(
			'plain'       => array( 'https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871' ),
			'www'         => array( 'https://www.vimeo.com/76979871', 'https://player.vimeo.com/video/76979871' ),
			'hash'        => array( 'https://vimeo.com/76979871/abcdef1234', 'https://player.vimeo.com/video/76979871?h=abcdef1234' ),
			'player'      => array( 'https://player.vimeo.com/video/76979871', 'https://player.vimeo.com/video/76979871' ),
			'player hash' => array( 'https://player.vimeo.com/video/76979871?h=abcdef1234&autoplay=1', 'https://player.vimeo.com/video/76979871?h=abcdef1234' ),
		);
	}

	#[DataProvider( 'vimeo_urls' )]
	public function test_recognises_vimeo( string $url, string $embed ): void {
		$this->assertSame(
			array(
				'provider' => 'Vimeo',
				'embed'    => $embed,
			),
			VideoUrl::hosted( $url )
		);
	}

	/** @return array<string,array{0:string}> */
	public static function not_hosted(): array {
		$id = self::ID;
		return array(
			'suffix host'    => array( "https://youtube.com.evil.example/watch?v=$id" ),
			'prefix host'    => array( "https://evilyoutube.com/watch?v=$id" ),
			'userinfo'       => array( "https://youtube.com@evil.example/watch?v=$id" ),
			'path trick'     => array( "https://evil.example/youtube.com/watch?v=$id" ),
			'youtu.be sfx'   => array( "https://youtu.be.evil.example/$id" ),
			'music host'     => array( "https://music.youtube.com/watch?v=$id" ),
			'mobile shorts'  => array( "https://m.youtube.com/shorts/$id" ),
			'short id'       => array( 'https://www.youtube.com/watch?v=short' ),
			'long id'        => array( "https://www.youtube.com/watch?v={$id}x" ),
			'channel'        => array( 'https://www.youtube.com/@channel' ),
			'ftp'            => array( "ftp://youtube.com/watch?v=$id" ),
			'javascript'     => array( "javascript:alert(1)//youtube.com/watch?v=$id" ),
			'relative'       => array( "/watch?v=$id" ),
			'vimeo suffix'   => array( 'https://vimeo.com.evil.example/76979871' ),
			'vimeo channel'  => array( 'https://vimeo.com/channels/staffpicks' ),
			'player letters' => array( 'https://player.vimeo.com/video/abc' ),
			'repeated v'     => array( "https://www.youtube.com/watch?v=$id&v=$id" ),
			'repeated v 2'   => array( "https://www.youtube.com/watch?v=$id&v=aaaaaaaaaaa" ),
			'repeated h'     => array( 'https://player.vimeo.com/video/76979871?h=abcdef1234&h=zzzz' ),
			'backslash user' => array( "https://evil.example\\@www.youtube.com/watch?v=$id" ),
			'backslash path' => array( "https://www.youtube.com\\watch?v=$id" ),
			'empty'          => array( '' ),
		);
	}

	#[DataProvider( 'not_hosted' )]
	public function test_does_not_recognise_lookalikes( string $url ): void {
		$this->assertNull( VideoUrl::hosted( $url ) );
	}

	public function test_embed_allowlist(): void {
		$id = self::ID;
		$no = "https://www.youtube-nocookie.com/embed/$id";
		$this->assertSame( $no, VideoUrl::allowed_embed( $no ) );
		$this->assertSame( $no, VideoUrl::allowed_embed( "https://www.youtube.com/embed/$id?autoplay=1" ) );
		$this->assertSame( 'https://player.vimeo.com/video/1?h=abc', VideoUrl::allowed_embed( 'https://player.vimeo.com/video/1?h=abc' ) );
		$this->assertSame( 'https://player.vimeo.com/video/1', VideoUrl::allowed_embed( 'https://player.vimeo.com/video/1' ) );
		foreach ( array( "http://www.youtube-nocookie.com/embed/$id", "https://youtube.com/embed/$id", "https://www.youtube.com.evil.example/embed/$id", 'https://evil.example/player', "https://www.youtube.com/watch?v=$id", 'javascript:alert(1)' ) as $bad ) {
			$this->assertNull( VideoUrl::allowed_embed( $bad ), $bad );
		}
		$this->assertNull( VideoUrl::allowed_embed( 42 ) );
	}

	public function test_trims_whitespace_and_checks_embed_oddities(): void {
		$id = self::ID;
		$this->assertSame( 'YouTube', VideoUrl::hosted( "  https://youtu.be/$id\n" )['provider'] );
		$this->assertSame( "https://www.youtube-nocookie.com/embed/$id", VideoUrl::allowed_embed( " https://www.youtube.com/embed/$id " ) );
		$this->assertNull( VideoUrl::allowed_embed( 'https://player.vimeo.com/video/1?h=a&h=b' ) );
		$this->assertNull( VideoUrl::allowed_embed( "https://evil.example\\@www.youtube.com/embed/$id" ) );
	}

	public function test_kind_and_http_url(): void {
		$this->assertSame( 'hls', VideoUrl::kind( 'https://x.example/a.M3U8?t=1' ) );
		$this->assertSame( 'dash', VideoUrl::kind( 'https://x.example/a.mpd' ) );
		$this->assertSame( 'file', VideoUrl::kind( 'https://x.example/a.mp4' ) );
		$this->assertTrue( VideoUrl::is_http_url( 'https://x.example/a.mp4' ) );
		$this->assertFalse( VideoUrl::is_http_url( 'javascript:alert(1)' ) );
		$this->assertFalse( VideoUrl::is_http_url( '/a.mp4' ) );
	}
}
