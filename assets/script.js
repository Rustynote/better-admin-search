/**
 * Data localized from PHP (see plugin.php) — API endpoints, the current post type, per-field
 * metadata, and UI copy for the filter box.
 *
 * @typedef {Object} BaSearchData
 * @property {string} apiUrl - REST endpoint for fetching field values (see FilterGroup.fetchValues).
 * @property {Object<string,string>} dataTypes - Data type value => label, e.g. `{string: 'Text', number: 'Number', ...}`.
 * @property {Object<string,Object>} fieldOptions - Per-field config keyed by field name; see FilterGroup.FIELD_OPTIONS.
 * @property {string[]} editableDataTypeFields - Field names whose data type the user may override (currently just Custom Fields).
 * @property {string} filterBoxToggleCancelLabel - Label for the button that hides the filter box.
 * @property {string} filterBoxToggleLabel - Label for the button that reveals the filter box.
 * @property {string} keysApiUrl - REST endpoint for fetching meta keys / taxonomies (see FilterGroup.fetchKeys).
 * @property {string} nonce - WP REST nonce sent as the X-WP-Nonce header on API requests.
 * @property {string} postType - The post type the current admin list table is showing.
 */
// Prevent ide from throwing errors that the object doesn't exists.
baSearchData = baSearchData || {
    apiUrl: '',
    dataTypes: '',
    editableDataTypeFields: '',
    fieldOptions: '',
    filterBoxToggleCancelLabel: '',
    filterBoxToggleLabel: '',
    keysApiUrl: '',
    nonce: '',
    postType: '',
};

/**
 * Two-column dropdown: left column lists options (grouped, e.g. taxonomies), right column
 * either shows a hint, or — for "expandable" options like Custom Fields — a searchable
 * sub-list fetched via onLoad. Picking a plain option or a searched sub-option both close
 * the panel and fire a 'bas-change' event.
 *
 * Closing the panel without ever picking a value fires a 'bas-cancel' event instead, so
 * callers can drop whatever they were building for this selection — see the `addCondition`
 * field picker in FilterGroup, which removes the condition it belongs to when this fires.
 *
 * @fires TwoColumnSelect#bas-change
 * @fires TwoColumnSelect#bas-cancel
 */
class TwoColumnSelect {
    /**
     * @param {Object} config
     * @param {Object<string, (string|Object<string,string>)>} config.options - Flat option map
     *   (key => label), or a map of group label => {key => label} for grouped sections.
     * @param {string[]} [config.expandableKeys] - Option keys that open a searchable sub-list
     *   (via onLoad) instead of selecting immediately.
     * @param {string} [config.placeholder] - Trigger text shown before anything is selected.
     * @param {?function(string): Promise<{value: string, label: string}[]>} [config.onLoad] -
     *   Loader called once per expandable key, to fetch its full sub-option list.
     */
    constructor({options, expandableKeys = [], placeholder = 'Select…', onLoad = null}) {
        this.options = options;
        this.expandableKeys = new Set(expandableKeys);
        this.onLoad = onLoad;
        this.value = null;
        this.metaKey = null;

        this.el = document.createElement('div');
        this.el.classList.add('ba-search-tcs');

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.classList.add('ba-search-tcs-trigger', 'button');
        this.trigger.textContent = placeholder;

        this.panel = document.createElement('div');
        this.panel.classList.add('ba-search-tcs-panel');
        this.panel.hidden = true;

        this.leftCol = document.createElement('div');
        this.leftCol.classList.add('ba-search-tcs-col', 'ba-search-tcs-col-left');

        this.rightCol = document.createElement('div');
        this.rightCol.classList.add('ba-search-tcs-col', 'ba-search-tcs-col-right');

        this.panel.append(this.leftCol, this.rightCol);
        this.el.append(this.trigger, this.panel);

        this.buildLeftColumn();
        this.showHint();

        this.trigger.addEventListener('click', () => this.toggle());
        this.outsideClickHandler = e => {
            if(!this.el.contains(e.target)) this.close();
        };
        document.addEventListener('click', this.outsideClickHandler);
        this.el.addEventListener('keydown', e => {
            if(e.key === 'Escape') this.close();
        });
    }

