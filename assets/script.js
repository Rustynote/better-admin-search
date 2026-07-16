baSearchData = baSearchData || {
    filterBoxToggleLabel: '',
    filterBoxToggleCancelLabel: ''
};

class FilterGroup {
    static OPERATORS = [
        ['is', 'Is'],
        ['is_not', 'Is Not'],
        ['contains', 'Contains'],
        ['contains_not', 'Contains Not'],
        ['is_set', 'Is set'],
        ['not_set', 'Not set'],
    ];
    
    static NO_VALUE_OPERATORS = new Set(['is_set', 'not_set']);
    
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
    
    static humanize(key) {
        return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    
    // Field dropdown — flattens baSearchData.options, nesting objects (e.g. taxonomies) as optgroups
    static buildFieldSelect(options) {
        const select = document.createElement('select');
        select.classList.add('ba-search-field-select');
        
        Object.entries(options).forEach(([key, value]) => {
            if(typeof value === 'object' && value !== null) {
                const group = document.createElement('optgroup');
                group.label = FilterGroup.humanize(key);
                Object.entries(value).forEach(([subKey, subLabel]) => {
                    const opt = document.createElement('option');
                    opt.value = subKey;
                    opt.textContent = subLabel;
                    group.appendChild(opt);
                });
                select.appendChild(group);
            } else {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = value;
                select.appendChild(opt);
            }
        });
        
        return select;
    }
    
    static buildOperatorSelect() {
        const select = document.createElement('select');
        select.classList.add('ba-search-operator-select');
        FilterGroup.OPERATORS.forEach(([value, label]) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        });
        return select;
    }
    
    static buildValueSelect() {
        const select = document.createElement('select');
        select.classList.add('ba-search-value-select');
        select.disabled = true;
        return select;
    }
    
    // TODO: point this at the real REST endpoint / nonce for your setup
    static async fetchValueOptions(field, metaKey = null) {
        try {
            const params = new URLSearchParams({field});
            if(metaKey) params.set('meta_key', metaKey);
            
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
        
        const fieldSelect = FilterGroup.buildFieldSelect(baSearchData.options);
        const operatorSelect = FilterGroup.buildOperatorSelect();
        const valueSelect = FilterGroup.buildValueSelect();
        
        const metaKeyInput = document.createElement('input');
        metaKeyInput.type = 'text';
        metaKeyInput.classList.add('ba-search-meta-key-input');
        metaKeyInput.placeholder = 'Meta key';
        metaKeyInput.style.display = 'none';
        
        const fieldWrapper = document.createElement('div');
        fieldWrapper.classList.add('ba-search-field-wrapper');
        fieldWrapper.append(fieldSelect, metaKeyInput);
        
        const refreshValues = async () => {
            const needsMetaKey = fieldSelect.value === 'postmeta' && !metaKeyInput.value.trim();
            
            if(needsMetaKey || FilterGroup.NO_VALUE_OPERATORS.has(operatorSelect.value)) {
                valueSelect.disabled = true;
                valueSelect.innerHTML = '';
                return;
            }
            
            valueSelect.disabled = true;
            valueSelect.innerHTML = '<option>Loading…</option>';
            const items = await FilterGroup.fetchValueOptions(fieldSelect.value, metaKeyInput.value);
            FilterGroup.populateValueSelect(valueSelect, items);
            valueSelect.disabled = false;
        };
        
        const updateMetaKeyVisibility = () => {
            metaKeyInput.style.display = fieldSelect.value === 'postmeta' ? '' : 'none';
        };
        
        fieldSelect.addEventListener('change', () => {
            updateMetaKeyVisibility();
            refreshValues();
        });
        operatorSelect.addEventListener('change', refreshValues);
        metaKeyInput.addEventListener('input', refreshValues);
        
        
        updateMetaKeyVisibility();
        refreshValues();
        
        const removeBtn = FilterGroup.createRemoveButton(condition, this.children, () => {
            this.updateConditionToggles();
            if(!this.isRoot && this.children.length === 0) {
                this.onEmpty?.();
            }
        });
        
        condition.append(whereLabel, operatorToggle, fieldWrapper, operatorSelect, valueSelect, removeBtn);
        
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