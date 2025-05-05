// --- JAVASCRIPT for Portfolio Analyzer (v2 - Backend Parity & Pagination) ---

// Ensure external libraries (jsPDF, Chart.js, SheetJS etc.) are loaded before this script runs.

// Use strict mode for better error handling and preventing common mistakes
"use strict";

// Check if IS_ADMIN_USER is defined (should be set in the HTML before this script)
if (typeof IS_ADMIN_USER === 'undefined') {
    console.error("CRITICAL: IS_ADMIN_USER is not defined. Ensure it's set in the HTML before loading script.js.");
    // Fallback might be needed if HTML fails to set it, but use with caution
    // const IS_ADMIN_USER = false;
} else {
    console.log("User admin status (from script.js):", IS_ADMIN_USER); // Confirm it's accessible
}


// --- Constants & Global Variables ---
const { jsPDF } = window.jspdf; // Destructure jsPDF from the global window object
// Note: SheetJS (XLSX) is typically accessed via the global 'XLSX' object after its script is loaded.
const apiRoot = '/api'; // Base URL for API calls
const PAGE_SIZE = 25; // Default page size from backend (used for display calculations)

let customers = []; // Holds the list of customers fetched for the main dropdown (populated by loadCustomers)
let currentPortfolios = []; // Holds the list of portfolios fetched for the selected customer

// Holdings Data & State
let currentHoldingsData = { // Store current page data + pagination info
    results: [],
    count: 0,
    nextUrl: null,
    previousUrl: null,
    currentPage: 1,
};
let filteredHoldings = []; // Holds holdings *after* client-side filtering (if any) - USED FOR CHARTS/EXPORTS
let activeFilters = []; // Array to store active filter objects for HOLDINGS
let nextFilterId = 0; // Counter for generating unique filter IDs for HOLDINGS
let columnOptionsHtml = ''; // HTML string for filter column dropdown options for HOLDINGS
let currentSortKey = 'security_cusip'; // Default sort column key for HOLDINGS
let currentSortDir = 'asc'; // Default sort direction for HOLDINGS

// Muni Offerings Data & State
let currentMuniOfferingsData = { // Store current page data + pagination info
    results: [],
    count: 0,
    nextUrl: null,
    previousUrl: null,
    currentPage: 1,
};
let filteredMuniOfferings = []; // Offerings after client-side filtering (if any)
let activeMuniFilters = []; // Array to store active filter objects for MUNIS
let nextMuniFilterId = 0; // Counter for generating unique filter IDs for MUNIS
let muniColumnOptionsHtml = ''; // HTML string for filter column dropdown options for MUNIS
let currentMuniSortKey = 'cusip'; // Default sort column key for munis
let currentMuniSortDir = 'asc'; // Default sort direction for munis

// General State
let chartInstances = {}; // Stores active Chart.js instances for later destruction/update
let availableCustomers = []; // Stores the full customer list fetched for the admin modal dropdown
let selectedCustomerId = null; // Store the currently selected customer ID from the MAIN dropdown
let selectedHoldingIds = new Set(); // Set to store IDs (ticket_id) of selected holdings for email action
let selectedMuniOfferingIds = new Set(); // Set to store IDs of selected muni offerings

// --- DOM Element References ---
// Using const for elements that are expected to always exist
const customerSelect = document.getElementById('customer-select');
const portfolioFilterContainer = document.getElementById('portfolio-filter-container');
const portfolioFilterSelect = document.getElementById('portfolio-filter-select');
const deletePortfolioBtn = document.getElementById('delete-portfolio-btn');
const portfolioNameEl = document.getElementById('portfolio-name');
// Holdings Table & Pagination
const tableBody = document.querySelector('#holdings-table tbody');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]');
const tableElement = document.getElementById('holdings-table');
const selectAllCheckbox = document.getElementById('select-all-holdings');
const holdingsPaginationControls = document.getElementById('holdings-pagination-controls'); // Pagination container
// Holdings Filters
const filtersContainer = document.getElementById('filters-container');
const addFilterBtn = document.getElementById('add-filter-btn');
const clearAllFiltersBtn = document.getElementById('clear-all-filters-btn');
// General Controls
const darkModeToggle = document.getElementById('dark-mode-toggle');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const exportExcelBtn = document.getElementById('export-excel-btn'); // Excel export button reference
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
const muniPaginationControls = document.getElementById('muni-pagination-controls'); // Pagination container
// Muni Filters
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
        // Ensure parsing assumes UTC to avoid timezone issues with date-only strings
        const date = new Date(dateString + 'T00:00:00Z');
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        console.error("Error parsing date:", dateString, e);
        return null;
    }
}

/** Safely parses a string value into a float, handling potential nulls/undefined/empty strings. */
function parseFloatSafe(value) {
    if (value === null || value === undefined || value === '') {
        return null; // Return null for non-numeric inputs
    }
    // Attempt to parse the value (which might be a string representation of a number)
    const parsed = parseFloat(String(value).replace(/,/g, '')); // Remove commas before parsing
    // Return the parsed number if valid, otherwise null
    return isNaN(parsed) ? null : parsed;
}


/** Generates an array of distinct HSL colors. */
function generateDistinctColors(count) {
    const colors = [];
    if (count <= 0) return colors;
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        // Use slightly different saturation/lightness for better visibility in both themes
        colors.push(`hsl(${i * hueStep}, 75%, 65%)`);
    }
    return colors;
}

