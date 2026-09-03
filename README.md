# Arcanum Admin Query Filters

Adds an advanced filter box to the WordPress admin post/page list screens, letting you combine multiple conditions with AND/OR logic to narrow results fast.

Filter by custom fields (postmeta), taxonomies, publish/modification date (including relative ranges like "in the last 7 days"), post author, status, slug, and parent — all without writing a query. Every applied filter is reflected in the URL, so a filtered view can be bookmarked or shared. The filter box and its REST endpoints are only available to users with the `manage_options` capability.

## Requirements

- WordPress 5.2+
- PHP 8.1+

## Installation

1. Copy the plugin into `wp-content/plugins/arcanum-admin-query-filters`.
2. Activate it under Plugins in wp-admin.
3. Go to Posts (or any post type's list screen) and click **Advanced Filters**.

## How it works

- [`arcanum-admin-query-filters.php`](arcanum-admin-query-filters.php) boots the plugin, builds the field list (`dropdown_options()`), and localizes it to `assets/script.js` as `baSearchData`.
- [`assets/script.js`](assets/script.js) renders the filter UI from that field list and submits the chosen conditions as a `ba_search` query-string parameter on the list screen's own URL (`GET edit.php?ba_search[groups][...]`).
- [`includes/filter.php`](includes/filter.php) reads `$_GET['ba_search']` on `pre_get_posts` and turns it into SQL `JOIN`/`WHERE` clauses added to the list table's query.
- [`includes/endpoints.php`](includes/endpoints.php) exposes two REST routes (`bas/v1/get_keys`, `bas/v1/get_values`) the UI calls to populate the field/value pickers — e.g. which postmeta keys exist, or which values a given key currently has. Both are filterable, so a plugin-added field gets pickers too — see "Extending" below.

## Extending: adding custom filter fields

The built-in fields (Custom Fields, Taxonomies, Publish Date, Modification Date, Post Author, Post Status, Post Slug, Post Parent) are defined in `plugin::dropdown_options()`, and each one is wired into the rest of the plugin through four filters. A field you add via those same filters shows up in the picker and works exactly like a built-in one.

| Filter | Called from | Purpose |
|---|---|---|
| `ba_search_dropdown_options` | [`arcanum-admin-query-filters.php`](arcanum-admin-query-filters.php) `dropdown_options()` | Adds the field to the picker and describes it (label, data type, flags). |
| `ba_search_get_keys` | [`includes/endpoints.php`](includes/endpoints.php) `get_keys()` | Supplies the sub-identifier list (which meta key, which taxonomy, ...) for a field marked `expandable`. |
| `ba_search_get_values` | [`includes/endpoints.php`](includes/endpoints.php) `get_values()` | Supplies the value picker's list for the field. |
| `ba_search_build_condition` | [`includes/filter.php`](includes/filter.php) `build_condition_sql()` | Supplies the SQL (`JOIN`/`WHERE`) for the field once a condition on it is submitted. |
| `ba_search_editable_data_type_fields` | [`arcanum-admin-query-filters.php`](arcanum-admin-query-filters.php) `admin_enqueue_scripts()` | Opts a field into letting the user override its default data type (like Custom Fields does). |

`ba_search_get_keys`, `ba_search_get_values`, and `ba_search_build_condition` are only required if your field actually needs them — see the data-type notes below.

### 1. Register the field — `ba_search_dropdown_options`

```php
apply_filters('ba_search_dropdown_options', array $options, string $post_type): array
```

Add an entry keyed by your field's unique identifier. Each entry supports:

| Key | Required | Meaning |
|---|---|---|
| `label` | yes | Text shown in the field picker. Return `''` to hide a field (including a built-in one). |
| `type` | yes | `'string'`, `'number'`, `'bool'`, or `'date'` — determines the default operator list and value widget. |
| `operatorOverride` | no | Fixed `[value, label]` operator pairs used instead of the ones `type` implies (see `Operators\operator_labels()` in [`includes/operators.php`](includes/operators.php) for existing labels). Use this for a field that only ever supports an exact match, e.g. `is`/`is_not`. |
| `expandable` | no | The field needs a sub-pick (e.g. which meta key, which taxonomy) before a value can load, supplied via `ba_search_get_keys` — see step 2 below. |
| `localSearch` | no | The field has a small, bounded set of values: fetched once via `ba_search_get_values` and filtered client-side, instead of re-querying per keystroke. |
| `postPicker` | no | The field's value is another post's ID: renders a title-search dropdown (backed by `ba_search_get_values`) instead of the plain input `type` would otherwise get. |
| `valueLookup` | no | The stored value (an ID, a slug, ...) isn't a fit display label by itself — restoring a condition from the URL resolves it via `ba_search_get_values`'s `$value` parameter instead of showing the raw value. `postPicker` fields imply this automatically. |

```php
add_filter('ba_search_dropdown_options', function(array $options, string $post_type): array {
	$options['comment_count'] = [
		'label' => __('Comment Count', 'my-plugin'),
		'type'  => 'number',
	];

	return $options;
}, 10, 2);
```

A `'number'`, `'date'`, or `'bool'` field with no `postPicker` flag gets a plain client-side input — no `ba_search_get_values` support needed. That's enough to make the field pickable; the remaining steps make it actually filter.

### 2. Supply its sub-identifiers — `ba_search_get_keys` (`expandable` fields only)

```php
apply_filters('ba_search_get_keys', array $keys, string $field, string $post_type): array
```

Only needed if your `ba_search_dropdown_options` entry set `'expandable' => true`. Called when the user opens that field in the picker, to list what's inside it — mirrors what Custom Fields does with meta keys, and Taxonomies does with taxonomy names. Return a list of `['value' => ..., 'label' => ...]` pairs; whichever one the user picks is then submitted back as `meta_key` (the condition's sub-identifier) to both `ba_search_get_values` (as `$thing`) and `ba_search_build_condition` (as `$meta_key`).

