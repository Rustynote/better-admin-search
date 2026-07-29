baSearchData = baSearchData || {
    filterBoxToggleLabel: '',
    filterBoxToggleCancelLabel: ''
};

// Two-column dropdown: left column lists options (grouped, e.g. taxonomies), right column
// either shows a hint, or — for "expandable" options like Custom Fields — a searchable
// sub-list fetched via onSearch. Picking a plain option or a searched sub-option both
// close the panel and fire a 'bas-change' event.
class TwoColumnSelect {
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

    static humanize(key) {
        return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

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

    showHint() {
        this.rightCol.innerHTML = '';
        const hint = document.createElement('p');
        hint.classList.add('ba-search-tcs-hint');
        hint.textContent = 'Please click the option on the left.';
        this.rightCol.appendChild(hint);
    }

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

    select(key, subValue, label, subLabel) {
        this.value = key;
        this.metaKey = subValue;
        this.trigger.textContent = subLabel ? `${label}: ${subLabel}` : label;
        this.close();
        this.el.dispatchEvent(new CustomEvent('bas-change', {detail: {field: key, metaKey: subValue}}));
    }

    toggle() {
        if(this.panel.hidden) this.open(); else this.close();
    }

    open() {
        this.panel.hidden = false;
        this.el.classList.add('ba-search-tcs-open');
    }

    close() {
        this.panel.hidden = true;
        this.el.classList.remove('ba-search-tcs-open');
        this.leftCol.querySelectorAll('.ba-search-tcs-option-active').forEach(el => {
            el.classList.remove('ba-search-tcs-option-active');
        });
        this.showHint();
    }

    destroy() {
        document.removeEventListener('click', this.outsideClickHandler);
    }
}

// Single-column searchable dropdown. Single-select mode picks and closes immediately, like a
// native <select>. Multiple-select mode shows a checkbox per option plus an Apply button in the
// footer — checking boxes only stages the selection, nothing is committed (and no 'bas-change'
// fires) until Apply is clicked or another option is picked; closing the panel any other way
// (outside click, Escape, re-toggling the trigger) discards the staged changes.
//
// Two ways to feed it options, chosen by which one is passed in:
//  - `options`: a fixed array of {value, label} — searching filters it in-browser.
//  - `onSearch(query)`: an async loader called (debounced) on open and on every keystroke —
//    used when the full option set is too large to fetch up front (e.g. post authors).
class SearchableDropdown {
    static SEARCH_DEBOUNCE_MS = 300;

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

    async runSearch(query) {
        const token = ++this.searchToken;
        this.list.innerHTML = '<li class="ba-search-dropdown-status">Searching…</li>';

        const items = await this.onSearch(query) ?? [];
        if(token !== this.searchToken) return; // a newer keystroke has since superseded this request

        this.renderList(items);
    }

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

    select(value, label) {
        this.value = value;
        this.labelsByValue.set(value, label);
        this.updateTrigger();
        this.close();
        this.el.dispatchEvent(new CustomEvent('bas-change', {detail: {value}}));
    }

    apply() {
        this.value = [...this.pending];
        this.updateTrigger();
        this.close();
        this.el.dispatchEvent(new CustomEvent('bas-change', {detail: {value: this.value}}));
    }

    updateSelectedCount() {
        if(this.selectedCount) this.selectedCount.textContent = `${this.pending.size} selected`;
    }

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

    toggle() {
        if(this.panel.hidden) this.open(); else this.close();
    }

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

    close() {
        this.panel.hidden = true;
        this.el.classList.remove('ba-search-dropdown-open');
    }

    destroy() {
        clearTimeout(this.searchTimer);
        document.removeEventListener('click', this.outsideClickHandler);
    }
}

class FilterGroup {
    // Available operators per data type — the value select repopulates from this whenever
    // the condition's data type changes.
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

    // Fields whose operator list is fixed regardless of data type, because the field only
    // ever supports an exact match (e.g. picking one of a fixed set of existing values).
    static FIELD_OPERATOR_OVERRIDES = {
        post_author: [['is', 'Is'], ['is_not', 'Is Not']],
        post_status: [['is', 'Is'], ['is_not', 'Is Not']],
        post_name:   [['is', 'Is'], ['is_not', 'Is Not']],
        post_parent: [['is', 'Is'], ['is_not', 'Is Not']],
    };

