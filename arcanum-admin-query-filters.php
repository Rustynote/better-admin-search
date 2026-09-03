<?php

namespace BetterAdminSearch;

/**
 * Plugin bootstrap: registers the admin hook, builds the filterable field list, and localizes
 * it to script.js so the frontend can render the field/value pickers described there.
 *
 * Plugin Name:       Arcanum Admin Query Filters
 * Plugin URI:        https://github.com/Rustynote/arcanum-admin-query-filters
 * Description:       Adds an advanced filter box to the post and page list screens, letting you combine multiple conditions with AND/OR logic to narrow results fast — no query writing required. Filter by custom fields (with string, number, boolean, or date comparisons), taxonomies, publish/modification date (including relative ranges like "in the last 7 days"), post author, status, slug, and parent. Filtered views are reflected in the URL, so they can be bookmarked or shared, and developers can add their own fields via a handful of filters. Restricted to users with the manage_options capability.
 * Version:           1.0.0
 * Requires at least: 5.2
 * Requires PHP:      8.1
 * Author:            Jaroslav Suhanek
 * Author URI:        https://wparcanum.com/
 * Text Domain:       arcanum-admin-query-filters
 * License:           GPL v3
 * License URI:       http://www.gnu.org/licenses/gpl-3.0.txt
 */

if(!defined('ABSPATH')) {
	exit;
}

class plugin {
	// Populated by vars(), called once from init(). See vars() for what each one holds.
	private string $version;
	private string $file;
	private string $basename;
	private string $plugin_dir;
	private string $plugin_url;
	private string $includes_dir;
	private string $lang_dir;
	private string $assets_url;

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
		$this->version = '1.0.0';
		
		// Paths
		$this->file       = __FILE__;
		$this->basename   = plugin_basename($this->file);
		$this->plugin_dir = plugin_dir_path($this->file);
		$this->plugin_url = plugin_dir_url($this->file);
		
		// Includes
		$this->includes_dir = trailingslashit($this->plugin_dir.'includes');
		
		// Languages
		$this->lang_dir = trailingslashit($this->plugin_dir.'languages');
		
