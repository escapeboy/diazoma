<?php
/**
 * REST route diazoma/v1/feed.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

/**
 * Registers and serves the feed endpoint.
 */
final class RestController {

	public const NAMESPACE = 'diazoma/v1';

	/**
	 * Register the route.
	 */
	public function register(): void {
		register_rest_route(
			self::NAMESPACE,
			'/feed',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle' ),
				// Public by design: the guard in handle() limits it to public post types.
				'permission_callback' => '__return_true',
				'args'                => array(
					'type'   => array( 'type' => 'string' ),
					'cursor' => array( 'type' => 'string' ),
					'q'      => array( 'type' => 'string' ),
					'limit'  => array( 'type' => 'integer' ),
				),
			)
		);
	}

	/**
	 * Serve one page.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function handle( $request ) {
		$options = Settings::with_defaults( get_option( Settings::OPTION, array() ) );
		$type    = (string) $request->get_param( 'type' );
		if ( '' === $type ) {
			$type = (string) ( $options['post_types'][0] ?? 'post' );
		}

		$error = PostTypeGuard::check( sanitize_key( $type ) );
		if ( null !== $error ) {
			return new \WP_Error(
				$error['code'],
				__( 'This post type is not available.', 'diazoma-wall' ),
				array( 'status' => $error['status'] )
			);
		}

		$search = sanitize_text_field( (string) $request->get_param( 'q' ) );
		$result = ( new FeedService() )->page(
			sanitize_key( $type ),
			Cursor::decode( $request->get_param( 'cursor' ) ),
			$search,
			FeedArgs::limit( $request->get_param( 'limit' ) )
		);

		$body = array( 'items' => $result['items'] );
		if ( null !== $result['next'] ) {
			$body['next'] = $result['next'];
		}
		return rest_ensure_response( $body );
	}
}