    /**
     * Turns a snake_case key into a human-readable label, e.g. `post_title` => `Post Title`.
     * @param {string} key
     * @returns {string}
     */
    static humanize(key) {
        return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    /**
     * Renders the left column from `this.options`, grouping nested option maps under a
     * group label and leaving flat entries as top-level leaves.
     */
    buildLeftColumn() {
        Object.entries(this.options).forEach(([key, value]) => {
            if(typeof value === 'object' && value !== null) {
                const group = document.createElement('div');
                group.classList.add('ba-search-tcs-group');

                const label = document.createElement('div');
                label.classList.add('ba-search-tcs-group-label');
                label.textContent = TwoColumnSelect.humanize(key);
                group.appendChild(label);

                Object.entries(value).forEach(([subKey, subLabel]) => {
                    group.appendChild(this.buildLeaf(subKey, subLabel, false));
                });

                this.leftCol.appendChild(group);
            } else {
                this.leftCol.appendChild(this.buildLeaf(key, value, this.expandableKeys.has(key)));
            }
        });
    }

    /**
     * Builds a single left-column option button. An expandable option opens the right-column
     * sub-list on click; a plain option selects immediately.
     * @param {string} key
     * @param {string} label
     * @param {boolean} expandable
     * @returns {HTMLButtonElement}
     */
    buildLeaf(key, label, expandable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('ba-search-tcs-option');
        btn.textContent = label;
        btn.dataset.key = key;

        if(expandable) {
            btn.classList.add('ba-search-tcs-option-expandable');
            btn.addEventListener('click', () => this.expand(key, label, btn));
        } else {
            btn.addEventListener('click', () => this.select(key, null, label, null));
        }

        return btn;
    }

    /** Resets the right column to its default "pick something on the left" hint. */
    showHint() {
        this.rightCol.innerHTML = '';
        const hint = document.createElement('p');
        hint.classList.add('ba-search-tcs-hint');
        hint.textContent = 'Please click the option on the left.';
        this.rightCol.appendChild(hint);
    }

    /**
     * Opens the right-column searchable sub-list for an expandable option: loads its full item
     * set once via `onLoad`, then filters that list client-side as the user types (no further
     * requests).
     * @param {string} key - The expandable option's key.
     * @param {string} parentLabel - The expandable option's label, used to build the trigger text.
     * @param {HTMLButtonElement} btn - The left-column button that was clicked, for active-state styling.
     * @returns {Promise<void>}
     */
    async expand(key, parentLabel, btn) {
        this.leftCol.querySelectorAll('.ba-search-tcs-option-active').forEach(el => {
            el.classList.remove('ba-search-tcs-option-active');
        });
        btn.classList.add('ba-search-tcs-option-active');

        this.rightCol.innerHTML = '';

        const search = document.createElement('input');
        search.type = 'search';
        search.classList.add('ba-search-tcs-search');
        search.placeholder = 'Search…';

        const results = document.createElement('ul');
        results.classList.add('ba-search-tcs-results');
        results.innerHTML = '<li class="ba-search-tcs-results-status">Loading…</li>';

        this.rightCol.append(search, results);
        search.focus();

        const renderResults = items => {
            results.innerHTML = '';

            if(!items.length) {
                results.innerHTML = '<li class="ba-search-tcs-results-status">No results</li>';
                return;
            }

            items.forEach(({value, label}) => {
                const li = document.createElement('li');
                const optBtn = document.createElement('button');
                optBtn.type = 'button';
                optBtn.textContent = label;
                optBtn.addEventListener('click', () => this.select(key, value, parentLabel, label));
                li.appendChild(optBtn);
                results.appendChild(li);
            });
        };

        // Load the full list once; searching filters it in-browser, no further requests.
        const allItems = await this.onLoad?.(key) ?? [];
        renderResults(allItems);

        search.addEventListener('input', () => {
            const query = search.value.trim().toLowerCase();
            const filtered = query ? allItems.filter(({label}) => label.toLowerCase().includes(query)) : allItems;
            renderResults(filtered);
        });
    }

    /**
     * Commits a selection: records the value, updates the trigger text, closes the panel, and
     * fires 'bas-change'.
     * @param {string} key - The chosen option's key (or the expandable parent's key, for a sub-pick).
     * @param {?string} subValue - The chosen sub-option's value, if this came from an expandable list.
     * @param {string} label - The chosen option's label (or the expandable parent's label).
     * @param {?string} subLabel - The chosen sub-option's label, if any.
     * @fires TwoColumnSelect#bas-change
     */
    select(key, subValue, label, subLabel) {
        this.value = key;
        this.metaKey = subValue;
        this.trigger.textContent = subLabel ? `${label}: ${subLabel}` : label;
        this.close();
        this.el.dispatchEvent(new CustomEvent('bas-change', {detail: {field: key, metaKey: subValue}}));
    }

    /** Opens the panel if closed, closes it if open. */
    toggle() {
        if(this.panel.hidden) this.open(); else this.close();
    }

    /** Shows the panel. */
    open() {
        this.panel.hidden = false;
        this.el.classList.add('ba-search-tcs-open');
    }

    /**
     * Hides the panel. A no-op if already hidden — this guards against the very click that
     * opened the panel also bubbling to the document-level outside-click handler and closing
     * it again in the same tick.
     * @fires TwoColumnSelect#bas-cancel If the panel closes with no value ever having been picked.
     */
    close() {
        if(this.panel.hidden) return; // already closed - avoid a spurious cancel from the click that opened it
        this.panel.hidden = true;
        this.el.classList.remove('ba-search-tcs-open');
        this.leftCol.querySelectorAll('.ba-search-tcs-option-active').forEach(el => {
            el.classList.remove('ba-search-tcs-option-active');
        });
        this.showHint();
        if(this.value === null) this.el.dispatchEvent(new CustomEvent('bas-cancel'));
    }

    /** Removes the document-level outside-click listener; call when the widget is discarded. */
    destroy() {
        document.removeEventListener('click', this.outsideClickHandler);
    }
}

/**
 * Single-column searchable dropdown. Single-select mode picks and closes immediately, like a
 * native `<select>`. Multiple-select mode shows a checkbox per option plus an Apply button in
 * the footer — checking boxes only stages the selection, nothing is committed (and no
 * 'bas-change' fires) until Apply is clicked or another option is picked; closing the panel any
 * other way (outside click, Escape, re-toggling the trigger) discards the staged changes.
 *
 * Two ways to feed it options, chosen by which one is passed in:
 *  - `options`: a fixed array of {value, label} — searching filters it in-browser.
 *  - `onSearch(query)`: an async loader called (debounced) on open and on every keystroke —
 *    used when the full option set is too large to fetch up front (e.g. post authors).
 *
 * @fires SearchableDropdown#bas-change
 */
class SearchableDropdown {
    static SEARCH_DEBOUNCE_MS = 300;

    /**
     * @param {Object} config
     * @param {?{value: string, label: string}[]} [config.options] - Fixed option list, filtered
     *   client-side. Mutually exclusive with `onSearch`.
     * @param {?function(string): Promise<{value: string, label: string}[]>} [config.onSearch] -
     *   Async loader called on open and on every (debounced) keystroke. Mutually exclusive with `options`.
     * @param {boolean} [config.multiple] - Enables checkbox multi-select with a staged Apply step.
     * @param {string} [config.placeholder] - Trigger text shown before anything is selected.
     * @param {string} [config.searchPlaceholder] - Placeholder for the search input.
     * @param {string} [config.applyLabel] - Label for the Apply button (multi-select only).
     * @param {?(string|string[])} [config.value] - Initial value: a single value, or an array in multi-select mode.
     */
    constructor({
        options = null,
        onSearch = null,
        multiple = false,
        placeholder = 'Select…',
        searchPlaceholder = 'Search…',
        applyLabel = 'Apply',
        value = null,
    }) {
        this.multiple = multiple;
        this.onSearch = onSearch;
        this.options = options ?? [];
        this.placeholder = placeholder;
        this.value = multiple ? [...(value ?? [])] : (value ?? null);
        this.pending = new Set(this.multiple ? this.value : []);

        // Remembers the label for every value we've ever rendered, since a value picked under
        // one search term may no longer be in the list once the user searches something else.
        this.labelsByValue = new Map();

        this.searchToken = 0;
        this.searchTimer = null;

        this.el = document.createElement('div');
        this.el.classList.add('ba-search-dropdown');

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.classList.add('ba-search-dropdown-trigger', 'button');

        this.panel = document.createElement('div');
        this.panel.classList.add('ba-search-dropdown-panel');
        this.panel.hidden = true;

        this.search = document.createElement('input');
        this.search.type = 'search';
        this.search.classList.add('ba-search-dropdown-search');
        this.search.placeholder = searchPlaceholder;

        this.list = document.createElement('ul');
        this.list.classList.add('ba-search-dropdown-list');

        this.panel.append(this.search, this.list);

        if(this.multiple) {
            this.selectedCount = document.createElement('span');
            this.selectedCount.classList.add('ba-search-dropdown-footer-count');

            this.applyBtn = document.createElement('button');
            this.applyBtn.type = 'button';
            this.applyBtn.classList.add('ba-search-dropdown-apply', 'button', 'button-primary');
            this.applyBtn.textContent = applyLabel;
            this.applyBtn.addEventListener('click', () => this.apply());

            this.footer = document.createElement('div');
            this.footer.classList.add('ba-search-dropdown-footer');
            this.footer.append(this.selectedCount, this.applyBtn);
            this.panel.append(this.footer);
        }

        this.el.append(this.trigger, this.panel);
        this.updateTrigger();

        this.trigger.addEventListener('click', () => this.toggle());
        this.search.addEventListener('input', () => this.handleSearchInput());
        this.outsideClickHandler = e => {
            if(!this.el.contains(e.target)) this.close();
        };
        document.addEventListener('click', this.outsideClickHandler);
        this.el.addEventListener('keydown', e => {
            if(e.key === 'Escape') this.close();
        });
    }