    static NO_VALUE_OPERATORS = new Set(['is_set', 'not_set']);

    // Operators that need a "from" and "to" value instead of a single one.
    static RANGE_OPERATORS = new Set(['between', 'not_between']);

    // Date operators expressed as a rolling amount of time (e.g. "in the last 7 days")
    // rather than a fixed date.
    static RELATIVE_DATE_OPERATORS = new Set(['last', 'not_in_last', 'before_last', 'in_next']);

    static RELATIVE_DATE_UNITS = [
        ['days', 'Days'],
        ['weeks', 'Weeks'],
        ['months', 'Months'],
        ['years', 'Years'],
    ];

    // Fields that need a sub-pick (which meta key / which taxonomy) before a value can load.
    static EXPANDABLE_FIELDS = new Set(['postmeta', 'taxonomies']);

    // Fields with a small, bounded set of values: fetched once and filtered client-side rather
    // than hitting the API on every keystroke. Everything else searches server-side, since its
    // full value set (post authors, taxonomy terms, custom field values) can be too large to
    // fetch up front.
    static LOCAL_SEARCH_FIELDS = new Set(['post_status']);

    // Fields whose value is actually another post: instead of the plain number input its data
    // type would otherwise get, this searches existing posts of the same post type by title.
    static POST_PICKER_FIELDS = new Set(['post_parent']);

    static BOOL_OPTIONS = [
        ['1', 'True'],
        ['0', 'False'],
    ];
    
    constructor(operator = 'AND', isRoot = false, onEmpty = null) {
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
        
        const addConditionBtn = FilterGroup.createActionButton('+ Condition', () => this.addCondition());
        addConditionBtn.classList.add('ba-search-add-condition');
        
        this.footer = document.createElement('div');
        this.footer.classList.add('ba-search-group-footer');
        this.footer.appendChild(addConditionBtn);
        
        this.el.append(this.header, this.childrenEl, this.footer);
        
        this.addCondition(); // group always starts with one condition
    }
    
    static createActionButton(label, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('button', 'button-secondary');
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }
    
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
    
