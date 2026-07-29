<?php

namespace BetterAdminSearch\Endpoints;

add_action('rest_api_init', function() {
	register_rest_route('bas/v1', 'get_keys', [
		'methods'             => 'GET',
		'callback'            => __NAMESPACE__.'\\get_keys',
		'permission_callback' => function() {
			return current_user_can('manage_options');
		},
		'args'                => [
			'field'     => [
				'type'     => 'string',
				'required' => true,
			],
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
			'field'     => [
				'type'     => 'string',
				'required' => true,
			],
			'thing'     => [
				'type'     => 'string',
				'required' => false,
			],
			'post_type' => [
				'type'     => 'string',
				'required' => false,
			],
			'search'    => [
				'type'     => 'string',
				'required' => false,
			],
		]
	]);
});

// Identifiers to drill into: meta_key names for Custom Fields, or the taxonomy list for
// Taxonomies. Populates the field picker's right column when one of those is expanded.
function get_keys(\WP_REST_Request $request) {
	$field = $request->get_param('field');
	
	if($field === 'postmeta') {
		return get_postmeta_keys();
	}
	
	if($field === 'taxonomies') {
		$post_type  = $request->get_param('post_type') ?: 'post';
		$taxonomies = \BetterAdminSearch\Helpers\get_post_type_taxonomies($post_type);
		
		return array_map(fn($slug, $label) => [
			'value' => $slug,
			'label' => $label
		], array_keys($taxonomies), $taxonomies);
	}
	
	return [];
}

function get_postmeta_keys(): array {
	global $wpdb;
	
	$keys = $wpdb->get_col("SELECT DISTINCT meta_key FROM {$wpdb->postmeta} ORDER BY meta_key ASC");
	
	return array_map(fn($key) => [
		'value' => $key,
		'label' => $key
	], $keys);
}

// Values for an already-chosen identifier: meta values for a meta_key, or terms of a taxonomy.
// For fields with no identifier to drill into (post_author, post_status, post_name), the
// values come straight from the post type. `search` narrows the result set as the user types
// in the value dropdown; fields with a small fixed set of values (post_status) ignore it and
// let the frontend filter its one-time fetch locally instead.
function get_values(\WP_REST_Request $request) {
	$field     = $request->get_param('field');
	$thing     = $request->get_param('thing');
	$post_type = $request->get_param('post_type') ?: 'post';
	$search    = $request->get_param('search') ?? '';

	if($field === 'postmeta') {
		return $thing ? get_postmeta_values($thing, $search) : [];
	}

	if($field === 'taxonomies') {
		return $thing ? get_taxonomy_terms($thing, $search) : [];
	}

	if($field === 'post_status') {
		return get_post_statuses($post_type);
	}

	if($field === 'post_author') {
		return get_post_authors($post_type, $search);
	}

	if($field === 'post_name') {
		return get_post_slugs($post_type, $search);
	}

	if($field === 'post_parent') {
		return get_post_parents($post_type, $search);
	}

	return [];
}

function get_postmeta_values(string $meta_key, string $search = ''): array {
	global $wpdb;

	$like = '%'.$wpdb->esc_like($search).'%';
	$sql  = "SELECT DISTINCT meta_value FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value LIKE %s ORDER BY meta_value ASC LIMIT 50";
	$values = $wpdb->get_col($wpdb->prepare($sql, $meta_key, $like));

	return array_map(fn($value) => [
		'value' => $value,
		'label' => $value
	], $values);
}

function get_post_slugs(string $post_type, string $search = ''): array {
	global $wpdb;

	$like = '%'.$wpdb->esc_like($search).'%';
	$sql  = "SELECT DISTINCT post_name FROM {$wpdb->posts} WHERE post_type = %s AND post_name LIKE %s ORDER BY post_name ASC LIMIT 50";
	$values = $wpdb->get_col($wpdb->prepare($sql, $post_type, $like));

	return array_map(fn($value) => [
		'value' => $value,
		'label' => $value
	], $values);
}

function get_post_statuses(string $post_type): array {
	global $wpdb;

	$values = $wpdb->get_col($wpdb->prepare("SELECT DISTINCT post_status FROM {$wpdb->posts} WHERE post_type = %s ORDER BY post_status ASC LIMIT 200", $post_type));

	return array_map(fn($value) => [
		'value' => $value,
		'label' => $value
	], $values);
}

function get_post_authors(string $post_type, string $search = ''): array {
	global $wpdb;

	$like = '%'.$wpdb->esc_like($search).'%';
	$sql  = "SELECT DISTINCT u.ID, u.display_name FROM {$wpdb->users} u
	         INNER JOIN {$wpdb->posts} p ON p.post_author = u.ID
	         WHERE p.post_type = %s AND u.display_name LIKE %s
	         ORDER BY u.display_name ASC LIMIT 50";
	$rows = $wpdb->get_results($wpdb->prepare($sql, $post_type, $like));

	return array_map(fn($row) => [
		'value' => (string) $row->ID,
		'label' => $row->display_name
	], $rows);
}

// Candidate parent posts, searched by title within the same post type.
function get_post_parents(string $post_type, string $search = ''): array {
	global $wpdb;

	$like = '%'.$wpdb->esc_like($search).'%';
	$sql  = "SELECT ID, post_title FROM {$wpdb->posts}
	         WHERE post_type = %s AND post_status NOT IN ('trash', 'auto-draft') AND post_title LIKE %s
	         ORDER BY post_title ASC LIMIT 50";
	$rows = $wpdb->get_results($wpdb->prepare($sql, $post_type, $like));

	return array_map(fn($row) => [
		'value' => (string) $row->ID,
		'label' => ($row->post_title !== '' ? $row->post_title : '(no title)').' (#'.$row->ID.')'
	], $rows);
}

function get_taxonomy_terms(string $taxonomy, string $search = ''): array {
	$terms = get_terms([
		'taxonomy'   => $taxonomy,
		'hide_empty' => false,
		'search'     => $search,
		'number'     => 50,
	]);

	if(is_wp_error($terms)) {
		return [];
	}

	return array_map(fn($term) => [
		'value' => $term->slug,
		'label' => $term->name
	], $terms);
}
