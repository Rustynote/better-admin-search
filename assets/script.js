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
    // if it's still a valid choice (e.g. "Between" exists for both Number and Date).
    static populateOperatorSelect(select, dataType) {
        const previousValue = select.value;
        select.innerHTML = '';
        (FilterGroup.OPERATORS[dataType] ?? FilterGroup.OPERATORS.string).forEach(([value, label]) => {
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
    static async fetchValues(field, thing = null, postType = null) {
        try {
            const params = new URLSearchParams({field});
            if(thing) params.set('thing', thing);
            if(postType) params.set('post_type', postType);

            const response = await fetch(`${baSearchData.apiUrl}?${params}`, {
                headers: {'X-WP-Nonce': baSearchData.nonce},
            });
            if(!response.ok) return [];
            return await response.json();
        } catch {
            return [];
        }
    }
    
    static populateValueSelect(select, items) {
        select.innerHTML = '';
        items.forEach(({value, label}) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        });
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
            FilterGroup.populateOperatorSelect(operatorSelect, dataTypeSelect.value);
        };

        // Tracks the in-flight fetch so a slow response for an earlier field/type
        // selection can't clobber a widget rebuilt by a later one.
        let refreshToken = 0;

        // Swaps the value widget to match the condition's data type and operator: an amount/unit
        // pair for relative date operators, a "from"/"to" pair for range operators, a native
        // date/number input for date/number (no API needed), a fixed True/False select for bool,
        // or the fetched dropdown of existing values for string.
        const refreshValues = async () => {
            const token = ++refreshToken;
            const needsSubKey = FilterGroup.EXPANDABLE_FIELDS.has(fieldSelect.value) && !fieldSelect.metaKey;
            const dataType = dataTypeSelect.value;

            if(!fieldSelect.value || needsSubKey || FilterGroup.NO_VALUE_OPERATORS.has(operatorSelect.value)) {
                valueWrapper.replaceChildren(FilterGroup.buildValueSelect());
                return;
            }

            if(FilterGroup.RELATIVE_DATE_OPERATORS.has(operatorSelect.value)) {
                valueWrapper.replaceChildren(FilterGroup.buildRelativeDateInput());
                return;
            }

            if(FilterGroup.RANGE_OPERATORS.has(operatorSelect.value)) {
                valueWrapper.replaceChildren(FilterGroup.buildRangeInput(dataType));
                return;
            }

            if(dataType === 'bool') {
                valueWrapper.replaceChildren(FilterGroup.buildBoolSelect());
                return;
            }

            if(dataType === 'date') {
                valueWrapper.replaceChildren(FilterGroup.buildDateInput());
                return;
            }

            if(dataType === 'number') {
                valueWrapper.replaceChildren(FilterGroup.buildNumberInput());
                return;
            }

            const valueSelect = FilterGroup.buildValueSelect();
            valueSelect.innerHTML = '<option>Loading…</option>';
            valueWrapper.replaceChildren(valueSelect);

            const items = await FilterGroup.fetchValues(fieldSelect.value, fieldSelect.metaKey, baSearchData.postType);
            if(token !== refreshToken) return; // a newer selection has since replaced this widget

            FilterGroup.populateValueSelect(valueSelect, items);
            valueSelect.disabled = false;
        };

        fieldSelect.el.addEventListener('bas-change', refreshDataType);
        fieldSelect.el.addEventListener('bas-change', refreshOperators);
        fieldSelect.el.addEventListener('bas-change', refreshValues);
        operatorSelect.addEventListener('change', refreshValues);
        dataTypeSelect.addEventListener('change', refreshOperators);
        dataTypeSelect.addEventListener('change', refreshValues);

        const removeBtn = FilterGroup.createRemoveButton(condition, this.children, () => {
            fieldSelect.destroy();
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