/** Displays a status message (success or error) in a specified status area. */
function showStatusMessageGeneric(statusElement, message, isError = false, duration = 5000) {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.className = 'status-message'; // Reset classes
    if (isError) {
        statusElement.classList.add('error');
    } else {
        statusElement.classList.add('success');
    }
    statusElement.style.display = 'block'; // Make it visible

    // Clear message after duration (if duration > 0)
    if (duration > 0) {
        setTimeout(() => {
            // Only clear if the message hasn't been changed in the meantime
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
        const type = th.dataset.type || 'string'; // Default to string if type is missing
        const text = th.textContent.replace('▲', '').replace('▼', '').trim(); // Clean header text
        if (key) { // Only add if data-key exists
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

    // Build the inner HTML for the filter row
    filterRow.innerHTML = `
        <label for="filter-column-${filterId}">Filter Holdings:</label>
        <select class="filter-column" id="filter-column-${filterId}">${columnOptionsHtml}</select>
        <select class="filter-operator" id="filter-operator-${filterId}"></select>
        <input type="text" class="filter-value" id="filter-value-${filterId}" placeholder="Value...">
        <button class="remove-filter-btn btn-danger" title="Remove this filter">X</button>
    `;

    filtersContainer.appendChild(filterRow);

    // Get references to the new elements
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');
    const removeBtn = filterRow.querySelector('.remove-filter-btn');

    // Attach generic event handlers (will delegate to specific handlers later)
    columnSelect.addEventListener('change', handleFilterDropdownChange);
    operatorSelect.addEventListener('change', handleFilterDropdownChange);
    valueInput.addEventListener('input', handleFilterValueChange); // Use input for real-time filtering
    removeBtn.addEventListener('click', handleRemoveFilter);

    // Create the initial state object for this filter
    const newFilter = {
        id: filterId,
        column: initialFilter?.column || columnSelect.value,
        operator: initialFilter?.operator, // Will be set by updateOperatorOptionsForRow
        value: initialFilter?.value || '',
        type: initialFilter?.type || columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    activeFilters.push(newFilter);

    // Apply initial values if provided
    if (initialFilter) {
        columnSelect.value = initialFilter.column;
        valueInput.value = initialFilter.value;
    }

    // Populate operator options based on the selected column type
    updateOperatorOptionsForRow(filterRow, newFilter.operator); // Pass preferred operator if any

    // Trigger update if an initial value was set (applies filters and fetches page 1)
    if (newFilter.value) {
        applyHoldingsFiltersAndFetchPage(1);
    }
}

/** Updates the operator dropdown options based on the selected column's data type. */
function updateOperatorOptionsForRow(filterRow, preferredOperator = null) {
    const columnSelect = filterRow.querySelector('.filter-column, .muni-filter-column'); // Works for both types
    const operatorSelect = filterRow.querySelector('.filter-operator, .muni-filter-operator');
    const valueInput = filterRow.querySelector('.filter-value, .muni-filter-value');

    // Ensure elements exist before proceeding
    if (!columnSelect || !operatorSelect || !valueInput) {
        console.warn("updateOperatorOptionsForRow: Missing elements in filter row:", filterRow);
        return;
    }

    // FIX: Check if columnSelect or its options exist before proceeding
    if (!columnSelect.options || columnSelect.options.length === 0) {
        console.warn("updateOperatorOptionsForRow called before column options were ready for:", filterRow);
        return; // Exit if options aren't ready
    }

    const selectedOption = columnSelect.options[columnSelect.selectedIndex];
    const columnType = selectedOption ? selectedOption.dataset.type : 'string'; // Default to string

    // Define operators for each type
    const numberOperators = ['=', '!=', '>', '<', '>=', '<='];
    const stringOperators = ['contains', '=', '!=', 'startsWith', 'endsWith'];
    const dateOperators = ['=', '!=', '>', '<', '>=', '<=']; // Use ISO date format for comparison

    let availableOperators;
    let defaultOperator;

    // Set operators and input type based on column type
    switch (columnType) {
        case 'number':
            availableOperators = numberOperators;
            valueInput.type = 'number';
            valueInput.step = 'any'; // Allow decimals
            defaultOperator = '=';
            break;
        case 'date':
            availableOperators = dateOperators;
            valueInput.type = 'date'; // Use HTML5 date picker
            valueInput.step = '';
            defaultOperator = '=';
            break;
        case 'string':
        default: // Treat any other type as string
            availableOperators = stringOperators;
            valueInput.type = 'text';
            valueInput.step = '';
            defaultOperator = 'contains';
            break;
    }

    // Preserve current selection if valid, otherwise use preferred or default
    const currentOperatorValue = operatorSelect.value;
    operatorSelect.innerHTML = ''; // Clear existing options
    availableOperators.forEach(op => {
        const option = document.createElement('option');
        option.value = op;
        // Use symbols for better display
        option.textContent = op.replace('>=', '≥').replace('<=', '≤').replace('!=', '≠');
        operatorSelect.appendChild(option);
    });

    // Set the selected operator
    if (preferredOperator && availableOperators.includes(preferredOperator)) {
        operatorSelect.value = preferredOperator;
    } else if (availableOperators.includes(currentOperatorValue)) {
        operatorSelect.value = currentOperatorValue; // Keep current if still valid
    } else {
        operatorSelect.value = defaultOperator; // Fallback to default
    }

    // Update the filter state immediately after changing operators
    if (filterRow.dataset.filterId) { // Check if it's a holdings filter
        updateFilterState(filterRow);
    } else if (filterRow.dataset.muniFilterId) { // Check if it's a muni filter
        updateMuniFilterState(filterRow);
    }
}

/** Updates the state object for a specific HOLDINGS filter row. */
function updateFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.filterId, 10);
    const filterIndex = activeFilters.findIndex(f => f.id === filterId);
    if (filterIndex === -1) return false; // Filter not found in state

    // Get current values from the UI elements
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');

    // Update the corresponding object in the activeFilters array
    activeFilters[filterIndex] = {
        id: filterId,
        column: columnSelect.value,
        operator: operatorSelect.value,
        value: valueInput.value.trim(), // Trim whitespace from value
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    // console.log("Updated holdings filter state:", activeFilters[filterIndex]); // Keep commented unless debugging
    return true; // Indicate state was updated
}

/** Event handler for changes in filter column or operator dropdowns (HOLDINGS). */
function handleFilterDropdownChange(event) {
    const filterRow = event.target.closest('.filter-row');
    // Ensure the event originated from a holdings filter row
    if (!filterRow || !filtersContainer.contains(filterRow)) return;

    // If the column changed, update the available operators
    if (event.target.classList.contains('filter-column')) {
        updateOperatorOptionsForRow(filterRow);
    }

    // Update the filter state and trigger fetch of page 1 with new filters
    if (updateFilterState(filterRow)) {
        applyHoldingsFiltersAndFetchPage(1); // Fetch page 1 with current filters/sort
    }
}

/** Event handler for changes in the filter value input field (HOLDINGS). */
function handleFilterValueChange(event) {
    const filterRow = event.target.closest('.filter-row');
    // Ensure the event originated from a holdings filter row
    if (!filterRow || !filtersContainer.contains(filterRow)) return;

    // Update the filter state and trigger fetch of page 1 with new filters
    if (updateFilterState(filterRow)) {
        applyHoldingsFiltersAndFetchPage(1); // Fetch page 1 with current filters/sort
    }
}

/** Event handler for removing a filter row (HOLDINGS). */
function handleRemoveFilter(event) {
    const filterRow = event.target.closest('.filter-row');
    // Ensure the event originated from a holdings filter row
    if (!filterRow || !filtersContainer.contains(filterRow)) return;

    // --- MODIFICATION START: Prevent removing the last filter ---
    const currentFilterRows = filtersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) {
        console.log("Cannot remove the last holdings filter.");
        // Optionally, provide user feedback (e.g., flash the button)
        return; // Stop the function here
    }
    // --- MODIFICATION END ---

    // Remove the filter from the state array
    const filterIdToRemove = parseInt(filterRow.dataset.filterId, 10);
    activeFilters = activeFilters.filter(f => f.id !== filterIdToRemove);

    // Remove the filter row from the DOM
    filterRow.remove();

    // Trigger fetch of page 1 with remaining filters
    applyHoldingsFiltersAndFetchPage(1);
}

/** Clears all active filters and resets the filter UI (HOLDINGS). */
function handleClearAllFilters() {
    activeFilters = []; // Clear state
    filtersContainer.innerHTML = ''; // Clear UI
    addFilterRow(); // Add back one default filter row
    // Trigger fetch of page 1 with no filters
    applyHoldingsFiltersAndFetchPage(1);
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
    if (!muniFiltersContainer) return; // Ensure container exists

    const filterId = nextMuniFilterId++;
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row'; // Reuse same class for styling
    filterRow.dataset.muniFilterId = filterId; // Use specific dataset attribute

    filterRow.innerHTML = `
        <label for="muni-filter-column-${filterId}">Filter Offerings:</label>
        <select class="muni-filter-column" id="muni-filter-column-${filterId}">${muniColumnOptionsHtml}</select>
        <select class="muni-filter-operator" id="muni-filter-operator-${filterId}"></select>
        <input type="text" class="muni-filter-value" id="muni-filter-value-${filterId}" placeholder="Value...">
        <button class="remove-muni-filter-btn btn-danger" title="Remove this filter">X</button>
    `;

    muniFiltersContainer.appendChild(filterRow);

    // Get references to the new elements
    const columnSelect = filterRow.querySelector('.muni-filter-column');
    const operatorSelect = filterRow.querySelector('.muni-filter-operator');
    const valueInput = filterRow.querySelector('.muni-filter-value');
    const removeBtn = filterRow.querySelector('.remove-muni-filter-btn');

    // Attach muni-specific event handlers
    columnSelect.addEventListener('change', handleMuniFilterDropdownChange);
    operatorSelect.addEventListener('change', handleMuniFilterDropdownChange);
    valueInput.addEventListener('input', handleMuniFilterValueChange);
    removeBtn.addEventListener('click', handleRemoveMuniFilter);

    // Create the initial state object for this muni filter
    const newFilter = {
        id: filterId,
        column: initialFilter?.column || columnSelect.value,
        operator: initialFilter?.operator,
        value: initialFilter?.value || '',
        type: initialFilter?.type || columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    activeMuniFilters.push(newFilter);

    // Apply initial values if provided
    if (initialFilter) {
        columnSelect.value = initialFilter.column;
        valueInput.value = initialFilter.value;
    }

    // Populate operator options based on the selected column type (reuse generic function)
    updateOperatorOptionsForRow(filterRow, newFilter.operator);

    // Trigger update if an initial value was set (fetches page 1)
    if (newFilter.value) {
        applyMuniFiltersAndFetchPage(1);
    }
}

/** Updates the state object for a specific MUNI filter row. */
function updateMuniFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.muniFilterId, 10);
    const filterIndex = activeMuniFilters.findIndex(f => f.id === filterId);
    if (filterIndex === -1) return false; // Filter not found

    // Get current values from the UI elements
    const columnSelect = filterRow.querySelector('.muni-filter-column');
    const operatorSelect = filterRow.querySelector('.muni-filter-operator');
    const valueInput = filterRow.querySelector('.muni-filter-value');

    // Update the corresponding object in the activeMuniFilters array
    activeMuniFilters[filterIndex] = {
        id: filterId,
        column: columnSelect.value,
        operator: operatorSelect.value,
        value: valueInput.value.trim(),
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    // console.log("Updated muni filter state:", activeMuniFilters[filterIndex]); // Keep commented unless debugging
    return true; // Indicate state was updated
}

/** Event handler for changes in filter column or operator dropdowns (MUNI). */
function handleMuniFilterDropdownChange(event) {
    const filterRow = event.target.closest('.filter-row');
    // Ensure the event originated from a muni filter row
    if (!filterRow || !muniFiltersContainer.contains(filterRow)) return;

    // If the column changed, update the available operators
    if (event.target.classList.contains('muni-filter-column')) {
        updateOperatorOptionsForRow(filterRow);
    }

    // Update the muni filter state and trigger fetch of page 1
    if (updateMuniFilterState(filterRow)) {
        applyMuniFiltersAndFetchPage(1);
    }
}

/** Event handler for changes in the filter value input field (MUNI). */
function handleMuniFilterValueChange(event) {
    const filterRow = event.target.closest('.filter-row');
    // Ensure the event originated from a muni filter row
    if (!filterRow || !muniFiltersContainer.contains(filterRow)) return;

    // Update the muni filter state and trigger fetch of page 1
    if (updateMuniFilterState(filterRow)) {
        applyMuniFiltersAndFetchPage(1);
    }
}

/** Event handler for removing a filter row (MUNI). */
function handleRemoveMuniFilter(event) {
    const filterRow = event.target.closest('.filter-row');
    // Ensure the event originated from a muni filter row
    if (!filterRow || !muniFiltersContainer.contains(filterRow)) return;

    // --- MODIFICATION START: Prevent removing the last filter ---
    const currentFilterRows = muniFiltersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) {
         console.log("Cannot remove the last muni filter.");
        // Optionally, provide user feedback
        return; // Stop the function here
    }
    // --- MODIFICATION END ---

    // Remove the filter from the state array
    const filterIdToRemove = parseInt(filterRow.dataset.muniFilterId, 10);
    activeMuniFilters = activeMuniFilters.filter(f => f.id !== filterIdToRemove);

    // Remove the filter row from the DOM
    filterRow.remove();

    // Trigger fetch of page 1
    applyMuniFiltersAndFetchPage(1);
}

/** Clears all active filters and resets the filter UI (MUNI). */
function handleClearAllMuniFilters() {
    activeMuniFilters = []; // Clear state
    if (muniFiltersContainer) {
        muniFiltersContainer.innerHTML = ''; // Clear UI
        addMuniFilterRow(); // Add back one default filter row
        applyMuniFiltersAndFetchPage(1); // Fetch page 1 with no filters
    }
}


// --- Data Fetching and Processing ---

/** Fetches the list of customers accessible to the current user (now paginated). */
async function loadCustomers(page = 1) {
    console.log(`Attempting to load customers (page ${page})...`);
    try {
        // NOTE: Customer list is unlikely to be huge, but handle pagination just in case
        const res = await fetch(`${apiRoot}/customers/?page=${page}`);
        console.log("Load customers response status:", res.status);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        const data = await res.json(); // Expect paginated response { count, next, previous, results }
        customers = data.results || []; // Store fetched customers for the current page (or all if not paginated)
        console.log("Customers loaded:", customers.length, "Total:", data.count);

        // Populate the main customer dropdown (only needs to happen once, ideally)
        // For simplicity, we'll populate with the first page's results.
        // A better approach might load ALL customers if the count is small,
        // or use a searchable dropdown for large counts.
        if (page === 1 && customerSelect.options.length <= 1) { // Populate only on first load
             customerSelect.innerHTML = customers.map(c =>
                // Use internal ID for value, display name and number
                `<option value="${c.id}">${c.name || 'Unnamed'} (${c.customer_number || 'No Number'})</option>`
            ).join('');
        }

        // Handle initial state based on fetched customers
        if (data.count > 0) {
            // If dropdown is populated, automatically select the first customer
             if (customerSelect.options.length > 0) {
                // Only trigger selection if it hasn't been done yet or customer changes
                if (selectedCustomerId !== customerSelect.value) {
                     await handleCustomerSelection();
                }
            }
        } else {
            // No customers available for this user
            portfolioNameEl.textContent = "No customers available for this user.";
            clearTableAndCharts();
            portfolioFilterContainer.classList.add('hidden'); // Hide portfolio dropdown
            const colSpan = (tableHeaders.length || 11) + 1; // Adjusted colspan
            tableBody.innerHTML = `<tr><td colspan="${colSpan}">No customers found.</td></tr>`;
            renderPaginationControls(holdingsPaginationControls, null); // Clear pagination
        }
    } catch (error) {
        console.error("Failed to load customers:", error);
        portfolioNameEl.textContent = "Error loading customers";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden');
        const colSpan = (tableHeaders.length || 11) + 1; // Adjusted colspan
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading customer list. Check console.</td></tr>`;
        renderPaginationControls(holdingsPaginationControls, null); // Clear pagination
    }
}

/** Handles the selection of a customer from the main dropdown. */
async function handleCustomerSelection() {
    const previousCustomerId = selectedCustomerId;
    selectedCustomerId = customerSelect.value; // Update global state

    // Only proceed if the customer ID actually changed
    if (selectedCustomerId === previousCustomerId) {
        return;
    }

    console.log(`Customer selected: ID ${selectedCustomerId}`);

    // Clear selections from previous customer/portfolio
    clearHoldingSelection();
    clearMuniOfferingSelection();

    if (!selectedCustomerId) {
        // Handle case where "-- Select Customer --" or similar is chosen
        portfolioNameEl.textContent = "Please select a customer.";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true;
        return;
    }

    // Find the selected customer object (might only have first page customers)
    // We might need to fetch the specific customer details if not in the initial 'customers' array
    let selectedCustomer = customers.find(c => c.id == selectedCustomerId);
    if (!selectedCustomer) {
        // If not found in the loaded list, fetch specifically (should be rare if dropdown is populated)
        console.warn(`Selected customer ID ${selectedCustomerId} not in initially loaded list. Fetching details...`);
        try {
            const res = await fetch(`${apiRoot}/customers/${selectedCustomerId}/`);
            if (!res.ok) throw new Error(`HTTP error fetching customer ${selectedCustomerId}! Status: ${res.status}`);
            selectedCustomer = await res.json();
        } catch (error) {
             console.error(`Failed to fetch details for customer ID ${selectedCustomerId}:`, error);
             portfolioNameEl.textContent = "Error: Selected customer details not found.";
             clearTableAndCharts();
             portfolioFilterContainer.classList.add('hidden');
             deletePortfolioBtn.disabled = true;
             return;
        }
    }

    const customerDisplayName = selectedCustomer.name || `Customer ${selectedCustomer.customer_number || 'N/A'}`;

    // Update UI and fetch portfolios for the selected customer
    portfolioNameEl.textContent = `Loading portfolios for ${customerDisplayName}...`;
    clearTableAndCharts(); // Clear previous data
    portfolioFilterContainer.classList.add('hidden'); // Hide portfolio dropdown until loaded
    deletePortfolioBtn.disabled = true; // Disable delete until a portfolio is selected

    await loadPortfolios(selectedCustomerId); // Fetch and display portfolios
}

/** Fetches portfolios for the selected customer (Portfolios list might also be paginated). */
async function loadPortfolios(customerId, page = 1) {
    console.log(`Attempting to load portfolios for customer ID: ${customerId} (page ${page})`);
    try {
        // Fetch portfolios filtered by owner ID (backend handles permission)
        // Add page parameter
        const res = await fetch(`${apiRoot}/portfolios/?owner=${customerId}&page=${page}`);
        console.log("Load portfolios response status:", res.status);
        if (!res.ok) throw new Error(`HTTP error fetching portfolios! status: ${res.status}`);

        const data = await res.json(); // Expect paginated response { count, next, previous, results }
        currentPortfolios = data.results || []; // Store portfolios for the current page
        console.log(`Portfolios loaded for customer ${customerId}:`, currentPortfolios.length, "Total:", data.count);

        portfolioFilterSelect.innerHTML = ''; // Clear previous options

        if (data.count > 0) {
             // Populate the portfolio dropdown with the fetched portfolios (current page)
            // If > 1 page, we might only show the first page initially.
            currentPortfolios.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name || `Portfolio ${p.id}`;
                option.dataset.isDefault = p.is_default || false; // Store default status
                portfolioFilterSelect.appendChild(option);
            });

            // TODO: Handle multiple pages of portfolios if necessary (e.g., add a "Load More" button or improve dropdown)
            if (data.next) {
                console.warn("Multiple pages of portfolios exist, but UI only shows first page.");
                // Optionally add a placeholder or indicator
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = `(${data.count - currentPortfolios.length} more...)`;
                portfolioFilterSelect.appendChild(option);
            }


            // Show the portfolio dropdown and trigger selection handler
            portfolioFilterContainer.classList.remove('hidden');
            await handlePortfolioSelection(); // Load holdings for the initially selected portfolio (will fetch page 1)
        } else {
            // No portfolios found for this customer
            const selectedCustomer = customers.find(c => c.id == customerId); // Assumes customer data is available
            const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || customerId}`;
            portfolioNameEl.textContent = `${customerDisplayName} - No Portfolios Found`;
            portfolioFilterContainer.classList.add('hidden'); // Keep dropdown hidden
            deletePortfolioBtn.disabled = true;
            clearTableAndCharts();
            const colSpan = (tableHeaders.length || 11) + 1; // Adjusted colspan
            tableBody.innerHTML = `<tr><td colspan="${colSpan}">No portfolios found for this customer.</td></tr>`;
            renderPaginationControls(holdingsPaginationControls, null); // Clear pagination
        }
    } catch (error) {
        console.error("Failed to load or process portfolios:", error);
        portfolioNameEl.textContent = "Error loading portfolios";
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true;
        clearTableAndCharts();
        const colSpan = (tableHeaders.length || 11) + 1; // Adjusted colspan
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading portfolio list. Check console.</td></tr>`;
        renderPaginationControls(holdingsPaginationControls, null); // Clear pagination
    }
}


/** Handles the selection of a portfolio from the dropdown, triggering holdings fetch for page 1. */
async function handlePortfolioSelection() {
    const selectedPortfolioId = portfolioFilterSelect.value;
    const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    const isDefaultPortfolio = selectedOption?.dataset?.isDefault === 'true';

    console.log(`Portfolio selected: ID '${selectedPortfolioId}' (Default: ${isDefaultPortfolio}), Customer ID: ${selectedCustomerId}`);

    // Clear selections from previous portfolio
    clearHoldingSelection();
    // Disable delete button if no portfolio is selected OR if it's the default one
    deletePortfolioBtn.disabled = (!selectedPortfolioId || isDefaultPortfolio);

    const selectedCustomer = customers.find(c => c.id == selectedCustomerId); // Assumes customer data available
    const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || selectedCustomerId}`;

    if (!selectedPortfolioId) {
        // Handle case where "-- Select Portfolio --" or similar is chosen
        console.log("No specific portfolio selected.");
        portfolioNameEl.textContent = `${customerDisplayName} - Select a Portfolio`;
        clearTableAndCharts();
        const colSpan = (tableHeaders.length || 11) + 1; // Adjusted colspan
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Please select a portfolio.</td></tr>`;
        renderPaginationControls(holdingsPaginationControls, null); // Clear pagination
        return;
    }

    // Find the portfolio name
    const selectedPortfolio = currentPortfolios.find(p => p.id == selectedPortfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${selectedPortfolioId}`;
    portfolioNameEl.textContent = `Loading ${portfolioDisplayName}...`; // Set loading title
    clearTableAndCharts(); // Clear previous data

    // Fetch the first page of holdings for the selected portfolio
    await fetchHoldings(selectedPortfolioId, 1);
}


/** Fetches a specific page of holdings for a given portfolio ID. */
async function fetchHoldings(portfolioId, page = 1) {
    const selectedPortfolio = currentPortfolios.find(p => p.id == portfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${portfolioId}`;
    console.log(`Fetching holdings page ${page} for portfolio ID: ${portfolioId}`);
    portfolioNameEl.textContent = `Loading ${portfolioDisplayName} (Page ${page})...`;

    // Construct API URL with portfolio filter and page parameter
    // Add sorting parameters
    const sortParam = `ordering=${currentSortDir === 'desc' ? '-' : ''}${currentSortKey}`;
    // Add filtering parameters (build query string from activeFilters)
    const filterParams = activeFilters
        .filter(f => f.value !== '') // Only include filters with values
        .map(f => `${f.column}__${f.operator}=${encodeURIComponent(f.value)}`) // Basic mapping, needs refinement based on backend filter names/operators
        .join('&');

    // TODO: Refine filterParams based on actual backend filter implementation (e.g., date ranges, numeric operators)
    // Example: Might need specific lookup expressions like `settlement_date__gte=`
    // For now, using a simple structure.

    const fetchUrl = `${apiRoot}/holdings/?portfolio=${portfolioId}&page=${page}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    console.log("Fetching holdings URL:", fetchUrl);

    try {
        const res = await fetch(fetchUrl);
        console.log(`Load holdings response status for portfolio '${portfolioDisplayName}' page ${page}:`, res.status);

        if (!res.ok) {
            // Handle different errors
            if (res.status === 404 && page > 1) {
                // Handle case where requested page doesn't exist (e.g., after deleting items)
                console.warn(`Page ${page} not found for portfolio ${portfolioId}. Fetching page 1 instead.`);
                await fetchHoldings(portfolioId, 1); // Go back to page 1
                return; // Stop processing this failed request
            } else {
                 // Handle other HTTP errors
                 let errorData = { detail: `HTTP error! status: ${res.status}` };
                 try { errorData = await res.json(); } catch (e) { /* ignore if response body is not JSON */ }
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }

        // Successfully fetched holdings data for the page
        const data = await res.json(); // Expect { count, next, previous, results }
        console.log(`Holdings page ${page} loaded for portfolio '${portfolioDisplayName}':`, data.results?.length, "Total:", data.count);

        // Update global state for holdings
        currentHoldingsData = {
            results: data.results || [],
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        };

        // Set final title
        portfolioNameEl.textContent = portfolioDisplayName;

        // Process and display the fetched holdings page
        processAndDisplayHoldings();
        // Render pagination controls based on the new state
        renderPaginationControls(holdingsPaginationControls, currentHoldingsData, 'holdings');

    } catch (error) {
        console.error("Failed to fetch or process holdings:", error);
        portfolioNameEl.textContent = `Error loading holdings for ${portfolioDisplayName}`;
        currentHoldingsData = { results: [], count: 0, nextUrl: null, previousUrl: null, currentPage: 1 }; // Reset state
        clearTableAndCharts(); // Clear UI elements
        const colSpan = (tableHeaders.length || 11) + 1; // Adjusted colspan
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading holdings. Check console.</td></tr>`;
        renderPaginationControls(holdingsPaginationControls, null); // Clear pagination
    }
}


/** Processes the raw holding data from the current page, adding calculated/parsed fields. */
function processAndDisplayHoldings() {
    console.log("Processing and displaying holdings page:", currentHoldingsData.results.length);
    const holdingsPage = currentHoldingsData.results; // Use data from the current page

    // Iterate through each holding on the current page
    holdingsPage.forEach(h => {
        // Ensure numeric fields are numbers or null, parsing from string if needed
        // Use the new field names from the updated serializer
        h.original_face_amount_num = parseFloatSafe(h.original_face_amount);
        h.settlement_price_num = parseFloatSafe(h.settlement_price);
        h.book_price_num = parseFloatSafe(h.book_price);
        h.book_yield_num = parseFloatSafe(h.book_yield);
        h.holding_duration_num = parseFloatSafe(h.holding_duration);
        h.holding_average_life_num = parseFloatSafe(h.holding_average_life);
        h.market_price_num = parseFloatSafe(h.market_price);
        h.market_yield_num = parseFloatSafe(h.market_yield);

        // Use the calculated par_value directly from the serializer (it's already calculated)
        // The serializer returns it as a string, so parse it for calculations if needed elsewhere
        h.par_value_num = parseFloatSafe(h.par_value);

        // Parse date strings into Date objects
        h.settlement_date_obj = parseDate(h.settlement_date);
        h.holding_average_life_date_obj = parseDate(h.holding_average_life_date);
        h.market_date_obj = parseDate(h.market_date);
        // Dates from the related Security model (assuming they are included or fetched separately if needed)
        // These might not be directly on the holding object unless the serializer includes them deeply
        // For now, assume basic dates are available if needed for display/sort
        // We rely on security_description, security_cusip which ARE included
        h.maturity_date_obj = parseDate(h.maturity_date); // Assuming maturity_date is passed through
        h.call_date_obj = parseDate(h.call_date); // Assuming call_date is passed through

        // Add ISO formatted date strings for potential export consistency
        h.maturity_date_str_iso = h.maturity_date_obj ? h.maturity_date_obj.toISOString().split('T')[0] : (h.maturity_date || '');
        h.call_date_str_iso = h.call_date_obj ? h.call_date_obj.toISOString().split('T')[0] : (h.call_date || '');
        h.settlement_date_str_iso = h.settlement_date_obj ? h.settlement_date_obj.toISOString().split('T')[0] : (h.settlement_date || '');

        // Add derived fields needed for sorting/filtering/display if not directly available
        // Example: Extract coupon from security if needed (assuming security details might be nested or fetched)
        // h.coupon_num = parseFloatSafe(h.security?.coupon); // Example if security details were nested

        // For charts/exports, we need the full filtered dataset, not just the current page.
        // We'll handle filtering client-side for charts/exports for now.
        // TODO: Re-evaluate if server-side filtering should provide the full dataset for exports.
    });

    // Render the table with the current page's processed data
    renderTable(holdingsPage);
    // Calculate totals based ONLY on the current page's data for display consistency
    renderTotals(holdingsPage);
    // Update sort indicators
    updateSortIndicators();

    // --- Client-Side Filtering for Charts/Exports ---
    // Apply active client-side filters to the current page's data
    const clientFiltersToApply = activeFilters.filter(f => f.value !== null && f.value !== '');
    if (clientFiltersToApply.length > 0) {
        // Filter the current page data
        filteredHoldings = holdingsPage.filter(holding =>
            clientFiltersToApply.every(filter => checkFilter(holding, filter))
        );
    } else {
        // No active filters, use the current page data
        filteredHoldings = [...holdingsPage];
    }
    // Sort the client-side filtered data (redundant if server sorting works, but safe)
    sortDataGeneric(filteredHoldings, currentSortKey, currentSortDir, getHoldingSortValue);

    // Render charts based on the client-side filtered data (from the current page)
    renderCharts(filteredHoldings);
}


// --- Muni Offerings Fetching and Rendering (Paginated) ---

/** Fetches a specific page of municipal offerings data from the API. */
async function loadMuniOfferings(page = 1) {
    console.log(`Attempting to load municipal offerings (page ${page})...`);
    if (!muniOfferingsTableBody) {
        console.warn("Muni offerings table body not found. Skipping load.");
        return;
    }

    // Display loading message
    const colSpan = (muniTableHeaders.length || 14); // Calculate colspan
    muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading offerings (Page ${page})...</td></tr>`;

    // Build filter query parameters
    const filterParams = activeMuniFilters
        .filter(f => f.value !== '')
        .map(f => `${f.column}__${f.operator}=${encodeURIComponent(f.value)}`) // Basic mapping
        .join('&');
    // Build sort query parameters
    const sortParam = `ordering=${currentMuniSortDir === 'desc' ? '-' : ''}${currentMuniSortKey}`;

    const fetchUrl = `${apiRoot}/muni-offerings/?page=${page}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    console.log("Fetching Muni Offerings URL:", fetchUrl);

    try {
        const response = await fetch(fetchUrl);
        console.log("Load muni offerings response status:", response.status);
        if (!response.ok) {
             // Handle different errors
            if (response.status === 404 && page > 1) {
                console.warn(`Page ${page} not found for muni offerings. Fetching page 1 instead.`);
                await loadMuniOfferings(1); // Go back to page 1
                return;
            } else {
                 let errorData = { detail: `HTTP error! status: ${response.status}` };
                 try { errorData = await response.json(); } catch (e) { /* ignore */ }
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }

        const data = await response.json(); // Expect { count, next, previous, results }
        console.log(`Muni offerings page ${page} loaded:`, data.results?.length, "Total:", data.count);

        // Update global state for muni offerings
        currentMuniOfferingsData = {
            results: data.results || [],
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        };

        // Process and render the current page of offerings
        processAndDisplayMuniOfferings();
        // Render pagination controls
        renderPaginationControls(muniPaginationControls, currentMuniOfferingsData, 'munis');
        // Update sort indicators
        updateMuniSortIndicators();

    } catch (error) {
        console.error("Failed to load municipal offerings:", error);
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading offerings. Check console.</td></tr>`;
        currentMuniOfferingsData = { results: [], count: 0, nextUrl: null, previousUrl: null, currentPage: 1 }; // Reset state
        renderPaginationControls(muniPaginationControls, null); // Clear pagination
    }
}

/** Processes and renders the current page of muni offerings. */
function processAndDisplayMuniOfferings() {
    const offeringsPage = currentMuniOfferingsData.results;
    console.log("Processing and displaying muni offerings page:", offeringsPage.length);

    // Process raw data: parse numbers and dates
    const processedOfferings = offeringsPage.map(offering => ({
        ...offering,
        // Parse numeric fields safely (expecting strings due to coerce_to_string=True)
        amount_num: parseFloatSafe(offering.amount),
        coupon_num: parseFloatSafe(offering.coupon),
        yield_rate_num: parseFloatSafe(offering.yield_rate),
        price_num: parseFloatSafe(offering.price),
        call_price_num: parseFloatSafe(offering.call_price),
        // Parse date fields into Date objects
        maturity_date_obj: parseDate(offering.maturity_date),
        call_date_obj: parseDate(offering.call_date),
        // Keep original string dates as fallback for display
        maturity_date_str: offering.maturity_date,
        call_date_str: offering.call_date,
    }));

    // Render the processed data for the current page
    renderMuniOfferingsTable(processedOfferings);

    // Client-side filtering (if needed for other features, though not currently used)
    const clientFiltersToApply = activeMuniFilters.filter(f => f.value !== null && f.value !== '');
    if (clientFiltersToApply.length > 0) {
        filteredMuniOfferings = processedOfferings.filter(offering =>
            clientFiltersToApply.every(filter => checkMuniFilter(offering, filter))
        );
    } else {
        filteredMuniOfferings = [...processedOfferings];
    }
    // Sort client-side data (redundant if server sort works)
    sortDataGeneric(filteredMuniOfferings, currentMuniSortKey, currentMuniSortDir, getMuniOfferingSortValue);
}


/** Renders the municipal offerings data into the HTML table. */
function renderMuniOfferingsTable(offeringsData) {
    if (!muniOfferingsTableBody) return; // Safety check
    muniOfferingsTableBody.innerHTML = ''; // Clear previous content

    const colSpan = (muniTableHeaders.length || 14);

    if (!offeringsData || offeringsData.length === 0) {
        // Display message if no offerings match filters or none exist
        const message = activeMuniFilters.some(f => f.value !== '') ? 'No offerings match filter criteria.' : (currentMuniOfferingsData.count === 0 ? 'No municipal offerings available.' : 'No offerings on this page.');
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">${message}</td></tr>`;
        // Reset select-all checkbox and disable buy button
        if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
        if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; }
        return;
    }

    // Create table rows for each offering
    offeringsData.forEach(o => {
        const row = document.createElement('tr');
        row.dataset.offeringId = o.id; // Store ID for selection

        // Checkbox cell
        const isChecked = selectedMuniOfferingIds.has(o.id);
        const checkboxCell = document.createElement('td');
        checkboxCell.className = 'checkbox-column';
        checkboxCell.innerHTML = `<input type="checkbox" class="muni-checkbox" data-offering-id="${o.id}" data-cusip="${o.cusip || ''}" data-amount="${(o.amount_num ?? 0).toFixed(2)}" ${isChecked ? 'checked' : ''} aria-label="Select offering ${o.cusip || 'N/A'}">`;
        row.appendChild(checkboxCell);

        // Helper function to add a table cell with content and optional alignment
        const addCell = (content, align = 'left') => {
            const cell = document.createElement('td');
            // Display 'N/A' for null or undefined values
            cell.textContent = (content !== null && content !== undefined && content !== '') ? content : 'N/A';
            cell.style.textAlign = align;
            row.appendChild(cell);
        };

        // Add cells for each data point, formatting as needed
        addCell(o.cusip, 'left');
        addCell(o.amount_num?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? 'N/A', 'right');
        addCell(o.description, 'left');
        addCell(o.coupon_num?.toFixed(3) ?? 'N/A', 'right');
        addCell(o.maturity_date_obj?.toLocaleDateString() ?? o.maturity_date_str, 'center'); // Display formatted date or original string
        addCell(o.yield_rate_num?.toFixed(3) ?? 'N/A', 'right');
        addCell(o.price_num?.toFixed(2) ?? 'N/A', 'right');
        addCell(o.moody_rating || 'N/A', 'left');
        addCell(o.sp_rating || 'N/A', 'left');
        addCell(o.call_date_obj?.toLocaleDateString() ?? o.call_date_str, 'center'); // Display formatted date or original string
        addCell(o.call_price_num?.toFixed(2) ?? 'N/A', 'right');
        addCell(o.state || 'N/A', 'left');
        addCell(o.insurance || 'N/A', 'left');

        muniOfferingsTableBody.appendChild(row);
    });

    // Update the state of the "Select All" checkbox and the "Buy" button
    updateSelectAllMunisCheckboxState();
    emailBuyInterestBtn.disabled = selectedMuniOfferingIds.size === 0;
}


// --- Filtering and Sorting Logic ---

/** Checks if a single HOLDING matches a given filter criteria (Client-Side). */
function checkFilter(holding, filter) {
    // If filter value is empty, the holding passes this filter
    if (!filter || filter.value === null || filter.value === '') return true;

    // Get the holding's value for the specified column
    // Use the processed values (e.g., _num, _obj) for comparison
    const holdingValue = getHoldingSortValue(holding, filter.column); // Use the sort value getter
    let filterValue = filter.value; // Raw filter value from input

    // If the holding doesn't have a value for this column, it fails the filter
    if (holdingValue === null || holdingValue === undefined) return false;

    try {
        let compareHolding = holdingValue;
        let compareFilter = filterValue;

        // Perform comparison based on data type
        if (filter.type === 'string') {
            // Case-insensitive string comparison
            compareHolding = String(holdingValue).toLowerCase();
            compareFilter = String(filterValue).toLowerCase();
            switch (filter.operator) {
                case 'contains': return compareHolding.includes(compareFilter);
                case 'startsWith': return compareHolding.startsWith(compareFilter);
                case 'endsWith': return compareHolding.endsWith(compareFilter);
                case '=': return compareHolding === compareFilter;
                case '!=': return compareHolding !== compareFilter;
                default: console.warn(`Unknown string operator: ${filter.operator}`); return false;
            }
        } else if (filter.type === 'number') {
            // Numeric comparison - use the _num values
            compareHolding = holdingValue; // Already a number or null from getHoldingSortValue
            compareFilter = parseFloatSafe(filterValue); // Parse filter value
            // If either value is not a valid number, filter fails
            if (compareHolding === null || compareFilter === null) return false;
            switch (filter.operator) {
                case '=': return compareHolding === compareFilter;
                case '!=': return compareHolding !== compareFilter;
                case '>': return compareHolding > compareFilter;
                case '<': return compareHolding < compareFilter;
                case '>=': return compareHolding >= compareFilter;
                case '<=': return compareHolding <= compareFilter;
                default: console.warn(`Unknown number operator: ${filter.operator}`); return false;
            }
        } else if (filter.type === 'date') {
            // Date comparison using timestamps (requires valid Date objects)
            // holdingValue should already be a Date object from getHoldingSortValue
            compareHolding = holdingValue instanceof Date ? holdingValue.getTime() : null;
            // Parse the filter value string into a Date object's timestamp
            compareFilter = parseDate(filterValue)?.getTime(); // parseDate handles YYYY-MM-DD
            // If either date is invalid, filter fails
            if (compareHolding === null || compareFilter === null) return false;
            switch (filter.operator) {
                case '=': return compareHolding === compareFilter;
                case '!=': return compareHolding !== compareFilter;
                case '>': return compareHolding > compareFilter; // Holding date is after filter date
                case '<': return compareHolding < compareFilter; // Holding date is before filter date
                case '>=': return compareHolding >= compareFilter;
                case '<=': return compareHolding <= compareFilter;
                default: console.warn(`Unknown date operator: ${filter.operator}`); return false;
            }
        }
    } catch (e) {
        console.error("Error during filter comparison:", e, { holdingValue, filter });
        return false; // Filter fails on error
    }
    return false; // Should not be reached if operators are handled
}

/** Checks if a single MUNI OFFERING matches a given filter criteria (Client-Side). */
function checkMuniFilter(offering, filter) {
    // If filter value is empty, the offering passes this filter
    if (!filter || filter.value === null || filter.value === '') return true;

    // Get the offering's value for the specified column
    const offeringValue = getMuniOfferingSortValue(offering, filter.column); // Use processed _num/_obj
    let filterValue = filter.value; // Raw filter value from input

    // If the offering doesn't have a value for this column, it fails the filter
    if (offeringValue === null || offeringValue === undefined) return false;

    try {
        let compareOffering = offeringValue;
        let compareFilter = filterValue;

        // Perform comparison based on data type
        if (filter.type === 'string') {
            // Case-insensitive string comparison
            compareOffering = String(offeringValue).toLowerCase();
            compareFilter = String(filterValue).toLowerCase();
            switch (filter.operator) {
                case 'contains': return compareOffering.includes(compareFilter);
                case 'startsWith': return compareOffering.startsWith(compareFilter);
                case 'endsWith': return compareOffering.endsWith(compareFilter);
                case '=': return compareOffering === compareFilter;
                case '!=': return compareOffering !== compareFilter;
                default: console.warn(`Unknown string operator: ${filter.operator}`); return false;
            }
        } else if (filter.type === 'number') {
            // Numeric comparison
            compareOffering = offeringValue; // Already parsed to _num
            compareFilter = parseFloatSafe(filterValue);
            if (compareOffering === null || compareFilter === null) return false;
            switch (filter.operator) {
                case '=': return compareOffering === compareFilter;
                case '!=': return compareOffering !== compareFilter;
                case '>': return compareOffering > compareFilter;
                case '<': return compareOffering < compareFilter;
                case '>=': return compareOffering >= compareFilter;
                case '<=': return compareOffering <= compareFilter;
                default: console.warn(`Unknown number operator: ${filter.operator}`); return false;
            }
        } else if (filter.type === 'date') {
            // Date comparison using timestamps
            compareOffering = offeringValue instanceof Date ? offeringValue.getTime() : null;
            compareFilter = parseDate(filterValue)?.getTime();
            if (compareOffering === null || compareFilter === null) return false;
            switch (filter.operator) {
                case '=': return compareOffering === compareFilter;
                case '!=': return compareOffering !== compareFilter;
                case '>': return compareOffering > compareFilter;
                case '<': return compareOffering < compareFilter;
                case '>=': return compareOffering >= compareFilter;
                case '<=': return compareOffering <= compareFilter;
                default: console.warn(`Unknown date operator: ${filter.operator}`); return false;
            }
        }
    } catch (e) {
        console.error("Error during muni filter comparison:", e, { offeringValue, filter });
        return false; // Filter fails on error
    }
    return false; // Default fail
}


/** Sorts an array of data (holdings or offerings) based on a key and direction (Client-Side). */
function sortDataGeneric(data, key, direction, getSortValueFunc) {
    data.sort((a, b) => {
        // Get the values to compare using the provided getter function
        let valA = getSortValueFunc(a, key);
        let valB = getSortValueFunc(b, key);

        // Define sort order for null/undefined values (push them to the end/start based on direction)
        const nullOrder = direction === 'asc' ? 1 : -1; // 1 pushes nulls down in asc, -1 pushes them up in desc

        // Handle null/undefined comparisons
        if (valA === null || valA === undefined) {
            return (valB === null || valB === undefined) ? 0 : nullOrder; // If both null, equal; else A is greater/lesser
        }
        if (valB === null || valB === undefined) {
            return -nullOrder; // B is null, so A is lesser/greater
        }

        // Perform comparison based on type
        let comparison = 0;
        if (valA instanceof Date && valB instanceof Date) {
            comparison = valA.getTime() - valB.getTime(); // Compare timestamps
        } else if (typeof valA === 'number' && typeof valB === 'number') {
            comparison = valA - valB; // Simple numeric comparison
        } else {
            // Default to case-insensitive string comparison
            valA = String(valA).toUpperCase();
            valB = String(valB).toUpperCase();
            if (valA < valB) comparison = -1;
            else if (valA > valB) comparison = 1;
        }

        // Apply sort direction
        return direction === 'desc' ? (comparison * -1) : comparison;
    });
}

/** Retrieves the appropriate value from a HOLDING object for sorting/filtering. */
function getHoldingSortValue(holding, key) {
    // Use the processed values (_num, _obj) where available
    switch (key) {
        case 'external_ticket': return holding.external_ticket; // Already number
        case 'par_value': return holding.par_value_num; // Use parsed number
        case 'settlement_price': return holding.settlement_price_num;
        case 'coupon': return parseFloatSafe(holding.coupon); // Assuming coupon comes from security, might not be parsed yet
        case 'book_yield': return holding.book_yield_num;
        case 'holding_average_life': return holding.holding_average_life_num;
        case 'maturity_date': return holding.maturity_date_obj; // Use Date object
        case 'call_date': return holding.call_date_obj; // Use Date object
        case 'security_cusip': return holding.security_cusip; // Direct property access
        case 'security_description': return holding.security_description;
        // Add other cases if needed
        default:
            // Default: try returning the property directly, parse if necessary
            const directValue = holding[key];
            if (typeof directValue === 'string') {
                // Attempt to parse if it looks numeric, otherwise return string
                const parsed = parseFloatSafe(directValue);
                return parsed !== null ? parsed : directValue;
            }
            return directValue; // Return numbers, booleans, etc. directly
    }
}

/** Retrieves the appropriate value from a MUNI OFFERING object for sorting/filtering. */
function getMuniOfferingSortValue(offering, key) {
    // Use the processed _num/_obj values
    switch (key) {
        case 'amount': return offering.amount_num;
        case 'coupon': return offering.coupon_num;
        case 'yield_rate': return offering.yield_rate_num;
        case 'price': return offering.price_num;
        case 'call_price': return offering.call_price_num;
        case 'maturity_date': return offering.maturity_date_obj; // Use Date object
        case 'call_date': return offering.call_date_obj; // Use Date object
        // Direct access for string fields
        case 'cusip': return offering.cusip;
        case 'description': return offering.description;
        case 'moody_rating': return offering.moody_rating;
        case 'sp_rating': return offering.sp_rating;
        case 'state': return offering.state;
        case 'insurance': return offering.insurance;
        default:
            // Default: return the property directly
            return offering[key];
    }
}

// --- UI Rendering ---

/** Renders the holdings data for the current page into the HTML table body. */
function renderTable(holdingsPage) {
    // console.log("Rendering holdings table with page data:", holdingsPage.length); // Keep commented unless debugging
    const colSpan = (tableHeaders.length || 11) + 1; // Dynamic colspan based on new header count

    if (!tableBody) {
        console.error("Holdings table body not found!");
        return;
    }

    // Handle empty state for the current page
    if (!holdingsPage || holdingsPage.length === 0) {
        const hasActiveFilters = activeFilters.some(f => f.value !== '');
        const noDataMessage = hasActiveFilters ? 'No holdings match filter criteria.' : (currentHoldingsData.count === 0 ? 'No holdings to display.' : 'No holdings on this page.');
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">${noDataMessage}</td></tr>`;
        // Reset select-all checkbox and disable email button
        if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
        if (emailInterestBtn) { emailInterestBtn.disabled = true; }
        return;
    }

    // Generate HTML for each holding row on the current page
    tableBody.innerHTML = holdingsPage.map(h => {
        // Format values for display using processed fields (_num, _obj)
        const maturityDisplay = h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : (h.maturity_date || 'N/A');
        const callDisplay = h.call_date_obj ? h.call_date_obj.toLocaleDateString() : (h.call_date || 'N/A');
        const parDisplay = (h.par_value_num ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const priceDisplay = (h.settlement_price_num ?? 0).toFixed(6); // Increased precision display
        const couponDisplay = (parseFloatSafe(h.coupon) ?? 0).toFixed(3); // Assuming coupon comes from security
        const bookYieldDisplay = (h.book_yield_num ?? 0).toFixed(3);
        const avgLifeDisplay = (h.holding_average_life_num ?? 0).toFixed(2);
        const isChecked = selectedHoldingIds.has(h.ticket_id); // Use internal ticket_id for selection tracking

        // Return the HTML string for the table row
        return `
            <tr data-holding-id="${h.ticket_id}">
                <td class="checkbox-column">
                    <input type="checkbox" class="holding-checkbox" data-holding-id="${h.ticket_id}" data-cusip="${h.security_cusip || ''}" data-par="${(h.par_value_num ?? 0).toFixed(2)}" ${isChecked ? 'checked' : ''} aria-label="Select holding ${h.security_cusip || 'N/A'}">
                </td>
                <td>${h.security_cusip || 'N/A'}</td>
                <td>${h.external_ticket ?? 'N/A'}</td>
                <td>${h.security_description || ''}</td>
                <td>${parDisplay}</td>
                <td>${priceDisplay}</td>
                <td>${couponDisplay}</td>
                <td>${bookYieldDisplay}</td>
                <td>${avgLifeDisplay}</td>
                <td>${maturityDisplay}</td>
                <td>${callDisplay}</td>
            </tr>`;
    }).join(''); // Join all row strings into one HTML block

    // Update the "Select All" checkbox state and email button
    updateSelectAllCheckboxState();
    emailInterestBtn.disabled = selectedHoldingIds.size === 0;
}

/** Updates the sort indicator arrows in the holdings table headers. */
function updateSortIndicators() {
    tableHeaders.forEach(th => {
        const key = th.dataset.key;
        const arrowSpan = th.querySelector('.sort-arrow');
        if (!arrowSpan) return; // Skip if arrow span is missing

        if (key === currentSortKey) {
            // This header is the current sort column
            th.classList.add('sorted');
            arrowSpan.textContent = currentSortDir === 'asc' ? ' ▲' : ' ▼'; // Show correct arrow
        } else {
            // This header is not the sort column
            th.classList.remove('sorted');
            arrowSpan.textContent = ''; // Clear arrow
        }
    });
}

/** Updates the sort indicator arrows in the muni offerings table headers. */
function updateMuniSortIndicators() {
    muniTableHeaders.forEach(th => {
        const key = th.dataset.key;
        const arrowSpan = th.querySelector('.sort-arrow');
        if (!arrowSpan) return;

        if (key === currentMuniSortKey) {
            th.classList.add('sorted');
            arrowSpan.textContent = currentMuniSortDir === 'asc' ? ' ▲' : ' ▼';
        } else {
            th.classList.remove('sorted');
            arrowSpan.textContent = '';
        }
    });
}


/** Calculates and renders the total values for the holdings table footer (based on current page). */
function renderTotals(holdingsPage) {
    // Calculate sums and weighted averages based ONLY on the current page's data
    const totalPar = holdingsPage.reduce((sum, h) => sum + (h.par_value_num ?? 0), 0);
    const weightedYieldSum = holdingsPage.reduce((sum, h) => sum + ((h.par_value_num ?? 0) * (h.book_yield_num ?? 0)), 0);
    const totalYield = totalPar > 0 ? weightedYieldSum / totalPar : 0; // Avoid division by zero
    const weightedWalSum = holdingsPage.reduce((sum, h) => sum + ((h.par_value_num ?? 0) * (h.holding_average_life_num ?? 0)), 0);
    const totalWal = totalPar > 0 ? weightedWalSum / totalPar : 0; // Avoid division by zero

    // Update the footer cells with formatted values
    document.getElementById('totals-par').textContent = totalPar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('totals-yield').textContent = totalYield.toFixed(3); // Using Book Yield
    document.getElementById('totals-wal').textContent = totalWal.toFixed(2); // Using Avg Life
}

/** Destroys an existing Chart.js instance if it exists. */
function destroyChart(chartId) {
    if (chartInstances[chartId]?.destroy) { // Check if instance exists and has destroy method
        chartInstances[chartId].destroy();
        delete chartInstances[chartId]; // Remove from tracking object
    }
}

/** Renders all the charts based on the client-side filtered holdings data (from current page). */
function renderCharts(holdingsDataForCharts) {
    console.log("Rendering charts with data count:", holdingsDataForCharts.length); // Use the filtered data passed in

    // Destroy existing charts before creating new ones
    Object.keys(chartInstances).forEach(destroyChart);
    chartInstances = {}; // Reset tracking object

    // Determine colors based on current theme
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
    const labelColor = isDark ? '#aaa' : '#666';
    const titleColor = isDark ? '#4dabf7' : '#0056b3'; // Use header color for titles
    const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)';
    const tooltipColor = isDark ? '#f1f1f1' : '#fff';

    // Base configuration options for all charts
    const baseChartOptionsStatic = {
        responsive: true,
        maintainAspectRatio: false, // Allow charts to fill container height
        plugins: {
            legend: { labels: { color: labelColor } },
            title: { color: titleColor, display: true, font: { size: 14 } }, // Slightly smaller title
            tooltip: {
                backgroundColor: tooltipBgColor,
                titleColor: tooltipColor,
                bodyColor: tooltipColor,
                footerColor: tooltipColor
            }
        },
        scales: {
            x: {
                ticks: { color: labelColor },
                grid: { color: gridColor, borderColor: gridColor },
                title: { color: labelColor, display: true }
            },
            y: {
                ticks: { color: labelColor },
                grid: { color: gridColor, borderColor: gridColor },
                title: { color: labelColor, display: true }
            }
        },
    };

    // Plugin to draw a white background before chart draw (for PDF export)
    const pdfBackgroundPlugin = {
        id: 'pdfBackground',
        beforeDraw: (chart) => {
            const ctx = chart.canvas.getContext('2d');
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over'; // Draw behind existing content
            ctx.fillStyle = 'white'; // PDF needs white background
            ctx.fillRect(0, 0, chart.width, chart.height);
            ctx.restore();
        }
    };

    // Get canvas contexts
    const contexts = {
        yieldVsMaturityChart: document.getElementById('yieldVsMaturityChart')?.getContext('2d'),
        parByMaturityYearChart: document.getElementById('parByMaturityYearChart')?.getContext('2d'),
        couponPieChart: document.getElementById('couponPieChart')?.getContext('2d'),
        priceVsYieldChart: document.getElementById('priceVsYieldChart')?.getContext('2d'),
    };

    // Check if all contexts were found
    if (Object.values(contexts).some(ctx => !ctx)) {
        console.error("One or more chart canvas elements not found. Cannot render charts.");
        return;
    }

    // --- 1. Book Yield vs. Holding Average Life (Scatter Plot) ---
    const yieldLifePoints = holdingsDataForCharts
        .filter(h => h.holding_average_life_num !== null && h.book_yield_num !== null)
        .map(h => ({ x: h.holding_average_life_num, y: h.book_yield_num }));

    if (yieldLifePoints.length > 0 && contexts.yieldVsMaturityChart) {
        const options1 = structuredClone(baseChartOptionsStatic); // Deep clone base options
        options1.plugins.title.text = 'Book Yield vs. Holding Average Life'; // Updated Title
        options1.scales.x.type = 'linear';
        options1.scales.x.position = 'bottom';
        options1.scales.x.title.text = 'Holding Average Life (Years)'; // Updated X Axis Label
        options1.scales.x.ticks = { ...options1.scales.x.ticks, stepSize: 1 }; // Adjust step if needed
        options1.scales.y.beginAtZero = false; // Yield can be negative
        options1.scales.y.title.text = 'Book Yield (%)'; // Updated Y Axis Label
        options1.plugins.tooltip.callbacks = { label: ctx => `Avg Life: ${ctx.parsed.x.toFixed(2)}, Yield: ${ctx.parsed.y.toFixed(3)}` };
        options1.plugins.pdfBackground = pdfBackgroundPlugin; // Add background for PDF

        const dataset1 = {
            label: 'Book Yield vs Avg Life',
            data: yieldLifePoints,
            backgroundColor: isDark ? 'rgba(66, 135, 245, 0.7)' : 'rgba(0, 123, 255, 0.5)',
            borderColor: isDark ? 'rgba(86, 155, 255, 1)' : 'rgba(0, 123, 255, 1)',
            pointRadius: 5,
            pointHoverRadius: 7,
            showLine: false // Scatter plot, no line
        };

        // Add trendline if plugin is available
        if (typeof Chart !== 'undefined' && window.pluginTrendlineLinear) {
            dataset1.trendlineLinear = {
                style: isDark ? "rgba(255, 80, 80, 0.9)" : "rgba(255, 50, 50, 0.8)", // Reddish trendline
                lineStyle: "solid",
                width: 2,
                projection: false // Don't project beyond data range
            };
        }

        chartInstances.yieldVsMaturityChart = new Chart(contexts.yieldVsMaturityChart, {
            type: 'scatter',
            data: { datasets: [dataset1] },
            options: options1
        });
    }

    // --- 2. Total Par by Maturity Year (Bar Chart) ---
    const maturityBuckets = {};
    holdingsDataForCharts.forEach(h => {
        // Use actual maturity year
        const year = h.maturity_date_obj ? h.maturity_date_obj.getFullYear() : 'Unknown';
        if (year !== 'Unknown' && !isNaN(year)) {
            maturityBuckets[year] = (maturityBuckets[year] || 0) + (h.par_value_num ?? 0);
        }
    });
    const sortedYears = Object.keys(maturityBuckets).map(Number).sort((a, b) => a - b); // Sort years numerically

    if (sortedYears.length > 0 && contexts.parByMaturityYearChart) {
        const options2 = structuredClone(baseChartOptionsStatic);
        options2.plugins.title.text = 'Total Par by Maturity Year'; // Updated Title
        options2.scales.x.title.text = 'Year';
        options2.scales.y.beginAtZero = true;
        options2.scales.y.title.text = 'Total Par Value';
        options2.scales.y.ticks = { ...options2.scales.y.ticks, callback: value => value.toLocaleString() }; // Format Y-axis labels
        options2.plugins.tooltip.callbacks = { label: ctx => `Year: ${ctx.label}, Par: ${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` };
        options2.plugins.pdfBackground = pdfBackgroundPlugin;

        chartInstances.parByMaturityYearChart = new Chart(contexts.parByMaturityYearChart, {
            type: 'bar',
            data: {
                labels: sortedYears,
                datasets: [{
                    label: 'Total Par by Maturity Year',
                    data: sortedYears.map(year => maturityBuckets[year]),
                    backgroundColor: isDark ? 'rgba(40, 167, 69, 0.85)' : 'rgba(40, 167, 69, 0.7)', // Green bars
                    borderColor: isDark ? 'rgba(60, 187, 89, 1)' : 'rgba(40, 167, 69, 1)',
                    borderWidth: 1
                }]
            },
            options: options2
        });
    }

    // --- 3. Portfolio Par Distribution by Coupon Rate (Pie Chart) ---
    const couponBuckets = {};
    holdingsDataForCharts.forEach(h => {
        // Assuming coupon is available (might need adjustment if it's deeply nested)
        const couponRate = (parseFloatSafe(h.coupon) ?? 0).toFixed(3); // Group by coupon rate
        couponBuckets[couponRate] = (couponBuckets[couponRate] || 0) + (h.par_value_num ?? 0);
    });
    const sortedCoupons = Object.keys(couponBuckets).sort((a, b) => parseFloat(a) - parseFloat(b)); // Sort coupons numerically

    if (sortedCoupons.length > 0 && contexts.couponPieChart) {
        const pieColors = generateDistinctColors(sortedCoupons.length); // Generate colors for slices
        const options3 = structuredClone(baseChartOptionsStatic);
        delete options3.scales; // Pie charts don't have scales
        options3.plugins.title.text = 'Portfolio Par Distribution by Coupon Rate';
        options3.plugins.title.align = 'center';
        options3.plugins.legend.position = 'bottom'; // Legend below chart
        options3.plugins.tooltip.callbacks = {
            label: ctx => { // Custom tooltip label
                const label = ctx.label || '';
                const value = ctx.parsed || 0;
                const total = ctx.dataset.data.reduce((acc, val) => acc + val, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return `${label}: ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`;
            }
        };
        options3.plugins.pdfBackground = pdfBackgroundPlugin;

        chartInstances.couponPieChart = new Chart(contexts.couponPieChart, {
            type: 'pie',
            data: {
                labels: sortedCoupons.map(c => `${c}% Coupon`), // Labels for legend/tooltips
                datasets: [{
                    label: 'Par by Coupon Rate',
                    data: sortedCoupons.map(c => couponBuckets[c]), // Data values
                    backgroundColor: pieColors,
                    hoverOffset: 4 // Slightly enlarge slice on hover
                }]
            },
            options: options3
        });
    }

    // --- 4. Settlement Price vs. Book Yield (Scatter Plot) ---
    const priceYieldPoints = holdingsDataForCharts
        .filter(h => h.settlement_price_num !== null && h.settlement_price_num > 0 && h.book_yield_num !== null)
        .map(h => ({ x: h.settlement_price_num, y: h.book_yield_num }));

    if (priceYieldPoints.length > 0 && contexts.priceVsYieldChart) {
        const options4 = structuredClone(baseChartOptionsStatic);
        options4.plugins.title.text = 'Settlement Price vs. Book Yield'; // Updated Title
        options4.scales.x.beginAtZero = false; // Price usually not zero
        options4.scales.x.title.text = 'Settlement Price';
        options4.scales.y.beginAtZero = false; // Yield can be negative
        options4.scales.y.title.text = 'Book Yield (%)'; // Updated Y Axis
        options4.plugins.tooltip.callbacks = { label: ctx => `Price: ${ctx.parsed.x.toFixed(6)}, Yield: ${ctx.parsed.y.toFixed(3)}` }; // Updated precision
        options4.plugins.pdfBackground = pdfBackgroundPlugin;

        chartInstances.priceVsYieldChart = new Chart(contexts.priceVsYieldChart, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Price vs Yield',
                    data: priceYieldPoints,
                    backgroundColor: isDark ? 'rgba(255, 200, 50, 0.7)' : 'rgba(255, 193, 7, 0.6)', // Yellow/Orange points
                    borderColor: isDark ? 'rgba(255, 210, 70, 1)' : 'rgba(255, 193, 7, 1)',
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    showLine: false
                }]
            },
            options: options4
        });
    }
}


// --- UI Update Triggers ---

/** Applies server-side filters and sorting by fetching page 1. */
function applyHoldingsFiltersAndFetchPage(page = 1) {
    const portfolioId = portfolioFilterSelect.value;
    if (portfolioId) {
        fetchHoldings(portfolioId, page); // Fetch the requested page with current filters/sort
    } else {
        console.warn("Cannot apply holdings filters: No portfolio selected.");
        // Optionally clear the table or show a message
        clearTableAndCharts();
    }
}

/** Applies server-side filters and sorting by fetching page 1 for Munis. */
function applyMuniFiltersAndFetchPage(page = 1) {
    loadMuniOfferings(page); // Fetch the requested page with current filters/sort
}


/** Clears the holdings table, totals, charts, selections, and pagination. */
function clearTableAndCharts() {
    const colSpan = (tableHeaders.length || 11) + 1; // Adjusted colspan
    if (tableBody) {
        // Display a generic loading/cleared message
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading...</td></tr>`;
    }
    renderTotals([]); // Clear totals in the footer
    Object.keys(chartInstances).forEach(destroyChart); // Destroy existing charts
    chartInstances = {}; // Reset chart tracking
    clearHoldingSelection(); // Clear any selected checkboxes
    renderPaginationControls(holdingsPaginationControls, null); // Clear pagination controls
}

// --- Theme Toggling ---

/** Applies the specified theme ('light' or 'dark') and re-renders charts. */
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
        darkModeToggle.textContent = 'Toggle Light Mode';
    } else {
        document.body.classList.remove('dark-mode');
        darkModeToggle.textContent = 'Toggle Dark Mode';
    }

    // Re-render charts to apply new theme colors, only if charts exist
    try {
        // Check if localStorage is accessible before potentially using it for theme persistence
        localStorage.setItem('themeCheck', '1');
        localStorage.removeItem('themeCheck');
        // Re-render charts if they have been initialized
        if (Object.keys(chartInstances).length > 0) {
             renderCharts(filteredHoldings); // Re-render holdings charts with new colors
        }
    } catch (e) {
        console.warn("localStorage not accessible, charts will not update theme colors dynamically if persistence fails.");
        // Still attempt to re-render charts even if localStorage fails, theme class on body changed anyway
        if (Object.keys(chartInstances).length > 0) {
             renderCharts(filteredHoldings);
        }
    }
}
/** Toggles the theme between light and dark, saves preference to localStorage. */
function toggleTheme() {
    const currentTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    try {
        localStorage.setItem('portfolioTheme', currentTheme);
        console.log("Theme preference saved:", currentTheme);
    } catch (e) {
        console.warn("Could not save theme preference to localStorage:", e);
    }
    // Apply the new theme (which also re-renders charts)
    applyTheme(currentTheme);
}

// --- PDF Export ---

/** Exports the current view (charts and holdings table - current page) to a PDF document. */
async function exportToPdf() {
    // Note: This currently exports ONLY the holdings shown on the current page.
    // Exporting all holdings would require fetching all pages first.
    console.warn("PDF export currently only includes holdings from the current page.");

    const { jsPDF } = window.jspdf; // Ensure jsPDF is loaded
    const doc = new jsPDF({
        orientation: 'p', // Portrait
        unit: 'pt', // Points
        format: 'a4' // Standard A4 size
    });

    // Determine colors based on current theme for PDF elements
    const isDark = document.body.classList.contains('dark-mode');
    const pdfHeaderBg = isDark ? '#3a3a3a' : '#e9ecef';
    const pdfHeaderText = isDark ? '#e0e0e0' : '#495057';
    const pdfTextColor = isDark ? '#f1f1f1' : '#333333';
    const pdfBorderColor = isDark ? '#444444' : '#dee2e6';
    const pdfRowBg = isDark ? '#2c2c2c' : '#ffffff';
    const pdfAlternateRowBg = isDark ? '#303030' : '#f8f9fa';

    // Page dimensions and margins
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40; // Points
    const usableWidth = pageWidth - (2 * margin);
    const usableHeight = pageHeight - (2 * margin);

    // --- Page 1: Charts ---
    const chartGap = 25; // Gap between charts
    // Calculate dimensions for 2x2 grid (adjust ratios if needed)
    const chartWidth = ((usableWidth - chartGap) / 2) * 0.95; // Slightly smaller than half width
    const chartHeight = ((usableHeight - chartGap - 30) / 2) * 0.95; // Adjust height based on available space
    const chartStartX1 = margin;
    const chartStartX2 = margin + chartWidth + chartGap;
    const chartStartY1 = margin + 25; // Start below title
    const chartStartY2 = chartStartY1 + chartHeight + chartGap;

    // Add title for charts page
    doc.setFontSize(18);
    doc.setTextColor(isDark ? 241 : 51); // Use theme-aware text color
    const viewTitle = portfolioNameEl.textContent || 'Portfolio Analysis'; // Use the current portfolio name
    doc.text(viewTitle + " - Charts (Current Page View)", margin, margin + 5);

    // Get chart images as Base64 PNGs
    const chartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart', 'priceVsYieldChart'];
    const chartImages = [];
    for (const chartId of chartIds) {
        const chartInstance = chartInstances[chartId];
        try {
            if (chartInstance) {
                // Use the version with the white background plugin applied
                chartImages.push(chartInstance.toBase64Image('image/png', 1.0));
            } else {
                chartImages.push(null); // Placeholder if chart doesn't exist
            }
        } catch (e) {
            console.error(`Error getting image for chart ${chartId}:`, e);
            chartImages.push(null);
        }
    }

    // Add chart images to the PDF in a 2x2 grid
    if (chartImages[0]) doc.addImage(chartImages[0], 'PNG', chartStartX1, chartStartY1, chartWidth, chartHeight);
    if (chartImages[1]) doc.addImage(chartImages[1], 'PNG', chartStartX2, chartStartY1, chartWidth, chartHeight);
    if (chartImages[2]) doc.addImage(chartImages[2], 'PNG', chartStartX1, chartStartY2, chartWidth, chartHeight);
    if (chartImages[3]) doc.addImage(chartImages[3], 'PNG', chartStartX2, chartStartY2, chartWidth, chartHeight);

    // --- Page 2: Holdings Table (Current Page) ---
    doc.addPage(); // Add a new page for the table

    // Add title for table page
    doc.setFontSize(18);
    doc.setTextColor(isDark ? 241 : 51);
    doc.text(viewTitle + " - Holdings Table (Current Page)", margin, margin + 5);

    // Use jsPDF-AutoTable to generate the table from HTML
    doc.autoTable({
        html: '#holdings-table', // Target the holdings table element
        startY: margin + 25, // Start below the title
        theme: 'grid', // Use grid theme for borders
        // Specify which columns to include (by index, skipping checkbox)
        // Indices adjusted for new Ext. Ticket column
        columns: [
            { header: 'CUSIP', dataKey: 1 },
            { header: 'Ext. Ticket #', dataKey: 2 },
            { header: 'Description', dataKey: 3 },
            { header: 'Par', dataKey: 4 },
            { header: 'Price', dataKey: 5 },
            { header: 'Coupon', dataKey: 6 },
            { header: 'Book Yield', dataKey: 7 },
            { header: 'Avg Life', dataKey: 8 },
            { header: 'Maturity Date', dataKey: 9 },
            { header: 'Call Date', dataKey: 10 },
        ],
        // Apply theme-aware styling
        styles: {
            fontSize: 7, // Smaller font size for table
            cellPadding: 3,
            overflow: 'linebreak', // Wrap text if needed
            textColor: pdfTextColor,
            lineColor: pdfBorderColor,
            lineWidth: 0.5,
        },
        headStyles: {
            fillColor: pdfHeaderBg,
            textColor: pdfHeaderText,
            fontStyle: 'bold',
            halign: 'center',
            lineColor: pdfBorderColor,
            lineWidth: 0.5,
        },
        bodyStyles: {
            fillColor: pdfRowBg, // Base row color
            textColor: pdfTextColor,
            lineColor: pdfBorderColor,
            lineWidth: 0.5,
        },
        alternateRowStyles: {
            fillColor: pdfAlternateRowBg // Alternate row color
        },
        // Define column widths and alignments (adjust indices)
        columnStyles: {
            // Index corresponds to the *selected* columns above (0=CUSIP, 1=Ticket, etc.)
            0: { cellWidth: 55, halign: 'left' }, // CUSIP
            1: { cellWidth: 50, halign: 'right' }, // Ext. Ticket
            2: { cellWidth: 'auto', halign: 'left'}, // Description (auto width)
            3: { cellWidth: 60, halign: 'right' }, // Par
            4: { cellWidth: 45, halign: 'right' }, // Price (adjusted width)
            5: { cellWidth: 40, halign: 'right' }, // Coupon
            6: { cellWidth: 40, halign: 'right' }, // Book Yield
            7: { cellWidth: 40, halign: 'right' }, // Avg Life
            8: { cellWidth: 55, halign: 'center' }, // Maturity Date
            9: { cellWidth: 55, halign: 'center' } // Call Date
        },
        margin: { left: margin, right: margin },
        // Add page numbers in the footer
        didDrawPage: function (data) {
            let footerStr = "Page " + doc.internal.getCurrentPageInfo().pageNumber;
            doc.setFontSize(8);
            doc.setTextColor(isDark ? 150 : 100); // Dimmer color for footer
            doc.text(footerStr, data.settings.margin.left, pageHeight - 15, { baseline: 'bottom' });
        }
    });

    // --- Save the PDF ---
    // Generate a safe filename based on customer/portfolio name
    const selectedCustomerOption = customerSelect.options[customerSelect.selectedIndex];
    const selectedPortfolioOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    let baseFilename = 'export';
    if (selectedPortfolioOption && selectedPortfolioOption.value !== "") {
        baseFilename = selectedPortfolioOption.text.split('(')[0].trim(); // Use portfolio name
    } else if (selectedCustomerOption) {
         baseFilename = selectedCustomerOption.text.split('(')[0].trim(); // Fallback to customer name
    }
    // Sanitize filename (replace non-alphanumeric with underscore)
    const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`portfolio_${safeFilename}_page${currentHoldingsData.currentPage}.pdf`); // Add page number
}

// --- Excel (XLSX) Export using SheetJS ---

/**
 * Exports the currently filtered holdings data (from current page only) to an XLSX file.
 */
function exportToXlsx() {
    // Note: This currently exports ONLY the holdings shown on the current page.
    // Exporting all holdings would require fetching all pages first.
    console.warn("XLSX export currently only includes holdings from the current page.");

    // Check if SheetJS library is loaded
    if (typeof XLSX === 'undefined') {
        console.error("SheetJS library (XLSX) not loaded.");
        alert("Error: Excel export library not loaded. Please check the console.");
        return;
    }

    // Use the client-side filtered data from the current page
    const holdingsToExport = filteredHoldings; // Use the data already filtered for charts

    if (!holdingsToExport || holdingsToExport.length === 0) {
        alert("No holdings data on the current page to export.");
        return;
    }

    // Define Headers (match the PDF export columns)
    const headers = [
        "CUSIP", "Ext. Ticket #", "Description", "Par", "Price", "Coupon",
        "Book Yield", "Avg Life", "Maturity Date", "Call Date"
    ];

    // Prepare data rows for SheetJS (Array of Arrays - AoA)
    // Use processed values for consistency
    const data = holdingsToExport.map(h => [
        h.security_cusip || '', // String
        h.external_ticket ?? null, // Number or null
        h.security_description || '',   // String
        h.par_value_num ?? null, // Number or null
        h.settlement_price_num ?? null, // Number or null
        parseFloatSafe(h.coupon) ?? null, // Number or null
        h.book_yield_num ?? null, // Number or null
        h.holding_average_life_num ?? null, // Number or null
        h.maturity_date_str_iso || '', // String (YYYY-MM-DD)
        h.call_date_str_iso || ''      // String (YYYY-MM-DD)
    ]);

    // Combine headers and data
    const sheetData = [headers, ...data];

    // Create a worksheet from the array of arrays
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Optional: Set column widths (example - adjust as needed)
    ws['!cols'] = [
        { wch: 12 }, // CUSIP
        { wch: 15 }, // Ext. Ticket #
        { wch: 40 }, // Description
        { wch: 15 }, // Par
        { wch: 12 }, // Price (adjust width for precision)
        { wch: 10 }, // Coupon
        { wch: 10 }, // Book Yield
        { wch: 10 }, // Avg Life
        { wch: 12 }, // Maturity Date
        { wch: 12 }  // Call Date
    ];

    // Optional: Apply number formats (example)
    // Example: ws['D2'].z = '#,##0.00'; // Format Par cell D2

    // Create a new workbook
    const wb = XLSX.utils.book_new();

    // Append the worksheet to the workbook
    XLSX.utils.book_append_sheet(wb, ws, "Holdings"); // Name the sheet "Holdings"

    // Generate filename based on portfolio name
    const selectedPortfolioOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    let baseFilename = 'holdings_export';
    if (selectedPortfolioOption && selectedPortfolioOption.value !== "") {
        baseFilename = selectedPortfolioOption.text.split('(')[0].trim(); // Use portfolio name
    }
    const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `portfolio_${safeFilename}_page${currentHoldingsData.currentPage}.xlsx`; // Add page number

    // Trigger the download
    try {
        XLSX.writeFile(wb, filename);
        console.log(`XLSX export triggered: ${filename}`);
    } catch (error) {
        console.error("Error exporting to XLSX:", error);
        alert("An error occurred while exporting to Excel. Please check the console.");
    }
}


// --- Modal Functions (Create Portfolio) ---

/** Shows the create portfolio modal and populates customer dropdown if needed. */
function showCreatePortfolioModal() {
    console.log("Showing create portfolio modal. Admin:", IS_ADMIN_USER, "Customer Count:", customers.length);

    // Reset form and error message
    createPortfolioForm.reset();
    modalErrorMessage.textContent = '';
    modalErrorMessage.style.display = 'none';
    adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>'; // Reset dropdown

    // Configure the customer selection dropdown based on user type and customer count
    if (IS_ADMIN_USER) {
        // Admin: Show dropdown, fetch all customers if not already loaded
        adminCustomerSelectGroup.classList.remove('hidden');
        fetchCustomersForAdmin(); // Fetch full list for admin
    } else if (customers && customers.length > 1) {
        // Non-Admin, Multiple Customers: Show dropdown, populate with their associated customers
        adminCustomerSelectGroup.classList.remove('hidden');
        customers.forEach(customer => { // Use the already loaded 'customers' array for this user
            const option = document.createElement('option');
            option.value = customer.id; // Use Customer ID as value
            option.textContent = `${customer.name || 'Unnamed'} (${customer.customer_number || 'No Number'})`;
            adminCustomerSelect.appendChild(option);
        });
    } else {
        // Non-Admin, Single Customer (or zero): Hide the dropdown
        adminCustomerSelectGroup.classList.add('hidden');
    }

    // Make the modal visible
    createPortfolioModal.classList.add('visible');
}

/** Hides the create portfolio modal. */
function hideCreatePortfolioModal() {
    createPortfolioModal.classList.remove('visible');
}

/** Fetches the full customer list for the admin modal dropdown. */
async function fetchCustomersForAdmin() {
    // Only run if user is admin
    if (!IS_ADMIN_USER) return;
    console.log("Fetching customers for admin modal...");

    // Avoid re-fetching if already populated (simple check)
    if (adminCustomerSelect.options.length > 1 && adminCustomerSelect.options[0].value === "") {
        console.log("Admin customer list already populated/loading.");
        return;
    }

    adminCustomerSelect.innerHTML = '<option value="">Loading customers...</option>'; // Show loading state
    try {
        // Fetch all customers (admin permission assumed) - Use page 1 for now
        // TODO: Handle pagination for admin customer list if necessary
        const response = await fetch(`${apiRoot}/customers/?page=1`); // Fetch first page
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json(); // Expect paginated response
        availableCustomers = data.results || []; // Store full list (first page)
        console.log("Fetched customers for admin modal:", availableCustomers.length, "Total:", data.count);

        // Populate the dropdown
        adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>'; // Reset header
        availableCustomers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.id; // Use Customer ID as value for admin selection
            option.textContent = `${customer.name || 'Unnamed'} (${customer.customer_number || 'No Number'})`;
            adminCustomerSelect.appendChild(option);
        });
        // TODO: Add indicator or load more if data.next exists
        if (data.next) {
             console.warn("Admin customer list is paginated, only showing first page in modal.");
        }
    } catch (error) {
        console.error("Failed to fetch customers for admin:", error);
        adminCustomerSelect.innerHTML = '<option value="">Error loading customers</option>';
        modalErrorMessage.textContent = 'Error loading customer list for modal.';
        modalErrorMessage.style.display = 'block';
    }
 }

/** Handles the create portfolio form submission. */
async function handleCreatePortfolioSubmit(event) {
    event.preventDefault(); // Prevent default form submission
    console.log("Handling create portfolio submit...");

    // Clear previous errors
    modalErrorMessage.textContent = '';
    modalErrorMessage.style.display = 'none';

    // Get portfolio name
    const portfolioName = newPortfolioNameInput.value.trim();
    if (!portfolioName) {
        modalErrorMessage.textContent = 'Portfolio name is required.';
        modalErrorMessage.style.display = 'block';
        return;
    }

    // Prepare payload for the API request
    const payload = {
        name: portfolioName
        // 'initial_holding_ids' is intentionally omitted until backend bug is fixed
    };

    // Check if the customer selection dropdown is visible and handle owner assignment
    const isCustomerSelectionVisible = !adminCustomerSelectGroup.classList.contains('hidden');

    if (isCustomerSelectionVisible) {
        const selectedOwnerId = adminCustomerSelect.value; // Get selected Customer ID

        // Check if a selection was made *if* the dropdown is visible
        if (!selectedOwnerId) {
            modalErrorMessage.textContent = 'Please select a customer.';
            modalErrorMessage.style.display = 'block';
            console.log("Validation failed - No customer selected from visible dropdown.");
            return;
        }
        // Add owner_id_input to the payload
        payload.owner_id_input = parseInt(selectedOwnerId, 10);
        console.log("Adding owner_id_input:", payload.owner_id_input);
        if (isNaN(payload.owner_id_input)) {
             modalErrorMessage.textContent = 'Invalid customer ID selected.';
             modalErrorMessage.style.display = 'block';
             console.log("Validation failed - Invalid customer ID (NaN).");
             return;
        }
    } else {
        // Dropdown is hidden: This happens for non-admins with only one customer.
        // Backend handles assigning the owner automatically based on user association.
        // No owner_id_input needed in payload.
        console.log("Customer selection dropdown is hidden. Backend will assign owner.");
    }

    // --- OMITTING initial_holding_ids ---
    // const initialHoldingIds = currentHoldingsData.results // Use current page holdings
    //     .map(holding => holding.external_ticket) // Get external tickets
    //     .filter(ticket => ticket != null); // Filter out nulls
    // if (initialHoldingIds.length > 0) {
    //     // payload.initial_holding_ids = initialHoldingIds; // Feature disabled for now
    //     console.log("Note: Copying initial holdings is disabled pending backend fix.");
    // }
    // --- END OMISSION ---

    console.log("Final create portfolio payload:", JSON.stringify(payload)); // Log the exact payload

    // Send the request to the backend API
    try {
        const response = await fetch(`${apiRoot}/portfolios/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken, // Include CSRF token
            },
            body: JSON.stringify(payload),
        });

        console.log("Create portfolio response status:", response.status); // Log status code

        if (!response.ok) {
            // Handle API errors (e.g., validation errors from serializer)
            const errorData = await response.json().catch(() => ({ detail: response.statusText })); // Try to parse JSON error
            console.error("API Error Data:", errorData); // Log the error data from backend
            let errorMsg = `Error ${response.status}: ${errorData.detail || JSON.stringify(errorData)}`;
            // Format validation errors nicely
            if (typeof errorData === 'object' && errorData !== null) {
                errorMsg = Object.entries(errorData)
                                 .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`)
                                 .join('; ');
            }
            throw new Error(errorMsg); // Throw error to be caught below
        }

        // Success!
        const newPortfolio = await response.json();
        console.log('Successfully created portfolio:', newPortfolio);
        hideCreatePortfolioModal(); // Close the modal
        alert(`Portfolio "${newPortfolio.name}" created successfully!`); // Simple success message

        // Refresh the portfolio list for the current customer (fetch page 1)
        if (selectedCustomerId) {
            await loadPortfolios(selectedCustomerId, 1); // Reload portfolios list (page 1)
            // Automatically select the newly created portfolio in the dropdown
            // Need to ensure the new portfolio is in the list first
            setTimeout(async () => { // Add slight delay to allow dropdown update
                if (Array.from(portfolioFilterSelect.options).some(opt => opt.value == newPortfolio.id)) {
                    portfolioFilterSelect.value = newPortfolio.id;
                    await handlePortfolioSelection(); // Load the new portfolio's data
                } else {
                     console.warn("Newly created portfolio not found in dropdown immediately after refresh.");
                     // Fallback: just reload the first portfolio listed
                     if (portfolioFilterSelect.options.length > 0) {
                         portfolioFilterSelect.value = portfolioFilterSelect.options[0].value;
                         await handlePortfolioSelection();
                     }
                }
            }, 100); // 100ms delay
        } else {
            // If no customer was selected initially (shouldn't happen?), reload customers
            loadCustomers();
        }

    } catch (error) {
        console.error('Failed to create portfolio:', error);
        // Display error message in the modal
        modalErrorMessage.textContent = `Creation failed: ${error.message}`;
        modalErrorMessage.style.display = 'block';
    }
 }

/** Handles the delete portfolio button click. */
async function handleDeletePortfolio() {
    const portfolioIdToDelete = portfolioFilterSelect.value;
    const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    const portfolioNameToDelete = selectedOption ? selectedOption.textContent : `Portfolio ID ${portfolioIdToDelete}`;

    // Basic validation
    if (!portfolioIdToDelete || selectedOption?.dataset?.isDefault === 'true') {
        alert("Please select a non-default portfolio to delete.");
        return;
    }

    // Confirmation dialog
    if (!confirm(`Are you sure you want to delete portfolio "${portfolioNameToDelete}"? This action cannot be undone.`)) {
        return;
    }

    console.log(`Attempting to delete portfolio ID: ${portfolioIdToDelete}`);
    try {
        const response = await fetch(`${apiRoot}/portfolios/${portfolioIdToDelete}/`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': csrfToken,
                'Accept': 'application/json', // Expect JSON error or no content
            }
        });

        console.log(`Delete portfolio response status: ${response.status}`);

        if (response.status === 204) { // 204 No Content indicates success
            alert(`Portfolio "${portfolioNameToDelete}" deleted successfully.`);
            // Refresh the portfolio list for the current customer (page 1)
            if (selectedCustomerId) {
                 await loadPortfolios(selectedCustomerId, 1);
            }
        } else {
            // Handle deletion errors (including 400 for trying to delete default)
            let errorMsg = `Error ${response.status}: Failed to delete portfolio.`;
            try {
                const errorData = await response.json();
                // Check for specific validation error message from perform_destroy
                if (errorData.detail && errorData.detail.includes("Cannot delete the default")) {
                    errorMsg = errorData.detail;
                } else {
                    errorMsg += ` ${errorData.detail || JSON.stringify(errorData)}`;
                }
            } catch (e) { /* Ignore if response is not JSON */
                errorMsg += ` ${response.statusText}`;
            }
            throw new Error(errorMsg);
        }
    } catch (error) {
        console.error("Failed to delete portfolio:", error);
        alert(`Error deleting portfolio: ${error.message}`); // Show error to user
    }
 }


// --- Holding Selection and Email Action ---

/** Handles checkbox changes for individual holdings and the "Select All" checkbox. */
function handleCheckboxChange(event) {
    const target = event.target;

    if (target === selectAllCheckbox) {
        // "Select All" checkbox was clicked
        const isChecked = target.checked;
        // Select/deselect all *visible* holding checkboxes on the current page
        const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox');
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            // Update the selectedHoldingIds Set accordingly using internal ticket_id
            const holdingId = checkbox.dataset.holdingId; // ticket_id is a string (UUID)
            if (holdingId) {
                if (isChecked) {
                    selectedHoldingIds.add(holdingId);
                } else {
                    selectedHoldingIds.delete(holdingId);
                }
            }
        });
    } else if (target.classList.contains('holding-checkbox')) {
        // An individual holding checkbox was clicked
        const holdingId = target.dataset.holdingId; // ticket_id is a string (UUID)
        if (holdingId) {
            if (target.checked) {
                selectedHoldingIds.add(holdingId); // Add to set if checked
            } else {
                selectedHoldingIds.delete(holdingId); // Remove from set if unchecked
            }
            // Update the indeterminate state of the "Select All" checkbox
            updateSelectAllCheckboxState();
        }
    }

    // Enable/disable the email button based on selection
    emailInterestBtn.disabled = selectedHoldingIds.size === 0;
    // console.log("Selected Holdings:", selectedHoldingIds); // Keep commented unless debugging
}
/** Updates the state (checked, indeterminate) of the "Select All" checkbox for holdings. */
function updateSelectAllCheckboxState() {
    if (!selectAllCheckbox || !tableBody) return; // Ensure elements exist

    // Get all visible checkboxes in the current table view
    const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox');
    const totalVisible = visibleCheckboxes.length;
    // Count how many of the visible ones are checked
    const totalSelected = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;

    if (totalVisible === 0) {
        // No rows visible
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (totalSelected === totalVisible) {
        // All visible rows are selected
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (totalSelected > 0) {
        // Some (but not all) visible rows are selected
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true; // Indeterminate state
    } else {
        // No visible rows are selected
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
}
/** Clears holding selection state and UI. */
function clearHoldingSelection() {
    selectedHoldingIds.clear(); // Clear the Set
    // Uncheck all checkboxes in the table body
    if(tableBody) tableBody.querySelectorAll('.holding-checkbox').forEach(cb => cb.checked = false);
    // Reset the "Select All" checkbox
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
    // Disable the email button
    if (emailInterestBtn) {
        emailInterestBtn.disabled = true;
    }
    // Clear any status messages
    if (emailStatusMessage) {
        emailStatusMessage.textContent = '';
        emailStatusMessage.style.display = 'none';
    }
}
/** Handles the "Sell Bonds" button click, sending data to the backend. */
async function handleEmailInterestClick() {
    // Validate that a customer and bonds are selected
    if (!selectedCustomerId) {
        showStatusMessageGeneric(emailStatusMessage, "Error: No customer selected.", true);
        return;
    }
    if (selectedHoldingIds.size === 0) {
        showStatusMessageGeneric(emailStatusMessage, "Error: No bonds selected.", true);
        return;
    }

    // Disable button and show sending message
    emailInterestBtn.disabled = true;
    showStatusMessageGeneric(emailStatusMessage, "Sending email...", false, 0); // 0 duration = persist until replaced

    // Prepare payload with selected bond details (CUSIP and Par)
    // Iterate through the *currently displayed page* holdings to get details
    const selectedBondsPayload = [];
    currentHoldingsData.results.forEach(holding => {
        if (selectedHoldingIds.has(holding.ticket_id)) { // Check if this holding is in the selected set
            selectedBondsPayload.push({
                cusip: holding.security_cusip || 'N/A',
                par: (holding.par_value_num ?? 0).toFixed(2) // Send calculated par number as string
            });
        }
    });

    // Construct the final payload for the API
    const payload = {
        customer_id: parseInt(selectedCustomerId, 10), // Send customer ID
        selected_bonds: selectedBondsPayload // Send list of selected bond details
    };

    console.log("Sending email interest payload:", payload);

    // Make the API call
    try {
        const response = await fetch(`${apiRoot}/email-salesperson-interest/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify(payload),
        });

        const responseData = await response.json().catch(() => ({})); // Try to parse JSON, default to empty obj

        if (response.ok) {
            // Success
            console.log("Email sent successfully:", responseData);
            showStatusMessageGeneric(emailStatusMessage, responseData.message || "Email sent successfully!", false);
            clearHoldingSelection(); // Clear selection after successful send
        } else {
            // API returned an error
            console.error("API Error sending email:", response.status, responseData);
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            showStatusMessageGeneric(emailStatusMessage, `Error: ${errorDetail}`, true); // Show error message
            emailInterestBtn.disabled = false; // Re-enable button on failure
        }
    } catch (error) {
        // Network or other fetch-related error
        console.error("Network/Fetch Error sending email:", error);
        showStatusMessageGeneric(emailStatusMessage, "Network error. Please try again.", true);
        emailInterestBtn.disabled = false; // Re-enable button on failure
    }
}

