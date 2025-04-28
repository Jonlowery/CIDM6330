// --- JAVASCRIPT for Portfolio Analyzer ---

// Ensure external libraries (jsPDF, Chart.js, etc.) are loaded before this script runs.

// Use strict mode for better error handling and preventing common mistakes
"use strict";

// Check if IS_ADMIN_USER is defined (should be set in the HTML before this script)
if (typeof IS_ADMIN_USER === 'undefined') {
    console.error("CRITICAL: IS_ADMIN_USER is not defined. Ensure it's set in the HTML before loading script.js.");
    // const IS_ADMIN_USER = false; // Example fallback (use with caution)
} else {
    console.log("User admin status (from script.js):", IS_ADMIN_USER); // Confirm it's accessible
}


// --- Constants & Global Variables ---
const { jsPDF } = window.jspdf; // Destructure jsPDF from the global window object
const apiRoot = '/api'; // Base URL for API calls
let customers = []; // Holds the list of customers fetched for the main dropdown (populated by loadCustomers)
let currentPortfolios = []; // Holds the list of portfolios fetched for the selected customer
// Holdings Data & State
let allHoldings = []; // Holds all holdings for the currently selected view (customer or portfolio)
let filteredHoldings = []; // Holdings after applying filters (THIS IS THE ARRAY USED FOR THE SNAPSHOT)
let activeFilters = []; // Array to store active filter objects for HOLDINGS
let nextFilterId = 0; // Counter for generating unique filter IDs for HOLDINGS
let columnOptionsHtml = ''; // HTML string for filter column dropdown options for HOLDINGS
let currentSortKey = 'security_cusip'; // Default sort column key for HOLDINGS
let currentSortDir = 'asc'; // Default sort direction for HOLDINGS
// Muni Offerings Data & State - NEW
let allMuniOfferings = []; // Holds all municipal offerings
let filteredMuniOfferings = []; // Offerings after applying muni filters
let activeMuniFilters = []; // Array to store active filter objects for MUNIS
let nextMuniFilterId = 0; // Counter for generating unique filter IDs for MUNIS
let muniColumnOptionsHtml = ''; // HTML string for filter column dropdown options for MUNIS
let currentMuniSortKey = 'cusip'; // Default sort column key for munis
let currentMuniSortDir = 'asc'; // Default sort direction for munis
// General State
let chartInstances = {}; // Stores active Chart.js instances for later destruction/update
let availableCustomers = []; // Stores the full customer list fetched for the admin modal dropdown
let selectedCustomerId = null; // Store the currently selected customer ID
let selectedHoldingIds = new Set(); // Set to store IDs of selected holdings for email action
let selectedMuniOfferingIds = new Set(); // Set to store IDs of selected muni offerings

// --- DOM Element References ---
// Using const for elements that are expected to always exist
const customerSelect = document.getElementById('customer-select');
const portfolioFilterContainer = document.getElementById('portfolio-filter-container');
const portfolioFilterSelect = document.getElementById('portfolio-filter-select');
const deletePortfolioBtn = document.getElementById('delete-portfolio-btn');
const portfolioNameEl = document.getElementById('portfolio-name');
// Holdings Table
const tableBody = document.querySelector('#holdings-table tbody');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]');
const tableElement = document.getElementById('holdings-table');
const selectAllCheckbox = document.getElementById('select-all-holdings');
// Holdings Filters
const filtersContainer = document.getElementById('filters-container');
const addFilterBtn = document.getElementById('add-filter-btn');
const clearAllFiltersBtn = document.getElementById('clear-all-filters-btn');
// General Controls
const darkModeToggle = document.getElementById('dark-mode-toggle');
const exportPdfBtn = document.getElementById('export-pdf-btn');
// Modal Elements
const createPortfolioBtn = document.getElementById('create-portfolio-btn');
const createPortfolioModal = document.getElementById('create-portfolio-modal');
const createPortfolioForm = document.getElementById('create-portfolio-form');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const newPortfolioNameInput = document.getElementById('new-portfolio-name');
const adminCustomerSelectGroup = document.getElementById('admin-customer-select-group');
const adminCustomerSelect = document.getElementById('admin-customer-select');
const modalErrorMessage = document.getElementById('modal-error-message');
// Email Action Elements (Sell)
const emailInterestBtn = document.getElementById('email-interest-btn');
const emailStatusMessage = document.getElementById('email-status-message');
// Muni Offerings Elements
const muniOfferingsTableBody = document.querySelector('#muni-offerings-table tbody');
const muniTableHeaders = document.querySelectorAll('#muni-offerings-table th[data-key]');
const selectAllMunisCheckbox = document.getElementById('select-all-munis');
// Muni Filters - NEW
const muniFiltersContainer = document.getElementById('muni-filters-container');
const addMuniFilterBtn = document.getElementById('add-muni-filter-btn');
const clearAllMuniFiltersBtn = document.getElementById('clear-all-muni-filters-btn');
// Email Action Elements (Buy)
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const emailBuyStatusMessage = document.getElementById('email-buy-status-message');


// --- Utility Functions ---

/** Retrieves a cookie value by name. */
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}
const csrfToken = getCookie('csrftoken');
console.log("CSRF Token:", csrfToken);

/** Parses a date string (YYYY-MM-DD) into a Date object. */
function parseDate(dateString) {
    if (!dateString) return null;
    try {
        const date = new Date(dateString + 'T00:00:00');
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        console.error("Error parsing date:", dateString, e);
        return null;
    }
}

/** Safely parses a string value into a float. */
function parseFloatSafe(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
}

/** Generates an array of distinct HSL colors. */
function generateDistinctColors(count) {
    const colors = [];
    if (count <= 0) return colors;
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        colors.push(`hsl(${i * hueStep}, 70%, 60%)`);
    }
    return colors;
}

/** Displays a status message (success or error) in a specified status area. */
function showStatusMessageGeneric(statusElement, message, isError = false, duration = 5000) {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.className = 'status-message';
    if (isError) {
        statusElement.classList.add('error');
    } else {
        statusElement.classList.add('success');
    }
    statusElement.style.display = 'block';
    if (duration > 0) {
        setTimeout(() => {
            if (statusElement.textContent === message) {
                statusElement.textContent = '';
                statusElement.style.display = 'none';
            }
        }, duration);
    }
}

// --- Filter Functions ---

// --- Holdings Filters ---

/** Generates HTML <option> elements for the HOLDINGS filter column dropdown. */
function generateColumnOptions() {
    columnOptionsHtml = '';
    tableHeaders.forEach(th => {
        const key = th.dataset.key;
        const type = th.dataset.type || 'string';
        const text = th.textContent.replace('▲', '').replace('▼', '').trim();
        if (key) {
            columnOptionsHtml += `<option value="${key}" data-type="${type}">${text}</option>`;
        }
    });
}

/** Adds a new filter row UI element for HOLDINGS. */
function addFilterRow(initialFilter = null) {
    const filterId = nextFilterId++;
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';
    filterRow.dataset.filterId = filterId;

    filterRow.innerHTML = `
        <label for="filter-column-${filterId}">Filter Holdings:</label>
        <select class="filter-column" id="filter-column-${filterId}">${columnOptionsHtml}</select>
        <select class="filter-operator" id="filter-operator-${filterId}"></select>
        <input type="text" class="filter-value" id="filter-value-${filterId}" placeholder="Value...">
        <button class="remove-filter-btn btn-danger" title="Remove this filter">X</button>
    `;

    filtersContainer.appendChild(filterRow);

    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');
    const removeBtn = filterRow.querySelector('.remove-filter-btn');

    // Attach generic handlers
    columnSelect.addEventListener('change', handleFilterDropdownChange);
    operatorSelect.addEventListener('change', handleFilterDropdownChange);
    valueInput.addEventListener('input', handleFilterValueChange);
    removeBtn.addEventListener('click', handleRemoveFilter);

    const newFilter = {
        id: filterId,
        column: initialFilter?.column || columnSelect.value,
        operator: initialFilter?.operator,
        value: initialFilter?.value || '',
        type: initialFilter?.type || columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    activeFilters.push(newFilter);

    if (initialFilter) {
        columnSelect.value = initialFilter.column;
        valueInput.value = initialFilter.value;
    }

    updateOperatorOptionsForRow(filterRow, newFilter.operator);

    if (newFilter.value) {
        triggerFullUpdate();
    }
}

/** Updates the operator dropdown options based on the selected column's data type. */
function updateOperatorOptionsForRow(filterRow, preferredOperator = null) {
    const columnSelect = filterRow.querySelector('.filter-column, .muni-filter-column'); // Check both selectors
    const operatorSelect = filterRow.querySelector('.filter-operator, .muni-filter-operator');
    const valueInput = filterRow.querySelector('.filter-value, .muni-filter-value');

    // FIX: Check if columnSelect or its options exist before proceeding
    if (!columnSelect || !columnSelect.options || columnSelect.options.length === 0) {
        console.warn("updateOperatorOptionsForRow called before column options were ready for:", filterRow);
        return; // Exit if options aren't ready
    }

    const selectedOption = columnSelect.options[columnSelect.selectedIndex];
    const columnType = selectedOption ? selectedOption.dataset.type : 'string';

    const numberOperators = ['=', '!=', '>', '<', '>=', '<='];
    const stringOperators = ['contains', '=', '!=', 'startsWith', 'endsWith'];
    const dateOperators = ['=', '!=', '>', '<', '>=', '<='];

    let availableOperators;
    let defaultOperator;

    switch (columnType) {
        case 'number': availableOperators = numberOperators; valueInput.type = 'number'; valueInput.step = 'any'; defaultOperator = '='; break;
        case 'date': availableOperators = dateOperators; valueInput.type = 'date'; valueInput.step = ''; defaultOperator = '='; break;
        case 'string': default: availableOperators = stringOperators; valueInput.type = 'text'; valueInput.step = ''; defaultOperator = 'contains'; break;
    }

    const currentOperatorValue = operatorSelect.value;
    operatorSelect.innerHTML = '';
    availableOperators.forEach(op => { const option = document.createElement('option'); option.value = op; option.textContent = op.replace('>=', '≥').replace('<=', '≤').replace('!=', '≠'); operatorSelect.appendChild(option); });

    if (preferredOperator && availableOperators.includes(preferredOperator)) { operatorSelect.value = preferredOperator; }
    else if (availableOperators.includes(currentOperatorValue)) { operatorSelect.value = currentOperatorValue; }
    else { operatorSelect.value = defaultOperator; }
}

/** Updates the state object for a specific HOLDINGS filter row. */
function updateFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.filterId, 10);
    const filterIndex = activeFilters.findIndex(f => f.id === filterId);
    if (filterIndex === -1) return false;
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');
    activeFilters[filterIndex] = { id: filterId, column: columnSelect.value, operator: operatorSelect.value, value: valueInput.value.trim(), type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string' };
    return true;
}

