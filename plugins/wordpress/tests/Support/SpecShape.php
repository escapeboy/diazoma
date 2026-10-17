<?php
namespace Diazoma\Wall\Tests\Support;

use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;

/**
 * Validates against the real JSON Schemas in packages/spec/schemas.
 *
 * Each method returns a list of problems (empty = valid).
 */
final class SpecShape {

	private const BASE = 'https://diazoma.app/spec/v1/';

	/**
	 * @param array<string,mixed> $page Feed response.
	 * @return string[]
	 */
	public static function feed_page( array $page ): array {
		return self::validate( $page, 'feed' );
	}

	/**
	 * @param array<string,mixed> $manifest Manifest document.
	 * @return string[]
	 */
	public static function manifest( array $manifest ): array {
		return self::validate( $manifest, 'manifest' );
	}

	/**
	 * @param array<string,mixed> $data Document.
	 * @return string[]
	 */
	private static function validate( array $data, string $name ): array {
		$dir = dirname( __DIR__, 4 ) . '/packages/spec/schemas';
		$validator = new Validator();
		foreach ( array( 'feed', 'item', 'manifest', 'recipe', 'view' ) as $schema ) {
			$validator->resolver()->registerFile( self::BASE . $schema . '.schema.json', $dir . '/' . $schema . '.schema.json' );
		}

		$result = $validator->validate( json_decode( json_encode( $data ) ), self::BASE . $name . '.schema.json' );
		if ( $result->isValid() ) {
			return array();
		}

		return array_map(
			static fn( $path, $messages ) => $path . ': ' . implode( '; ', (array) $messages ),
			array_keys( ( new ErrorFormatter() )->format( $result->error() ) ),
			array_values( ( new ErrorFormatter() )->format( $result->error() ) )
		);
	}
}
