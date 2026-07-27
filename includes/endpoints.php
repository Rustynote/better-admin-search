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
			'field' => [
				'type'     => 'string',
				'required' => true,
			],
			'thing' => [
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
function get_values(\WP_REST_Request $request) {
	$field = $request->get_param('field');
	$thing = $request->get_param('thing');
	
	if(!$thing) {
		return [];
	}
	
	if($field === 'postmeta') {
		return get_postmeta_values($thing);
	}
	
	if($field === 'post_status') {
		return get_post_statuses();
	}
	
	if($field === 'taxonomies') {
		return get_taxonomy_terms($thing);
	}
	
	return [];
}

function get_postmeta_values(string $meta_key): array {
	global $wpdb;
	
	$values = $wpdb->get_col($wpdb->prepare("SELECT DISTINCT meta_value FROM {$wpdb->postmeta} WHERE meta_key = %s ORDER BY meta_value ASC LIMIT 200", $meta_key));
	
	return array_map(fn($value) => [
		'value' => $value,
		'label' => $value
	], $values);
}

function get_post_slugs(string $post_type) {
	global $wpdb;
	
	$values = $wpdb->get_col($wpdb->prepare("SELECT DISTINCT post_name FROM {$wpdb->posts} WHERE post_type = %s ORDER BY post_name ASC LIMIT 200", $post_type));
	
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

function get_taxonomy_terms(string $taxonomy): array {
	$terms = get_terms([
		'taxonomy'   => $taxonomy,
		'hide_empty' => false,
	]);
	
	if(is_wp_error($terms)) {
		return [];
	}
	
	return array_map(fn($term) => [
		'value' => $term->slug,
		'label' => $term->name
	], $terms);
}
