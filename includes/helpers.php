<?php

namespace BetterAdminSearch\Helpers;
use \BetterAdminSearch\Query;

/*
 * Data lookups behind the REST endpoints in endpoints.php: everything the filter UI needs to
 * populate the field picker's expandable sub-lists (postmeta keys, taxonomies) and the value
 * picker for each field (postmeta values, post authors, statuses, slugs, parents, terms).
 *
 * Several of these run a raw SELECT against a column with no index — see includes/query.php —
 * so most of the value-lookup functions below route their query through Query\with_timeout()
 * and, on failure, distinguish "the query timed out" (Query\is_timeout(), turned into a
 * Query\timeout_error() WP_Error) from any other failure (silently returned as []).
 */

/**
 * Taxonomies registered for a post type, keyed by taxonomy name.
 *
 * Backs the "Taxonomies" entry in the field picker: when expanded, the frontend calls the
 * get_keys REST route, which uses this to list the sub-options (one per taxonomy).
 *
 * @param string $post_type Post type slug, e.g. 'post' or 'page'.
 * @return array Taxonomy name => taxonomy label (as shown in the admin), e.g.
 *               ['category' => 'Categories', 'post_tag' => 'Tags'].
 */
function get_post_type_taxonomies(string $post_type): array {
	return array_column(get_object_taxonomies($post_type, 'objects'), 'label', 'name');
}

/**
 * Every distinct postmeta key in use, across all post types.
 *
 * Backs the "Custom Fields" entry in the field picker: when expanded, the frontend calls the
 * get_keys REST route, which uses this to list the sub-options (one per meta key) the user can
 * drill into. Unlike the value lookups below, this isn't wrapped in Query\with_timeout() —
 * meta_key has an index (unlike meta_value), so a DISTINCT scan over it is cheap even on a
 * large postmeta table.
 *
 * @return array List of {value, label} pairs, both set to the meta key name.
 */
function get_postmeta_keys(): array {
	global $wpdb;

	$keys = $wpdb->get_col("SELECT DISTINCT meta_key FROM {$wpdb->postmeta} ORDER BY meta_key ASC");

	return array_map(fn($key) => [
		'value' => $key,
		'label' => $key
	], $keys);
}

/**
 * Distinct postmeta values for a given meta key, optionally narrowed by a search term.
 *
 * postmeta.meta_value has no index, so a `LIKE '%…%'` scan here can be slow on a large table —
 * this is the main reason Query\with_timeout() exists. Results are capped at 50 and the caller
 * (the frontend's SearchableDropdown) is expected to re-query as the user refines their search
 * rather than fetching the full value set up front.
 *
 * @param string $meta_key The meta_key to fetch distinct values for.
 * @param string $search   Substring to filter values by (case-insensitive, via LIKE); empty
 *                         string matches everything.
 * @return array|\WP_Error List of {value, label} pairs (both the raw meta value), or a
 *                         Query\timeout_error() if the search took too long to run.
 */
function get_postmeta_values(string $meta_key, string $search = ''): \WP_Error|array {
	global $wpdb;
	
	$like = '%'.$wpdb->esc_like($search).'%';
	$sql  = $wpdb->prepare(
		"SELECT DISTINCT meta_value FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value LIKE %s ORDER BY meta_value ASC LIMIT 50",
		$meta_key, $like
	);
	$values = Query\with_timeout($sql);
	
	if($values === null) {
		return Query\is_timeout() ? Query\timeout_error() : [];
	}
	
	return array_map(fn($value) => [
		'value' => $value,
		'label' => $value
	], $values);
}

/**
 * Distinct post slugs (post_name) for a post type, optionally narrowed by a search term.
 *
 * post_name has an index, but the leading wildcard in the LIKE query below (needed to match
 * a substring anywhere in the slug, not just a prefix) means MySQL can't use it — so this goes
 * through Query\with_timeout() the same as the genuinely unindexed lookups.
 *
 * @param string $post_type Post type slug, e.g. 'post' or 'page'.
 * @param string $search    Substring to filter slugs by; empty string matches everything.
 * @return array|\WP_Error List of {value, label} pairs (both the post_name), or a
 *                         Query\timeout_error() if the search took too long to run.
 */
