=== Arcanum Admin Query Filters ===
Contributors: rustynote
Tags: filter, custom fields, search, admin, taxonomy
Requires at least: 5.2
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 1.0.0
License: GPL v3
License URI: http://www.gnu.org/licenses/gpl-3.0.txt

Filter the post and page list by custom fields, taxonomies, dates, author, and status — combine conditions with AND/OR logic, no code required.

== Description ==

WordPress's built-in search box only checks post titles and content — there's no way to filter the post list by a custom field, a taxonomy term, or a date range without writing PHP. Arcanum Admin Query Filters fixes that.

It adds an **Advanced Filters** box to the post and page list screens where you build a query visually: pick a field, pick an operator, pick a value, and combine as many conditions as you need with AND/OR logic.

**Filter by:**

* **Custom fields** (postmeta) — string, number, boolean, or date comparisons. Works with fields from ACF, Meta Box, Pods, Custom Field Suite, or any plugin that stores postmeta — Arcanum Admin Query Filters reads the field name and value directly, not the plugin that created it.
* **Taxonomies** — categories, tags, and any custom taxonomy
* **Publish date and modification date** — exact dates or relative ranges like "in the last 7 days"
* **Post author, status, slug, and parent**

Conditions can be grouped and combined with AND/OR logic, matching the reading order of the toggles in the UI. Every filter you build is reflected in the URL, so a filtered view can be bookmarked or shared with a teammate instead of rebuilt from scratch.

= Built for site admins and support teams =

If you manage a site with hundreds or thousands of posts — products, listings, applications, events — tagged with custom fields and taxonomies, Arcanum Admin Query Filters lets you answer questions like "which posts have `featured = true` AND `expires_on` before next week" directly from the post list, without touching the database.

= Developer-friendly =

The filter UI and its REST endpoints are restricted to users with the `manage_options` capability. Developers can extend the field list via the `ba_search_dropdown_options` filter, and supply matching values and query logic via `ba_search_get_values` and `ba_search_build_condition`.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/arcanum-admin-query-filters` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the "Plugins" screen in WordPress.
3. Go to Posts (or any post-type list screen) and click "Advanced Filters" to build a filter.

== Frequently Asked Questions ==

= Does this work with ACF, Pods, Meta Box, or other custom field plugins? =

Yes. Arcanum Admin Query Filters filters by the underlying postmeta key and value, so it works no matter which plugin created the field.

= Who can use the filter box? =

Only users with the `manage_options` capability (administrators, by default) see the filter box and can query it.

= Does this replace the normal search box? =

No. It adds a separate, structured filter box alongside the existing search box and list table views.

= Does this slow down my site? =

No. The filter box and its REST endpoints only load on the admin post/page list screens for users with the `manage_options` capability — there's no frontend footprint.

== Future Features ==

Ideas being considered for future releases:

* Saved filters — name and store a filter combination for one-click reuse, instead of relying on bookmarking the URL
* Export matching results to CSV
* Extend advanced filtering to the users and comments list screens

== Changelog ==

= 1.0.0 =
* Initial release.