		// Assets
		$this->assets_url = trailingslashit($this->plugin_url.'assets');
	}
	
	/**
	 * Loads the plugin's supporting files.
	 *
	 * helpers.php's value-lookup functions call into Query\with_timeout() etc. from query.php,
	 * and filter.php calls into Operators\* from operators.php, but since those are all plain
	 * function definitions (not executed on load), the require order below doesn't actually
	 * matter — PHP only needs each file loaded by the time the other's functions are called, not
	 * by the time they're defined.
	 */
	function includes(): void {
		require_once $this->includes_dir.'operators.php';
		require_once $this->includes_dir.'helpers.php';
		require_once $this->includes_dir.'endpoints.php';
		require_once $this->includes_dir.'query.php';
		require_once $this->includes_dir.'filter.php';
	}

	/**
	 * Wires up the plugin's WordPress hooks: enqueueing assets (and localizing the field data) on
	 * the admin list screens, and applying the submitted `ba_search` filter (see
	 * includes/filter.php) to the list table's query.
	 *
	 * Translations aren't loaded here: WordPress.org hosts and auto-loads this plugin's
	 * translations itself, since its Text Domain matches its slug.
	 */
	function actions(): void {
		add_action('admin_enqueue_scripts', [
			$this,
			'admin_enqueue_scripts'
		]);

		\BetterAdminSearch\Filter\bootstrap();
	}

	/**
	 * Enqueues the plugin's style/script on the post list screen and localizes everything
	 * script.js needs to render the filter UI — the field list (from dropdown_options()),
	 * selectable data types, the operator-classification lists from includes/operators.php (so
	 * they and includes/filter.php's query builder stay in sync off one shared definition),
	 * REST endpoint URLs, and the nonce to call them with.
	 *
	 * Hooked to 'admin_enqueue_scripts', which fires on every wp-admin page; bails out early
	 * for everything except edit.php (the post list screen), which is the only place the
	 * filter UI is rendered, and for users lacking manage_options — the same capability the
	 * REST endpoints in includes/endpoints.php require, so the filter UI never appears for a
	 * user who couldn't actually use it.
	 *
	 * 'editableDataTypeFields' (which fields let the user override the default data type from
	 * dropdown_options()) defaults to just 'postmeta', but is filterable via
	 * 'ba_search_editable_data_type_fields' so a field added through 'ba_search_dropdown_options'
	 * can opt into the same override behavior.
	 *
	 * @param string $hook The current admin page's hook suffix, e.g. 'edit.php' or 'index.php'.
	 */
	function admin_enqueue_scripts(string $hook): void {
		if($hook != 'edit.php' || !current_user_can('manage_options')) {
			return;
		}

		// Read-only GET param that just picks which post type's list screen this is (like core's
		// own use of $_GET['post_type'] to render edit.php) — nothing is changed, so no nonce is
		// needed; the value is sanitized via sanitize_key() before use.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$post_type = isset($_GET['post_type']) ? sanitize_key(wp_unslash($_GET['post_type'])) : 'post';

		wp_enqueue_style($this->basename.'-style', $this->assets_url.'style.css', [], $this->version);
		wp_enqueue_script($this->basename.'-script', $this->assets_url.'script.js', [], $this->version, true);

		$options = $this->dropdown_options($post_type);

		wp_localize_script($this->basename.'-script', 'baSearchData', [
			'filterBoxToggleLabel'       => __('Advanced Filters', 'arcanum-admin-query-filters'),
			'filterBoxToggleCancelLabel' => __('Cancel', 'arcanum-admin-query-filters'),
			'popupTitle'                 => __('Filters', 'arcanum-admin-query-filters'),
			'fieldOptions'               => $options,
			'postType'                   => $post_type,
			'apiUrl'                     => get_rest_url(null, 'bas/v1/get_values'),
			'keysApiUrl'                 => get_rest_url(null, 'bas/v1/get_keys'),
			'nonce'                      => wp_create_nonce('wp_rest'),
			'dataTypes'                  => $this->data_types(),
			'editableDataTypeFields'     => apply_filters('ba_search_editable_data_type_fields', ['postmeta']),
			'noValueOperators'           => Operators\no_value_operators(),
			'rangeOperators'             => Operators\range_operators(),
			'relativeDateOperators'      => Operators\relative_date_operators(),
			'relativeDateUnits'          => array_map(fn($unit) => $unit['label'], Operators\relative_date_units()),
			'operatorsByType'            => Operators\operators_by_type(),
			'operatorLabels'             => Operators\operator_labels(),
			'boolOptions'                => Operators\bool_options(),
			'logicLabels'                => Operators\logic_labels(),
			'selectPlaceholder'          => __('Select…', 'arcanum-admin-query-filters'),
			'searchPlaceholder'          => __('Search…', 'arcanum-admin-query-filters'),
			'selectFieldPlaceholder'     => __('Select field…', 'arcanum-admin-query-filters'),
			'selectValuePlaceholder'     => __('Select value…', 'arcanum-admin-query-filters'),
			'applyLabel'                 => __('Apply', 'arcanum-admin-query-filters'),
			'removeLabel'                => __('Remove', 'arcanum-admin-query-filters'),
			'addConditionLabel'          => __('+ Condition', 'arcanum-admin-query-filters'),
			'addGroupLabel'              => __('+ Group', 'arcanum-admin-query-filters'),
			'whereLabel'                 => __('Where', 'arcanum-admin-query-filters'),
			'rangeSeparatorLabel'        => __('and', 'arcanum-admin-query-filters'),
			'loadingLabel'               => __('Loading…', 'arcanum-admin-query-filters'),
			'searchingLabel'             => __('Searching…', 'arcanum-admin-query-filters'),
			'noResultsLabel'             => __('No results', 'arcanum-admin-query-filters'),
			'pickOptionHint'             => __('Please click the option on the left.', 'arcanum-admin-query-filters'),
			/* translators: %s: the search text the user typed, used verbatim as the value. */
			'useValueTemplate'           => __('Use "%s"', 'arcanum-admin-query-filters'),
			/* translators: %d: number of checked options in a multi-select dropdown. */
			'selectedCountTemplate'      => __('%d selected', 'arcanum-admin-query-filters'),
			'searchTimeoutMessage'       => __('This search took too long to run. Try a more specific search, or enter the value directly.', 'arcanum-admin-query-filters'),
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
		$labels      = Operators\operator_labels();
		$is_operator = [
			['is', $labels['is']],
			['is_not', $labels['is_not']],
		];
		
		$options = [
			'postmeta'    => [
				'label'      => __('Custom Fields', 'arcanum-admin-query-filters'),
				'type'       => 'string',
				'expandable' => true,
			],
			'date_query'  => [
				'label' => __('Publish Date', 'arcanum-admin-query-filters'),
				'type'  => 'date'
			],
			'mod_date'    => [
				'label' => __('Modification Date', 'arcanum-admin-query-filters'),
				'type'  => 'date'
			],
			'post_author' => [
				'label'            => __('Post Author', 'arcanum-admin-query-filters'),
				'type'             => 'string',
				'operatorOverride' => $is_operator,
				'valueLookup'      => true,
			],
			'post_status' => [
				'label'            => __('Post Status', 'arcanum-admin-query-filters'),
				'type'             => 'string',
				'operatorOverride' => $is_operator,
				'localSearch'      => true,
			],
			'post_name'   => [
				'label'            => __('Post Slug', 'arcanum-admin-query-filters'),
				'type'             => 'string',
				'operatorOverride' => $is_operator,
			],
			'post_parent' => [
				'label'            => __('Post Parent', 'arcanum-admin-query-filters'),
				'type'             => 'number',
				'operatorOverride' => $is_operator,
				'postPicker'       => true,
			],
			'taxonomies'  => [
				'label'       => __('Taxonomies', 'arcanum-admin-query-filters'),
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
	 * in script.js). Determines how a condition's value is compared once submitted — see
	 * includes/filter.php's build_meta_condition(), the only field this actually varies for.
	 *
	 * @return array Data type key => translated label, e.g. 'string' => 'String'.
	 */
	function data_types(): array {
		return [
			'string' => __('String', 'arcanum-admin-query-filters'),
			'number' => __('Number', 'arcanum-admin-query-filters'),
			'bool'   => __('Bool (True / False)', 'arcanum-admin-query-filters'),
			'date'   => __('Date', 'arcanum-admin-query-filters'),
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
	$request_uri = sanitize_text_field(wp_unslash($_SERVER['REQUEST_URI']));

	// str_contains() would need WordPress 5.9's polyfill on PHP < 8.0, but this plugin already
	// requires PHP 8.1 (see the file header), where it's always natively available.
	return str_contains($request_uri, $rest_prefix);
}

// Load plugin only in wp-admin or on REST API requests; skip the frontend.
if(is_admin() || is_rest_request()) {
	plugin();
}