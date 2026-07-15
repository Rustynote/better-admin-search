baSearchData = baSearchData || {
    filterBoxToggleLabel: '',
    filterBoxToggleCancelLabel: ''
};
document.addEventListener('DOMContentLoaded', () => {
    class BaSearch {
        constructor() {
            this.postFilter = document.querySelector('div.tablenav.top');
            this.buttonClass = 'ba-search-button';
            this.activeClass = 'ba-search-container-active';

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

            this.container.append(this.toggleBtn, this.cancelBtn);
            this.postFilter.prepend(this.container);
        }

        bindEvents() {
            this.toggleBtn.addEventListener('click', () => this.setActive(true));
            this.cancelBtn.addEventListener('click', () => this.setActive(false));
        }

        setActive(active) {
            this.container.classList.toggle(this.activeClass, active);
        }
    }

    window.baSearch = new BaSearch();
});