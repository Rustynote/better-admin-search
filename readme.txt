=== Better Admin Search ===
Contributors: rustynote
Tags: search, filter, admin, custom fields, taxonomy
Requires at least: 5.2
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 1.0.0
License: GPL v3
License URI: http://www.gnu.org/licenses/gpl-3.0.txt

Add advanced AND/OR filters to the post/page list screens: custom fields, taxonomies, dates, author, status, and more.

== Description ==

Better Admin Search adds an advanced filter box to the WordPress admin post and page list screens, letting you combine multiple conditions with AND/OR logic to narrow results fast — without writing a single query.

**Filter by:**

* Custom fields (postmeta), with string, number, boolean, or date comparisons
* Taxonomies (categories, tags, and any custom taxonomy)
* Publish date and modification date, including relative ranges like "in the last 7 days"
* Post author, status, slug, and parent

Conditions can be grouped and combined with AND/OR logic, matching the reading order of the toggles in the UI. Every added condition is reflected in the URL, so filtered views can be bookmarked or shared.

The filter UI and its REST endpoints are only available to users with the `manage_options` capability.

Developers can extend the field list via the `ba_search_dropdown_options` filter, and supply matching values and query logic via `ba_search_get_values` and `ba_search_build_condition`.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/better-admin-search` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the "Plugins" screen in WordPress.
3. Go to Posts (or any post-type list screen) and click "Advanced Filters" to build a filter.

== Frequently Asked Questions ==

= Who can use the filter box? =

Only users with the `manage_options` capability (administrators, by default) see the filter box and can query it.

= Does this replace the normal search box? =

No. It adds a separate, structured filter box alongside the existing search box and list table views.

== Future Features ==

Ideas being considered for future releases:

* Saved filters — name and store a filter combination for one-click reuse, instead of relying on bookmarking the URL
* Export matching results to CSV
* Extend advanced filtering to the users and comments list screens

== Changelog ==

= 1.0.0 =
* Initial release.
