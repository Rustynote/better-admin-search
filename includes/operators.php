<?php

namespace BetterAdminSearch\Operators;

if(!defined('ABSPATH')) {
	exit;
}

/*
 * Single source of truth for the small operator-classification lists that both the query builder
 * (includes/filter.php) and the filter UI (assets/script.js, via wp_localize_script — see
 * plugin::admin_enqueue_scripts()) need to agree on: which operators take no value, which take a
 * range, which take a relative amount/unit, and what units that last group offers. Previously
 * each side declared its own copy of these; keeping them here means there's exactly one place
 * to add an operator/unit and have both sides pick it up.
 */

/**
 * Operators that take no value at all (Is Set / Is Not Set).
 *
 * @return string[]
 */
function no_value_operators(): array {
	return ['is_set', 'not_set'];
}

/**
 * Operators whose value is a ['from' => , 'to' => ] pair.
 *
 * @return string[]
 */
function range_operators(): array {
	return ['between', 'not_between'];
}

/**
 * Date operators whose value is an ['amount' => , 'unit' => ] pair.
 *
 * @return string[]
 */
function relative_date_operators(): array {
	return ['last', 'not_in_last', 'before_last', 'in_next'];
}

/**
 * Units offered for the relative date amount/unit input (e.g. "7 Days"), keyed by the value
 * submitted in `ba_search[...][value][unit]`.
 *
 * @return array<string, array{label: string, sql: string}> Unit key => {label, sql}: `label` is
 *                                                            shown in the unit `<select>`, `sql`
 *                                                            is the INTERVAL keyword
 *                                                            includes/filter.php's
 *                                                            build_date_condition() uses to build
 *                                                            the DATE_SUB()/DATE_ADD() SQL.
 */
function relative_date_units(): array {
	return [
		'days'   => ['label' => __('Days', 'arcanum-admin-query-filters'), 'sql' => 'DAY'],
		'weeks'  => ['label' => __('Weeks', 'arcanum-admin-query-filters'), 'sql' => 'WEEK'],
		'months' => ['label' => __('Months', 'arcanum-admin-query-filters'), 'sql' => 'MONTH'],
		'years'  => ['label' => __('Years', 'arcanum-admin-query-filters'), 'sql' => 'YEAR'],
	];
}

/**
 * Which operators are offered for each data type, and in what order — the operator `<select>` in
 * the filter UI (see FilterGroup.OPERATORS in script.js) repopulates from this whenever a
 * condition's data type changes. Codes only; see operator_labels() for their display text.
 *
 * @return array<string, string[]> Data type => ordered operator codes.
 */
function operators_by_type(): array {
	return [
		'string' => ['is', 'is_not', 'contains', 'contains_not', 'is_set', 'not_set'],
		'number' => [
			'equals', 'not_equals', 'greater_than', 'greater_than_or_equal',
			'less_than', 'less_than_or_equal', 'between', 'not_between',
		],
		'bool'   => ['is'],
		'date'   => [
			'last', 'not_in_last', 'between', 'not_between', 'on', 'not_on',
			'before_last', 'before', 'since', 'in_next',
		],
	];
}

/**
 * Display label for every operator code used across operators_by_type() and the
 * operatorOverride lists in plugin::dropdown_options() — one flat map since a handful of codes
 * (e.g. 'is', 'between', 'not_between') are shared between data types with the same label.
 *
 * @return array<string, string> Operator code => translated label.
 */
function operator_labels(): array {
	return [
		'is'                    => __('Is', 'arcanum-admin-query-filters'),
		'is_not'                => __('Is Not', 'arcanum-admin-query-filters'),
		'contains'              => __('Contains', 'arcanum-admin-query-filters'),
		'contains_not'          => __('Does Not Contain', 'arcanum-admin-query-filters'),
		'is_set'                => __('Is Set', 'arcanum-admin-query-filters'),
		'not_set'               => __('Is Not Set', 'arcanum-admin-query-filters'),
		'equals'                => __('Equals', 'arcanum-admin-query-filters'),
		'not_equals'            => __('Not Equals', 'arcanum-admin-query-filters'),
		'greater_than'          => __('Greater Than', 'arcanum-admin-query-filters'),
		'greater_than_or_equal' => __('Greater Than or Equal To', 'arcanum-admin-query-filters'),
		'less_than'             => __('Less Than', 'arcanum-admin-query-filters'),
		'less_than_or_equal'    => __('Less Than or Equal To', 'arcanum-admin-query-filters'),
		'between'               => __('Between', 'arcanum-admin-query-filters'),
		'not_between'           => __('Not Between', 'arcanum-admin-query-filters'),
		'last'                  => __('Last', 'arcanum-admin-query-filters'),
		'not_in_last'           => __('Not in the Last', 'arcanum-admin-query-filters'),
		'on'                    => __('On', 'arcanum-admin-query-filters'),
		'not_on'                => __('Not On', 'arcanum-admin-query-filters'),
		'before_last'           => __('Before the Last', 'arcanum-admin-query-filters'),
		'before'                => __('Before', 'arcanum-admin-query-filters'),
		'since'                 => __('Since', 'arcanum-admin-query-filters'),
		'in_next'               => __('In the Next', 'arcanum-admin-query-filters'),
	];
}

/**
 * Fixed True/False choices for the bool data type (see FilterGroup.BOOL_OPTIONS in script.js).
 *
 * A list of [value, label] pairs rather than a value => label map, since '0'/'1' are
 * numeric-looking string keys that JS would otherwise silently reorder ascending.
 *
 * @return array{0: array{0: string, 1: string}, 1: array{0: string, 1: string}}
 */
function bool_options(): array {
	return [
		['1', __('True', 'arcanum-admin-query-filters')],
		['0', __('False', 'arcanum-admin-query-filters')],
	];
}

/**
 * Display label for the AND/OR group/condition toggle buttons (see createOperatorToggle in
 * script.js). Keyed by the literal 'AND'/'OR' submitted in `ba_search[...][logic]` — that
 * submitted value itself is never translated, since includes/filter.php matches it literally.
 *
 * @return array{AND: string, OR: string}
 */
function logic_labels(): array {
	return [
		'AND' => __('AND', 'arcanum-admin-query-filters'),
		'OR'  => __('OR', 'arcanum-admin-query-filters'),
	];
}
