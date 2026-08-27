<?php

namespace BetterAdminSearch\Filter;

use \BetterAdminSearch\Operators;

if(!defined('ABSPATH')) {
	exit;
}

/*
 * Builds the admin post list's SQL WHERE (and any JOINs it needs) from the `ba_search` query
 * string parameter submitted by the filter box in assets/script.js, and applies it to the list
 * table's WP_Query via 'pre_get_posts'.
 *
 * `ba_search` arrives as a nested array (see BaSearch#render and FilterGroup#addCondition in
 * assets/script.js for exactly which `name`s produce it):
 *
 *   ba_search[groups][{gi}][logic]                                = 'AND'|'OR'
 *   ba_search[groups][{gi}][conditions][{ci}][logic]               = 'AND'|'OR'
 *   ba_search[groups][{gi}][conditions][{ci}][field]               = e.g. 'postmeta', 'post_author'
 *   ba_search[groups][{gi}][conditions][{ci}][meta_key]            = sub-identifier (meta_key or taxonomy slug)
 *   ba_search[groups][{gi}][conditions][{ci}][data_type]           = 'string'|'number'|'bool'|'date'
 *   ba_search[groups][{gi}][conditions][{ci}][operator]            = e.g. 'is', 'contains', 'between'
 *   ba_search[groups][{gi}][conditions][{ci}][value]               = scalar, or ['from'=>,'to'=>], or ['amount'=>,'unit'=>]
 *
 * Each group's conditions are combined left-to-right by each condition's own `logic` (the first
 * condition's `logic` is submitted but meaningless — there's nothing before it to combine with),
 * matching the reading order of the AND/OR toggles in the UI rather than SQL operator precedence.
 * Groups themselves are then combined the same way, by their own `logic`.
 *
 * A condition that's missing required data (no field, no value where one is needed, ...) is
 * dropped rather than treated as a query error, since that's just an in-progress row the browser
 * happened to submit anyway (e.g. hidden inputs disabled client-side don't always stay absent
 * from every code path). A group left with no valid conditions is dropped the same way, and if
 * every group ends up empty this file changes nothing — the list table runs its normal query.
 */

/**
 * Hooks the filter into 'pre_get_posts'. Called once from plugin::actions().
 */
function bootstrap(): void {
	add_action('pre_get_posts', __NAMESPACE__.'\\apply_to_query');
}

/**
 * Reads $_GET['ba_search'] and, if it describes anything valid, adds the JOIN/WHERE (and, if
 * needed, DISTINCT) it builds to the admin list table's query via 'posts_join' / 'posts_where' /
 * 'posts_distinct'. A no-op on anything but the post list screen's main query, for a user
 * lacking manage_options (the same capability the REST endpoints in includes/endpoints.php
 * require to build a condition in the first place), or when `ba_search` is absent, malformed,
 * or empty of usable conditions.
 *
 * @param \WP_Query $query
 */
function apply_to_query(\WP_Query $query): void {
	global $pagenow;

	if(!is_admin() || $pagenow !== 'edit.php' || !$query->is_main_query() || !current_user_can('manage_options')) {
		return;
	}

	// This is a read-only GET filter for the admin list table (like core's own `?s=` search box),
	// not a state-changing action, so a nonce isn't required; every value is type-checked and
	// escaped via $wpdb->prepare() downstream in build_condition_sql() before it reaches SQL.
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
	$raw = wp_unslash($_GET['ba_search'] ?? null);

	if(!is_array($raw) || !is_array($raw['groups'] ?? null)) {
		return;
	}

	$post_type = (string) ($query->get('post_type') ?: 'post');
	$built     = build_groups_sql($raw['groups'], $post_type);

	if($built === null) {
		return;
	}

	add_filter('posts_join', fn($join) => $join.$built['join']);
	add_filter('posts_where', fn($where) => $where.' AND ('.$built['where'].')');

	if($built['distinct']) {
		add_filter('posts_distinct', fn() => 'DISTINCT');
	}
}

