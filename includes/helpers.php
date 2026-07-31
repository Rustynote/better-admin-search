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

// How long (in seconds) a single value-search query may run before the database aborts it.
// Several of the columns this plugin searches (postmeta.meta_value, post_title,
// users.display_name) have no index, so a broad LIKE '%…%' can run away on a large table.
// Filterable via 'ba_search_query_timeout' so sites can tune it for their table sizes.
function query_timeout_seconds(): float {
	return apply_filters('ba_search_query_timeout', 10);
}

// Runs an already-prepared SELECT with a server-side execution time limit, using MySQL's
// MAX_EXECUTION_TIME optimizer hint or MariaDB's max_statement_time, whichever the connected
// server understands. Returns null if the query errored — including timing out — so callers
// can tell that apart from a legitimately empty result; use is_query_timeout() to tell a
// timeout apart from some other database error.
function query_with_timeout(string $prepared_sql, string $method = 'get_col') {
	global $wpdb;

	$timeout_seconds = query_timeout_seconds();
	$is_mariadb      = stripos($wpdb->db_server_info(), 'mariadb') !== false;

	$timed_sql = $is_mariadb
		? 'SET STATEMENT max_statement_time='.$timeout_seconds.' FOR '.$prepared_sql
		: preg_replace('/^SELECT\b/i', 'SELECT /*+ MAX_EXECUTION_TIME('.($timeout_seconds * 1000).') */', $prepared_sql, 1);

	// A timeout here is an expected, handled outcome — not a bug to surface via wpdb's normal
	// error output, which would otherwise print raw HTML into this JSON REST response.
	$suppress = $wpdb->suppress_errors(true);
	$result   = $wpdb->$method($timed_sql);
	$wpdb->suppress_errors($suppress);

	return $wpdb->last_error === '' ? $result : null;
}

// Whether the last query failed because it ran past query_timeout_seconds(), as opposed to
// some other database error.
function is_query_timeout(): bool {
	global $wpdb;

	return stripos($wpdb->last_error, 'exceed') !== false && stripos($wpdb->last_error, 'time') !== false;
}

function query_timeout_error(): \WP_Error {
	return new \WP_Error(
		'ba_search_query_timeout',
		__('This search took too long to run. Try a more specific search, or enter the value directly.', 'ba-search'),
		['status' => 504]
	);
}