/** Event handler for changes in filter column or operator dropdowns (HOLDINGS). */
function handleFilterDropdownChange(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow || !filtersContainer.contains(filterRow)) return; // Ensure it's a holdings filter
    if (event.target.classList.contains('filter-column')) {
        updateOperatorOptionsForRow(filterRow);
    }
    if (updateFilterState(filterRow)) {
        triggerTableUpdate();
    }
}

/** Event handler for changes in the filter value input field (HOLDINGS). */
function handleFilterValueChange(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow || !filtersContainer.contains(filterRow)) return; // Ensure it's a holdings filter
    if (updateFilterState(filterRow)) {
        triggerFullUpdate();
    }
}

/** Event handler for removing a filter row (HOLDINGS). */
function handleRemoveFilter(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow || !filtersContainer.contains(filterRow)) return; // Ensure it's a holdings filter
    const currentFilterRows = filtersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) return;
    const filterIdToRemove = parseInt(filterRow.dataset.filterId, 10);
    activeFilters = activeFilters.filter(f => f.id !== filterIdToRemove);
    filterRow.remove();
    triggerFullUpdate();
}

/** Clears all active filters and resets the filter UI (HOLDINGS). */
function handleClearAllFilters() {
    activeFilters = [];
    filtersContainer.innerHTML = '';
    addFilterRow();
    if (!portfolioFilterContainer.classList.contains('hidden') && portfolioFilterSelect.options.length > 0) {
        portfolioFilterSelect.value = portfolioFilterSelect.options[0].value;
        handlePortfolioSelection();
    } else if (selectedCustomerId) {
        handleCustomerSelection();
    }
}

// --- Muni Offerings Filters ---

/** Generates HTML <option> elements for the MUNI filter column dropdown. */
function generateMuniColumnOptions() {
    muniColumnOptionsHtml = '';
    muniTableHeaders.forEach(th => {
        const key = th.dataset.key;
        const type = th.dataset.type || 'string';
        const text = th.textContent.replace('▲', '').replace('▼', '').trim();
        if (key) {
            muniColumnOptionsHtml += `<option value="${key}" data-type="${type}">${text}</option>`;
        }
    });
}

/** Adds a new filter row UI element for MUNI OFFERINGS. */
function addMuniFilterRow(initialFilter = null) {
    if (!muniFiltersContainer) return;

    const filterId = nextMuniFilterId++;
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';
    filterRow.dataset.muniFilterId = filterId;

    filterRow.innerHTML = `
        <label for="muni-filter-column-${filterId}">Filter Offerings:</label>
        <select class="muni-filter-column" id="muni-filter-column-${filterId}">${muniColumnOptionsHtml}</select>
        <select class="muni-filter-operator" id="muni-filter-operator-${filterId}"></select>
        <input type="text" class="muni-filter-value" id="muni-filter-value-${filterId}" placeholder="Value...">
        <button class="remove-muni-filter-btn btn-danger" title="Remove this filter">X</button>
    `;

    muniFiltersContainer.appendChild(filterRow);

    const columnSelect = filterRow.querySelector('.muni-filter-column');
    const operatorSelect = filterRow.querySelector('.muni-filter-operator');
    const valueInput = filterRow.querySelector('.muni-filter-value');
    const removeBtn = filterRow.querySelector('.remove-muni-filter-btn');

    // Attach muni-specific handlers
    columnSelect.addEventListener('change', handleMuniFilterDropdownChange);
    operatorSelect.addEventListener('change', handleMuniFilterDropdownChange);
    valueInput.addEventListener('input', handleMuniFilterValueChange);
    removeBtn.addEventListener('click', handleRemoveMuniFilter);

    const newFilter = {
        id: filterId,
        column: initialFilter?.column || columnSelect.value,
        operator: initialFilter?.operator,
        value: initialFilter?.value || '',
        type: initialFilter?.type || columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    activeMuniFilters.push(newFilter);

    if (initialFilter) {
        columnSelect.value = initialFilter.column;
        valueInput.value = initialFilter.value;
    }

    updateOperatorOptionsForRow(filterRow, newFilter.operator); // Reuse generic updater

    if (newFilter.value) {
        applyMuniFiltersAndSort();
    }
}

/** Updates the state object for a specific MUNI filter row. */
function updateMuniFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.muniFilterId, 10);
    const filterIndex = activeMuniFilters.findIndex(f => f.id === filterId);
    if (filterIndex === -1) return false;
    const columnSelect = filterRow.querySelector('.muni-filter-column');
    const operatorSelect = filterRow.querySelector('.muni-filter-operator');
    const valueInput = filterRow.querySelector('.muni-filter-value');
    activeMuniFilters[filterIndex] = {
        id: filterId,
        column: columnSelect.value,
        operator: operatorSelect.value,
        value: valueInput.value.trim(),
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    console.log("Updated muni filter state:", activeMuniFilters[filterIndex]);
    return true;
}

/** Event handler for changes in filter column or operator dropdowns (MUNI). */
function handleMuniFilterDropdownChange(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow || !muniFiltersContainer.contains(filterRow)) return; // Ensure it's a muni filter
    if (event.target.classList.contains('muni-filter-column')) {
        updateOperatorOptionsForRow(filterRow);
    }
    if (updateMuniFilterState(filterRow)) {
        applyMuniFiltersAndSort();
    }
}

/** Event handler for changes in the filter value input field (MUNI). */
function handleMuniFilterValueChange(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow || !muniFiltersContainer.contains(filterRow)) return; // Ensure it's a muni filter
    if (updateMuniFilterState(filterRow)) {
        applyMuniFiltersAndSort();
    }
}

/** Event handler for removing a filter row (MUNI). */
function handleRemoveMuniFilter(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow || !muniFiltersContainer.contains(filterRow)) return; // Ensure it's a muni filter
    const currentFilterRows = muniFiltersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) return;
    const filterIdToRemove = parseInt(filterRow.dataset.muniFilterId, 10);
    activeMuniFilters = activeMuniFilters.filter(f => f.id !== filterIdToRemove);
    filterRow.remove();
    applyMuniFiltersAndSort();
}

/** Clears all active filters and resets the filter UI (MUNI). */
function handleClearAllMuniFilters() {
    activeMuniFilters = [];
    if (muniFiltersContainer) {
        muniFiltersContainer.innerHTML = '';
        addMuniFilterRow();
        applyMuniFiltersAndSort();
    }
}


// --- Data Fetching and Processing ---

