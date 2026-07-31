<?php

namespace BetterAdminSearch\Endpoints;
use \BetterAdminSearch\Helpers;

/*
 * REST routes that power the filter UI's field/value pickers (see assets/script.js). The
 * two-step flow is: the field picker calls get_keys when the user expands an EXPANDABLE_FIELDS
 * entry (Custom Fields, Taxonomies) to list what's inside it (meta keys, taxonomy names); the
 * value picker then calls get_values, passing that choice back as `thing`, to list or search
 * the actual values for the condition. Both require 'manage_options' — this is admin-only
 * tooling, not a public search API.
 */
add_action('rest_api_init', function() {
	register_rest_route('bas/v1', 'get_keys', [
		'methods'             => 'GET',
		'callback'            => __NAMESPACE__.'\\get_keys',
		'permission_callback' => function() {
			return current_user_can('manage_options');
		},
		'args'                => [
			// Which EXPANDABLE_FIELDS entry to list identifiers for: 'postmeta' or 'taxonomies'.
			'field'     => [
				'type'     => 'string',
				'required' => true,
			],
			// Scopes the identifier list to a post type; defaults to 'post' if omitted.
			'post_type' => [
				'type'     => 'string',
				'required' => false,
			],
		]
	]);

	register_rest_route('bas/v1', 'get_values', [
		'methods'             => 'GET',
		'callback'            => __NAMESPACE__.'\\get_values',
		'permission_callback' => function() {
			return current_user_can('manage_options');
		},
		'args'                => [
			// Which field the condition is filtering on, e.g. 'postmeta', 'post_author'.
			'field'     => [
				'type'     => 'string',
				'required' => true,
			],
			// The sub-identifier chosen via get_keys — a meta_key for 'postmeta', a taxonomy
			// slug for 'taxonomies'. Unused (and the route returns []) for every other field.
			'thing'     => [
				'type'     => 'string',
				'required' => false,
			],
			// Scopes the value list to a post type; defaults to 'post' if omitted.
			'post_type' => [
				'type'     => 'string',
				'required' => false,
			],
			// Narrows the result set server-side as the user types. Ignored by fields whose
			// full value set is fetched once and filtered client-side instead (see
			// LOCAL_SEARCH_FIELDS in assets/script.js).
			'search'    => [
				'type'     => 'string',
				'required' => false,
			],
		]
	]);
});

/**
 * Identifiers to drill into: meta_key names for Custom Fields, or the taxonomy list for
 * Taxonomies. Populates the field picker's right column when one of those is expanded.
 *
 * Only handles the two EXPANDABLE_FIELDS entries; any other `field` value (or one that isn't
 * expandable) returns an empty array rather than an error, since the frontend only calls this
 * for fields it already knows are expandable.
 *
 * @param \WP_REST_Request $request Expects `field` ('postmeta' or 'taxonomies') and optionally
 *                                  `post_type` (defaults to 'post').
 * @return array List of {value, label} pairs: meta key names for 'postmeta', or taxonomy
 *               slug/label pairs for 'taxonomies'.
 */
function get_keys(\WP_REST_Request $request): array {
	$field = $request->get_param('field');
	
	if($field === 'postmeta') {
		return Helpers\get_postmeta_keys();
	}
	
	if($field === 'taxonomies') {
		$post_type  = $request->get_param('post_type') ?: 'post';
		$taxonomies = Helpers\get_post_type_taxonomies($post_type);
		
		return array_map(fn($slug, $label) => [
			'value' => $slug,
			'label' => $label
		], array_keys($taxonomies), $taxonomies);
	}
	
	return [];
}

/**
 * Values for an already-chosen identifier: meta values for a meta_key, or terms of a taxonomy.
 * For fields with no identifier to drill into (post_author, post_status, post_name), the
 * values come straight from the post type. `search` narrows the result set as the user types
 * in the value dropdown; fields with a small fixed set of values (post_status) ignore it and
 * let the frontend filter its one-time fetch locally instead.
 *
 * Several of the underlying lookups run a query against a column with no index and can time
 * out (see includes/query.php); when that happens the helper returns a WP_Error instead of a
 * result array, which is returned here as-is so WP_REST_Server sends it back as a 504 — the
 * frontend's fetchValues() checks for that status to show the timeout error in the UI.
 *
 * @param \WP_REST_Request $request Expects `field` and optionally `thing`, `post_type`
 *                                  (defaults to 'post'), and `search` — see the route args
 *                                  registered above for what each means per field.
 * @return array|\WP_Error List of {value, label} pairs for the requested field (empty for an
 *                         unrecognized `field`, or for 'postmeta'/'taxonomies' without a
 *                         `thing`), or a WP_Error if the underlying query timed out.
 */
function get_values(\WP_REST_Request $request): \WP_Error|array {
	$field     = $request->get_param('field');
	$thing     = $request->get_param('thing');
	$post_type = $request->get_param('post_type') ?: 'post';
	$search    = $request->get_param('search') ?? '';

	if($field === 'postmeta') {
		return $thing ? Helpers\get_postmeta_values($thing, $search) : [];
	}

	if($field === 'taxonomies') {
		return $thing ? Helpers\get_taxonomy_terms($thing, $search) : [];
	}

	if($field === 'post_status') {
		return Helpers\get_post_statuses($post_type);
	}

	if($field === 'post_author') {
		return Helpers\get_post_authors($post_type, $search);
	}

	if($field === 'post_name') {
		return Helpers\get_post_slugs($post_type, $search);
	}

	if($field === 'post_parent') {
		return Helpers\get_post_parents($post_type, $search);
	}

	return [];
}