function get_post_slugs(string $post_type, string $search = ''): \WP_Error|array {
	global $wpdb;
	
	$like = '%'.$wpdb->esc_like($search).'%';
	$sql  = $wpdb->prepare(
		"SELECT DISTINCT post_name FROM {$wpdb->posts} WHERE post_type = %s AND post_name LIKE %s ORDER BY post_name ASC LIMIT 50",
		$post_type, $like
	);
	$values = Query\with_timeout($sql);
	
	if($values === null) {
		return Query\is_timeout() ? Query\timeout_error() : [];
	}
	
	return array_map(fn($value) => [
		'value' => $value,
		'label' => $value
	], $values);
}

/**
 * Distinct post_status values in use for a post type.
 *
 * Backs a LOCAL_SEARCH_FIELDS field (see assets/script.js): the frontend fetches this once per
 * condition and filters it client-side as the user types, rather than re-querying on every
 * keystroke, since the set of statuses in use is always small. Still routed through
 * Query\with_timeout() for consistency, though a timeout here is unlikely — there's no LIKE
 * clause, just an equality match on post_type.
 *
 * @param string $post_type Post type slug, e.g. 'post' or 'page'.
 * @return array|\WP_Error List of {value, label} pairs (both the post_status, e.g. 'publish'),
 *                         or a Query\timeout_error() if the query took too long to run.
 */
function get_post_statuses(string $post_type): \WP_Error|array {
	global $wpdb;
	
	$sql    = $wpdb->prepare("SELECT DISTINCT post_status FROM {$wpdb->posts} WHERE post_type = %s ORDER BY post_status ASC LIMIT 200", $post_type);
	$values = Query\with_timeout($sql);
	
	if($values === null) {
		return Query\is_timeout() ? Query\timeout_error() : [];
	}
	
	return array_map(fn($value) => [
		'value' => $value,
		'label' => $value
	], $values);
}

/**
 * Authors with at least one post of the given post type, optionally searched by display name.
 *
 * users.display_name has no index, so this goes through Query\with_timeout() like the other
 * unindexed lookups. Only authors who have actually authored a post of this type are returned
 * (via the INNER JOIN), so the list doesn't include unrelated site users.
 *
 * When $value is given (a previously-chosen user ID, restored from the ba_search query string —
 * see FilterGroup.restoreCondition in script.js), it's resolved straight to its display name via
 * get_userdata() — a cheap primary-key lookup — instead of running the search below, since the
 * search only matches display names and the restored value is an ID.
 *
 * @param string $post_type Post type slug, e.g. 'post' or 'page'.
 * @param string $search    Substring to filter display names by; empty string matches everything.
 * @param ?string $value    A user ID to resolve directly instead of searching, if given.
 * @return array|\WP_Error List of {value, label} pairs — the user ID (as a string) and their
 *                         display name — or a Query\timeout_error() if the search took too
 *                         long to run.
 */
function get_post_authors(string $post_type, string $search = '', ?string $value = null): \WP_Error|array {
	if($value !== null && $value !== '') {
		$user = get_userdata((int) $value);

		return $user ? [[
			'value' => (string) $user->ID,
			'label' => $user->display_name
		]] : [];
	}

	global $wpdb;

	$like = '%'.$wpdb->esc_like($search).'%';
	$sql  = $wpdb->prepare(
		"SELECT DISTINCT u.ID, u.display_name FROM {$wpdb->users} u
		 INNER JOIN {$wpdb->posts} p ON p.post_author = u.ID
		 WHERE p.post_type = %s AND u.display_name LIKE %s
		 ORDER BY u.display_name ASC LIMIT 50",
		$post_type, $like
	);
	$rows = Query\with_timeout($sql, 'get_results');
	
	if($rows === null) {
		return Query\is_timeout() ? Query\timeout_error() : [];
	}
	
	return array_map(fn($row) => [
		'value' => (string) $row->ID,
		'label' => $row->display_name
	], $rows);
}