/** Fetches the list of customers. */
async function loadCustomers() { /* ... no changes ... */
    console.log("Attempting to load customers..."); try { const res = await fetch(`${apiRoot}/customers/`); console.log("Load customers response status:", res.status); if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`); customers = await res.json(); console.log("Customers loaded:", customers); customerSelect.innerHTML = customers.map(c => `<option value="${c.id}">${c.name || `Customer ${c.customer_number}`}</option>`).join(''); if (customers.length > 0) { await handleCustomerSelection(); } else { portfolioNameEl.textContent = "No customers available for this user."; clearTableAndCharts(); portfolioFilterContainer.classList.add('hidden'); const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">No customers found.</td></tr>`; } } catch (error) { console.error("Failed to load customers:", error); portfolioNameEl.textContent = "Error loading customers"; clearTableAndCharts(); portfolioFilterContainer.classList.add('hidden'); const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading customer list. Check console.</td></tr>`; }
}

/** Handles the selection of a customer. */
async function handleCustomerSelection() { /* ... no changes ... */
    selectedCustomerId = customerSelect.value; console.log(`Customer selected: ID ${selectedCustomerId}`); clearHoldingSelection(); clearMuniOfferingSelection(); if (!selectedCustomerId) { portfolioNameEl.textContent = "Please select a customer."; clearTableAndCharts(); portfolioFilterContainer.classList.add('hidden'); deletePortfolioBtn.disabled = true; return; } const selectedCustomer = customers.find(c => c.id == selectedCustomerId); if (!selectedCustomer) { console.error(`Selected customer with ID ${selectedCustomerId} not found.`); portfolioNameEl.textContent = "Error: Selected customer not found."; clearTableAndCharts(); portfolioFilterContainer.classList.add('hidden'); deletePortfolioBtn.disabled = true; return; } portfolioNameEl.textContent = `Loading portfolios for ${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`}...`; clearTableAndCharts(); portfolioFilterContainer.classList.add('hidden'); deletePortfolioBtn.disabled = true; await loadPortfolios(selectedCustomerId);
}

/** Fetches portfolios for the selected customer. */
async function loadPortfolios(customerId) { /* ... no changes ... */
    console.log(`Attempting to load portfolios for customer ID: ${customerId}`); try { const res = await fetch(`${apiRoot}/portfolios/`); console.log("Load portfolios response status:", res.status); if (!res.ok) throw new Error(`HTTP error fetching portfolios! status: ${res.status}`); currentPortfolios = await res.json(); console.log("All accessible portfolios loaded:", currentPortfolios.length); const customerPortfolios = currentPortfolios.filter(p => p.owner?.id == customerId); console.log(`Portfolios found for customer ${customerId}:`, customerPortfolios.length); portfolioFilterSelect.innerHTML = ''; if (customerPortfolios.length > 0) { customerPortfolios.forEach(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name || `Portfolio ${p.id}`; option.dataset.isDefault = p.is_default || false; portfolioFilterSelect.appendChild(option); }); portfolioFilterContainer.classList.remove('hidden'); handlePortfolioSelection(); } else { const selectedCustomer = customers.find(c => c.id == customerId); portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - No Portfolios Found`; portfolioFilterContainer.classList.add('hidden'); deletePortfolioBtn.disabled = true; clearTableAndCharts(); const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">No portfolios found for this customer.</td></tr>`; } } catch (error) { console.error("Failed to load or process portfolios:", error); portfolioNameEl.textContent = "Error loading portfolios"; portfolioFilterContainer.classList.add('hidden'); deletePortfolioBtn.disabled = true; clearTableAndCharts(); const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading portfolio list. Check console.</td></tr>`; }
}

/** Handles the selection of a portfolio. */
async function handlePortfolioSelection() { /* ... no changes ... */
    const selectedPortfolioId = portfolioFilterSelect.value; const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex]; const isDefaultPortfolio = selectedOption?.dataset?.isDefault === 'true'; console.log(`Portfolio selected: ID '${selectedPortfolioId}' (Default: ${isDefaultPortfolio}), Customer ID: ${selectedCustomerId}`); clearHoldingSelection(); deletePortfolioBtn.disabled = (!selectedPortfolioId || isDefaultPortfolio); const selectedCustomer = customers.find(c => c.id == selectedCustomerId); if (!selectedCustomer) { console.error("Customer not found during portfolio selection."); return; } if (!selectedPortfolioId) { console.log("No specific portfolio selected."); portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - Select a Portfolio`; clearTableAndCharts(); const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">Please select a portfolio.</td></tr>`; return; } const fetchUrl = `${apiRoot}/holdings/?portfolio=${selectedPortfolioId}`; const selectedPortfolio = currentPortfolios.find(p => p.id == selectedPortfolioId); const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${selectedPortfolioId}`; const viewName = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - ${portfolioDisplayName}`; console.log("Fetching holdings for specific portfolio:", fetchUrl); portfolioNameEl.textContent = `Loading ${viewName}...`; clearTableAndCharts(); try { const res = await fetch(fetchUrl); console.log(`Load holdings response status for view '${viewName}':`, res.status); if (!res.ok) { if (res.status === 404) { allHoldings = []; portfolioNameEl.textContent = `${viewName} (No Holdings)`; const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">No holdings found for this portfolio.</td></tr>`; } else { let errorText = `HTTP error! status: ${res.status}`; try { errorText += ` - ${JSON.stringify(await res.json())}`; } catch (e) {} throw new Error(errorText); } } else { allHoldings = await res.json(); console.log(`Holdings loaded for view '${viewName}':`, allHoldings.length); portfolioNameEl.textContent = viewName; } processAndDisplayHoldings(); } catch (error) { console.error("Failed to update holdings view:", error); portfolioNameEl.textContent = `Error loading holdings for ${viewName}`; allHoldings = []; clearTableAndCharts(); const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading holdings. Check console.</td></tr>`; }
}

/** Processes the raw holding data fetched from the API. */
function processAndDisplayHoldings() { /* ... no changes ... */
    console.log("Processing and displaying holdings:", allHoldings.length); const today = new Date(); allHoldings.forEach(h => { const wal = parseFloatSafe(h.wal); h.estimated_maturity_date = !isNaN(wal) ? today.getFullYear() + Math.floor(wal) : null; h.original_face_amount = parseFloatSafe(h.original_face_amount) ?? 0; h.settlement_price = parseFloatSafe(h.settlement_price) ?? 0; h.coupon = parseFloatSafe(h.coupon) ?? 0; h.book_yield = parseFloatSafe(h.book_yield) ?? 0; h.security_factor = parseFloatSafe(h.factor || h.security?.factor) ?? 1.0; h.par_calculated = (h.original_face_amount * h.security_factor); h.yield_val = h.book_yield || parseFloatSafe(h.yield) || 0; h.wal = wal ?? 0; h.maturity_date_obj = parseDate(h.maturity_date); h.call_date_obj = parseDate(h.call_date); }); triggerFullUpdate();
}

// --- Muni Offerings Fetching and Rendering ---

