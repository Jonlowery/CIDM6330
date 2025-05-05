// filters.js
// Manages the filter UI elements and state for both Holdings and Muni Offerings.

"use strict";

import * as state from './state.js';
import * as api from './api.js'; // For fetching data after filter changes
import * as ui from './ui.js'; // For clearing selections and triggering chart redraw

// --- DOM Element References ---
const filtersContainer = document.getElementById('filters-container');
const muniFiltersContainer = document.getElementById('muni-filters-container');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]');
const muniTableHeaders = document.querySelectorAll('#muni-offerings-table th[data-key]');
const portfolioFilterSelect = document.getElementById('portfolio-filter-select'); // Needed for applyHoldingsFiltersAndFetchPage

// --- Holdings Filters ---

/** Generates HTML <option> elements for the HOLDINGS filter column dropdown. */
export function generateColumnOptions() {
    let html = '';
    tableHeaders.forEach(th => {
        const key = th.dataset.key;
        const type = th.dataset.type || 'string';
        const text = th.textContent.replace(/[▲▼]/g, '').trim();
        if (key) {
            html += `<option value="${key}" data-type="${type}">${text}</option>`;
        }
    });
    state.setColumnOptionsHtml(html); // Store in state
}

/** Adds a new filter row UI element for HOLDINGS. */
export function addFilterRow(initialFilter = null) {
    if (!filtersContainer) return; // Ensure container exists

    const filterId = state.incrementNextFilterId();
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';
    filterRow.dataset.filterId = filterId;

    filterRow.innerHTML = `
        <label for="filter-column-${filterId}">Filter Holdings:</label>
        <select class="filter-column" id="filter-column-${filterId}">${state.columnOptionsHtml}</select>
        <select class="filter-operator" id="filter-operator-${filterId}"></select>
        <input type="text" class="filter-value" id="filter-value-${filterId}" placeholder="Value...">
        <button class="remove-filter-btn btn-danger" title="Remove this filter">X</button>
    `;

    filtersContainer.appendChild(filterRow);

    const columnSelect = filterRow.querySelector('.filter-column');
    const valueInput = filterRow.querySelector('.filter-value');

    // Create and add the initial state object for this filter
    const newFilter = {
        id: filterId,
        column: initialFilter?.column || columnSelect.value,
        operator: initialFilter?.operator, // Will be set by updateOperatorOptionsForRow
        value: initialFilter?.value || '',
        type: initialFilter?.type || columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string',
        lookup: 'exact' // Default lookup, will be updated
    };
    state.addActiveFilter(newFilter); // Add to state

    if (initialFilter) {
        columnSelect.value = initialFilter.column;
        valueInput.value = initialFilter.value;
    }

    updateOperatorOptionsForRow(filterRow, newFilter.operator); // Populate operators and set initial lookup in state

    // Trigger initial fetch AND chart refresh ONLY IF an initial value was set
    if (newFilter.value) {
        applyHoldingsFiltersAndRefreshAll(1);
    }
}

/** Updates the state object for a specific HOLDINGS filter row based on its UI elements. */
export function updateFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.filterId, 10);

    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');
    const selectedOperatorOption = operatorSelect.options[operatorSelect.selectedIndex];

    const updates = {
        column: columnSelect.value,
        operator: operatorSelect.value,
        value: valueInput.value.trim(),
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string',
        lookup: selectedOperatorOption?.dataset.lookup || 'exact' // Get lookup from selected operator
    };

    // console.log("Updating holdings filter state:", filterId, updates); // Debug
    return state.updateActiveFilter(filterId, updates); // Update state
}

// --- Muni Offerings Filters ---

/** Generates HTML <option> elements for the MUNI filter column dropdown. */
export function generateMuniColumnOptions() {
    let html = '';
    muniTableHeaders.forEach(th => {
        const key = th.dataset.key;
        const type = th.dataset.type || 'string';
        const text = th.textContent.replace(/[▲▼]/g, '').trim();
        if (key) {
            html += `<option value="${key}" data-type="${type}">${text}</option>`;
        }
    });
    state.setMuniColumnOptionsHtml(html); // Store in state
}

/** Adds a new filter row UI element for MUNI OFFERINGS. */
export function addMuniFilterRow(initialFilter = null) {
    if (!muniFiltersContainer) return;

    const filterId = state.incrementNextMuniFilterId();
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';
    filterRow.dataset.muniFilterId = filterId;

    filterRow.innerHTML = `
        <label for="muni-filter-column-${filterId}">Filter Offerings:</label>
        <select class="muni-filter-column" id="muni-filter-column-${filterId}">${state.muniColumnOptionsHtml}</select>
        <select class="muni-filter-operator" id="muni-filter-operator-${filterId}"></select>
        <input type="text" class="muni-filter-value" id="muni-filter-value-${filterId}" placeholder="Value...">
        <button class="remove-muni-filter-btn btn-danger" title="Remove this filter">X</button>
    `;

    muniFiltersContainer.appendChild(filterRow);

    const columnSelect = filterRow.querySelector('.muni-filter-column');
    const valueInput = filterRow.querySelector('.muni-filter-value');

    const newFilter = {
        id: filterId,
        column: initialFilter?.column || columnSelect.value,
        operator: initialFilter?.operator,
        value: initialFilter?.value || '',
        type: initialFilter?.type || columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string',
        lookup: 'exact' // Default lookup
    };
    state.addActiveMuniFilter(newFilter); // Add to state

    if (initialFilter) {
        columnSelect.value = initialFilter.column;
        valueInput.value = initialFilter.value;
    }

    updateOperatorOptionsForRow(filterRow, newFilter.operator); // Populate operators and set lookup

    // Trigger initial fetch if value exists
    if (newFilter.value) {
        applyMuniFiltersAndFetchPage(1);
    }
}