// --- Muni Offering Selection and Email Action ---

/** Handles checkbox changes for muni offerings. */
function handleMuniCheckboxChange(event) {
    const target = event.target;

    if (target === selectAllMunisCheckbox) {
        // "Select All" checkbox for munis
        const isChecked = target.checked;
        const visibleCheckboxes = muniOfferingsTableBody.querySelectorAll('.muni-checkbox');
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const offeringId = parseInt(checkbox.dataset.offeringId, 10);
            if (!isNaN(offeringId)) {
                if (isChecked) { selectedMuniOfferingIds.add(offeringId); }
                else { selectedMuniOfferingIds.delete(offeringId); }
            }
        });
    } else if (target.classList.contains('muni-checkbox')) {
        // Individual muni offering checkbox
        const offeringId = parseInt(target.dataset.offeringId, 10);
        if (!isNaN(offeringId)) {
            if (target.checked) { selectedMuniOfferingIds.add(offeringId); }
            else { selectedMuniOfferingIds.delete(offeringId); }
            updateSelectAllMunisCheckboxState(); // Update main checkbox state
        }
    }

    // Enable/disable the "Buy Interest" button
    emailBuyInterestBtn.disabled = selectedMuniOfferingIds.size === 0;
    // console.log("Selected Muni Offerings:", selectedMuniOfferingIds); // Keep commented unless debugging
}
/** Updates the "Select All" checkbox state for muni offerings. */
function updateSelectAllMunisCheckboxState() {
    if (!selectAllMunisCheckbox || !muniOfferingsTableBody) return; // Ensure elements exist

    const visibleCheckboxes = muniOfferingsTableBody.querySelectorAll('.muni-checkbox');
    const totalVisible = visibleCheckboxes.length;
    const totalSelected = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;

    if (totalVisible === 0) {
        selectAllMunisCheckbox.checked = false;
        selectAllMunisCheckbox.indeterminate = false;
    } else if (totalSelected === totalVisible) {
        selectAllMunisCheckbox.checked = true;
        selectAllMunisCheckbox.indeterminate = false;
    } else if (totalSelected > 0) {
        selectAllMunisCheckbox.checked = false;
        selectAllMunisCheckbox.indeterminate = true;
    } else {
        selectAllMunisCheckbox.checked = false;
        selectAllMunisCheckbox.indeterminate = false;
    }
}
/** Clears muni offering selection state and UI. */
function clearMuniOfferingSelection() {
    selectedMuniOfferingIds.clear(); // Clear the Set
    if(muniOfferingsTableBody) muniOfferingsTableBody.querySelectorAll('.muni-checkbox').forEach(cb => cb.checked = false);
    if (selectAllMunisCheckbox) {
        selectAllMunisCheckbox.checked = false;
        selectAllMunisCheckbox.indeterminate = false;
    }
    if (emailBuyInterestBtn) {
        emailBuyInterestBtn.disabled = true;
    }
    if (emailBuyStatusMessage) {
        emailBuyStatusMessage.textContent = '';
        emailBuyStatusMessage.style.display = 'none';
    }
}
/** Handles the "Indicate Interest in Buying" button click. */
async function handleEmailBuyInterestClick() {
    // Validate customer and selection
    if (!selectedCustomerId) {
        showStatusMessageGeneric(emailBuyStatusMessage, "Error: No customer selected.", true);
        return;
    }
    if (selectedMuniOfferingIds.size === 0) {
        showStatusMessageGeneric(emailBuyStatusMessage, "Error: No offerings selected.", true);
        return;
    }

    // Disable button and show status
    emailBuyInterestBtn.disabled = true;
    showStatusMessageGeneric(emailBuyStatusMessage, "Sending email...", false, 0);

    // Prepare payload with selected offering details (CUSIP and Description)
    // Iterate through *currently displayed page* of offerings data to find selected ones by ID
    const selectedOfferingsPayload = [];
    currentMuniOfferingsData.results.forEach(offering => {
        if (selectedMuniOfferingIds.has(offering.id)) {
            selectedOfferingsPayload.push({
                cusip: offering.cusip || 'N/A',
                description: offering.description || 'N/A' // Include description
            });
        }
    });

    // Construct the final payload
    const payload = {
        customer_id: parseInt(selectedCustomerId, 10),
        selected_offerings: selectedOfferingsPayload
    };

    console.log("Sending email buy interest payload:", payload);
    // --- Use CORRECTED API URL ---
    const buyInterestApiUrl = `${apiRoot}/email-buy-muni-interest/`;

    // Make the API call
    try {
        const response = await fetch(buyInterestApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify(payload),
        });

        const responseData = await response.json().catch(() => ({}));

        if (response.ok) {
            // Success
            console.log("Buy interest email sent successfully:", responseData);
            showStatusMessageGeneric(emailBuyStatusMessage, responseData.message || "Buy interest email sent successfully!", false);
            clearMuniOfferingSelection(); // Clear selection
        } else {
            // API Error
            console.error("API Error sending buy interest email:", response.status, responseData);
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            // Handle potential nested validation errors from the serializer
            let displayError = `Error: ${errorDetail}`;
            if (responseData.selected_offerings && typeof responseData.selected_offerings === 'object') {
                // Try to extract nested errors if present
                const nestedErrors = Object.values(responseData.selected_offerings)
                                           .map(itemErrors => Object.values(itemErrors).flat().map(e => e.string || e).join(' '))
                                           .join('; ');
                if (nestedErrors) {
                    displayError = `Error: Invalid data in selected offerings - ${nestedErrors}`;
                }
            }
            showStatusMessageGeneric(emailBuyStatusMessage, displayError, true);
            emailBuyInterestBtn.disabled = false; // Re-enable button
        }
    } catch (error) {
        // Network/Fetch Error
        console.error("Network/Fetch Error sending buy interest email:", error);
        showStatusMessageGeneric(emailBuyStatusMessage, "Network error. Please try again.", true);
        emailBuyInterestBtn.disabled = false; // Re-enable button
    }
}