/** Fetches municipal offerings data from the API. */
async function loadMuniOfferings() {
    console.log("Attempting to load municipal offerings...");
    if (!muniOfferingsTableBody) {
        console.warn("Muni offerings table body not found. Skipping load.");
        return;
    }

    muniOfferingsTableBody.innerHTML = `<tr><td colspan="14">Loading offerings...</td></tr>`;

    // FIX: Add try...catch block
    try {
        const response = await fetch(`${apiRoot}/muni-offerings/`);
        console.log("Load muni offerings response status:", response.status);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const rawOfferings = await response.json();
        console.log("Raw muni offerings loaded:", rawOfferings.length);

        allMuniOfferings = rawOfferings.map(offering => ({
            ...offering,
            amount_num: parseFloatSafe(offering.amount),
            coupon_num: parseFloatSafe(offering.coupon),
            yield_rate_num: parseFloatSafe(offering.yield_rate),
            price_num: parseFloatSafe(offering.price),
            call_price_num: parseFloatSafe(offering.call_price),
            maturity_date_obj: parseDate(offering.maturity_date),
            call_date_obj: parseDate(offering.call_date),
            maturity_date_str: offering.maturity_date,
            call_date_str: offering.call_date,
        }));

        console.log("Processed muni offerings:", allMuniOfferings.length);
        applyMuniFiltersAndSort(); // Apply initial filters/sort
        updateMuniSortIndicators(); // Show initial sort indicator

    } catch (error) { // Add missing catch block
        console.error("Failed to load municipal offerings:", error);
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="14">Error loading offerings. Check console.</td></tr>`;
    }
}

/** Renders the municipal offerings data into the HTML table. */
function renderMuniOfferingsTable(offeringsData) { /* ... no changes ... */
    if (!muniOfferingsTableBody) return; muniOfferingsTableBody.innerHTML = ''; if (!offeringsData || offeringsData.length === 0) { muniOfferingsTableBody.innerHTML = `<tr><td colspan="14">No municipal offerings available.</td></tr>`; if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; } if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; } return; } offeringsData.forEach(o => { const row = document.createElement('tr'); row.dataset.offeringId = o.id; const isChecked = selectedMuniOfferingIds.has(o.id); const checkboxCell = document.createElement('td'); checkboxCell.className = 'checkbox-column'; checkboxCell.innerHTML = `<input type="checkbox" class="muni-checkbox" data-offering-id="${o.id}" data-cusip="${o.cusip || ''}" data-amount="${(o.amount_num ?? 0).toFixed(2)}" ${isChecked ? 'checked' : ''} aria-label="Select offering ${o.cusip || 'N/A'}">`; row.appendChild(checkboxCell); const addCell = (content, align = 'left') => { const cell = document.createElement('td'); cell.textContent = (content !== null && content !== undefined) ? content : 'N/A'; cell.style.textAlign = align; row.appendChild(cell); }; addCell(o.cusip, 'left'); addCell(o.amount_num?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? 'N/A', 'right'); addCell(o.description, 'left'); addCell(o.coupon_num?.toFixed(3) ?? 'N/A', 'right'); addCell(o.maturity_date_obj?.toLocaleDateString() ?? o.maturity_date_str, 'center'); addCell(o.yield_rate_num?.toFixed(3) ?? 'N/A', 'right'); addCell(o.price_num?.toFixed(2) ?? 'N/A', 'right'); addCell(o.moody_rating || 'N/A', 'left'); addCell(o.sp_rating || 'N/A', 'left'); addCell(o.call_date_obj?.toLocaleDateString() ?? o.call_date_str, 'center'); addCell(o.call_price_num?.toFixed(2) ?? 'N/A', 'right'); addCell(o.state || 'N/A', 'left'); addCell(o.insurance || 'N/A', 'left'); muniOfferingsTableBody.appendChild(row); }); updateSelectAllMunisCheckboxState(); emailBuyInterestBtn.disabled = selectedMuniOfferingIds.size === 0;
}


// --- Filtering and Sorting Logic ---

/** Checks if a single HOLDING matches a given filter criteria. */
function checkFilter(holding, filter) { /* ... no changes ... */
    if (!filter || filter.value === null || filter.value === '') return true; const holdingValue = getHoldingSortValue(holding, filter.column); let filterValue = filter.value; if (holdingValue === null || holdingValue === undefined) return false; try { let compareHolding = holdingValue; let compareFilter = filterValue; if (filter.type === 'string') { compareHolding = String(holdingValue).toLowerCase(); compareFilter = String(filterValue).toLowerCase(); switch (filter.operator) { case 'contains': return compareHolding.includes(compareFilter); case 'startsWith': return compareHolding.startsWith(compareFilter); case 'endsWith': return compareHolding.endsWith(compareFilter); case '=': return compareHolding === compareFilter; case '!=': return compareHolding !== compareFilter; default: return false; } } else if (filter.type === 'number') { compareHolding = parseFloatSafe(holdingValue); compareFilter = parseFloatSafe(filterValue); if (compareHolding === null || compareFilter === null) return false; switch (filter.operator) { case '=': return compareHolding === compareFilter; case '!=': return compareHolding !== compareFilter; case '>': return compareHolding > compareFilter; case '<': return compareHolding < compareFilter; case '>=': return compareHolding >= compareFilter; case '<=': return compareHolding <= compareFilter; default: return false; } } else if (filter.type === 'date') { compareHolding = holdingValue instanceof Date ? holdingValue.getTime() : null; compareFilter = parseDate(filterValue)?.getTime(); if (compareHolding === null || compareFilter === null) return false; switch (filter.operator) { case '=': return compareHolding === compareFilter; case '!=': return compareHolding !== compareFilter; case '>': return compareHolding > compareFilter; case '<': return compareHolding < compareFilter; case '>=': return compareHolding >= compareFilter; case '<=': return compareHolding <= compareFilter; default: return false; } } } catch (e) { console.error("Error during filter comparison:", e, { holdingValue, filter }); return false; } return false;
}

/** Checks if a single MUNI OFFERING matches a given filter criteria. */
function checkMuniFilter(offering, filter) { /* ... no changes ... */
    if (!filter || filter.value === null || filter.value === '') return true; const offeringValue = getMuniOfferingSortValue(offering, filter.column); let filterValue = filter.value; if (offeringValue === null || offeringValue === undefined) return false; try { let compareOffering = offeringValue; let compareFilter = filterValue; if (filter.type === 'string') { compareOffering = String(offeringValue).toLowerCase(); compareFilter = String(filterValue).toLowerCase(); switch (filter.operator) { case 'contains': return compareOffering.includes(compareFilter); case 'startsWith': return compareOffering.startsWith(compareFilter); case 'endsWith': return compareOffering.endsWith(compareFilter); case '=': return compareOffering === compareFilter; case '!=': return compareOffering !== compareFilter; default: return false; } } else if (filter.type === 'number') { compareOffering = parseFloatSafe(offeringValue); compareFilter = parseFloatSafe(filterValue); if (compareOffering === null || compareFilter === null) return false; switch (filter.operator) { case '=': return compareOffering === compareFilter; case '!=': return compareOffering !== compareFilter; case '>': return compareOffering > compareFilter; case '<': return compareOffering < compareFilter; case '>=': return compareOffering >= compareFilter; case '<=': return compareOffering <= compareFilter; default: return false; } } else if (filter.type === 'date') { compareOffering = offeringValue instanceof Date ? offeringValue.getTime() : null; compareFilter = parseDate(filterValue)?.getTime(); if (compareOffering === null || compareFilter === null) return false; switch (filter.operator) { case '=': return compareOffering === compareFilter; case '!=': return compareOffering !== compareFilter; case '>': return compareOffering > compareFilter; case '<': return compareOffering < compareFilter; case '>=': return compareOffering >= compareFilter; case '<=': return compareOffering <= compareFilter; default: return false; } } } catch (e) { console.error("Error during muni filter comparison:", e, { offeringValue, filter }); return false; } return false;
}


/** Sorts an array of data based on a key and direction. */
function sortDataGeneric(data, key, direction, getSortValueFunc) { /* ... no changes ... */
    data.sort((a, b) => { let valA = getSortValueFunc(a, key); let valB = getSortValueFunc(b, key); const nullOrder = direction === 'asc' ? 1 : -1; if (valA === null || valA === undefined) return (valB === null || valB === undefined) ? 0 : nullOrder; if (valB === null || valB === undefined) return -nullOrder; let comparison = 0; if (valA instanceof Date && valB instanceof Date) { comparison = valA.getTime() - valB.getTime(); } else if (typeof valA === 'number' && typeof valB === 'number') { comparison = valA - valB; } else { valA = String(valA).toUpperCase(); valB = String(valB).toUpperCase(); if (valA < valB) comparison = -1; else if (valA > valB) comparison = 1; } return direction === 'desc' ? (comparison * -1) : comparison; });
}

/** Retrieves the appropriate value from a HOLDING object for sorting/filtering. */
function getHoldingSortValue(holding, key) { /* ... no changes ... */
    switch (key) { case 'yield': return holding.yield_val; case 'maturity_date': return holding.maturity_date_obj; case 'call_date': return holding.call_date_obj; case 'par': return holding.par_calculated; case 'security_cusip': return holding.security_cusip; default: return holding[key]; }
}

/** Retrieves the appropriate value from a MUNI OFFERING object for sorting/filtering. */
function getMuniOfferingSortValue(offering, key) { /* ... no changes ... */
    switch (key) { case 'amount': return offering.amount_num; case 'coupon': return offering.coupon_num; case 'yield_rate': return offering.yield_rate_num; case 'price': return offering.price_num; case 'call_price': return offering.call_price_num; case 'maturity_date': return offering.maturity_date_obj; case 'call_date': return offering.call_date_obj; case 'cusip': return offering.cusip; case 'description': return offering.description; case 'moody_rating': return offering.moody_rating; case 'sp_rating': return offering.sp_rating; case 'state': return offering.state; case 'insurance': return offering.insurance; default: return offering[key]; }
}

// --- UI Rendering ---

/** Renders the holdings data into the HTML table body. */
function renderTable(holdings) { /* ... no changes ... */
    console.log("Rendering holdings table with:", holdings.length); const colSpan = (tableHeaders.length || 10) + 1; if (!tableBody) { console.error("Holdings table body not found!"); return; } if (!holdings || holdings.length === 0) { const hasActiveFilters = activeFilters.some(f => f.value !== ''); const noDataMessage = portfolioFilterSelect.value ? 'No holdings match filter criteria.' : 'No holdings to display.'; tableBody.innerHTML = `<tr><td colspan="${colSpan}">${noDataMessage}</td></tr>`; if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; } if (emailInterestBtn) { emailInterestBtn.disabled = true; } return; } tableBody.innerHTML = holdings.map(h => { const maturityDisplay = h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : (h.maturity_date || ''); const callDisplay = h.call_date_obj ? h.call_date_obj.toLocaleDateString() : (h.call_date || ''); const parDisplay = (h.par_calculated ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); const priceDisplay = (h.settlement_price ?? 0).toFixed(2); const couponDisplay = (h.coupon ?? 0).toFixed(3); const yieldDisplay = (h.yield_val ?? 0).toFixed(3); const walDisplay = (h.wal ?? 0).toFixed(2); const isChecked = selectedHoldingIds.has(h.id); return `<tr data-holding-id="${h.id}"><td class="checkbox-column"><input type="checkbox" class="holding-checkbox" data-holding-id="${h.id}" data-cusip="${h.security_cusip || ''}" data-par="${(h.par_calculated ?? 0).toFixed(2)}" ${isChecked ? 'checked' : ''} aria-label="Select holding ${h.security_cusip || 'N/A'}"></td><td>${h.security_cusip || 'N/A'}</td><td>${h.description || ''}</td><td>${parDisplay}</td><td>${priceDisplay}</td><td>${couponDisplay}</td><td>${yieldDisplay}</td><td>${walDisplay}</td><td>${h.estimated_maturity_date ?? 'N/A'}</td><td>${maturityDisplay}</td><td>${callDisplay}</td></tr>`; }).join(''); updateSelectAllCheckboxState(); emailInterestBtn.disabled = selectedHoldingIds.size === 0;
}

/** Updates the sort indicator arrows in the holdings table headers. */
function updateSortIndicators() { /* ... no changes ... */
    tableHeaders.forEach(th => { const key = th.dataset.key; const arrowSpan = th.querySelector('.sort-arrow'); if (!arrowSpan) return; if (key === currentSortKey) { th.classList.add('sorted'); arrowSpan.textContent = currentSortDir === 'asc' ? ' ▲' : ' ▼'; } else { th.classList.remove('sorted'); arrowSpan.textContent = ''; } });
}

/** Updates the sort indicator arrows in the muni offerings table headers. */
function updateMuniSortIndicators() { /* ... no changes ... */
    muniTableHeaders.forEach(th => { const key = th.dataset.key; const arrowSpan = th.querySelector('.sort-arrow'); if (!arrowSpan) return; if (key === currentMuniSortKey) { th.classList.add('sorted'); arrowSpan.textContent = currentMuniSortDir === 'asc' ? ' ▲' : ' ▼'; } else { th.classList.remove('sorted'); arrowSpan.textContent = ''; } });
}


/** Calculates and renders the total values for the holdings table footer. */
function renderTotals(holdings) { /* ... no changes ... */
    const totalPar = holdings.reduce((sum, h) => sum + (h.par_calculated ?? 0), 0); const weightedYieldSum = holdings.reduce((sum, h) => sum + ((h.par_calculated ?? 0) * (h.yield_val ?? 0)), 0); const totalYield = totalPar > 0 ? weightedYieldSum / totalPar : 0; const weightedWalSum = holdings.reduce((sum, h) => sum + ((h.par_calculated ?? 0) * (h.wal ?? 0)), 0); const totalWal = totalPar > 0 ? weightedWalSum / totalPar : 0; document.getElementById('totals-par').textContent = totalPar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); document.getElementById('totals-yield').textContent = totalYield.toFixed(3); document.getElementById('totals-wal').textContent = totalWal.toFixed(2);
}

/** Destroys an existing Chart.js instance. */
function destroyChart(chartId) { /* ... no changes ... */
    if (chartInstances[chartId]?.destroy) { chartInstances[chartId].destroy(); delete chartInstances[chartId]; }
}

/** Renders all the charts based on the holdings data. */
function renderCharts(holdings) { /* ... no changes ... */
    console.log("Rendering charts with holdings:", holdings.length); Object.keys(chartInstances).forEach(destroyChart); chartInstances = {}; const isDark = document.body.classList.contains('dark-mode'); const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)'; const labelColor = isDark ? '#aaa' : '#666'; const titleColor = isDark ? '#4dabf7' : '#0056b3'; const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)'; const tooltipColor = isDark ? '#f1f1f1' : '#fff'; const baseChartOptionsStatic = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: labelColor } }, title: { color: titleColor, display: true }, tooltip: { backgroundColor: tooltipBgColor, titleColor: tooltipColor, bodyColor: tooltipColor, footerColor: tooltipColor } }, scales: { x: { ticks: { color: labelColor }, grid: { color: gridColor, borderColor: gridColor }, title: { color: labelColor, display: true } }, y: { ticks: { color: labelColor }, grid: { color: gridColor, borderColor: gridColor }, title: { color: labelColor, display: true } } }, }; const pdfBackgroundPlugin = { id: 'pdfBackground', beforeDraw: (chart) => { const ctx = chart.canvas.getContext('2d'); ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, chart.width, chart.height); ctx.restore(); } }; const contexts = { yieldVsMaturityChart: document.getElementById('yieldVsMaturityChart')?.getContext('2d'), parByMaturityYearChart: document.getElementById('parByMaturityYearChart')?.getContext('2d'), couponPieChart: document.getElementById('couponPieChart')?.getContext('2d'), priceVsYieldChart: document.getElementById('priceVsYieldChart')?.getContext('2d'), }; if (Object.values(contexts).some(ctx => !ctx)) { console.error("One or more chart canvas elements not found."); return; } const yieldMaturityPoints = holdings.filter(h => h.estimated_maturity_date !== null && typeof h.yield_val === 'number').map(h => ({ x: h.estimated_maturity_date, y: h.yield_val })); if (yieldMaturityPoints.length > 0 && contexts.yieldVsMaturityChart) { const options1 = structuredClone(baseChartOptionsStatic); options1.plugins.title.text = 'Yield vs. Estimated Maturity Year'; options1.scales.x.type = 'linear'; options1.scales.x.position = 'bottom'; options1.scales.x.title.text = 'Estimated Maturity Year'; options1.scales.x.ticks = { ...options1.scales.x.ticks, stepSize: 1, callback: value => Math.round(value) }; options1.scales.y.beginAtZero = false; options1.scales.y.title.text = 'Yield (%)'; options1.plugins.tooltip.callbacks = { label: ctx => `Year: ${ctx.parsed.x}, Yield: ${ctx.parsed.y.toFixed(3)}` }; options1.plugins.pdfBackground = pdfBackgroundPlugin; const dataset1 = { label: 'Yield vs Est Maturity Year', data: yieldMaturityPoints, backgroundColor: isDark ? 'rgba(66, 135, 245, 0.7)' : 'rgba(0, 123, 255, 0.5)', borderColor: isDark ? 'rgba(86, 155, 255, 1)' : 'rgba(0, 123, 255, 1)', pointRadius: 5, pointHoverRadius: 7, showLine: false }; if (typeof Chart !== 'undefined' && window.pluginTrendlineLinear) { dataset1.trendlineLinear = { style: isDark ? "rgba(255, 80, 80, 0.9)" : "rgba(255, 50, 50, 0.8)", lineStyle: "solid", width: 2, projection: false }; } chartInstances.yieldVsMaturityChart = new Chart(contexts.yieldVsMaturityChart, { type: 'scatter', data: { datasets: [dataset1] }, options: options1 }); } const maturityBuckets = {}; holdings.forEach(h => { const year = h.estimated_maturity_date || (h.maturity_date_obj ? h.maturity_date_obj.getFullYear() : 'Unknown'); if (year !== 'Unknown' && !isNaN(year)) { maturityBuckets[year] = (maturityBuckets[year] || 0) + (h.par_calculated ?? 0); } }); const sortedYears = Object.keys(maturityBuckets).map(Number).sort((a, b) => a - b); if (sortedYears.length > 0 && contexts.parByMaturityYearChart) { const options2 = structuredClone(baseChartOptionsStatic); options2.plugins.title.text = 'Total Par by Estimated Maturity Year'; options2.scales.x.title.text = 'Year'; options2.scales.y.beginAtZero = true; options2.scales.y.title.text = 'Total Par Value'; options2.scales.y.ticks = { ...options2.scales.y.ticks, callback: value => value.toLocaleString() }; options2.plugins.tooltip.callbacks = { label: ctx => `Year: ${ctx.label}, Par: ${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }; options2.plugins.pdfBackground = pdfBackgroundPlugin; chartInstances.parByMaturityYearChart = new Chart(contexts.parByMaturityYearChart, { type: 'bar', data: { labels: sortedYears, datasets: [{ label: 'Total Par by Est. Maturity Year', data: sortedYears.map(year => maturityBuckets[year]), backgroundColor: isDark ? 'rgba(40, 167, 69, 0.85)' : 'rgba(40, 167, 69, 0.7)', borderColor: isDark ? 'rgba(60, 187, 89, 1)' : 'rgba(40, 167, 69, 1)', borderWidth: 1 }] }, options: options2 }); } const couponBuckets = {}; holdings.forEach(h => { const couponRate = (h.coupon ?? 0).toFixed(3); couponBuckets[couponRate] = (couponBuckets[couponRate] || 0) + (h.par_calculated ?? 0); }); const sortedCoupons = Object.keys(couponBuckets).sort((a, b) => parseFloat(a) - parseFloat(b)); if (sortedCoupons.length > 0 && contexts.couponPieChart) { const pieColors = generateDistinctColors(sortedCoupons.length); const options3 = structuredClone(baseChartOptionsStatic); delete options3.scales; options3.plugins.title.text = 'Portfolio Par Distribution by Coupon Rate'; options3.plugins.title.align = 'center'; options3.plugins.legend.position = 'bottom'; options3.plugins.tooltip.callbacks = { label: ctx => { const label = ctx.label || ''; const value = ctx.parsed || 0; const total = ctx.dataset.data.reduce((acc, val) => acc + val, 0); const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0; return `${label}: ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`; } }; options3.plugins.pdfBackground = pdfBackgroundPlugin; chartInstances.couponPieChart = new Chart(contexts.couponPieChart, { type: 'pie', data: { labels: sortedCoupons.map(c => `${c}% Coupon`), datasets: [{ label: 'Par by Coupon Rate', data: sortedCoupons.map(c => couponBuckets[c]), backgroundColor: pieColors, hoverOffset: 4 }] }, options: options3 }); } const priceYieldPoints = holdings.filter(h => typeof h.settlement_price === 'number' && h.settlement_price > 0 && typeof h.yield_val === 'number').map(h => ({ x: h.settlement_price, y: h.yield_val })); if (priceYieldPoints.length > 0 && contexts.priceVsYieldChart) { const options4 = structuredClone(baseChartOptionsStatic); options4.plugins.title.text = 'Settlement Price vs. Yield'; options4.scales.x.beginAtZero = false; options4.scales.x.title.text = 'Settlement Price'; options4.scales.y.beginAtZero = false; options4.scales.y.title.text = 'Yield (%)'; options4.plugins.tooltip.callbacks = { label: ctx => `Price: ${ctx.parsed.x.toFixed(2)}, Yield: ${ctx.parsed.y.toFixed(3)}` }; options4.plugins.pdfBackground = pdfBackgroundPlugin; chartInstances.priceVsYieldChart = new Chart(contexts.priceVsYieldChart, { type: 'scatter', data: { datasets: [{ label: 'Price vs Yield', data: priceYieldPoints, backgroundColor: isDark ? 'rgba(255, 200, 50, 0.7)' : 'rgba(255, 193, 7, 0.6)', borderColor: isDark ? 'rgba(255, 210, 70, 1)' : 'rgba(255, 193, 7, 1)', pointRadius: 5, pointHoverRadius: 7, showLine: false }] }, options: options4 }); }
}


