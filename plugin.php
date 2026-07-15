<?php

namespace BetterAdminSearch;

/**
 *
 * @package           BetterAdminSearch
 * @author            Jaroslav Suhanek
 * @copyright         2026 Jaroslav Suhanek PR DevSolutions
 * @license           GPL-3.0
 *
 * @wordpress-plugin
 * Plugin Name:       Better Admin Search
 * Plugin URI:        https://example.com/plugin-name
 * Description:       Filter wp-admin search by multiple criterias
 * Version:           0.0.1
 * Requires at least: 5.2
 * Requires PHP:      8.1
 * Author:            Jaroslav Suhanek
 * Author URI:        https://wparcanum.com/
 * Text Domain:       ba-search
 * License:           GPL v3
 * License URI:       http://www.gnu.org/licenses/gpl-3.0.txt
 */

class plugin {
	private string $version;
	private string $file;
	private string $basename;
	private string $plugin_dir;
	private string $plugin_url;
	private string $includes_dir;
	private string $lang_dir;
	private string $textdomain;
	private string $assets_url;
	private string $option_name;

	function __construct() { /* Do nothing */}

	static function init(): ?plugin {
		static $init = null;

		if($init === null) {
			$init = new plugin;

			$init->vars();
			$init->includes();
			$init->actions();
		}

		return $init;
	}

	function vars(): void {
		$this->version = '0.0.1';

		// Paths
		$this->file       = __FILE__;
		$this->basename   = plugin_basename($this->file);
		$this->plugin_dir = plugin_dir_path($this->file);
		$this->plugin_url = plugin_dir_url($this->file);

		// Includes
		$this->includes_dir = trailingslashit($this->plugin_dir.'includes');

		// Languages
		$this->lang_dir   = trailingslashit($this->plugin_dir.'languages');
		$this->textdomain = 'ba-search';

		// Assets
		$this->assets_url = trailingslashit($this->plugin_url.'assets');

		// Settings
		$this->option_name = 'ba_search_options';
	}

	function includes(): void {
		require_once $this->includes_dir.'endpoints.php';
		require_once $this->includes_dir.'query.php';
	}

	function actions(): void {
		add_action('admin_enqueue_scripts', [$this, 'admin_enqueue_scripts']);
	}

	function admin_enqueue_scripts($hook): void {
		if($hook != 'edit.php') {
			return;
		}

		wp_enqueue_style($this->basename.'-style', $this->assets_url.'style.css', [], $this->version);
		wp_enqueue_script($this->basename.'-script', $this->assets_url.'script.js', [], $this->version);
		wp_localize_script($this->basename.'-script', 'baSearchData', [
			'filterBoxToggleLabel' => __('Advanced Filters', 'ba-search'),
			'filterBoxToggleCancelLabel' => __('Cancel', 'ba-search'),
			'popupTitle' => __('Filters', 'ba-search'),
			'options' => $this->dropdown_options()
		]);
	}

	function dropdown_options(): array {
		$post_type = $_GET['post_type'] ?? 'post';

		$options = [
			'postmeta' => __('Custom Fields', 'ba-search'),
			'date_query' => __('Publish Date', 'ba-search'),
			'mod_date' => __('Modification Date', 'ba-search'),
			'post_author' => __('Post Author', 'ba-search'),
			'post_status' => __('Post Status', 'ba-search'),
			'post_name' => __('Post Slug', 'ba-search'),
			'post_parent' => __('Post Parent', 'ba-search'),
			'taxonomies' => $this->get_post_type_taxs($post_type),
		];

		return array_filter($options);
	}

	function get_post_type_taxs($post_type): array {
		$out = [];

		$taxonomies = get_object_taxonomies($post_type, 'object');
		foreach($taxonomies as $taxonomy) {
			$out[$taxonomy->name] = $taxonomy->label;
		}

		return $out;
	}
}

function plugin(): ?plugin {
	return plugin::init();
}

// Load plugin only if it's wp-admin or rest api
if(is_admin() || wp_is_serving_rest_request()) {
	plugin();
}