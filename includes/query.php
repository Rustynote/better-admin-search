<?php

namespace BetterAdminSearch\Query;

if(!defined('ABSPATH')) {
	exit;
}

/*
 * Server-side timeout guard for the value-search queries in helpers.php.
 *
 * Several of the columns this plugin searches (postmeta.meta_value, post_title,
 * users.display_name) have no index, so a broad `LIKE '%…%'` on a large table can run for a
 * long time and tie up a database connection. Every SELECT that touches one of those columns
 * is routed through with_timeout(), which caps how long the server lets it run and reports
 * back whether it was cut off, so the REST endpoints in endpoints.php can turn that into a
 * proper error response instead of hanging or returning a silently-truncated result.
 */

/**
 * How long (in seconds) a single value-search query may run before the database aborts it.
 *
 * Filterable via 'ba_search_query_timeout' so site owners can tune it for their table sizes
 * (e.g. lower it on a huge postmeta table, or raise it if 10s is too aggressive).
 *
 * @return float Timeout in seconds. Defaults to 10.
 */
function timeout_seconds(): float {
	return apply_filters('ba_search_query_timeout', 10);
}

/**
 * Runs an already-prepared SELECT with a server-side execution time limit.
 *
 * Rewrites the query with whichever timeout syntax the connected server understands — MySQL's
 * `MAX_EXECUTION_TIME` optimizer hint (a comment injected right after the SELECT keyword,
 * expressed in milliseconds) or MariaDB's `SET STATEMENT max_statement_time=… FOR …` wrapper
 * (expressed in seconds) — then runs it via the given $wpdb method.
 *
 * wpdb's own error output is suppressed for the duration of the call: a timeout here is an
 * expected, handled outcome rather than a bug, and letting wpdb print its usual HTML error
 * block would corrupt the JSON this ends up inside of (the REST response). The error is still
 * recorded on $wpdb->last_error as normal, which is what is_timeout() reads afterwards.
 *
 * @param string $prepared_sql SQL already passed through $wpdb->prepare(); must start with SELECT.
 * @param string $method       The $wpdb method to run it with — 'get_col' or 'get_results'.
 * @return array|null The query result (array of scalars or objects, depending on $method), or
 *                     null if the query errored — including timing out. Check is_timeout()
 *                     immediately afterwards to tell a timeout apart from any other DB error.
 */
function with_timeout(string $prepared_sql, string $method = 'get_col'): ?array {
	global $wpdb;

	$timeout_seconds = timeout_seconds();
	$is_mariadb      = stripos($wpdb->db_server_info(), 'mariadb') !== false;

	// MariaDB wraps the whole statement; MySQL takes an inline hint right after SELECT. A
	// timeout of 0 means "no limit" on both engines, so timeout_seconds() must stay positive.
	$timed_sql = $is_mariadb ? 'SET STATEMENT max_statement_time='.$timeout_seconds.' FOR '.$prepared_sql : preg_replace('/^SELECT\b/i', 'SELECT /*+ MAX_EXECUTION_TIME('.($timeout_seconds * 1000).') */', $prepared_sql, 1);

	// See the docblock above for why errors are suppressed here.
	$suppress = $wpdb->suppress_errors(true);
	$result   = $wpdb->$method($timed_sql);
	$wpdb->suppress_errors($suppress);

	return $wpdb->last_error === '' ? $result : null;
}

/**
 * Whether the last query failed because it ran past timeout_seconds(), as opposed to some
 * other database error (bad SQL, lost connection, etc).
 *
 * Matches on the wording both engines use for their respective timeout errors: MySQL's
 * "…maximum statement execution time exceeded" and MariaDB's "…max_statement_time exceeded".
 * Both contain "time" and "exceed", which is enough to tell them apart from unrelated errors
 * without hardcoding either engine's exact error code or phrasing.
 *
 * @return bool True if $wpdb->last_error looks like a query-timeout error.
 */
function is_timeout(): bool {
	global $wpdb;

	return stripos($wpdb->last_error, 'exceed') !== false && stripos($wpdb->last_error, 'time') !== false;
}

/**
 * Builds the WP_Error returned to REST clients when a value-search query times out.
 *
 * The 504 status is what the frontend (see fetchValues() in assets/script.js) checks for to
 * distinguish "the search timed out" from any other failed request, so it can show an error
 * and let the user type the value in directly instead of picking it from a list the server
 * couldn't produce in time.
 *
 * @return \WP_Error
 */
function timeout_error(): \WP_Error {
	return new \WP_Error('ba_search_query_timeout', __('This search took too long to run. Try a more specific search, or enter the value directly.', 'better-admin-search'), ['status' => 504]);
}