// --- UI Update Triggers ---

/** Applies filters and sorting to holdings, then renders table and totals. */
function triggerTableUpdate() {
    applyFilterAndSort();
    renderTotals(filteredHoldings);
}

/** Applies filters and sorting to holdings, then renders table, totals, and charts. */
function triggerFullUpdate() {
    applyFilterAndSort();
    renderTotals(filteredHoldings);
    renderCharts(filteredHoldings);
}

/** Applies filters and sorting to `allHoldings`, renders table and indicators. */
function applyFilterAndSort() {
    const filtersToApply = activeFilters.filter(f => f.value !== null && f.value !== '');
    if (filtersToApply.length > 0) {
        filteredHoldings = allHoldings.filter(holding => filtersToApply.every(filter => checkFilter(holding, filter)));
    } else {
        filteredHoldings = [...allHoldings];
    }
    sortDataGeneric(filteredHoldings, currentSortKey, currentSortDir, getHoldingSortValue);
    renderTable(filteredHoldings);
    updateSortIndicators();
}

/** Applies filters and sorting to `allMuniOfferings`, renders table and indicators. */
function applyMuniFiltersAndSort() {
    const filtersToApply = activeMuniFilters.filter(f => f.value !== null && f.value !== '');
    if (filtersToApply.length > 0) {
        console.log("Applying Muni Filters:", filtersToApply);
        filteredMuniOfferings = allMuniOfferings.filter(offering => {
            return filtersToApply.every(filter => checkMuniFilter(offering, filter));
        });
    } else {
        console.log("No active Muni Filters, showing all.");
        filteredMuniOfferings = [...allMuniOfferings]; // Use all if no filters
    }
    sortDataGeneric(filteredMuniOfferings, currentMuniSortKey, currentMuniSortDir, getMuniOfferingSortValue);
    renderMuniOfferingsTable(filteredMuniOfferings);
    updateMuniSortIndicators();
}