/**
 * Builds and left-to-right-combines the SQL for every top-level group, by each group's own
 * `logic`.
 *
 * @param array  $groups    `ba_search[groups]`, keyed by group index.
 * @param string $post_type
 * @return ?array{join: string, where: string, distinct: bool} Null if no group had any usable condition.
 */
function build_groups_sql(array $groups, string $post_type): ?array {
	ksort($groups);

	$join          = '';
	$where         = null;
	$distinct      = false;
	$alias_counter = 0;

	foreach($groups as $group) {
		if(!is_array($group)) {
			continue;
		}

		$conditions = is_array($group['conditions'] ?? null) ? $group['conditions'] : [];
		$built      = build_conditions_sql($conditions, $post_type, $alias_counter);

		if($built === null) {
			continue;
		}

		$join    .= $built['join'];
		$distinct = $distinct || $built['distinct'];
		$logic    = ($group['logic'] ?? 'AND') === 'OR' ? 'OR' : 'AND';
		$where    = $where === null ? $built['where'] : "($where) $logic ({$built['where']})";
	}

	return $where === null ? null : ['join' => $join, 'where' => $where, 'distinct' => $distinct];
}

/**
 * Builds and left-to-right-combines the SQL for every condition in a group, by each condition's
 * own `logic`.
 *
 * @param array  $conditions    `ba_search[groups][gi][conditions]`, keyed by condition index.
 * @param string $post_type
 * @param int    $alias_counter Running count of postmeta JOINs added so far, threaded through so
 *                               every meta condition (across every group) gets its own alias —
 *                               see build_meta_condition().
 * @return ?array{join: string, where: string, distinct: bool} Null if no condition was usable.
 */
function build_conditions_sql(array $conditions, string $post_type, int &$alias_counter): ?array {
	ksort($conditions);

	$join     = '';
	$where    = null;
	$distinct = false;

	foreach($conditions as $condition) {
		if(!is_array($condition)) {
			continue;
		}

		$built = build_condition_sql($condition, $post_type, $alias_counter);

		if($built === null) {
			continue;
		}

		$join    .= $built['join'];
		$distinct = $distinct || $built['distinct'];
		$logic    = ($condition['logic'] ?? 'AND') === 'OR' ? 'OR' : 'AND';
		$where    = $where === null ? $built['where'] : "($where) $logic ({$built['where']})";
	}

	return $where === null ? null : ['join' => $join, 'where' => $where, 'distinct' => $distinct];
}

/**
 * Dispatches a single condition to the SQL builder for its field. Mirrors the fields in
 * plugin::dropdown_options() one-for-one; a field added there via 'ba_search_dropdown_options'
 * needs matching support here (via 'ba_search_build_condition') to actually filter by anything,
 * the same way it needs matching support in endpoints.php's get_values() to offer values for it.
 *
 * @param array  $condition     One `ba_search[groups][gi][conditions][ci]` entry.
 * @param string $post_type
 * @param int    $alias_counter See build_conditions_sql().
 * @return ?array{join: string, where: string, distinct: bool} Null if the condition is
 *                                                              unrecognized or incomplete.
 */
function build_condition_sql(array $condition, string $post_type, int &$alias_counter): ?array {
	global $wpdb;

	$field     = is_string($condition['field'] ?? null) ? $condition['field'] : '';
	$meta_key  = is_string($condition['meta_key'] ?? null) ? $condition['meta_key'] : '';
	$data_type = is_string($condition['data_type'] ?? null) ? $condition['data_type'] : 'string';
	$operator  = is_string($condition['operator'] ?? null) ? $condition['operator'] : '';
	$value     = $condition['value'] ?? null;

	if($field === '' || $operator === '') {
		return null;
	}

	return match($field) {
		'postmeta'    => $meta_key === '' ? null : build_meta_condition($meta_key, $data_type, $operator, $value, $alias_counter),
		'taxonomies'  => $meta_key === '' ? null : build_taxonomy_condition($meta_key, $operator, $value),
		'date_query'  => build_date_condition("{$wpdb->posts}.post_date", $operator, $value),
		'mod_date'    => build_date_condition("{$wpdb->posts}.post_modified", $operator, $value),
		'post_author' => build_exact_condition("{$wpdb->posts}.post_author", '%d', $operator, $value),
		'post_status' => build_exact_condition("{$wpdb->posts}.post_status", '%s', $operator, $value),
		'post_name'   => build_exact_condition("{$wpdb->posts}.post_name", '%s', $operator, $value),
		'post_parent' => build_exact_condition("{$wpdb->posts}.post_parent", '%d', $operator, $value),
		default       => apply_filters('ba_search_build_condition', null, $field, $meta_key, $data_type, $operator, $value, $post_type, $alias_counter),
	};
}