    /**
     * Reacts to search input: filters `this.options` in-browser when there's no `onSearch`,
     * otherwise debounces a call to `runSearch`.
     */
    handleSearchInput() {
        const query = this.search.value.trim();

        if(!this.onSearch) {
            const filtered = query
                ? this.options.filter(({label}) => label.toLowerCase().includes(query.toLowerCase()))
                : this.options;
            this.renderList(filtered);
            return;
        }

        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.runSearch(query), SearchableDropdown.SEARCH_DEBOUNCE_MS);
    }

    /**
     * Calls `onSearch` for the given query and renders the result, guarding against a slower
     * earlier request clobbering a faster later one.
     * @param {string} query
     * @returns {Promise<void>}
     */
    async runSearch(query) {
        const token = ++this.searchToken;
        this.list.innerHTML = '<li class="ba-search-dropdown-status">Searching…</li>';

        try {
            const items = await this.onSearch(query) ?? [];
            if(token !== this.searchToken) return; // a newer keystroke has since superseded this request
            this.renderList(items);
        } catch(err) {
            if(token !== this.searchToken) return; // a newer keystroke has since superseded this request
            this.renderSearchError(query, err.message);
        }
    }

    /**
     * Shown when onSearch rejects (e.g. the server-side query timeout in includes/helpers.php)
     * instead of resolving with results — explains why, and, in single-select mode, offers to
     * use whatever the user has already typed as the value directly.
     * @param {string} query
     * @param {string} message
     */
    renderSearchError(query, message) {
        this.list.innerHTML = '';

        const status = document.createElement('li');
        status.classList.add('ba-search-dropdown-status', 'ba-search-dropdown-status-error');
        status.textContent = message;
        this.list.appendChild(status);

        if(!this.multiple && query) {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.classList.add('ba-search-dropdown-option');
            btn.textContent = `Use "${query}"`;
            btn.addEventListener('click', () => this.select(query, query));
            li.appendChild(btn);
            this.list.appendChild(li);
        }
    }

    /**
     * Renders the option list: a checkbox row per item in multi-select mode, or a plain
     * selectable button in single-select mode.
     * @param {{value: string, label: string}[]} items
     */
    renderList(items) {
        items.forEach(({value, label}) => this.labelsByValue.set(value, label));

        this.list.innerHTML = '';

        if(!items.length) {
            this.list.innerHTML = '<li class="ba-search-dropdown-status">No results</li>';
            return;
        }

        items.forEach(({value, label}) => {
            const li = document.createElement('li');

            if(this.multiple) {
                const row = document.createElement('label');
                row.classList.add('ba-search-dropdown-option');

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = this.pending.has(value);
                checkbox.addEventListener('change', () => {
                    if(checkbox.checked) this.pending.add(value); else this.pending.delete(value);
                    this.updateSelectedCount();
                });

                const text = document.createElement('span');
                text.textContent = label;

                row.append(checkbox, text);
                li.appendChild(row);
            } else {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.classList.add('ba-search-dropdown-option');
                btn.textContent = label;
                btn.addEventListener('click', () => this.select(value, label));
                li.appendChild(btn);
            }

            this.list.appendChild(li);
        });
    }

    /**
     * Commits a single-select value immediately, updates the trigger, closes the panel, and
     * fires 'bas-change'.
     * @param {string} value
     * @param {string} label
     * @fires SearchableDropdown#bas-change
     */
    select(value, label) {
        this.value = value;
        this.labelsByValue.set(value, label);
        this.updateTrigger();
        this.close();
        this.el.dispatchEvent(new CustomEvent('bas-change', {detail: {value}}));
    }

    /**
     * Commits the staged multi-select checkboxes, updates the trigger, closes the panel, and
     * fires 'bas-change'.
     * @fires SearchableDropdown#bas-change
     */
    apply() {
        this.value = [...this.pending];
        this.updateTrigger();
        this.close();
        this.el.dispatchEvent(new CustomEvent('bas-change', {detail: {value: this.value}}));
    }

    /** Updates the "N selected" footer text in multi-select mode. */
    updateSelectedCount() {
        if(this.selectedCount) this.selectedCount.textContent = `${this.pending.size} selected`;
    }

    /** Refreshes the trigger button's text to reflect the current committed value(s). */
    updateTrigger() {
        if(!this.multiple) {
            this.trigger.textContent = this.value !== null
                ? (this.labelsByValue.get(this.value) ?? this.value)
                : this.placeholder;
            return;
        }

        if(!this.value.length) {
            this.trigger.textContent = this.placeholder;
        } else if(this.value.length === 1) {
            this.trigger.textContent = this.labelsByValue.get(this.value[0]) ?? this.value[0];
        } else {
            this.trigger.textContent = `${this.value.length} selected`;
        }
    }

    /** Opens the panel if closed, closes it if open. */
    toggle() {
        if(this.panel.hidden) this.open(); else this.close();
    }

    /**
     * Shows the panel, clears the search box, stages the current value(s) for multi-select
     * editing, and kicks off the initial search/render.
     */
    open() {
        this.panel.hidden = false;
        this.el.classList.add('ba-search-dropdown-open');
        this.search.value = '';

        if(this.multiple) {
            this.pending = new Set(this.value);
            this.updateSelectedCount();
        }

        if(this.onSearch) {
            this.runSearch('');
        } else {
            this.renderList(this.options);
        }

        this.search.focus();
    }

    /** Hides the panel. Any staged (unapplied) multi-select checkboxes are discarded. */
    close() {
        this.panel.hidden = true;
        this.el.classList.remove('ba-search-dropdown-open');
    }

    /** Cancels any pending debounce and removes the document-level outside-click listener. */
    destroy() {
        clearTimeout(this.searchTimer);
        document.removeEventListener('click', this.outsideClickHandler);
    }
}

/**
 * Compact icon-only picker, used for the condition's data type select. The trigger shows just
 * the selected option's icon so it stays out of the way next to the field picker; the open
 * panel spells out icon + label so the choice is unambiguous. Shaped like a native `<select>`
 * (`.value`, `.disabled`, `.hidden`, a 'change' event) so it can drop into code written for one.
 *
 * @fires IconSelect#change
 */