/** Clears the holdings table, totals, charts, and selections. */
function clearTableAndCharts() {
    const colSpan = (tableHeaders.length || 10) + 1;
    if (tableBody) { tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading...</td></tr>`; }
    renderTotals([]); Object.keys(chartInstances).forEach(destroyChart); chartInstances = {};
    clearHoldingSelection();
}

// --- Theme Toggling ---

/** Applies the specified theme and re-renders charts. */
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
        darkModeToggle.textContent = 'Toggle Light Mode';
    } else {
        document.body.classList.remove('dark-mode');
        darkModeToggle.textContent = 'Toggle Dark Mode';
    }
    // FIX: Wrap localStorage access in try...catch
    try {
        localStorage.setItem('themeCheck', '1'); // Test write access
        localStorage.removeItem('themeCheck');
        // Only re-render if charts exist AND localStorage was accessible
        if (Object.keys(chartInstances).length > 0) {
             renderCharts(filteredHoldings); // Re-render holdings charts
        }
    } catch (e) {
        console.warn("localStorage not accessible, charts will not update theme colors dynamically.");
    }
}
/** Toggles the theme and saves preference. */
function toggleTheme() {
    const currentTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    // FIX: Wrap localStorage access in try...catch
    try {
        localStorage.setItem('portfolioTheme', currentTheme);
    } catch (e) {
        console.warn("Could not save theme preference to localStorage:", e);
    }
    applyTheme(currentTheme);
}

// --- PDF Export --- (No changes needed for muni offerings)

/** Exports the current view (charts and holdings table) to PDF. */
async function exportToPdf() { /* ... no changes ... */
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' }); const isDark = document.body.classList.contains('dark-mode'); const pdfHeaderBg = isDark ? '#3a3a3a' : '#e9ecef'; const pdfHeaderText = isDark ? '#e0e0e0' : '#495057'; const pdfTextColor = isDark ? '#f1f1f1' : '#333333'; const pdfBorderColor = isDark ? '#444444' : '#dee2e6'; const pdfRowBg = isDark ? '#2c2c2c' : '#ffffff'; const pdfAlternateRowBg = isDark ? '#303030' : '#f8f9fa'; const pageHeight = doc.internal.pageSize.getHeight(); const pageWidth = doc.internal.pageSize.getWidth(); const margin = 40; const usableWidth = pageWidth - (2 * margin); const usableHeight = pageHeight - (2 * margin); const chartGap = 25; const chartWidth = ((usableWidth - chartGap) / 2) * 0.95; const chartHeight = ((usableHeight - chartGap - 30) / 2) * 0.95; const chartStartX1 = margin; const chartStartX2 = margin + chartWidth + chartGap; const chartStartY1 = margin + 25; const chartStartY2 = chartStartY1 + chartHeight + chartGap; doc.setFontSize(18); doc.setTextColor(isDark ? 241 : 51); const viewTitle = portfolioNameEl.textContent || 'Portfolio Analysis'; doc.text(viewTitle + " - Charts", margin, margin + 5); const chartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart', 'priceVsYieldChart']; const chartImages = []; for (const chartId of chartIds) { const chartInstance = chartInstances[chartId]; try { if (chartInstance) { chartImages.push(chartInstance.toBase64Image('image/png', 1.0)); } else { chartImages.push(null); } } catch (e) { console.error(`Error getting image for chart ${chartId}:`, e); chartImages.push(null); } } if (chartImages[0]) doc.addImage(chartImages[0], 'PNG', chartStartX1, chartStartY1, chartWidth, chartHeight); if (chartImages[1]) doc.addImage(chartImages[1], 'PNG', chartStartX2, chartStartY1, chartWidth, chartHeight); if (chartImages[2]) doc.addImage(chartImages[2], 'PNG', chartStartX1, chartStartY2, chartWidth, chartHeight); if (chartImages[3]) doc.addImage(chartImages[3], 'PNG', chartStartX2, chartStartY2, chartWidth, chartHeight); doc.addPage(); doc.setFontSize(18); doc.setTextColor(isDark ? 241 : 51); doc.text(viewTitle + " - Holdings Table", margin, margin + 5); doc.autoTable({ html: '#holdings-table', startY: margin + 25, theme: 'grid', columns: [ { header: 'CUSIP', dataKey: 1 }, { header: 'Description', dataKey: 2 }, { header: 'Par', dataKey: 3 }, { header: 'Price', dataKey: 4 }, { header: 'Coupon', dataKey: 5 }, { header: 'Yield', dataKey: 6 }, { header: 'WAL', dataKey: 7 }, { header: 'Est. Maturity Year', dataKey: 8 }, { header: 'Maturity Date', dataKey: 9 }, { header: 'Call Date', dataKey: 10 }, ], styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak', textColor: pdfTextColor, lineColor: pdfBorderColor, lineWidth: 0.5, }, headStyles: { fillColor: pdfHeaderBg, textColor: pdfHeaderText, fontStyle: 'bold', halign: 'center', lineColor: pdfBorderColor, lineWidth: 0.5, }, bodyStyles: { fillColor: pdfRowBg, textColor: pdfTextColor, lineColor: pdfBorderColor, lineWidth: 0.5, }, alternateRowStyles: { fillColor: pdfAlternateRowBg }, columnStyles: { 0: { cellWidth: 55, halign: 'left' }, 1: { cellWidth: 'auto', halign: 'left'}, 2: { cellWidth: 60, halign: 'right' }, 3: { cellWidth: 40, halign: 'right' }, 4: { cellWidth: 40, halign: 'right' }, 5: { cellWidth: 40, halign: 'right' }, 6: { cellWidth: 40, halign: 'right' }, 7: { cellWidth: 55, halign: 'center' }, 8: { cellWidth: 55, halign: 'center' }, 9: { cellWidth: 55, halign: 'center' } }, margin: { left: margin, right: margin }, didDrawPage: function (data) { let footerStr = "Page " + doc.internal.getCurrentPageInfo().pageNumber; doc.setFontSize(8); doc.setTextColor(isDark ? 150 : 100); doc.text(footerStr, data.settings.margin.left, pageHeight - 15, { baseline: 'bottom' }); } }); const selectedCustomerOption = customerSelect.options[customerSelect.selectedIndex]; const selectedPortfolioOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex]; let baseFilename = 'export'; if (selectedCustomerOption) { baseFilename = selectedCustomerOption.text.split('(')[0].trim(); if (selectedPortfolioOption && selectedPortfolioOption.value !== "") { baseFilename += '_' + selectedPortfolioOption.text.split('(')[0].trim(); } } const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase(); doc.save(`portfolio_${safeFilename}.pdf`);
}


// --- Modal Functions (Create Portfolio) --- (No changes needed)

/** Shows the create portfolio modal. */
function showCreatePortfolioModal() { /* ... no changes ... */
    console.log("Showing create portfolio modal. Admin:", IS_ADMIN_USER, "Customer Count:", customers.length); createPortfolioForm.reset(); modalErrorMessage.textContent = ''; modalErrorMessage.style.display = 'none'; adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>'; if (IS_ADMIN_USER) { adminCustomerSelectGroup.classList.remove('hidden'); fetchCustomersForAdmin(); } else if (customers && customers.length > 1) { adminCustomerSelectGroup.classList.remove('hidden'); customers.forEach(customer => { const option = document.createElement('option'); option.value = customer.id; option.textContent = `${customer.name} (${customer.customer_number})`; adminCustomerSelect.appendChild(option); }); } else { adminCustomerSelectGroup.classList.add('hidden'); } createPortfolioModal.classList.add('visible');
}
/** Hides the create portfolio modal. */
function hideCreatePortfolioModal() { createPortfolioModal.classList.remove('visible'); }
/** Fetches customers for the admin modal dropdown. */
async function fetchCustomersForAdmin() { /* ... no changes ... */
    if (!IS_ADMIN_USER) return; console.log("Fetching customers for admin modal..."); if (adminCustomerSelect.options.length > 1 && adminCustomerSelect.options[0].value === "") { console.log("Admin customer list already populated/loading."); return; } adminCustomerSelect.innerHTML = '<option value="">Loading customers...</option>'; try { const response = await fetch(`${apiRoot}/customers/`); if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`); availableCustomers = await response.json(); console.log("Fetched customers for admin modal:", availableCustomers.length); adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>'; availableCustomers.forEach(customer => { const option = document.createElement('option'); option.value = customer.customer_number; option.textContent = `${customer.name} (${customer.customer_number})`; adminCustomerSelect.appendChild(option); }); } catch (error) { console.error("Failed to fetch customers for admin:", error); adminCustomerSelect.innerHTML = '<option value="">Error loading customers</option>'; modalErrorMessage.textContent = 'Error loading customer list for modal.'; modalErrorMessage.style.display = 'block'; }
 }
