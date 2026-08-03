<?php

namespace BetterAdminSearch\Operators;

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
		'days'   => ['label' => __('Days', 'ba-search'), 'sql' => 'DAY'],
		'weeks'  => ['label' => __('Weeks', 'ba-search'), 'sql' => 'WEEK'],
		'months' => ['label' => __('Months', 'ba-search'), 'sql' => 'MONTH'],
		'years'  => ['label' => __('Years', 'ba-search'), 'sql' => 'YEAR'],
	];
}