/**
 * Builds an `is` / `is_not` equality condition against a plain post column — used by every field
 * whose FIELD_OPERATOR_OVERRIDES in assets/script.js is the fixed Is/Is Not pair (post_author,
 * post_status, post_name, post_parent).
 *
 * @param string $column   Fully qualified column, e.g. "{$wpdb->posts}.post_author".
 * @param string $format   $wpdb->prepare() placeholder for the column's type — '%d' or '%s'.
 * @param string $operator 'is' or 'is_not'; anything else is treated as unrecognized.
 * @param mixed  $value
 * @return ?array{join: string, where: string, distinct: bool}
 */
function build_exact_condition(string $column, string $format, string $operator, mixed $value): ?array {
	global $wpdb;

	if(!in_array($operator, ['is', 'is_not'], true) || !is_scalar($value) || $value === '') {
		return null;
	}

	// $format is always the caller's own hardcoded '%d' or '%s' (see build_condition_sql()), never
	// user input, so this is a fixed placeholder per call site rather than dynamic SQL.
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $column is a fixed, hardcoded column identifier, not user input.
	$sql = $format === '%d' ? $wpdb->prepare("$column = %d", $value) : $wpdb->prepare("$column = %s", $value);

	return ['join' => '', 'where' => $operator === 'is_not' ? "NOT ($sql)" : $sql, 'distinct' => false];
}

/**
 * Builds a taxonomy-term condition: `is` checks the post has the given term, `is_not` checks it
 * doesn't. Uses an EXISTS subquery rather than a JOIN, since — unlike postmeta — a post having
 * (or lacking) the term doesn't need to change how many result rows it contributes.
 *
 * @param string $taxonomy Taxonomy slug (the sub-identifier chosen via get_keys).
 * @param string $operator 'is' or 'is_not'.
 * @param mixed  $value    The term slug (chosen via get_values).
 * @return ?array{join: string, where: string, distinct: bool}
 */
function build_taxonomy_condition(string $taxonomy, string $operator, mixed $value): ?array {
	global $wpdb;

	if(!in_array($operator, ['is', 'is_not'], true) || !is_scalar($value) || $value === '') {
		return null;
	}

	$exists = $wpdb->prepare(
		"EXISTS (SELECT 1 FROM {$wpdb->term_relationships} tr
		         INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
		         INNER JOIN {$wpdb->terms} t ON t.term_id = tt.term_id
		         WHERE tr.object_id = {$wpdb->posts}.ID AND tt.taxonomy = %s AND t.slug = %s)",
		$taxonomy, $value
	);

	return ['join' => '', 'where' => $operator === 'is_not' ? "NOT ($exists)" : $exists, 'distinct' => false];
}

/**
 * Builds a condition against a datetime column (post_date / post_modified, or a postmeta column
 * already cast to DATE — see build_meta_condition()) for every FilterGroup.OPERATORS.date
 * operator in assets/script.js: fixed on/before/since/between comparisons, and the relative
 * last/not_in_last/before_last/in_next ones (amount + unit, measured from NOW()).
 *
 * "Not in the Last" and "Before the Last" are treated as the same comparison (older than the
 * given amount of time) — the UI offers both as alternate phrasings of the same idea, not two
 * different ones.
 *
 * @param string $column   Fully qualified column or expression to compare, e.g.
 *                         "{$wpdb->posts}.post_date" or "$alias.meta_value" already DATE()-cast.
 * @param string $operator
 * @param mixed  $value    A date string for on/not_on/before/since; ['from'=>,'to'=>] for
 *                         between/not_between; ['amount'=>,'unit'=>] for the relative operators.
 * @return ?array{join: string, where: string, distinct: bool}
 */