/** Handles the create portfolio form submission. */
async function handleCreatePortfolioSubmit(event) { /* ... no changes ... */
    event.preventDefault(); console.log("Handling create portfolio submit..."); modalErrorMessage.textContent = ''; modalErrorMessage.style.display = 'none'; const portfolioName = newPortfolioNameInput.value.trim(); if (!portfolioName) { modalErrorMessage.textContent = 'Portfolio name is required.'; modalErrorMessage.style.display = 'block'; return; } const payload = { name: portfolioName }; const isCustomerSelectionVisible = !adminCustomerSelectGroup.classList.contains('hidden'); if (isCustomerSelectionVisible) { const selectedValue = adminCustomerSelect.value; if (!selectedValue) { modalErrorMessage.textContent = 'Please select a customer.'; modalErrorMessage.style.display = 'block'; return; } if (IS_ADMIN_USER) { payload.customer_number_input = selectedValue; } else { payload.owner_customer_id = parseInt(selectedValue, 10); if (isNaN(payload.owner_customer_id)) { modalErrorMessage.textContent = 'Invalid customer selected.'; modalErrorMessage.style.display = 'block'; return; } } } const initialHoldingIds = filteredHoldings.map(holding => holding.id).filter(id => id != null); if (initialHoldingIds.length > 0) { payload.initial_holding_ids = initialHoldingIds; } console.log("Final create portfolio payload:", payload); try { const response = await fetch(`${apiRoot}/portfolios/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, }, body: JSON.stringify(payload), }); console.log("Create portfolio response status:", response.status); if (!response.ok) { const errorData = await response.json().catch(() => ({ detail: response.statusText })); let errorMsg = `Error ${response.status}: ${errorData.detail || JSON.stringify(errorData)}`; if (typeof errorData === 'object' && errorData !== null) { errorMsg = Object.entries(errorData).map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`).join('; '); } throw new Error(errorMsg); } const newPortfolio = await response.json(); console.log('Successfully created portfolio:', newPortfolio); hideCreatePortfolioModal(); alert(`Portfolio "${newPortfolio.name}" created successfully!`); if (selectedCustomerId) { await loadPortfolios(selectedCustomerId); portfolioFilterSelect.value = newPortfolio.id; await handlePortfolioSelection(); } else { loadCustomers(); } } catch (error) { console.error('Failed to create portfolio:', error); modalErrorMessage.textContent = `Creation failed: ${error.message}`; modalErrorMessage.style.display = 'block'; }
 }

/** Handles the delete portfolio button click. */
async function handleDeletePortfolio() { /* ... no changes ... */
    const portfolioIdToDelete = portfolioFilterSelect.value; const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex]; const portfolioNameToDelete = selectedOption ? selectedOption.textContent : `Portfolio ID ${portfolioIdToDelete}`; if (!portfolioIdToDelete || selectedOption?.dataset?.isDefault === 'true') { alert("Please select a non-default portfolio to delete."); return; } if (!confirm(`Are you sure you want to delete portfolio "${portfolioNameToDelete}"? This action cannot be undone.`)) { return; } console.log(`Attempting to delete portfolio ID: ${portfolioIdToDelete}`); try { const response = await fetch(`${apiRoot}/portfolios/${portfolioIdToDelete}/`, { method: 'DELETE', headers: { 'X-CSRFToken': csrfToken, 'Accept': 'application/json', } }); console.log(`Delete portfolio response status: ${response.status}`); if (response.status === 204) { alert(`Portfolio "${portfolioNameToDelete}" deleted successfully.`); selectedOption.remove(); if (portfolioFilterSelect.options.length > 0) { portfolioFilterSelect.value = portfolioFilterSelect.options[0].value; await handlePortfolioSelection(); } else { portfolioFilterContainer.classList.add('hidden'); deletePortfolioBtn.disabled = true; const selectedCustomer = customers.find(c => c.id == selectedCustomerId); portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - No Portfolios Found`; clearTableAndCharts(); const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">No portfolios found.</td></tr>`; } } else { let errorMsg = `Error ${response.status}: Failed to delete portfolio.`; try { const errorData = await response.json(); errorMsg += ` ${errorData.detail || JSON.stringify(errorData)}`; } catch (e) { errorMsg += ` ${response.statusText}`; } throw new Error(errorMsg); } } catch (error) { console.error("Failed to delete portfolio:", error); alert(`Error deleting portfolio: ${error.message}`); }
 }


// --- Holding Selection and Email Action ---

