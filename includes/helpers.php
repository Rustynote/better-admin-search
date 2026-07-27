<?php

namespace BetterAdminSearch\Helpers;

function get_post_type_taxonomies(string $post_type): array {
	$out = [];
	
	$taxonomies = get_object_taxonomies($post_type, 'object');
	foreach($taxonomies as $taxonomy) {
		$out[$taxonomy->name] = $taxonomy->label;
	}
	
	return $out;
}