function build_date_condition(string $column, string $operator, mixed $value): ?array {
	global $wpdb;

	if(in_array($operator, Operators\relative_date_operators(), true)) {
		if(!is_array($value) || !isset($value['amount'], $value['unit'])) {
			return null;
		}

		$amount = (int) $value['amount'];
		$unit   = Operators\relative_date_units()[$value['unit']]['sql'] ?? null;

		if($amount < 1 || $unit === null) {
			return null;
		}

		// $unit comes from the fixed allow-list in Operators\relative_date_units() (looked up by
		// key just above, with an unrecognized key already rejected), never raw user input, so
		// it's a fixed identifier fragment rather than dynamic SQL.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $unit is validated against a fixed allow-list above.
		$cutoff = $wpdb->prepare("DATE_SUB(NOW(), INTERVAL %d $unit)", $amount);

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $column is a fixed, hardcoded column identifier; $unit is validated against a fixed allow-list above.
		$sql = $operator === 'in_next' ? $wpdb->prepare("$column BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL %d $unit)", $amount) : null;

		// $column is a fixed, hardcoded column identifier and $cutoff already went through
		// $wpdb->prepare() above, so these are safe string comparisons, not raw dynamic SQL.
		return match($operator) {
			'last'    => ['join' => '', 'where' => "$column >= $cutoff", 'distinct' => false], // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			'in_next' => ['join' => '', 'where' => $sql, 'distinct' => false],
			default   => ['join' => '', 'where' => "$column < $cutoff", 'distinct' => false], // not_in_last / before_last -- phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		};
	}

	if(in_array($operator, Operators\range_operators(), true)) {
		if(!is_array($value) || empty($value['from']) || empty($value['to'])) {
			return null;
		}

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $column is a fixed, hardcoded column identifier, not user input.
		$sql = $wpdb->prepare("DATE($column) BETWEEN %s AND %s", $value['from'], $value['to']);

		return ['join' => '', 'where' => $operator === 'not_between' ? "NOT ($sql)" : $sql, 'distinct' => false];
	}

	if(!is_scalar($value) || $value === '') {
		return null;
	}

	// $column is a fixed, hardcoded column identifier, not user input, in every arm below.
	$sql = match($operator) {
		'on'     => $wpdb->prepare("DATE($column) = %s", $value), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		'not_on' => $wpdb->prepare("DATE($column) != %s", $value), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		'before' => $wpdb->prepare("DATE($column) < %s", $value), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		'since'  => $wpdb->prepare("DATE($column) >= %s", $value), // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		default  => null,
	};

	return $sql === null ? null : ['join' => '', 'where' => $sql, 'distinct' => false];
}

/**
 * Builds a postmeta condition: LEFT JOINs a uniquely-aliased copy of the postmeta table for this
 * meta_key (LEFT rather than INNER so posts lacking the key at all are still visible to
 * is_not/not_set/contains_not, as `meta_value IS NULL`), then compares that alias's meta_value
 * according to the condition's data type — the only field whose data type the user can actually
 * change (see baSearchData.editableDataTypeFields in plugin.php), so this is the one place that
 * has to handle every FilterGroup.OPERATORS set rather than just one fixed operator pair.
 *
 * Always reports `distinct: true`: a repeatable custom field can give one post multiple postmeta
 * rows for the same key, and without SELECT DISTINCT that post would appear once per matching row.
 *
 * @param string $meta_key
 * @param string $data_type     'string', 'number', 'bool', or 'date'.
 * @param string $operator
 * @param mixed  $value
 * @param int    $alias_counter See build_conditions_sql().
 * @return ?array{join: string, where: string, distinct: bool}
 */
function build_meta_condition(string $meta_key, string $data_type, string $operator, mixed $value, int &$alias_counter): ?array {
	global $wpdb;

	// $alias is generated above from an internal counter, never user input, so it's a fixed
	// identifier fragment rather than dynamic SQL.
	$alias = 'ba_meta_'.($alias_counter++);
	$join  = $wpdb->prepare(" LEFT JOIN {$wpdb->postmeta} AS $alias ON ($alias.post_id = {$wpdb->posts}.ID AND $alias.meta_key = %s)", $meta_key); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared

	if(in_array($operator, Operators\no_value_operators(), true)) {
		$where = $operator === 'is_set' ? "$alias.meta_value IS NOT NULL" : "$alias.meta_value IS NULL";

		return ['join' => $join, 'where' => $where, 'distinct' => true];
	}

	// A post with no row at all for this meta_key reads as absent — the "negative" side of
	// whichever comparison is being made — since the LEFT JOIN leaves meta_value NULL for it.
	$absent = "$alias.meta_value IS NULL";

	if($data_type === 'date') {
		$built = build_date_condition("DATE($alias.meta_value)", $operator, $value);

		if($built === null) {
			return null;
		}

		if(in_array($operator, ['not_on', 'not_in_last', 'before_last', 'not_between'], true)) {
			$built['where'] = "($absent OR {$built['where']})";
		}

		return ['join' => $join, 'where' => $built['where'], 'distinct' => true];
	}

	if($data_type === 'number') {
		$column = "CAST($alias.meta_value AS DECIMAL(20,4))";

		if(in_array($operator, Operators\range_operators(), true)) {
			if(!is_array($value) || !is_numeric($value['from'] ?? null) || !is_numeric($value['to'] ?? null)) {
				return null;
			}

			$sql   = $wpdb->prepare("$column BETWEEN %f AND %f", $value['from'], $value['to']); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $column is a fixed CAST(...) expression built above, not user input.
			$where = $operator === 'not_between' ? "($absent OR NOT ($sql))" : $sql;

			return ['join' => $join, 'where' => $where, 'distinct' => true];
		}

		$comparator = match($operator) {
			'equals'                => '=',
			'not_equals'            => '!=',
			'greater_than'          => '>',
			'greater_than_or_equal' => '>=',
			'less_than'             => '<',
			'less_than_or_equal'    => '<=',
			default                 => null,
		};

		if($comparator === null || !is_numeric($value)) {
			return null;
		}

		$sql   = $wpdb->prepare("$column $comparator %f", $value); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $column is a fixed CAST(...) expression, $comparator a fixed allow-listed operator built above, neither user input.
		$where = $operator === 'not_equals' ? "($absent OR $sql)" : $sql;

		return ['join' => $join, 'where' => $where, 'distinct' => true];
	}

	if($data_type === 'bool') {
		if(!in_array($value, ['0', '1'], true)) {
			return null;
		}

		return ['join' => $join, 'where' => $wpdb->prepare("$alias.meta_value = %s", $value), 'distinct' => true]; // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $alias is a fixed identifier generated above, not user input.
	}

	// string
	if(!is_scalar($value) || $value === '') {
		return null;
	}

	if(in_array($operator, ['contains', 'contains_not'], true)) {
		$sql   = $wpdb->prepare("$alias.meta_value LIKE %s", '%'.$wpdb->esc_like($value).'%'); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $alias is a fixed identifier generated above, not user input.
		$where = $operator === 'contains_not' ? "($absent OR NOT ($sql))" : $sql;

		return ['join' => $join, 'where' => $where, 'distinct' => true];
	}

	if(!in_array($operator, ['is', 'is_not'], true)) {
		return null;
	}

	$sql   = $wpdb->prepare("$alias.meta_value = %s", $value); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $alias is a fixed identifier generated above, not user input.
	$where = $operator === 'is_not' ? "($absent OR NOT ($sql))" : $sql;

	return ['join' => $join, 'where' => $where, 'distinct' => true];
}