/** Handles checkbox changes for holdings. */
function handleCheckboxChange(event) { /* ... no changes ... */
    const target = event.target; if (target === selectAllCheckbox) { const isChecked = target.checked; const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox'); visibleCheckboxes.forEach(checkbox => { checkbox.checked = isChecked; const holdingId = parseInt(checkbox.dataset.holdingId, 10); if (!isNaN(holdingId)) { if (isChecked) { selectedHoldingIds.add(holdingId); } else { selectedHoldingIds.delete(holdingId); } } }); } else if (target.classList.contains('holding-checkbox')) { const holdingId = parseInt(target.dataset.holdingId, 10); if (!isNaN(holdingId)) { if (target.checked) { selectedHoldingIds.add(holdingId); } else { selectedHoldingIds.delete(holdingId); } updateSelectAllCheckboxState(); } } emailInterestBtn.disabled = selectedHoldingIds.size === 0; console.log("Selected Holdings:", selectedHoldingIds);
}
/** Updates the "Select All" checkbox state for holdings. */
function updateSelectAllCheckboxState() { /* ... no changes ... */
    if (!selectAllCheckbox || !tableBody) return; const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox'); const totalVisible = visibleCheckboxes.length; const totalSelected = Array.from(visibleCheckboxes).filter(cb => cb.checked).length; if (totalVisible === 0) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; } else if (totalSelected === totalVisible) { selectAllCheckbox.checked = true; selectAllCheckbox.indeterminate = false; } else if (totalSelected > 0) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = true; } else { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
}
/** Clears holding selection. */
function clearHoldingSelection() { /* ... no changes ... */
    selectedHoldingIds.clear(); if(tableBody) tableBody.querySelectorAll('.holding-checkbox').forEach(cb => cb.checked = false); if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; } if (emailInterestBtn) { emailInterestBtn.disabled = true; } if (emailStatusMessage) { emailStatusMessage.textContent = ''; emailStatusMessage.style.display = 'none'; }
}
/** Handles the "Sell Bonds" button click. */
async function handleEmailInterestClick() { /* ... no changes ... */
    if (!selectedCustomerId) { showStatusMessageGeneric(emailStatusMessage, "Error: No customer selected.", true); return; } if (selectedHoldingIds.size === 0) { showStatusMessageGeneric(emailStatusMessage, "Error: No bonds selected.", true); return; } emailInterestBtn.disabled = true; showStatusMessageGeneric(emailStatusMessage, "Sending email...", false, 0); const selectedBondsPayload = []; filteredHoldings.forEach(holding => { if (selectedHoldingIds.has(holding.id)) { selectedBondsPayload.push({ cusip: holding.security_cusip || 'N/A', par: (holding.par_calculated ?? 0).toFixed(2) }); } }); const payload = { customer_id: parseInt(selectedCustomerId, 10), selected_bonds: selectedBondsPayload }; console.log("Sending email interest payload:", payload); try { const response = await fetch(`${apiRoot}/email-salesperson-interest/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, }, body: JSON.stringify(payload), }); const responseData = await response.json(); if (response.ok) { console.log("Email sent successfully:", responseData); showStatusMessageGeneric(emailStatusMessage, responseData.message || "Email sent successfully!", false); clearHoldingSelection(); } else { console.error("API Error sending email:", response.status, responseData); const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.'; showStatusMessageGeneric(emailStatusMessage, `Error: ${errorDetail}`, true); emailInterestBtn.disabled = false; } } catch (error) { console.error("Network/Fetch Error sending email:", error); showStatusMessageGeneric(emailStatusMessage, "Network error. Please try again.", true); emailInterestBtn.disabled = false; }
}

// --- Muni Offering Selection and Email Action ---

/** Handles checkbox changes for muni offerings. */
function handleMuniCheckboxChange(event) { /* ... no changes ... */
    const target = event.target; if (target === selectAllMunisCheckbox) { const isChecked = target.checked; const visibleCheckboxes = muniOfferingsTableBody.querySelectorAll('.muni-checkbox'); visibleCheckboxes.forEach(checkbox => { checkbox.checked = isChecked; const offeringId = parseInt(checkbox.dataset.offeringId, 10); if (!isNaN(offeringId)) { if (isChecked) { selectedMuniOfferingIds.add(offeringId); } else { selectedMuniOfferingIds.delete(offeringId); } } }); } else if (target.classList.contains('muni-checkbox')) { const offeringId = parseInt(target.dataset.offeringId, 10); if (!isNaN(offeringId)) { if (target.checked) { selectedMuniOfferingIds.add(offeringId); } else { selectedMuniOfferingIds.delete(offeringId); } updateSelectAllMunisCheckboxState(); } } emailBuyInterestBtn.disabled = selectedMuniOfferingIds.size === 0; console.log("Selected Muni Offerings:", selectedMuniOfferingIds);
}
/** Updates the "Select All" checkbox state for muni offerings. */
function updateSelectAllMunisCheckboxState() { /* ... no changes ... */
    if (!selectAllMunisCheckbox || !muniOfferingsTableBody) return; const visibleCheckboxes = muniOfferingsTableBody.querySelectorAll('.muni-checkbox'); const totalVisible = visibleCheckboxes.length; const totalSelected = Array.from(visibleCheckboxes).filter(cb => cb.checked).length; if (totalVisible === 0) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; } else if (totalSelected === totalVisible) { selectAllMunisCheckbox.checked = true; selectAllMunisCheckbox.indeterminate = false; } else if (totalSelected > 0) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = true; } else { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
}
/** Clears muni offering selection. */
function clearMuniOfferingSelection() { /* ... no changes ... */
    selectedMuniOfferingIds.clear(); if(muniOfferingsTableBody) muniOfferingsTableBody.querySelectorAll('.muni-checkbox').forEach(cb => cb.checked = false); if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; } if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; } if (emailBuyStatusMessage) { emailBuyStatusMessage.textContent = ''; emailBuyStatusMessage.style.display = 'none'; }
}
/** Handles the "Indicate Interest in Buying" button click. */
async function handleEmailBuyInterestClick() { /* ... no changes ... */
    if (!selectedCustomerId) { showStatusMessageGeneric(emailBuyStatusMessage, "Error: No customer selected.", true); return; } if (selectedMuniOfferingIds.size === 0) { showStatusMessageGeneric(emailBuyStatusMessage, "Error: No offerings selected.", true); return; } emailBuyInterestBtn.disabled = true; showStatusMessageGeneric(emailBuyStatusMessage, "Sending email...", false, 0); const selectedOfferingsPayload = []; allMuniOfferings.forEach(offering => { if (selectedMuniOfferingIds.has(offering.id)) { selectedOfferingsPayload.push({ cusip: offering.cusip || 'N/A', description: offering.description || 'N/A' }); } }); const payload = { customer_id: parseInt(selectedCustomerId, 10), selected_offerings: selectedOfferingsPayload }; console.log("Sending email buy interest payload:", payload); const buyInterestApiUrl = `${apiRoot}/email-buy-muni-interest/`; try { const response = await fetch(buyInterestApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, }, body: JSON.stringify(payload), }); const responseData = await response.json(); if (response.ok) { console.log("Buy interest email sent successfully:", responseData); showStatusMessageGeneric(emailBuyStatusMessage, responseData.message || "Buy interest email sent successfully!", false); clearMuniOfferingSelection(); } else { console.error("API Error sending buy interest email:", response.status, responseData); const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.'; let displayError = `Error: ${errorDetail}`; if (responseData.selected_offerings && typeof responseData.selected_offerings === 'object') { const nestedErrors = Object.values(responseData.selected_offerings).map(itemErrors => Object.values(itemErrors).flat().map(e => e.string || e).join(' ')).join('; '); if (nestedErrors) { displayError = `Error: Invalid data in selected offerings - ${nestedErrors}`; } } showStatusMessageGeneric(emailBuyStatusMessage, displayError, true); emailBuyInterestBtn.disabled = false; } } catch (error) { console.error("Network/Fetch Error sending buy interest email:", error); showStatusMessageGeneric(emailBuyStatusMessage, "Network error. Please try again.", true); emailBuyInterestBtn.disabled = false; }
}


// --- Event Listeners Setup ---

/**
 * Attaches all necessary event listeners.
 */
function setupEventListeners() {
    // Customer/Portfolio Dropdowns
    customerSelect.addEventListener('change', handleCustomerSelection);
    portfolioFilterSelect.addEventListener('change', handlePortfolioSelection);
    deletePortfolioBtn.addEventListener('click', handleDeletePortfolio);

    // Holdings Filters
    addFilterBtn.addEventListener('click', () => addFilterRow());
    clearAllFiltersBtn.addEventListener('click', handleClearAllFilters);
    // Delegate events for dynamically added holdings filter rows
    if (filtersContainer) {
        filtersContainer.addEventListener('change', handleFilterDropdownChange);
        filtersContainer.addEventListener('input', handleFilterValueChange);
        filtersContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('remove-filter-btn')) {
                handleRemoveFilter(event);
            }
        });
    }

    // Holdings Table Sorting
    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key; if (!key) return;
            if (key === currentSortKey) { currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc'; }
            else { currentSortKey = key; currentSortDir = 'asc'; }
            applySortAndRenderTable();
        });
    });

    // Muni Offerings Table Sorting
    muniTableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key; if (!key) return;
            if (key === currentMuniSortKey) { currentMuniSortDir = currentMuniSortDir === 'asc' ? 'desc' : 'asc'; }
            else { currentMuniSortKey = key; currentMuniSortDir = 'asc'; }
            applySortAndRenderMuniTable();
        });
    });

    // Muni Offerings Filters
    if(addMuniFilterBtn) addMuniFilterBtn.addEventListener('click', () => addMuniFilterRow()); // Corrected: Call addMuniFilterRow
    if(clearAllMuniFiltersBtn) clearAllMuniFiltersBtn.addEventListener('click', handleClearAllMuniFilters);
    // Delegate events for dynamically added muni filter rows
    if (muniFiltersContainer) {
        muniFiltersContainer.addEventListener('change', handleMuniFilterDropdownChange);
        muniFiltersContainer.addEventListener('input', handleMuniFilterValueChange);
        muniFiltersContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('remove-muni-filter-btn')) {
                handleRemoveMuniFilter(event);
            }
        });
    }


    // Theme & Export
    darkModeToggle.addEventListener('click', toggleTheme);
    exportPdfBtn.addEventListener('click', exportToPdf);

    // Create Portfolio Modal
    createPortfolioBtn.addEventListener('click', showCreatePortfolioModal);
    modalCloseBtn.addEventListener('click', hideCreatePortfolioModal);
    modalCancelBtn.addEventListener('click', hideCreatePortfolioModal);
    createPortfolioForm.addEventListener('submit', handleCreatePortfolioSubmit);
    createPortfolioModal.addEventListener('click', (event) => { if (event.target === createPortfolioModal) hideCreatePortfolioModal(); });

    // Holdings Table Checkboxes & Email Button (Sell)
    if (tableBody) tableBody.addEventListener('change', handleCheckboxChange);
    if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', handleCheckboxChange);
    if (emailInterestBtn) emailInterestBtn.addEventListener('click', handleEmailInterestClick);

    // Muni Offerings Table Checkboxes & Email Button (Buy)
    if (muniOfferingsTableBody) muniOfferingsTableBody.addEventListener('change', handleMuniCheckboxChange);
    if (selectAllMunisCheckbox) selectAllMunisCheckbox.addEventListener('change', handleMuniCheckboxChange);
    if (emailBuyInterestBtn) emailBuyInterestBtn.addEventListener('click', handleEmailBuyInterestClick);
}

/** Applies sorting and re-renders the holdings table and totals. */
function applySortAndRenderTable() { /* ... no changes ... */
    sortDataGeneric(filteredHoldings, currentSortKey, currentSortDir, getHoldingSortValue); renderTable(filteredHoldings); renderTotals(filteredHoldings); updateSortIndicators();
}

/** Applies sorting and re-renders the muni offerings table. */
function applySortAndRenderMuniTable() { /* ... no changes ... */
    sortDataGeneric(filteredMuniOfferings, currentMuniSortKey, currentMuniSortDir, getMuniOfferingSortValue); renderMuniOfferingsTable(filteredMuniOfferings); updateMuniSortIndicators(); // Use filteredMuniOfferings
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // Initial setup
    generateColumnOptions(); // For holdings filters
    addFilterRow(); // Add initial holdings filter row
    generateMuniColumnOptions(); // For muni filters
    addMuniFilterRow(); // Add initial muni filter row

    // Register Chart.js plugins
    if (typeof Chart !== 'undefined' && window.pluginTrendlineLinear) {
        try { Chart.register(window.pluginTrendlineLinear); console.log("Trendline plugin registered."); }
        catch (e) { console.error("Error registering Trendline plugin:", e); }
    } else { console.warn("Chart.js or Trendline plugin not found."); }

    // Apply theme
    let preferredTheme = 'light';
    // FIX: Wrap localStorage access in try...catch
    try {
        localStorage.setItem('themeCheck', '1'); // Check if localStorage is accessible
        localStorage.removeItem('themeCheck');
        preferredTheme = localStorage.getItem('portfolioTheme') || 'light'; // Get saved theme or default
        console.log("Theme preference loaded:", preferredTheme);
    } catch (e) {
        console.warn("Could not access localStorage for theme preference:", e);
    }
    applyTheme(preferredTheme); // Apply the determined theme

    // Setup event listeners
    setupEventListeners();

    // Start loading initial data
    loadCustomers(); // This triggers portfolio/holdings load
    loadMuniOfferings(); // Load municipal offerings data
});
