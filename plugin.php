<?php

namespace BetterAdminSearch;

/**
 * Plugin bootstrap: registers the admin hook, builds the filterable field list, and localizes
 * it to script.js so the frontend can render the field/value pickers described there.
 *
 * Plugin Name:       Better Admin Search
 * Plugin URI:        https://github.com/Rustynote/better-admin-search
 * Description:       Adds advanced filters to the post/page list screens, letting you combine multiple conditions with AND/OR logic to narrow results fast.
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
	// Populated by vars(), called once from init(). See vars() for what each one holds.
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
	
	// Instantiated only via init(); nothing to set up here that vars()/includes()/actions()
	// don't already handle in a defined order.
	function __construct() { /* Do nothing */ }
	
	/**
	 * Boots the plugin exactly once, no matter how many times it's called.
	 *
	 * Uses a static local rather than a class property for the singleton instance so that
	 * calling plugin() (the module-level accessor at the bottom of this file) before the
	 * instance exists is enough to trigger construction — there's no separate "has it been
	 * initialized?" check to keep in sync.
	 *
	 * @return plugin|null The singleton instance. Effectively never null in practice — vars(),
	 *                      includes(), and actions() don't have a failure path — but typed
	 *                      nullable to match the constructor's return contract.
	 */
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
	
	/**
	 * Populates the path/URL/settings properties used throughout the class.
	 *
	 * Must run before includes() and actions(), since both rely on paths set up here
	 * ($includes_dir for the require_once calls, and — indirectly, via admin_enqueue_scripts()
	 * — $assets_url and $basename for the enqueued style/script).
	 */
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
	
	/**
	 * Loads the plugin's supporting files.
	 *
	 * helpers.php's value-lookup functions call into Query\with_timeout() etc. from query.php,
	 * but since those are plain function definitions (not executed on load), the require order
	 * below doesn't actually matter — PHP only needs query.php loaded by the time helpers.php's
	 * functions are called, not by the time they're defined.
	 */
	function includes(): void {
		require_once $this->includes_dir.'helpers.php';
		require_once $this->includes_dir.'endpoints.php';
		require_once $this->includes_dir.'query.php';
	}
	
	/**
	 * Wires up the plugin's WordPress hooks. Currently just the one: enqueueing assets (and
	 * localizing the field data) on the admin list screens.
	 */
	function actions(): void {
		add_action('admin_enqueue_scripts', [
			$this,
			'admin_enqueue_scripts'
		]);
	}
	
	/**
	 * Enqueues the plugin's style/script on the post list screen and localizes everything
	 * script.js needs to render the filter UI — the field list (from dropdown_options()),
	 * selectable data types, REST endpoint URLs, and the nonce to call them with.
	 *
	 * Hooked to 'admin_enqueue_scripts', which fires on every wp-admin page; bails out early
	 * for everything except edit.php (the post list screen), which is the only place the
	 * filter UI is rendered.
	 *
	 * 'editableDataTypeFields' (which fields let the user override the default data type from
	 * dropdown_options()) defaults to just 'postmeta', but is filterable via
	 * 'ba_search_editable_data_type_fields' so a field added through 'ba_search_dropdown_options'
	 * can opt into the same override behavior.
	 *
	 * @param string $hook The current admin page's hook suffix, e.g. 'edit.php' or 'index.php'.
	 */
	function admin_enqueue_scripts(string $hook): void {
		if($hook != 'edit.php') {
			return;
		}
		
		$post_type = $_GET['post_type'] ?? 'post';
		
		wp_enqueue_style($this->basename.'-style', $this->assets_url.'style.css', [], $this->version);
		wp_enqueue_script($this->basename.'-script', $this->assets_url.'script.js', [], $this->version);
		
		$options = $this->dropdown_options($post_type);
		
		wp_localize_script($this->basename.'-script', 'baSearchData', [
			'filterBoxToggleLabel'       => __('Advanced Filters', 'ba-search'),
			'filterBoxToggleCancelLabel' => __('Cancel', 'ba-search'),
			'popupTitle'                 => __('Filters', 'ba-search'),
			'fieldOptions'               => $options,
			'postType'                   => $post_type,
			'apiUrl'                     => get_rest_url(null, 'bas/v1/get_values'),
			'keysApiUrl'                 => get_rest_url(null, 'bas/v1/get_keys'),
			'nonce'                      => wp_create_nonce('wp_rest'),
			'dataTypes'                  => $this->data_types(),
			'editableDataTypeFields'     => apply_filters('ba_search_editable_data_type_fields', ['postmeta']),
		]);
	}
	
	/**
	 * The fields selectable in the filter UI's field picker, each with its label and default
	 * data type. Only fields listed in 'editableDataTypeFields' (see admin_enqueue_scripts(),
	 * filterable via 'ba_search_editable_data_type_fields') allow the user to override the
	 * default data type.
	 *
	 * Optional per-field flags, consumed by the matching JS FilterGroup static (see script.js):
	 * - operatorOverride: fixed [value, label] operator pairs, used regardless of data type,
	 *   for fields that only ever support an exact match.
	 * - expandable: needs a sub-pick (which meta key / which taxonomy) before a value can load.
	 * - localSearch: has a small, bounded set of values, fetched once and filtered client-side.
	 * - postPicker: value is actually another post, searched by title instead of the plain input
	 *   its data type would otherwise get.
	 * - valueLookup: the value stored for a condition (an ID, a slug, ...) isn't itself a fit
	 *   display label — restoring a condition from the ba_search query string (see
	 *   FilterGroup.restoreCondition in script.js) resolves it via a dedicated `value` lookup
	 *   (see includes/endpoints.php's get_values()) instead of trusting the raw value as-is.
	 *   postPicker fields (see above) always imply this too, since their value is a post ID.
	 *
	 * Filterable via 'ba_search_dropdown_options' so themes/plugins can add or adjust fields —
	 * a field added this way needs matching support in includes/endpoints.php's get_values()
	 * (via the 'ba_search_get_values' filter) to actually return values for it, and in
	 * get_keys() if it's marked expandable.
	 *
	 * @param string $post_type Post type slug the field list is being built for, e.g. 'post' or
	 *                          'page'; passed through to the filter for post-type-specific
	 *                          field lists.
	 * @return array Field key => {label, type, ...optional flags above}, with entries whose
	 *               label resolves to an empty string filtered out (e.g. a translation that
	 *               deliberately hides a built-in field).
	 */
	function dropdown_options(string $post_type): array {
		$is_operator = [
			[
				'is',
				__('Is', 'ba-search')
			],
			[
				'is_not',
				__('Is Not', 'ba-search')
			]
		];
		
		$options = [
			'postmeta'    => [
				'label'      => __('Custom Fields', 'ba-search'),
				'type'       => 'string',
				'expandable' => true,
			],
			'date_query'  => [
				'label' => __('Publish Date', 'ba-search'),
				'type'  => 'date'
			],
			'mod_date'    => [
				'label' => __('Modification Date', 'ba-search'),
				'type'  => 'date'
			],
			'post_author' => [
				'label'            => __('Post Author', 'ba-search'),
				'type'             => 'string',
				'operatorOverride' => $is_operator,
				'valueLookup'      => true,
			],
			'post_status' => [
				'label'            => __('Post Status', 'ba-search'),
				'type'             => 'string',
				'operatorOverride' => $is_operator,
				'localSearch'      => true,
			],
			'post_name'   => [
				'label'            => __('Post Slug', 'ba-search'),
				'type'             => 'string',
				'operatorOverride' => $is_operator,
			],
			'post_parent' => [
				'label'            => __('Post Parent', 'ba-search'),
				'type'             => 'number',
				'operatorOverride' => $is_operator,
				'postPicker'       => true,
			],
			'taxonomies'  => [
				'label'       => __('Taxonomies', 'ba-search'),
				'type'        => 'string',
				'expandable'  => true,
				'valueLookup' => true,
			],
		];
		
		$options = array_filter($options, fn($option) => $option['label'] !== '');
		
		return apply_filters('ba_search_dropdown_options', $options, $post_type);
	}
	
	/**
	 * The data types offered in the condition's data type dropdown (see buildDataTypeSelect()
	 * in script.js). Determines how a condition's value is validated and, ultimately, compared
	 * once query building is implemented.
	 *
	 * @return array Data type key => translated label, e.g. 'string' => 'String'.
	 */
	function data_types(): array {
		return [
			'string' => __('String', 'ba-search'),
			'number' => __('Number', 'ba-search'),
			'bool'   => __('Bool (True / False)', 'ba-search'),
			'date'   => __('Date', 'ba-search'),
		];
	}
}

/**
 * Module-level accessor for the plugin singleton — the conventional entry point other code
 * (or this file's own bottom-of-file bootstrap) uses to get at the instance, rather than
 * calling plugin::init() directly.
 *
 * @return plugin|null The singleton instance (see plugin::init()).
 */
function plugin(): ?plugin {
	return plugin::init();
}

/**
 * Whether the current request is a WordPress REST API request.
 *
 * Used by the bootstrap check at the bottom of this file: the plugin only needs to load in
 * wp-admin (to render the filter UI) or during a REST request (to serve get_keys/get_values),
 * so this lets it skip loading — and registering its hooks — on ordinary frontend requests.
 *
 * @return bool True if this looks like a REST API request.
 */
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
	
	return str_contains($_SERVER['REQUEST_URI'], $rest_prefix);
}

// Load plugin only in wp-admin or on REST API requests; skip the frontend.
if(is_admin() || is_rest_request()) {
	plugin();
}