// --- Pagination Rendering and Handling ---

/**
 * Renders pagination controls (buttons and info) into the specified container element.
 * @param {HTMLElement} containerElement - The DOM element to render controls into.
 * @param {object | null} paginationData - The pagination state object ({ count, nextUrl, previousUrl, currentPage }). Null to clear.
 * @param {string} dataType - Identifier ('holdings' or 'munis') for button data attributes.
 */
function renderPaginationControls(containerElement, paginationData, dataType) {
    if (!containerElement) return;

    containerElement.innerHTML = ''; // Clear previous controls

    if (!paginationData || paginationData.count === 0) {
        containerElement.style.display = 'none'; // Hide if no data or pagination info
        return;
    }

    containerElement.style.display = 'flex'; // Show the container

    const { count, nextUrl, previousUrl, currentPage } = paginationData;
    const totalPages = Math.ceil(count / PAGE_SIZE);

    // Page Info (e.g., "Page 2 of 10 (26-50 of 245 items)")
    const pageInfo = document.createElement('div');
    pageInfo.className = 'page-info';
    const startItem = (currentPage - 1) * PAGE_SIZE + 1;
    const endItem = Math.min(currentPage * PAGE_SIZE, count);
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${startItem}-${endItem} of ${count} items)`;

    // Buttons Container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'pagination-buttons';

    // Previous Button
    const prevButton = document.createElement('button');
    prevButton.textContent = 'Previous';
    prevButton.disabled = !previousUrl; // Disable if previousUrl is null
    if (previousUrl) {
        // Extract page number from URL (handles potential query params)
        try {
            const url = new URL(previousUrl);
            const prevPage = url.searchParams.get('page') || 1; // Default to 1 if param missing
            prevButton.dataset.page = prevPage;
            prevButton.dataset.type = dataType; // Store data type
            prevButton.addEventListener('click', handlePaginationClick);
        } catch (e) {
            console.error("Error parsing previous URL:", previousUrl, e);
            prevButton.disabled = true; // Disable if URL is invalid
        }
    }

    // Next Button
    const nextButton = document.createElement('button');
    nextButton.textContent = 'Next';
    nextButton.disabled = !nextUrl; // Disable if nextUrl is null
    if (nextUrl) {
         try {
            const url = new URL(nextUrl);
            const nextPage = url.searchParams.get('page');
            if (nextPage) {
                nextButton.dataset.page = nextPage;
                nextButton.dataset.type = dataType; // Store data type
                nextButton.addEventListener('click', handlePaginationClick);
            } else {
                 console.error("Could not extract page number from next URL:", nextUrl);
                 nextButton.disabled = true; // Disable if page number missing
            }
        } catch (e) {
            console.error("Error parsing next URL:", nextUrl, e);
            nextButton.disabled = true; // Disable if URL is invalid
        }
    }

    buttonsContainer.appendChild(prevButton);
    buttonsContainer.appendChild(nextButton);

    containerElement.appendChild(pageInfo);
    containerElement.appendChild(buttonsContainer);
}

/** Handles clicks on pagination buttons. */
function handlePaginationClick(event) {
    const button = event.target;
    const page = button.dataset.page;
    const type = button.dataset.type; // 'holdings' or 'munis'

    if (!page || !type) {
        console.error("Pagination button missing page or type data.");
        return;
    }

    console.log(`Pagination click: Type=${type}, Page=${page}`);

    // Fetch the requested page for the correct data type
    if (type === 'holdings') {
        const portfolioId = portfolioFilterSelect.value;
        if (portfolioId) {
            fetchHoldings(portfolioId, parseInt(page, 10));
        }
    } else if (type === 'munis') {
        loadMuniOfferings(parseInt(page, 10));
    }
}


// --- Event Listeners Setup ---

/** Attaches all necessary event listeners on DOMContentLoaded. */
function setupEventListeners() {
    // Customer/Portfolio Dropdowns & Delete Button
    customerSelect.addEventListener('change', handleCustomerSelection);
    portfolioFilterSelect.addEventListener('change', handlePortfolioSelection);
    deletePortfolioBtn.addEventListener('click', handleDeletePortfolio);

    // Holdings Filters Buttons & Container Delegation
    addFilterBtn.addEventListener('click', () => addFilterRow());
    clearAllFiltersBtn.addEventListener('click', handleClearAllFilters);
    // Use event delegation on the container for dynamically added filter rows
    if (filtersContainer) {
        // Handle changes in dropdowns (column, operator)
        filtersContainer.addEventListener('change', handleFilterDropdownChange);
        // Handle input in value field
        filtersContainer.addEventListener('input', handleFilterValueChange);
        // Handle clicks on remove buttons
        filtersContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('remove-filter-btn')) {
                handleRemoveFilter(event);
            }
        });
    }

    // Holdings Table Sorting (attach to each header)
    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return; // Ignore clicks on non-sortable headers (like checkbox)

            // Toggle direction or change sort key
            if (key === currentSortKey) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortKey = key;
                currentSortDir = 'asc'; // Default to ascending on new column
            }
            // Apply sort and re-fetch page 1
            applyHoldingsFiltersAndFetchPage(1);
        });
    });

    // Muni Offerings Table Sorting (attach to each header)
    muniTableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return;

            if (key === currentMuniSortKey) {
                currentMuniSortDir = currentMuniSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentMuniSortKey = key;
                currentMuniSortDir = 'asc';
            }
            // Apply sort and re-fetch page 1
            applyMuniFiltersAndFetchPage(1);
        });
    });

    // Muni Offerings Filters Buttons & Container Delegation
    if(addMuniFilterBtn) addMuniFilterBtn.addEventListener('click', () => addMuniFilterRow());
    if(clearAllMuniFiltersBtn) clearAllMuniFiltersBtn.addEventListener('click', handleClearAllMuniFilters);
    // Use event delegation for muni filters
    if (muniFiltersContainer) {
        muniFiltersContainer.addEventListener('change', handleMuniFilterDropdownChange);
        muniFiltersContainer.addEventListener('input', handleMuniFilterValueChange);
        muniFiltersContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('remove-muni-filter-btn')) {
                handleRemoveMuniFilter(event);
            }
        });
    }


    // Theme Toggle & Export Buttons
    darkModeToggle.addEventListener('click', toggleTheme);
    exportPdfBtn.addEventListener('click', exportToPdf);
    exportExcelBtn.addEventListener('click', exportToXlsx); // Updated listener to call exportToXlsx

    // Create Portfolio Modal Interactions
    createPortfolioBtn.addEventListener('click', showCreatePortfolioModal);
    modalCloseBtn.addEventListener('click', hideCreatePortfolioModal);
    modalCancelBtn.addEventListener('click', hideCreatePortfolioModal);
    createPortfolioForm.addEventListener('submit', handleCreatePortfolioSubmit);
    // Close modal if overlay is clicked
    createPortfolioModal.addEventListener('click', (event) => {
        if (event.target === createPortfolioModal) hideCreatePortfolioModal();
    });

    // Holdings Table Checkboxes & Email Button (Sell) - Use delegation
    if (tableBody) tableBody.addEventListener('change', handleCheckboxChange); // Delegate checkbox changes
    if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', handleCheckboxChange);
    if (emailInterestBtn) emailInterestBtn.addEventListener('click', handleEmailInterestClick);

    // Muni Offerings Table Checkboxes & Email Button (Buy) - Use delegation
    if (muniOfferingsTableBody) muniOfferingsTableBody.addEventListener('change', handleMuniCheckboxChange); // Delegate checkbox changes
    if (selectAllMunisCheckbox) selectAllMunisCheckbox.addEventListener('change', handleMuniCheckboxChange);
    if (emailBuyInterestBtn) emailBuyInterestBtn.addEventListener('click', handleEmailBuyInterestClick);

    // Pagination controls event listeners are added dynamically in renderPaginationControls
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // Initial setup for filters
    generateColumnOptions(); // Generate <option> HTML for holdings filters
    addFilterRow(); // Add the initial (empty) holdings filter row
    generateMuniColumnOptions(); // Generate <option> HTML for muni filters
    addMuniFilterRow(); // Add the initial (empty) muni filter row

    // Register Chart.js plugins if available
    if (typeof Chart !== 'undefined' && window.pluginTrendlineLinear) {
        try {
            Chart.register(window.pluginTrendlineLinear);
            console.log("Trendline plugin registered.");
        } catch (e) {
            console.error("Error registering Trendline plugin:", e);
        }
    } else {
        console.warn("Chart.js or Trendline plugin not found.");
    }

    // Apply preferred theme from localStorage
    let preferredTheme = 'light'; // Default theme
    try {
        // Check if localStorage is accessible and get saved theme
        localStorage.setItem('themeCheck', '1');
        localStorage.removeItem('themeCheck');
        preferredTheme = localStorage.getItem('portfolioTheme') || 'light';
        console.log("Theme preference loaded:", preferredTheme);
    } catch (e) {
        console.warn("Could not access localStorage for theme preference:", e);
    }
    applyTheme(preferredTheme); // Apply the determined theme

    // Setup all event listeners for user interactions
    setupEventListeners();

    // Start loading initial data (customers -> portfolios -> holdings)
    loadCustomers(); // This triggers the chain reaction (will load page 1)
    loadMuniOfferings(); // Load municipal offerings data in parallel (will load page 1)
});
