<?php
/**
 * Plugin bootstrap: hooks, rewrite rules, manifest and embed output.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall;

use Diazoma\Wall\Admin\SettingsPage;

/**
 * Main plugin class.
 */
final class Plugin {

	/** @var self|null */
	private static $instance = null;

	/**
	 * Singleton accessor.
	 */
	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register hooks.
	 */
	public function boot(): void {
		add_action( 'init', array( $this, 'register_rewrites' ) );
		add_filter( 'query_vars', array( $this, 'query_vars' ) );
		add_action( 'template_redirect', array( $this, 'serve' ) );
		add_filter( 'redirect_canonical', array( $this, 'skip_canonical' ) );
		add_action( 'rest_api_init', array( new RestController(), 'register' ) );
		add_action( 'wp_head', array( $this, 'head_links' ) );
		add_action( 'update_option_' . Settings::OPTION, array( $this, 'schedule_rewrite_flush' ) );
		add_action( 'add_option_' . Settings::OPTION, array( $this, 'schedule_rewrite_flush' ) );

		if ( is_admin() ) {
			( new SettingsPage() )->hooks();
		}
	}

	/**
	 * Activation: register rules, then flush.
	 */
	public static function activate(): void {
		self::instance()->register_rewrites();
		flush_rewrite_rules();
	}

	/**
	 * Deactivation: flush so our rules disappear.
	 */
	public static function deactivate(): void {
		flush_rewrite_rules();
	}

	/**
	 * Rewrite rules for the manifest and the optional /xr page.
	 */
	public function register_rewrites(): void {
		add_rewrite_rule( '^\.well-known/wall\.json$', 'index.php?diazoma_manifest=1', 'top' );
		if ( $this->options()['xr_enabled'] ) {
			add_rewrite_rule( '^xr/?$', 'index.php?diazoma_xr=1', 'top' );
		}
	}

	/**
	 * Rules depend on the xr setting: drop the cached rules so they regenerate.
	 */
	public function schedule_rewrite_flush(): void {
		delete_option( 'rewrite_rules' );
	}

	/**
	 * Register our query vars.
	 *
	 * @param string[] $vars Query vars.
	 * @return string[]
	 */
	public function query_vars( array $vars ): array {
		$vars[] = 'diazoma_manifest';
		$vars[] = 'diazoma_xr';
		return $vars;
	}

	/**
	 * Keep WordPress from redirecting our virtual URLs.
	 *
	 * @param string|false $redirect Redirect target.
	 * @return string|false
	 */
	public function skip_canonical( $redirect ) {
		if ( get_query_var( 'diazoma_manifest' ) || get_query_var( 'diazoma_xr' ) ) {
			return false;
		}
		return $redirect;
	}

	/**
	 * Output the manifest or the embed page when requested.
	 */
	public function serve(): void {
		$options = $this->options();

		if ( get_query_var( 'diazoma_manifest' ) ) {
			$manifest = $this->manifest( $options );
			status_header( 200 );
			header( 'Content-Type: application/json; charset=utf-8' );
			header( 'Access-Control-Allow-Origin: *' );
			header( 'Cache-Control: public, max-age=300' );
			echo wp_json_encode( $manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			exit;
		}

		if ( get_query_var( 'diazoma_xr' ) && $options['xr_enabled'] ) {
			status_header( 200 );
			header( 'Content-Type: text/html; charset=utf-8' );
			echo EmbedPage::render( $options['base_url'], home_url( '/.well-known/wall.json' ), get_bloginfo( 'name' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			exit;
		}
	}

	/**
	 * The manifest as served: built from the settings, then passed through the
	 * `diazoma_wall_manifest` filter so a theme or plugin can add a `view`.
	 *
	 * @param array<string,mixed> $options Settings with defaults applied.
	 * @return array<string,mixed>
	 */
	public function manifest( array $options ): array {
		$manifest = ManifestBuilder::build(
			$options,
			get_bloginfo( 'name' ),
			rest_url( RestController::NAMESPACE . '/feed' ),
			$this->type_labels( $options['post_types'] )
		);

		/**
		 * Filters the manifest served at /.well-known/wall.json.
		 *
		 * @param array<string,mixed> $manifest The built manifest.
		 * @param array<string,mixed> $options  The plugin settings.
		 */
		$filtered = apply_filters( 'diazoma_wall_manifest', $manifest, $options );

		return is_array( $filtered ) ? $filtered : $manifest;
	}

	/**
	 * Discovery link tags.
	 */
	public function head_links(): void {
		$types = $this->type_labels( $this->options()['post_types'] );
		if ( array() === $types ) {
			return;
		}
		$feed = rest_url( RestController::NAMESPACE . '/feed' );
		$sep  = false !== strpos( $feed, '?' ) ? '&' : '?';
		$first = (string) array_key_first( $types );

		printf(
			'<link rel="wall-manifest" href="%s">' . "\n",
			esc_url( home_url( '/.well-known/wall.json' ) )
		);
		printf(
			'<link rel="wall-feed" href="%s" title="%s">' . "\n",
			esc_url( $feed . $sep . 'type=' . rawurlencode( $first ) ),
			esc_attr( $types[ $first ] )
		);
	}

	/**
	 * Options with defaults.
	 *
	 * @return array<string,mixed>
	 */
	private function options(): array {
		return Settings::with_defaults( get_option( Settings::OPTION, array() ) );
	}

	/**
	 * Slug => label for enabled types that still exist and are public.
	 *
	 * @param string[] $slugs Enabled slugs.
	 * @return array<string,string>
	 */
	private function type_labels( array $slugs ): array {
		$labels = array();
		foreach ( $slugs as $slug ) {
			$object = get_post_type_object( $slug );
			if ( $object && $object->public ) {
				$labels[ $slug ] = (string) $object->labels->name;
			}
		}
		return $labels;
	}
}
