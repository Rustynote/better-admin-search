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
	
	function __construct() { /* Do nothing */ }
	
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
		require_once $this->includes_dir.'helpers.php';
		require_once $this->includes_dir.'endpoints.php';
		require_once $this->includes_dir.'query.php';
	}
	
	function actions(): void {
		add_action('admin_enqueue_scripts', [
			$this,
			'admin_enqueue_scripts'
		]);
	}
	
	function admin_enqueue_scripts($hook): void {
		if($hook != 'edit.php') {
			return;
		}
		
		$post_type = $_GET['post_type'] ?? 'post';

		wp_enqueue_style($this->basename.'-style', $this->assets_url.'style.css', [], $this->version);
		wp_enqueue_script($this->basename.'-script', $this->assets_url.'script.js', [], $this->version);
		wp_localize_script($this->basename.'-script', 'baSearchData', [
			'filterBoxToggleLabel'       => __('Advanced Filters', 'ba-search'),
			'filterBoxToggleCancelLabel' => __('Cancel', 'ba-search'),
			'popupTitle'                 => __('Filters', 'ba-search'),
			'options'                    => $this->dropdown_options($post_type),
			'postType'                   => $post_type,
			'apiUrl'                     => get_rest_url(null, 'bas/v1/get_values'),
			'keysApiUrl'                 => get_rest_url(null, 'bas/v1/get_keys'),
			'nonce'                      => wp_create_nonce('wp_rest')
		]);
	}

	function dropdown_options(string $post_type): array {
		$options = [
			'postmeta'    => __('Custom Fields', 'ba-search'),
			'date_query'  => __('Publish Date', 'ba-search'),
			'mod_date'    => __('Modification Date', 'ba-search'),
			'post_author' => __('Post Author', 'ba-search'),
			'post_status' => __('Post Status', 'ba-search'),
			'post_name'   => __('Post Slug', 'ba-search'),
			'post_parent' => __('Post Parent', 'ba-search'),
			'taxonomies'  => __('Taxonomies', 'ba-search'),
		];
		
		return array_filter($options);
	}
}

function plugin(): ?plugin {
	return plugin::init();
}

function is_rest_request(): bool {
	if(defined('REST_REQUEST') && REST_REQUEST) {
		return true;
	}

	if(!isset($_SERVER['REQUEST_URI'])) {
		return false;
	}

	// This runs before the 'parse_request' action, so the REST_REQUEST
	// constant isn't defined yet even for an actual REST request.
	$rest_prefix = trailingslashit(rest_get_url_prefix());

	return strpos($_SERVER['REQUEST_URI'], $rest_prefix) !== false;
}

// Load plugin only in wp-admin or on REST API requests; skip the frontend.
if(is_admin() || is_rest_request()) {
	plugin();
}