<?php
/**
 * Settings -> Diazoma Wall.
 *
 * @package Diazoma\Wall
 */

namespace Diazoma\Wall\Admin;

use Diazoma\Wall\Settings;

/**
 * Admin page built on the Settings API (nonce handled by settings_fields()).
 */
final class SettingsPage {

	private const PAGE = 'diazoma-wall';

	/**
	 * Register hooks.
	 */
	public function hooks(): void {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_init', array( $this, 'register' ) );
	}

	/**
	 * Add the page under Settings, manage_options only.
	 */
	public function menu(): void {
		add_options_page(
			__( 'Diazoma Wall', 'diazoma-wall' ),
			__( 'Diazoma Wall', 'diazoma-wall' ),
			'manage_options',
			self::PAGE,
			array( $this, 'render' )
		);
	}

	/**
	 * Register the setting; options.php checks the nonce and capability.
	 */
	public function register(): void {
		register_setting(
			'diazoma_wall',
			Settings::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize' ),
				'default'           => Settings::defaults(),
			)
		);
	}

	/**
	 * Sanitise and surface the contrast warning.
	 *
	 * @param mixed $input Submitted value.
	 * @return array<string,mixed>
	 */
	public function sanitize( $input ): array {
		if ( ! current_user_can( 'manage_options' ) ) {
			return Settings::with_defaults( get_option( Settings::OPTION, array() ) );
		}
		$clean   = Settings::sanitize( $input, $this->public_types() );
		$warning = Settings::contrast_warning( $clean['accent'] );
		if ( null !== $warning ) {
			add_settings_error( Settings::OPTION, 'diazoma_wall_contrast', $warning, 'warning' );
		}
		return $clean;
	}

	/**
	 * Render the form.
	 */
	public function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$o     = Settings::with_defaults( get_option( Settings::OPTION, array() ) );
		$name  = Settings::OPTION;
		$types = get_post_types( array( 'public' => true ), 'objects' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Diazoma Wall', 'diazoma-wall' ); ?></h1>
			<form action="options.php" method="post">
				<?php settings_fields( 'diazoma_wall' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Post types in the wall', 'diazoma-wall' ); ?></th>
						<td>
							<?php foreach ( $types as $slug => $type ) : ?>
								<label style="display:block">
									<input type="checkbox" name="<?php echo esc_attr( $name ); ?>[post_types][]" value="<?php echo esc_attr( $slug ); ?>" <?php checked( in_array( $slug, $o['post_types'], true ) ); ?>>
									<?php echo esc_html( $type->labels->name ); ?>
								</label>
							<?php endforeach; ?>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="diazoma-accent"><?php esc_html_e( 'Accent colour', 'diazoma-wall' ); ?></label></th>
						<td>
							<input id="diazoma-accent" type="color" name="<?php echo esc_attr( $name ); ?>[accent]" value="<?php echo esc_attr( $o['accent'] ); ?>">
							<p class="description"><?php esc_html_e( 'Checked against the wall background; at least 4.5:1 is recommended.', 'diazoma-wall' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="diazoma-policy"><?php esc_html_e( 'Policy', 'diazoma-wall' ); ?></label></th>
						<td>
							<select id="diazoma-policy" name="<?php echo esc_attr( $name ); ?>[policy]">
								<?php foreach ( Settings::POLICIES as $policy ) : ?>
									<option value="<?php echo esc_attr( $policy ); ?>" <?php selected( $o['policy'], $policy ); ?>><?php echo esc_html( $policy ); ?></option>
								<?php endforeach; ?>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( '/xr page', 'diazoma-wall' ); ?></th>
						<td>
							<label>
								<input type="checkbox" name="<?php echo esc_attr( $name ); ?>[xr_enabled]" value="1" <?php checked( ! empty( $o['xr_enabled'] ) ); ?>>
								<?php esc_html_e( 'Serve the embedded wall at /xr', 'diazoma-wall' ); ?>
							</label>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="diazoma-script"><?php esc_html_e( 'Script base URL', 'diazoma-wall' ); ?></label></th>
						<td>
							<input id="diazoma-script" class="regular-text" type="url" name="<?php echo esc_attr( $name ); ?>[base_url]" value="<?php echo esc_attr( $o['base_url'] ); ?>" placeholder="https://cdn.example/diazoma">
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Slugs of public post types.
	 *
	 * @return string[]
	 */
	private function public_types(): array {
		return array_values( get_post_types( array( 'public' => true ) ) );
	}
}