/**
 * Candidate parent posts, searched by title within the same post type.
 *
 * Backs the POST_PICKER_FIELDS value widget for post_parent (see assets/script.js): rather than
 * a plain number input, the user searches for the parent post by its title. post_title has no
 * index, so this goes through Query\with_timeout(). Trashed and auto-draft posts are excluded
 * since neither is a sensible parent to filter by.
 *
 * When $value is given (a previously-chosen parent post ID, restored from the ba_search query
 * string — see FilterGroup.restoreCondition in script.js), it's resolved straight via get_post()
 * — a cheap primary-key lookup — instead of running the search below, since the search only
 * matches titles and the restored value is an ID.
 *
 * @param string $post_type Post type slug, e.g. 'post' or 'page'.
 * @param string $search    Substring to filter titles by; empty string matches everything.
 * @param ?string $value    A post ID to resolve directly instead of searching, if given.
 * @return array|\WP_Error List of {value, label} pairs — the post ID (as a string) and a label
 *                         combining the title (or '(no title)') with the post ID — or a
 *                         Query\timeout_error() if the search took too long to run.
 */
function get_post_parents(string $post_type, string $search = '', ?string $value = null) {
	if($value !== null && $value !== '') {
		$post = get_post((int) $value);

		return $post ? [[
			'value' => (string) $post->ID,
			'label' => ($post->post_title !== '' ? $post->post_title : '(no title)').' (#'.$post->ID.')'
		]] : [];
	}

	global $wpdb;

	$like = '%'.$wpdb->esc_like($search).'%';
	$sql  = $wpdb->prepare(
		"SELECT ID, post_title FROM {$wpdb->posts}
		 WHERE post_type = %s AND post_status NOT IN ('trash', 'auto-draft') AND post_title LIKE %s
		 ORDER BY post_title ASC LIMIT 50",
		$post_type, $like
	);
	$rows = Query\with_timeout($sql, 'get_results');
	
	if($rows === null) {
		return Query\is_timeout() ? Query\timeout_error() : [];
	}
	
	return array_map(fn($row) => [
		'value' => (string) $row->ID,
		'label' => ($row->post_title !== '' ? $row->post_title : '(no title)').' (#'.$row->ID.')'
	], $rows);
}

/**
 * Terms of a given taxonomy, optionally searched by name.
 *
 * Goes through core's get_terms() rather than a raw query and Query\with_timeout() — WP's term
 * lookups are backed by the term cache and (for the search itself) core query building, so they
 * don't carry the same unindexed-column risk as the raw SQL lookups above.
 *
 * When $value is given (a previously-chosen term slug, restored from the ba_search query string
 * — see FilterGroup.restoreCondition in script.js), it's resolved straight via get_term_by() —
 * a cheap lookup keyed on the (indexed) slug — instead of running the search below, since the
 * search only matches term names and the restored value is a slug.
 *
 * @param string $taxonomy Taxonomy slug, e.g. 'category' or 'post_tag'.
 * @param string $search   Substring to filter term names by; empty string matches everything.
 * @param ?string $value   A term slug to resolve directly instead of searching, if given.
 * @return array List of {value, label} pairs — the term slug and name — or an empty array if
 *               the taxonomy doesn't exist or the lookup otherwise fails.
 */
function get_taxonomy_terms(string $taxonomy, string $search = '', ?string $value = null): array {
	if($value !== null && $value !== '') {
		$term = get_term_by('slug', $value, $taxonomy);

		return $term && !is_wp_error($term) ? [[
			'value' => $term->slug,
			'label' => $term->name
		]] : [];
	}

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