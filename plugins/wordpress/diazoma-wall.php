<?php
/**
 * Plugin Name:       Diazoma Wall
 * Description:       Publishes a Diazoma wall feed, a .well-known/wall.json manifest and an optional /xr embed page.
 * Version:           0.2.0
 * Requires at least: 6.0
 * Requires PHP:      8.1
 * Author:            Diazoma
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       diazoma-wall
 *
 * @package Diazoma\Wall
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'DIAZOMA_WALL_VERSION', '0.2.0' );
define( 'DIAZOMA_WALL_FILE', __FILE__ );

$diazoma_wall_autoload = __DIR__ . '/vendor/autoload.php';
if ( is_readable( $diazoma_wall_autoload ) ) {
	require_once $diazoma_wall_autoload;
} else {
	// Release zips ship without vendor/: plain PSR-4 loader for Diazoma\Wall\.
	spl_autoload_register(
		static function ( string $class_name ): void {
			$prefix = 'Diazoma\\Wall\\';
			if ( 0 !== strpos( $class_name, $prefix ) ) {
				return;
			}
			$file = __DIR__ . '/src/' . str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) ) . '.php';
			if ( is_readable( $file ) ) {
				require_once $file;
			}
		}
	);
}

register_activation_hook( __FILE__, array( \Diazoma\Wall\Plugin::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( \Diazoma\Wall\Plugin::class, 'deactivate' ) );

\Diazoma\Wall\Plugin::instance()->boot();