    static createRemoveButton(target, list, onRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.classList.add('ba-search-block-remove', 'button-link-delete');
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            target.remove();
            const idx = list.findIndex(c => (c.el ?? c) === target);
            if(idx > -1) list.splice(idx, 1);
            onRemove?.();
        });
        return removeBtn;
    }

    static buildOperatorSelect(dataType = 'string') {
        const select = document.createElement('select');
        select.classList.add('ba-search-operator-select');
        FilterGroup.populateOperatorSelect(select, dataType);
        return select;
    }

    // Repopulates an operator select for a given data type, keeping the current selection
    // if it's still a valid choice (e.g. "Between" exists for both Number and Date). A field
    // listed in FIELD_OPERATOR_OVERRIDES gets its fixed operator list regardless of data type.
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
    
    static buildValueSelect() {
        const select = document.createElement('select');
        select.classList.add('ba-search-value-select');
        select.disabled = true;
        return select;
    }

    // Fixed True/False choice — no API fetch needed.
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

    static buildDateInput() {
        const input = document.createElement('input');
        input.type = 'date';
        input.classList.add('ba-search-value-date');
        return input;
    }

    static buildNumberInput() {
        const input = document.createElement('input');
        input.type = 'number';
        input.classList.add('ba-search-value-number');
        return input;
    }

    // "From" and "to" inputs for Between / Not Between, matching the condition's data type.
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

    // Amount + unit inputs for the relative date operators (Last, Not in the Last,
    // Before the Last, In the Next), e.g. "7 Days".
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

    // Data type select shown under the field picker. Only fields listed in
    // baSearchData.editableDataTypeFields (currently just Custom Fields) can be changed
    // by the user; for every other field it just displays the fixed default.
    static buildDataTypeSelect() {
        const select = document.createElement('select');
        select.classList.add('ba-search-datatype-select');
        Object.entries(baSearchData.dataTypes).forEach(([value, label]) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        });
        select.disabled = true;
        select.hidden = true;
        return select;
    }

    // Identifiers to drill into: meta_key names for postmeta, or the taxonomy list for taxonomies.
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

    // Values for an already-chosen identifier: meta values for a meta_key, or terms of a taxonomy.
    // `search` narrows the result set server-side, for fields whose full value set is too large
    // to fetch up front — see LOCAL_SEARCH_FIELDS for the fields that skip this.
    static async fetchValues(field, thing = null, postType = null, search = '') {
        try {
            const params = new URLSearchParams({field});
            if(thing) params.set('thing', thing);
            if(postType) params.set('post_type', postType);
            if(search) params.set('search', search);

            const response = await fetch(`${baSearchData.apiUrl}?${params}`, {
                headers: {'X-WP-Nonce': baSearchData.nonce},
            });
            if(!response.ok) return [];
            return await response.json();
        } catch {
            return [];
        }
    }

    addCondition() {
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
            options: baSearchData.options,
            expandableKeys: FilterGroup.EXPANDABLE_FIELDS,
            placeholder: 'Select field…',
            onLoad: key => FilterGroup.fetchKeys(key, baSearchData.postType)
        });
        const dataTypeSelect = FilterGroup.buildDataTypeSelect();
        const operatorSelect = FilterGroup.buildOperatorSelect(dataTypeSelect.value);

        const valueWrapper = document.createElement('div');
        valueWrapper.classList.add('ba-search-value-wrapper');
        valueWrapper.appendChild(FilterGroup.buildValueSelect());

        const fieldWrapper = document.createElement('div');
        fieldWrapper.classList.add('ba-search-field-wrapper');
        fieldWrapper.append(fieldSelect.el, dataTypeSelect);

        const refreshDataType = () => {
            const field = fieldSelect.value;
            const editable = baSearchData.editableDataTypeFields.includes(field);
            dataTypeSelect.value = baSearchData.fieldDataTypes[field] ?? 'string';
            dataTypeSelect.disabled = !editable;
            dataTypeSelect.hidden = !editable;
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

        // Swaps the value widget to match the condition's data type and operator: an amount/unit
        // pair for relative date operators, a "from"/"to" pair for range operators, a native
        // date/number input for date/number (no API needed), a fixed True/False select for bool,
        // a searchable post picker for POST_PICKER_FIELDS regardless of data type, or — for
        // string — a SearchableDropdown of existing values. Fields in LOCAL_SEARCH_FIELDS are
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

                const items = await FilterGroup.fetchValues(field, metaKey, baSearchData.postType);
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
            valueDropdown?.destroy();
            this.updateConditionToggles();
            if(!this.isRoot && this.children.length === 0) {
                this.onEmpty?.();
            }
        });

        condition.dataTypeSelect = dataTypeSelect;
        condition.append(whereLabel, operatorToggle, fieldWrapper, operatorSelect, valueWrapper, removeBtn);
        
        this.childrenEl.appendChild(condition);
        this.children.push(condition);
        this.updateConditionToggles();
    }
    
    updateConditionToggles() {
        this.children.forEach((condition, index) => {
            const isFirst = index === 0;
            condition.whereLabel.style.display = isFirst ? '' : 'none';
            condition.operatorToggle.style.display = isFirst ? 'none' : '';
        });
    }
}

class BaSearch {
    constructor() {
        this.postFilter = document.querySelector('div.tablenav.top');
        this.buttonClass = 'ba-search-button';
        this.activeClass = 'ba-search-container-active';
        this.groups = [];
        
        this.render();
        this.bindEvents();
    }
    
    createButton(classes, label) {
        const btn = document.createElement('button');
        btn.classList.add(...classes, 'button');
        btn.textContent = label;
        btn.type = 'button';
        return btn;
    }
    
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
    
    addGroup(isRoot = false) {
        const group = new FilterGroup('AND', isRoot, () => {
            group.el.remove();
            this.groups = this.groups.filter(g => g !== group);
        });
        group.el.classList.add('ba-search-block');
        
        if(!isRoot) {
            group.header.appendChild(FilterGroup.createRemoveButton(group.el, this.groups));
        }
        
        this.groupsEl.appendChild(group.el);
        this.groups.push(group);
    }
    
    bindEvents() {
        this.toggleBtn.addEventListener('click', () => this.setActive(true));
        this.cancelBtn.addEventListener('click', () => this.setActive(false));
    }
    
    setActive(active) {
        this.container.classList.toggle(this.activeClass, active);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.baSearch = new BaSearch();
});