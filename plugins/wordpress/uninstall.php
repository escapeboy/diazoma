<?php
/**
 * Removes plugin data on uninstall.
 *
 * @package Diazoma\Wall
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'diazoma_wall_options' );
delete_site_option( 'diazoma_wall_options' );
delete_option( 'rewrite_rules' );