class IconSelect {
    /**
     * @param {Object} config
     * @param {{value: string, label: string, icon: string}[]} config.options - Icon is raw SVG markup.
     * @param {?string} [config.value] - Initial value; defaults to the first option's value.
     */
    constructor({options, value = null}) {
        this.options = options;
        this._value = value ?? options[0]?.value ?? null;
        this._disabled = false;

        this.el = document.createElement('div');
        this.el.classList.add('ba-search-icon-select');

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.classList.add('ba-search-icon-select-trigger', 'button');

        this.panel = document.createElement('ul');
        this.panel.classList.add('ba-search-icon-select-panel');
        this.panel.hidden = true;

        this.el.append(this.trigger, this.panel);

        this.renderPanel();
        this.updateTrigger();

        this.trigger.addEventListener('click', () => this.toggle());
        this.outsideClickHandler = e => {
            if(!this.el.contains(e.target)) this.close();
        };
        document.addEventListener('click', this.outsideClickHandler);
        this.el.addEventListener('keydown', e => {
            if(e.key === 'Escape') this.close();
        });
    }

    /** @returns {?string} The currently selected value. */
    get value() { return this._value; }
    /** @param {?string} value */
    set value(value) {
        this._value = value;
        this.updateTrigger();
    }

    /** @returns {boolean} */
    get disabled() { return this._disabled; }
    /** @param {boolean} disabled - Disabling also closes the panel if open. */
    set disabled(disabled) {
        this._disabled = disabled;
        this.trigger.disabled = disabled;
        if(disabled) this.close();
    }

    /** @returns {boolean} */
    get hidden() { return this.el.hidden; }
    /** @param {boolean} hidden */
    set hidden(hidden) { this.el.hidden = hidden; }

    /**
     * Proxies to the root element's listener, so this behaves like a native form element for
     * the purposes of a 'change' listener.
     * @param {...*} args
     */
    addEventListener(...args) { this.el.addEventListener(...args); }

    /** (Re)renders the option list from `this.options`. */
    renderPanel() {
        this.panel.innerHTML = '';
        this.options.forEach(({value, label, icon}) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.classList.add('ba-search-icon-select-option');
            btn.dataset.value = value;

            const iconEl = document.createElement('span');
            iconEl.classList.add('ba-search-icon-select-icon');
            iconEl.innerHTML = icon;

            const text = document.createElement('span');
            text.textContent = label;

            btn.append(iconEl, text);
            btn.addEventListener('click', () => this.select(value));
            li.appendChild(btn);
            this.panel.appendChild(li);
        });
    }

    /**
     * Commits a selection, closes the panel, and fires 'change'.
     * @param {string} value
     * @fires IconSelect#change
     */
    select(value) {
        this.value = value;
        this.close();
        this.el.dispatchEvent(new Event('change'));
    }

    /** Refreshes the trigger's icon/title and the panel's active-option highlighting. */
    updateTrigger() {
        const option = this.options.find(o => o.value === this._value);

        const icon = document.createElement('span');
        icon.classList.add('ba-search-icon-select-icon');
        icon.innerHTML = option?.icon ?? '';
        this.trigger.replaceChildren(icon);
        this.trigger.title = option?.label ?? '';
        this.trigger.setAttribute('aria-label', option?.label ?? '');

        this.panel.querySelectorAll('.ba-search-icon-select-option').forEach(btn => {
            btn.classList.toggle('ba-search-icon-select-option-active', btn.dataset.value === this._value);
        });
    }

    /** Opens the panel if closed, closes it if open. */
    toggle() {
        if(this.panel.hidden) this.open(); else this.close();
    }

    /** Shows the panel, unless disabled. */
    open() {
        if(this._disabled) return;
        this.panel.hidden = false;
        this.el.classList.add('ba-search-icon-select-open');
    }

    /** Hides the panel. */
    close() {
        this.panel.hidden = true;
        this.el.classList.remove('ba-search-icon-select-open');
    }

    /** Removes the document-level outside-click listener; call when the widget is discarded. */
    destroy() {
        document.removeEventListener('click', this.outsideClickHandler);
    }
}

/**
 * A single AND/OR group of conditions in the filter box, and the static helpers shared by
 * every condition row it builds (operator lists, value-widget factories, and the field-metadata
 * lookups derived from `baSearchData.fieldOptions`).
 */
class FilterGroup {
    /**
     * Available operators per data type — the operator select repopulates from this whenever
     * the condition's data type changes.
     * @type {Object<string, [string, string][]>}
     */
    static OPERATORS = {
        string: [
            ['is', 'Is'],
            ['is_not', 'Is Not'],
            ['contains', 'Contains'],
            ['contains_not', 'Does Not Contain'],
            ['is_set', 'Is Set'],
            ['not_set', 'Is Not Set'],
        ],
        number: [
            ['equals', 'Equals'],
            ['not_equals', 'Not Equals'],
            ['greater_than', 'Greater Than'],
            ['greater_than_or_equal', 'Greater Than or Equal To'],
            ['less_than', 'Less Than'],
            ['less_than_or_equal', 'Less Than or Equal To'],
            ['between', 'Between'],
            ['not_between', 'Not Between'],
        ],
        bool: [
            ['is', 'Is'],
        ],
        date: [
            ['last', 'Last'],
            ['not_in_last', 'Not in the Last'],
            ['between', 'Between'],
            ['not_between', 'Not Between'],
            ['on', 'On'],
            ['not_on', 'Not On'],
            ['before_last', 'Before the Last'],
            ['before', 'Before'],
            ['since', 'Since'],
            ['in_next', 'In the Next'],
        ],
    };

    /**
     * Per-field data — label, default data type, and the optional flags read below — keyed by
     * field name. Comes from BetterAdminSearch\plugin::dropdown_options() via the
     * 'ba_search_dropdown_options' filter, so themes/plugins adding fields there are picked up
     * here automatically.
     * @returns {Object<string, Object>}
     */
    static get FIELD_OPTIONS() {
        return baSearchData.fieldOptions;
    }

    /**
     * Field names whose FIELD_OPTIONS entry has a truthy value for `prop`.
     * @param {string} prop
     * @returns {Set<string>}
     */
    static fieldsWhere(prop) {
        return new Set(Object.entries(FilterGroup.FIELD_OPTIONS)
            .filter(([, option]) => option[prop])
            .map(([field]) => field));
    }

    /**
     * Fields whose operator list is fixed regardless of data type, because the field only
     * ever supports an exact match (e.g. picking one of a fixed set of existing values).
     * @returns {Object<string, [string, string][]>} Field name => its fixed operator list.
     */
    static get FIELD_OPERATOR_OVERRIDES() {
        return Object.fromEntries(Object.entries(FilterGroup.FIELD_OPTIONS)
            .filter(([, option]) => option.operatorOverride)
            .map(([field, option]) => [field, option.operatorOverride]));
    }