/** Updates the state object for a specific MUNI filter row. */
export function updateMuniFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.muniFilterId, 10);

    const columnSelect = filterRow.querySelector('.muni-filter-column');
    const operatorSelect = filterRow.querySelector('.muni-filter-operator');
    const valueInput = filterRow.querySelector('.muni-filter-value');
    const selectedOperatorOption = operatorSelect.options[operatorSelect.selectedIndex];

    const updates = {
        column: columnSelect.value,
        operator: operatorSelect.value,
        value: valueInput.value.trim(),
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string',
        lookup: selectedOperatorOption?.dataset.lookup || 'exact' // Get lookup from selected operator
    };

    // console.log("Updating muni filter state:", filterId, updates); // Debug
    return state.updateActiveMuniFilter(filterId, updates); // Update state
}

// --- Shared Filter Logic ---

/** Updates the operator dropdown options based on the selected column's data type. */
export function updateOperatorOptionsForRow(filterRow, preferredOperator = null) {
    const columnSelect = filterRow.querySelector('.filter-column, .muni-filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator, .muni-filter-operator');
    const valueInput = filterRow.querySelector('.filter-value, .muni-filter-value');

    if (!columnSelect || !operatorSelect || !valueInput) return;
    if (!columnSelect.options || columnSelect.options.length === 0) return;

    const selectedOption = columnSelect.options[columnSelect.selectedIndex];
    const columnType = selectedOption ? selectedOption.dataset.type : 'string';

    // Define operators and their corresponding backend lookup types
    const numberOperators = { '=': 'exact', '!=': 'exact', '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte' };
    const stringOperators = { 'contains': 'icontains', '=': 'iexact', '!=': 'iexact', 'startsWith': 'istartswith', 'endsWith': 'iendswith' };
    const dateOperators = { '=': 'exact', '!=': 'exact', '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte' };

    let availableOperatorsMap;
    let defaultOperatorSymbol;

    switch (columnType) {
        case 'number':
            availableOperatorsMap = numberOperators; valueInput.type = 'number'; valueInput.step = 'any'; defaultOperatorSymbol = '='; break;
        case 'date':
            availableOperatorsMap = dateOperators; valueInput.type = 'date'; valueInput.step = ''; defaultOperatorSymbol = '='; break;
        case 'string': default:
            availableOperatorsMap = stringOperators; valueInput.type = 'text'; valueInput.step = ''; defaultOperatorSymbol = 'contains'; break;
    }

    const availableOperatorSymbols = Object.keys(availableOperatorsMap);
    const currentOperatorSymbol = operatorSelect.value;
    operatorSelect.innerHTML = ''; // Clear existing options

    // Populate new options with lookup types in data attributes
    availableOperatorSymbols.forEach(opSymbol => {
        const option = document.createElement('option');
        option.value = opSymbol;
        option.textContent = opSymbol.replace('>=', '≥').replace('<=', '≤').replace('!=', '≠');
        option.dataset.lookup = availableOperatorsMap[opSymbol]; // Store backend lookup type
        operatorSelect.appendChild(option);
    });

    // Set the selected operator
    if (preferredOperator && availableOperatorSymbols.includes(preferredOperator)) {
        operatorSelect.value = preferredOperator;
    } else if (availableOperatorSymbols.includes(currentOperatorSymbol)) {
        operatorSelect.value = currentOperatorSymbol; // Keep current if valid
    } else {
        operatorSelect.value = defaultOperatorSymbol; // Fallback to default
    }

    // Update the filter state immediately after operators are set/changed
    // This ensures the 'lookup' type is correctly stored in the state object
    if (filterRow.dataset.filterId) {
        updateFilterState(filterRow);
    } else if (filterRow.dataset.muniFilterId) {
        updateMuniFilterState(filterRow);
    }
}

// --- Filter Application Triggers ---

/**
 * Applies server-side filters and sorting by fetching the specified page for Holdings.
 * ONLY updates the table/pagination, does NOT trigger chart refresh.
 * Used for sorting and pagination clicks.
 */
export function applyHoldingsFiltersAndFetchPageOnly(page = 1) { // Renamed for clarity
    const portfolioId = portfolioFilterSelect?.value;
    if (portfolioId) {
        ui.clearHoldingSelection(); // Clear selection when filters/sort change
        api.fetchHoldingsPage(portfolioId, page); // Use api.js function that ONLY fetches page
    } else {
        console.warn("Cannot apply holdings filters: No portfolio selected.");
        ui.clearHoldingsUI(); // Use specific clear function
    }
}

/**
 * Applies server-side filters and sorting for Holdings, fetching page 1
 * AND triggers a refresh of the charts based on the new full filtered dataset.
 * Used when filter values change or portfolio selection changes.
 */
export async function applyHoldingsFiltersAndRefreshAll(page = 1) {
    const portfolioId = portfolioFilterSelect?.value;
    if (portfolioId) {
        ui.clearHoldingSelection(); // Clear selection when filters change
        // Fetch page 1 first to update the table quickly
        await api.fetchHoldingsPage(portfolioId, page);
        // Then, trigger the chart update (which fetches all data again)
        // Note: ui.renderChartsWithAllData is async but we don't need to await it here
        ui.renderChartsWithAllData();
    } else {
        console.warn("Cannot apply holdings filters: No portfolio selected.");
        ui.clearHoldingsUI(); // Use specific clear function
    }
}


/** Applies server-side filters and sorting by fetching the specified page for Munis. */
export function applyMuniFiltersAndFetchPage(page = 1) {
    ui.clearMuniOfferingSelection(); // Clear selection when filters/sort change
    api.loadMuniOfferings(page); // Use api.js function (Muni view doesn't have charts needing separate refresh)
}