```php
add_filter('ba_search_get_keys', function(array $keys, string $field, string $post_type): array {
	if($field !== 'social_links') {
		return $keys;
	}

	$platforms = [
		'twitter'   => __('Twitter', 'my-plugin'),
		'facebook'  => __('Facebook', 'my-plugin'),
		'instagram' => __('Instagram', 'my-plugin'),
	];

	return array_map(fn($k, $l) => ['value' => $k, 'label' => $l], array_keys($platforms), $platforms);
}, 10, 3);
```

Skip this step entirely for a non-expandable field — a plain `'string'`/`'number'`/`'date'`/`'bool'` field goes straight from the field picker to its value picker, with nothing to drill into.

### 3. Build its query condition — `ba_search_build_condition`

```php
apply_filters(
	'ba_search_build_condition',
	?array $result, string $field, string $meta_key, string $data_type,
	string $operator, mixed $value, string $post_type, int $alias_counter
): ?array
```

Called once per submitted condition, for any `field` none of the built-ins handle. Return `null` if your filter doesn't recognize `$field` (so another filter, or the built-in "unrecognized" path, can run) or if the submitted operator/value combination isn't usable. Otherwise return:

```php
['join' => string, 'where' => string, 'distinct' => bool]
```

- `join` — extra SQL appended after the query's `JOIN`s (empty string if you don't need one).
- `where` — SQL appended to the query's `WHERE`, combined with the rest via the condition's own AND/OR logic. Always build this with `$wpdb->prepare()`.
- `distinct` — `true` if your `join` can multiply matching rows (e.g. a one-to-many join), so the query needs `SELECT DISTINCT`.

```php
add_filter('ba_search_build_condition', function(
	?array $result, string $field, string $meta_key, string $data_type,
	string $operator, mixed $value, string $post_type, int $alias_counter
): ?array {
	if($field !== 'comment_count') {
		return $result;
	}

	global $wpdb;

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

	return [
		'join'     => '',
		'where'    => $wpdb->prepare("{$wpdb->posts}.comment_count $comparator %d", (int) $value),
		'distinct' => false,
	];
}, 10, 8);
```

That's a complete custom field: it appears in the picker, offers the standard number operators, and filters the list table.

### 4. Supply a value list — `ba_search_get_values` (string / `localSearch` / `postPicker` fields only)

```php
apply_filters(
	'ba_search_get_values',
	array $values, string $field, ?string $thing, string $post_type, string $search, ?string $value
): array|\WP_Error
```

Needed for a `'string'`-type field (rendered as a searchable dropdown), or any field with `localSearch` or `postPicker` set. Return a list of `['value' => ..., 'label' => ...]` pairs.

- `$search` — what the user has typed so far; narrow your results by it (unless `localSearch`, in which case the UI filters your one-time full list itself).
- `$value` — a single already-known value to resolve straight to its `{value, label}` pair, used to restore a condition's display label from the URL instead of showing the raw stored value (see `valueLookup` above).