    /** @type {Set<string>} Operators that take no value input at all (Is Set / Is Not Set). */
    static NO_VALUE_OPERATORS = new Set(['is_set', 'not_set']);

    /**
     * Substring-match operators take arbitrary typed text rather than one of the field's
     * existing exact values, since the value being searched for need not be a whole value.
     * @type {Set<string>}
     */
    static CONTAINS_OPERATORS = new Set(['contains', 'contains_not']);

    /** @type {Set<string>} Operators that need a "from" and "to" value instead of a single one. */
    static RANGE_OPERATORS = new Set(['between', 'not_between']);

    /**
     * Date operators expressed as a rolling amount of time (e.g. "in the last 7 days")
     * rather than a fixed date.
     * @type {Set<string>}
     */
    static RELATIVE_DATE_OPERATORS = new Set(['last', 'not_in_last', 'before_last', 'in_next']);

    /** @type {[string, string][]} Units offered for the relative date amount/unit input. */
    static RELATIVE_DATE_UNITS = [
        ['days', 'Days'],
        ['weeks', 'Weeks'],
        ['months', 'Months'],
        ['years', 'Years'],
    ];

    /**
     * Fields that need a sub-pick (which meta key / which taxonomy) before a value can load.
     * @returns {Set<string>}
     */
    static get EXPANDABLE_FIELDS() {
        return FilterGroup.fieldsWhere('expandable');
    }

    /**
     * Fields with a small, bounded set of values: fetched once and filtered client-side rather
     * than hitting the API on every keystroke. Everything else searches server-side, since its
     * full value set (post authors, taxonomy terms, custom field values) can be too large to
     * fetch up front.
     * @returns {Set<string>}
     */
    static get LOCAL_SEARCH_FIELDS() {
        return FilterGroup.fieldsWhere('localSearch');
    }

    /**
     * Fields whose value is actually another post: instead of the plain number input its data
     * type would otherwise get, this searches existing posts of the same post type by title.
     * @returns {Set<string>}
     */
    static get POST_PICKER_FIELDS() {
        return FilterGroup.fieldsWhere('postPicker');
    }

    /** @type {[string, string][]} Fixed True/False choices for the bool data type. */
    static BOOL_OPTIONS = [
        ['1', 'True'],
        ['0', 'False'],
    ];

    /**
     * @param {string} [operator] - Initial AND/OR operator, shown on the toggle for non-root groups.
     * @param {boolean} [isRoot] - Root groups have no operator toggle and no remove button, and
     *   are never removed automatically when emptied.
     * @param {?function(): void} [onEmpty] - Called when the last condition is removed from a
     *   non-root group, so the caller can remove the now-pointless group too.
     * @param {boolean} [focusFirstCondition] - Passed through to the initial `addCondition` call;
     *   see its `focus` parameter.
     */
    constructor(operator = 'AND', isRoot = false, onEmpty = null, focusFirstCondition = false) {
        this.operator = operator;
        this.isRoot = isRoot;
        this.onEmpty = onEmpty;
        this.children = [];

        this.el = document.createElement('div');
        this.el.classList.add('ba-search-group');

        this.header = document.createElement('div');
        this.header.classList.add('ba-search-group-header');

        if(!this.isRoot) {
            this.operatorToggle = FilterGroup.createOperatorToggle(this.operator, op => this.operator = op);
            this.header.append(this.operatorToggle);
        }

        this.childrenEl = document.createElement('div');
        this.childrenEl.classList.add('ba-search-group-children');

        const addConditionBtn = FilterGroup.createActionButton('+ Condition', () => this.addCondition(true));
        addConditionBtn.classList.add('ba-search-add-condition');

        this.footer = document.createElement('div');
        this.footer.classList.add('ba-search-group-footer');
        this.footer.appendChild(addConditionBtn);

        this.el.append(this.header, this.childrenEl, this.footer);

        this.addCondition(focusFirstCondition); // group always starts with one condition
    }

    /**
     * Builds a plain secondary button used for the "+ Condition" / "+ Group" actions.
     * @param {string} label
     * @param {function(): void} onClick
     * @returns {HTMLButtonElement}
     */
    static createActionButton(label, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('button', 'button-secondary');
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }

    /**
     * Builds the AND/OR toggle button shown between sibling conditions/groups; clicking it
     * flips between the two values.
     * @param {string} initial - 'AND' or 'OR'.
     * @param {function(string): void} onChange - Called with the new value after a flip.
     * @returns {HTMLButtonElement}
     */
    static createOperatorToggle(initial, onChange) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('ba-search-group-operator', 'button');
        btn.textContent = initial;
        btn.dataset.operator = initial;
        btn.addEventListener('click', () => {
            const next = btn.dataset.operator === 'AND' ? 'OR' : 'AND';
            btn.dataset.operator = next;
            btn.textContent = next;
            onChange(next);
        });
        return btn;
    }

    /** @type {string} Trash-can SVG markup used on every remove button. */
    static REMOVE_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 7h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M9 7V5.5c0-.6.4-1 1-1h4c.6 0 1 .4 1 1V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 7l.8 12c.05.8.7 1.5 1.5 1.5h5.4c.8 0 1.45-.6 1.5-1.5L17 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`;

    /**
     * Builds a remove ("×") button shared by conditions and groups: removes `target` from the
     * DOM and from `list`, then calls `onRemove`.
     * @param {HTMLElement} target - The element to remove from the DOM.
     * @param {Array<{el: HTMLElement}|HTMLElement>} list - The array `target` (or its owner)
     *   should be spliced out of; entries may be plain elements or objects with an `.el`.
     * @param {?function(): void} [onRemove] - Called after removal, for caller-specific cleanup.
     * @returns {HTMLButtonElement}
     */
    static createRemoveButton(target, list, onRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.classList.add('ba-search-block-remove', 'button-link-delete');
        removeBtn.setAttribute('aria-label', 'Remove');
        removeBtn.innerHTML = `<span class="ba-search-icon">${FilterGroup.REMOVE_ICON}</span>`;
        removeBtn.addEventListener('click', () => {
            target.remove();
            const idx = list.findIndex(c => (c.el ?? c) === target);
            if(idx > -1) list.splice(idx, 1);
            onRemove?.();
        });
        return removeBtn;
    }

    /**
     * Builds a condition's operator `<select>`, populated for the given data type.
     * @param {string} [dataType]
     * @returns {HTMLSelectElement}
     */
    static buildOperatorSelect(dataType = 'string') {
        const select = document.createElement('select');
        select.classList.add('ba-search-operator-select');
        FilterGroup.populateOperatorSelect(select, dataType);
        return select;
    }

    /**
     * Repopulates an operator select for a given data type, keeping the current selection
     * if it's still a valid choice (e.g. "Between" exists for both Number and Date). A field
     * listed in FIELD_OPERATOR_OVERRIDES gets its fixed operator list regardless of data type.
     * @param {HTMLSelectElement} select
     * @param {string} dataType
     * @param {?string} [field]
     */
    static populateOperatorSelect(select, dataType, field = null) {
        const previousValue = select.value;
        select.innerHTML = '';
        const operators = FilterGroup.FIELD_OPERATOR_OVERRIDES[field] ?? FilterGroup.OPERATORS[dataType] ?? FilterGroup.OPERATORS.string;
        operators.forEach(([value, label]) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        });
        if(previousValue && [...select.options].some(opt => opt.value === previousValue)) {
            select.value = previousValue;
        }
    }

    /**
     * Builds the placeholder value `<select>` shown before a field is chosen (or while one
     * isn't needed, e.g. for Is Set / Is Not Set).
     * @returns {HTMLSelectElement}
     */
    static buildValueSelect() {
        const select = document.createElement('select');
        select.classList.add('ba-search-value-select');
        select.disabled = true;
        return select;
    }

    /**
     * Fixed True/False choice — no API fetch needed.
     * @returns {HTMLSelectElement}
     */
    static buildBoolSelect() {
        const select = document.createElement('select');
        select.classList.add('ba-search-value-select', 'ba-search-value-bool');
        FilterGroup.BOOL_OPTIONS.forEach(([value, label]) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        });
        return select;
    }

    /** @returns {HTMLInputElement} A native `<input type="date">`. */
    static buildDateInput() {
        const input = document.createElement('input');
        input.type = 'date';
        input.classList.add('ba-search-value-date');
        return input;
    }

    /** @returns {HTMLInputElement} A native `<input type="number">`. */
    static buildNumberInput() {
        const input = document.createElement('input');
        input.type = 'number';
        input.classList.add('ba-search-value-number');
        return input;
    }

    /** @returns {HTMLInputElement} A native `<input type="text">`. */
    static buildTextInput() {
        const input = document.createElement('input');
        input.type = 'text';
        input.classList.add('ba-search-value-text');
        return input;
    }

    /**
     * Shown in place of the normal value widget when a server-side value search errors out
     * (e.g. the query timeout in includes/helpers.php) — surfaces why, and lets the user type
     * the value directly instead of picking it from a list the server couldn't produce in time.
     * @param {string} message
     * @returns {HTMLDivElement}
     */
    static buildValueErrorFallback(message) {
        const wrapper = document.createElement('div');
        wrapper.classList.add('ba-search-value-error');

        const text = document.createElement('p');
        text.classList.add('ba-search-value-error-message');
        text.textContent = message;

        wrapper.append(text, FilterGroup.buildTextInput());
        return wrapper;
    }

    /**
     * "From" and "to" inputs for Between / Not Between, matching the condition's data type.
     * @param {string} dataType - 'date' gets date inputs; anything else gets number inputs.
     * @returns {HTMLDivElement}
     */
    static buildRangeInput(dataType) {
        const wrapper = document.createElement('div');
        wrapper.classList.add('ba-search-value-range');

        const buildBound = () => dataType === 'date' ? FilterGroup.buildDateInput() : FilterGroup.buildNumberInput();

        const from = buildBound();
        from.classList.add('ba-search-value-range-from');

        const to = buildBound();
        to.classList.add('ba-search-value-range-to');

        const sep = document.createElement('span');
        sep.classList.add('ba-search-value-range-sep');
        sep.textContent = 'and';

        wrapper.append(from, sep, to);
        return wrapper;
    }

    /**
     * Amount + unit inputs for the relative date operators (Last, Not in the Last,
     * Before the Last, In the Next), e.g. "7 Days".
     * @returns {HTMLDivElement}
     */
    static buildRelativeDateInput() {
        const wrapper = document.createElement('div');
        wrapper.classList.add('ba-search-value-relative');

        const amount = document.createElement('input');
        amount.type = 'number';
        amount.min = '1';
        amount.value = '1';
        amount.classList.add('ba-search-value-relative-amount');

        const unit = document.createElement('select');
        unit.classList.add('ba-search-value-relative-unit');
        FilterGroup.RELATIVE_DATE_UNITS.forEach(([value, label]) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            unit.appendChild(opt);
        });

        wrapper.append(amount, unit);
        return wrapper;
    }

    /** @type {Object<string, string>} Data type value => its icon's raw SVG markup. */
    static DATA_TYPE_ICONS = {
        string: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <text x="12" y="16.5" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="11" font-weight="600" fill="currentColor">Aa</text>
        </svg>`,
        number: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <text x="12" y="16.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="currentColor">#</text>
        </svg>`,
        bool: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="9" cy="12" r="3" fill="currentColor"/>
            <circle cx="16" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/>
        </svg>`,
        date: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="6" width="14" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>
            <line x1="5" y1="10" x2="19" y2="10" stroke="currentColor" stroke-width="1.4"/>
            <line x1="8.5" y1="4.5" x2="8.5" y2="7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <line x1="15.5" y1="4.5" x2="15.5" y2="7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>`,
    };

    /**
     * Data type select shown at the end of the condition row. Only fields listed in
     * baSearchData.editableDataTypeFields (currently just Custom Fields) can be changed
     * by the user; for every other field it just displays the fixed default, and starts
     * disabled and hidden until a field is chosen.
     * @returns {IconSelect}
     */
    static buildDataTypeSelect() {
        const options = Object.entries(baSearchData.dataTypes).map(([value, label]) => ({
            value,
            label,
            icon: FilterGroup.DATA_TYPE_ICONS[value] ?? '',
        }));
        const select = new IconSelect({options});
        select.el.classList.add('ba-search-datatype-select');
        select.disabled = true;
        select.hidden = true;
        return select;
    }

    /**
     * Identifiers to drill into: meta_key names for postmeta, or the taxonomy list for taxonomies.
     * @param {string} field
     * @param {?string} [postType]
     * @returns {Promise<{value: string, label: string}[]>} Empty array on any failure.
     */
    static async fetchKeys(field, postType = null) {
        try {
            const params = new URLSearchParams({field});
            if(postType) params.set('post_type', postType);

            const response = await fetch(`${baSearchData.keysApiUrl}?${params}`, {
                headers: {'X-WP-Nonce': baSearchData.nonce},
            });
            if(!response.ok) return [];
            return await response.json();
        } catch {
            return [];
        }
    }

    /**
     * Values for an already-chosen identifier: meta values for a meta_key, or terms of a taxonomy.
     * `search` narrows the result set server-side, for fields whose full value set is too large
     * to fetch up front — see LOCAL_SEARCH_FIELDS for the fields that skip this. Several of the
     * columns searched here (meta_value, post_title, display_name) have no index, so the server
     * enforces a 10s query timeout (see includes/helpers.php); a 504 response means it was hit,
     * and is thrown here as an Error rather than swallowed, so callers can offer the user a way
     * to enter the value directly instead of quietly showing an empty result list.
     * @param {string} field
     * @param {?string} [thing] - The meta_key / taxonomy chosen for an expandable field.
     * @param {?string} [postType]
     * @param {string} [search]
     * @returns {Promise<{value: string, label: string}[]>} Empty array on a non-504 failure.
     * @throws {Error} If the request times out (HTTP 504).
     */
    static async fetchValues(field, thing = null, postType = null, search = '') {
        let response;
        try {
            const params = new URLSearchParams({field});
            if(thing) params.set('thing', thing);
            if(postType) params.set('post_type', postType);
            if(search) params.set('search', search);

            response = await fetch(`${baSearchData.apiUrl}?${params}`, {
                headers: {'X-WP-Nonce': baSearchData.nonce},
            });
        } catch {
            return [];
        }

        if(response.status === 504) {
            let message = 'This search took too long to run. Enter the value directly instead.';
            try {
                message = (await response.json())?.message ?? message;
            } catch {
                // Use the fallback message above.
            }
            throw new Error(message);
        }

        if(!response.ok) return [];
        return await response.json();
    }

    /**
     * Adds a new condition row to this group: a field picker, an operator select, a value
     * widget that adapts to the chosen field's data type and operator, and a data type picker
     * (for fields that allow overriding it). The operator/value/data-type inputs stay hidden
     * until a field is actually picked, and the whole condition removes itself (see
     * `createRemoveButton`) if the field picker is ever closed with nothing chosen.
     * @param {boolean} [focus] - If true, opens the field picker once the current click's event
     *   bubble finishes, instead of leaving the newly added row idle. Used for conditions/groups
     *   added by explicit user action (not the very first condition rendered at page load).
     */
    addCondition(focus = false) {
        const condition = document.createElement('div');
        condition.classList.add('ba-search-block', 'ba-search-condition');
        condition.dataset.operator = 'AND';

        const whereLabel = document.createElement('span');
        whereLabel.classList.add('ba-search-group-operator', 'ba-search-group-operator-label');
        whereLabel.textContent = 'Where';

        const operatorToggle = FilterGroup.createOperatorToggle('AND', op => condition.dataset.operator = op);

        condition.whereLabel = whereLabel;
        condition.operatorToggle = operatorToggle;

        const fieldSelect = new TwoColumnSelect({
            options: Object.fromEntries(Object.entries(FilterGroup.FIELD_OPTIONS)
                .map(([field, option]) => [field, option.label])),
            expandableKeys: FilterGroup.EXPANDABLE_FIELDS,
            placeholder: 'Select field…',
            onLoad: key => FilterGroup.fetchKeys(key, baSearchData.postType)
        });
        const dataTypeSelect = FilterGroup.buildDataTypeSelect();
        const operatorSelect = FilterGroup.buildOperatorSelect(dataTypeSelect.value);
        operatorSelect.hidden = true; // stays hidden until a field is picked

        const valueWrapper = document.createElement('div');
        valueWrapper.classList.add('ba-search-value-wrapper');
        valueWrapper.appendChild(FilterGroup.buildValueSelect());
        valueWrapper.hidden = true; // stays hidden until a field is picked

        const fieldWrapper = document.createElement('div');
        fieldWrapper.classList.add('ba-search-field-wrapper');
        fieldWrapper.append(fieldSelect.el);

        // Syncs the data-type picker (and the operator/value inputs' visibility) to the chosen
        // field: fixed default type normally, editable only for baSearchData.editableDataTypeFields.
        const refreshDataType = () => {
            const field = fieldSelect.value;
            const editable = baSearchData.editableDataTypeFields.includes(field);
            dataTypeSelect.value = FilterGroup.FIELD_OPTIONS[field]?.type ?? 'string';
            dataTypeSelect.disabled = !editable;
            dataTypeSelect.hidden = !editable;
            operatorSelect.hidden = !field;
            valueWrapper.hidden = !field;
        };

        const refreshOperators = () => {
            FilterGroup.populateOperatorSelect(operatorSelect, dataTypeSelect.value, fieldSelect.value);
        };

        // Tracks the in-flight fetch so a slow response for an earlier field/type
        // selection can't clobber a widget rebuilt by a later one.
        let refreshToken = 0;

        // The value widget is sometimes a SearchableDropdown, which holds a document-level click
        // listener that must be torn down before it's replaced — plain inputs/selects need no
        // such cleanup, so this is a no-op for those.
        let valueDropdown = null;
        const setValueWidget = node => {
            valueDropdown?.destroy();
            valueDropdown = null;
            valueWrapper.replaceChildren(node);
        };

        // Swaps the value widget to match the condition's data type and operator: a free-text
        // input for the substring CONTAINS_OPERATORS, an amount/unit pair for relative date
        // operators, a "from"/"to" pair for range operators, a native date/number input for
        // date/number (no API needed), a fixed True/False select for bool, a searchable post
        // picker for POST_PICKER_FIELDS regardless of data type, or — for string — a
        // SearchableDropdown of existing values. Fields in LOCAL_SEARCH_FIELDS are
        // fetched once and filtered client-side; everything else searches the API as the user
        // types, since its full value set can be large.
        const refreshValues = async () => {
            const token = ++refreshToken;
            const field = fieldSelect.value;
            const needsSubKey = FilterGroup.EXPANDABLE_FIELDS.has(field) && !fieldSelect.metaKey;
            const dataType = dataTypeSelect.value;
            const operator = operatorSelect.value;
            const metaKey = fieldSelect.metaKey;
            const placeholder = 'Select value…';

            if(!field || needsSubKey || FilterGroup.NO_VALUE_OPERATORS.has(operator)) {
                setValueWidget(FilterGroup.buildValueSelect());
                return;
            }

            if(FilterGroup.CONTAINS_OPERATORS.has(operator)) {
                setValueWidget(FilterGroup.buildTextInput());
                return;
            }

            if(FilterGroup.RELATIVE_DATE_OPERATORS.has(operator)) {
                setValueWidget(FilterGroup.buildRelativeDateInput());
                return;
            }

            if(FilterGroup.RANGE_OPERATORS.has(operator)) {
                setValueWidget(FilterGroup.buildRangeInput(dataType));
                return;
            }

            if(FilterGroup.POST_PICKER_FIELDS.has(field)) {
                const dropdown = new SearchableDropdown({
                    onSearch: query => FilterGroup.fetchValues(field, metaKey, baSearchData.postType, query),
                    placeholder,
                });
                setValueWidget(dropdown.el);
                valueDropdown = dropdown;
                return;
            }

            if(dataType === 'bool') {
                setValueWidget(FilterGroup.buildBoolSelect());
                return;
            }

            if(dataType === 'date') {
                setValueWidget(FilterGroup.buildDateInput());
                return;
            }

            if(dataType === 'number') {
                setValueWidget(FilterGroup.buildNumberInput());
                return;
            }

            if(FilterGroup.LOCAL_SEARCH_FIELDS.has(field)) {
                const loading = document.createElement('span');
                loading.classList.add('ba-search-value-loading');
                loading.textContent = 'Loading…';
                setValueWidget(loading);

                let items;
                try {
                    items = await FilterGroup.fetchValues(field, metaKey, baSearchData.postType);
                } catch(err) {
                    if(token !== refreshToken) return; // a newer selection has since replaced this widget
                    setValueWidget(FilterGroup.buildValueErrorFallback(err.message));
                    return;
                }
                if(token !== refreshToken) return; // a newer selection has since replaced this widget

                const dropdown = new SearchableDropdown({options: items, placeholder});
                setValueWidget(dropdown.el);
                valueDropdown = dropdown;
                return;
            }

            const dropdown = new SearchableDropdown({
                onSearch: query => FilterGroup.fetchValues(field, metaKey, baSearchData.postType, query),
                placeholder,
            });
            setValueWidget(dropdown.el);
            valueDropdown = dropdown;
        };

        fieldSelect.el.addEventListener('bas-change', refreshDataType);
        fieldSelect.el.addEventListener('bas-change', refreshOperators);
        fieldSelect.el.addEventListener('bas-change', refreshValues);
        operatorSelect.addEventListener('change', refreshValues);
        dataTypeSelect.addEventListener('change', refreshOperators);
        dataTypeSelect.addEventListener('change', refreshValues);

        const removeBtn = FilterGroup.createRemoveButton(condition, this.children, () => {
            fieldSelect.destroy();
            dataTypeSelect.destroy();
            valueDropdown?.destroy();
            this.updateConditionToggles();
            if(!this.isRoot && this.children.length === 0) {
                this.onEmpty?.();
            }
        });

        // If the field picker is closed without a field being chosen, this condition (and its
        // parent group, once empty) has no reason to exist — drop it via the same path as an
        // explicit remove click.
        fieldSelect.el.addEventListener('bas-cancel', () => removeBtn.click(), {once: true});

        condition.dataTypeSelect = dataTypeSelect;
        condition.fieldSelect = fieldSelect;
        condition.append(whereLabel, operatorToggle, fieldWrapper, operatorSelect, valueWrapper, dataTypeSelect.el, removeBtn);

        this.childrenEl.appendChild(condition);
        this.children.push(condition);
        this.updateConditionToggles();

        // Deferred past the current click's bubble so the field picker's own outside-click
        // handler (attached above, on document) doesn't treat that same click as "outside" and
        // immediately cancel the picker it just opened.
        if(focus) setTimeout(() => fieldSelect.open(), 0);
    }

    /**
     * Shows "Where" on the first condition and the AND/OR toggle on every condition after it,
     * since the first condition has nothing to its left to combine with.
     */
    updateConditionToggles() {
        this.children.forEach((condition, index) => {
            const isFirst = index === 0;
            condition.whereLabel.style.display = isFirst ? '' : 'none';
            condition.operatorToggle.style.display = isFirst ? 'none' : '';
        });
    }
}

/**
 * Top-level controller: renders the "Filter"/"Cancel" toggle buttons and the root FilterGroup
 * into the admin list table's tablenav, and owns the set of top-level groups.
 */
class BaSearch {
    constructor() {
        this.postFilter = document.querySelector('div.tablenav.top');
        this.buttonClass = 'ba-search-button';
        this.activeClass = 'ba-search-container-active';
        this.groups = [];

        this.render();
        this.bindEvents();
    }

    /**
     * Builds a `<button class="button">` with the given extra classes and label.
     * @param {string[]} classes
     * @param {string} label
     * @returns {HTMLButtonElement}
     */
    createButton(classes, label) {
        const btn = document.createElement('button');
        btn.classList.add(...classes, 'button');
        btn.textContent = label;
        btn.type = 'button';
        return btn;
    }

    /** Builds the toggle/cancel buttons and the filter box (starting with one root group), and inserts it all before the list table. */
    render() {
        this.container = document.createElement('div');
        this.container.classList.add('ba-search-container');

        this.toggleBtn = this.createButton(
            [this.buttonClass, 'button-primary'],
            baSearchData.filterBoxToggleLabel
        );

        this.cancelBtn = this.createButton(
            [`${this.buttonClass}-cancel`, 'ba-search-active-visible-inline', 'button-secondary'],
            baSearchData.filterBoxToggleCancelLabel
        );

        this.filterList = document.createElement('div');
        this.filterList.classList.add('ba-search-active-visible');

        this.groupsEl = document.createElement('div');
        this.groupsEl.classList.add('ba-search-groups');

        const addGroupBtn = FilterGroup.createActionButton('+ Group', () => this.addGroup());

        this.addGroup(true); // root

        this.filterList.append(this.groupsEl, addGroupBtn);
        this.container.append(this.toggleBtn, this.cancelBtn, this.filterList);
        this.postFilter.prepend(this.container);
    }

    /**
     * Creates a new top-level FilterGroup and appends it. Non-root groups get a remove button
     * and auto-open their first condition's field picker (see FilterGroup#addCondition); the
     * root group does neither, since it's created before the filter box is ever shown.
     * @param {boolean} [isRoot]
     */
    addGroup(isRoot = false) {
        const group = new FilterGroup('AND', isRoot, () => {
            group.el.remove();
            this.groups = this.groups.filter(g => g !== group);
        }, !isRoot);
        group.el.classList.add('ba-search-block');

        if(!isRoot) {
            group.header.appendChild(FilterGroup.createRemoveButton(group.el, this.groups));
        }

        this.groupsEl.appendChild(group.el);
        this.groups.push(group);
        if(isRoot) this.rootGroup = group;
    }

    bindEvents() {
        this.toggleBtn.addEventListener('click', () => this.setActive(true));
        this.cancelBtn.addEventListener('click', () => this.setActive(false));
    }

    /**
     * Shows or hides the filter box. Activating also tries to open the root group's still-empty
     * starting condition's field picker (see `focusEmptyCondition`).
     * @param {boolean} active
     */
    setActive(active) {
        this.container.classList.toggle(this.activeClass, active);
        if(active) this.focusEmptyCondition();
    }

    /**
     * On first opening the filter box, the root group's starting condition has no field chosen
     * yet — open its picker right away, same as a freshly added condition/group. Deferred past
     * the toggle click's bubble so the picker's own outside-click handler (on document) doesn't
     * treat that same click as "outside" and immediately cancel it. A no-op once that condition
     * already has a field (or has been removed).
     */
    focusEmptyCondition() {
        const fieldSelect = this.rootGroup?.children[0]?.fieldSelect;
        if(fieldSelect && fieldSelect.value === null) {
            setTimeout(() => fieldSelect.open(), 0);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.baSearch = new BaSearch();
});