```php
add_filter('ba_search_get_values', function(
	array $values, string $field, ?string $thing, string $post_type, string $search, ?string $value
): array|\WP_Error {
	if($field !== 'reading_level') {
		return $values;
	}

	$levels = ['beginner' => __('Beginner', 'my-plugin'), 'intermediate' => __('Intermediate', 'my-plugin'), 'advanced' => __('Advanced', 'my-plugin')];

	return array_map(fn($k, $l) => ['value' => $k, 'label' => $l], array_keys($levels), $levels);
}, 10, 6);
```

(Pair this with `'localSearch' => true` in the `ba_search_dropdown_options` entry above, since the value set is small and fixed.)

### Putting it together: a full `expandable` field

Continuing the `social_links` example from step 2 — say each platform is stored as its own postmeta key (`social_twitter`, `social_facebook`, ...). Registering the field, supplying its sub-picker, its values, and its query condition together makes a complete expandable field:

```php
add_filter('ba_search_dropdown_options', function(array $options, string $post_type): array {
	$options['social_links'] = [
		'label'      => __('Social Links', 'my-plugin'),
		'type'       => 'string',
		'expandable' => true,
	];

	return $options;
}, 10, 2);

// Step 2: which platform.
add_filter('ba_search_get_keys', function(array $keys, string $field, string $post_type): array {
	if($field !== 'social_links') {
		return $keys;
	}

	$platforms = [
		'twitter'   => __('Twitter', 'my-plugin'),
		'facebook'  => __('Facebook', 'my-plugin'),
		'instagram' => __('Instagram', 'my-plugin'),
	];

	return array_map(fn($k, $l) => ['value' => $k, 'label' => $l], array_keys($platforms), $platforms);
}, 10, 3);

// Step 4: existing URLs for the chosen platform.
add_filter('ba_search_get_values', function(
	array $values, string $field, ?string $thing, string $post_type, string $search, ?string $value
): array|\WP_Error {
	if($field !== 'social_links' || !$thing) {
		return $values;
	}

	global $wpdb;

	$like = '%'.$wpdb->esc_like($search).'%';
	$urls = $wpdb->get_col($wpdb->prepare(
		"SELECT DISTINCT meta_value FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value LIKE %s ORDER BY meta_value ASC LIMIT 50",
		'social_'.$thing, $like
	));

	return array_map(fn($url) => ['value' => $url, 'label' => $url], $urls);
}, 10, 6);

// Step 3: the actual query condition, once a platform and value are both chosen.
add_filter('ba_search_build_condition', function(
	?array $result, string $field, string $meta_key, string $data_type,
	string $operator, mixed $value, string $post_type, int $alias_counter
): ?array {
	if($field !== 'social_links' || $meta_key === '') {
		return $result;
	}

	if(!in_array($operator, ['is', 'is_not'], true) || !is_scalar($value) || $value === '') {
		return null;
	}

	global $wpdb;

	// An EXISTS subquery, like build_taxonomy_condition() in includes/filter.php, sidesteps
	// needing a uniquely-aliased JOIN — useful here since $alias_counter is passed by value
	// through apply_filters(), so incrementing it in this callback wouldn't propagate back to
	// the next condition anyway. A field that does need a JOIN should keep its own counter
	// (e.g. a static variable in the callback) rather than relying on mutating this one.
	$exists = $wpdb->prepare(
		"EXISTS (SELECT 1 FROM {$wpdb->postmeta} WHERE post_id = {$wpdb->posts}.ID AND meta_key = %s AND meta_value = %s)",
		'social_'.$meta_key, $value
	);

	return ['join' => '', 'where' => $operator === 'is_not' ? "NOT ($exists)" : $exists, 'distinct' => false];
}, 10, 8);
```

`$meta_key` in `ba_search_build_condition` (and `$thing` in `ba_search_get_values`) is whichever `value` the user picked from your `ba_search_get_keys` list — `'twitter'`, `'facebook'`, or `'instagram'` here.

### Letting users override the data type — `ba_search_editable_data_type_fields`

```php
apply_filters('ba_search_editable_data_type_fields', array $fields): array
```

Fields listed here (`['postmeta']` by default) show a data-type `<select>` next to the value picker, letting the user reinterpret the stored value as string/number/bool/date rather than trusting your field's own default `type`. Add your field's key to opt in — only useful if the same field can meaningfully hold different kinds of values (which is why only `postmeta` does by default; a purpose-built field usually shouldn't need this).

## License

GPL v3 — see [LICENSE](LICENSE).
