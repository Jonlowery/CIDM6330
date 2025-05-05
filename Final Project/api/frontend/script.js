// --- JAVASCRIPT for Portfolio Analyzer (v2.2 - Fixed Muni Rendering Error) ---

// Ensure external libraries (jsPDF, Chart.js, SheetJS etc.) are loaded before this script runs.

// Use strict mode for better error handling and preventing common mistakes
"use strict";

// Check if IS_ADMIN_USER is defined (should be set in the HTML before this script)
if (typeof IS_ADMIN_USER === 'undefined') {
    console.error("CRITICAL: IS_ADMIN_USER is not defined. Ensure it's set in the HTML before loading script.js.");
    // If this error occurs, the page likely won't function correctly for admins.
} else {
    console.log("User admin status (from script.js):", IS_ADMIN_USER);
}


// --- Constants & Global Variables ---
const { jsPDF } = window.jspdf; // Destructure jsPDF from the global window object
// Note: SheetJS (XLSX) is accessed via the global 'XLSX' object.
const apiRoot = '/api'; // Base URL for API calls
const PAGE_SIZE = 25; // Default page size from backend (used for display calculations)

// --- State Management ---
let customers = []; // Holds the list of customers fetched for the main dropdown (populated by loadCustomers)
let currentPortfolios = []; // Holds the list of portfolios fetched for the selected customer

// Holdings Data & State
let currentHoldingsData = { // Store current page data + pagination info from SERVER
    results: [],        // Raw results for the current page from the server
    count: 0,           // Total count of items matching server-side filters
    nextUrl: null,
    previousUrl: null,
    currentPage: 1,
};
// Removed filteredHoldings - Charts/Exports will use currentHoldingsData.results directly (current page data)
let activeFilters = []; // Array to store active filter objects for HOLDINGS (used for SERVER-SIDE filtering)
let nextFilterId = 0; // Counter for generating unique filter IDs for HOLDINGS UI
let columnOptionsHtml = ''; // HTML string for filter column dropdown options for HOLDINGS
let currentSortKey = 'security__cusip'; // Default sort column key for HOLDINGS (match backend field)
let currentSortDir = 'asc'; // Default sort direction for HOLDINGS

// Muni Offerings Data & State
let currentMuniOfferingsData = { // Store current page data + pagination info from SERVER
    results: [],        // Raw results for the current page from the server
    count: 0,           // Total count of items matching server-side filters
    nextUrl: null,
    previousUrl: null,
    currentPage: 1,
};
// Removed filteredMuniOfferings - will use currentMuniOfferingsData.results directly
let activeMuniFilters = []; // Array to store active filter objects for MUNIS (used for SERVER-SIDE filtering)
let nextMuniFilterId = 0; // Counter for generating unique filter IDs for MUNIS UI
let muniColumnOptionsHtml = ''; // HTML string for filter column dropdown options for MUNIS
let currentMuniSortKey = 'cusip'; // Default sort column key for munis
let currentMuniSortDir = 'asc'; // Default sort direction for munis

// General State
let chartInstances = {}; // Stores active Chart.js instances for later destruction/update
let availableCustomers = []; // Stores the full customer list fetched for the admin modal dropdown
let selectedCustomerId = null; // Store the currently selected customer ID from the MAIN dropdown
let selectedHoldingIds = new Set(); // Set to store IDs (ticket_id UUID strings) of selected holdings for email action
let selectedMuniOfferingIds = new Set(); // Set to store IDs (integer PKs) of selected muni offerings

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
const tableElement = document.getElementById('holdings-table'); // Needed for PDF export
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

/** Retrieves a cookie value by name. Essential for CSRF protection. */
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            // Does this cookie string begin with the name we want?
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}
const csrfToken = getCookie('csrftoken');
if (!csrfToken) {
    console.error("CRITICAL: CSRF token not found. POST/DELETE requests will fail.");
    // Consider displaying an error to the user or preventing actions.
} else {
    // console.log("CSRF Token found:", csrfToken); // Keep commented unless debugging
}

/**
 * Parses a date string (YYYY-MM-DD) into a Date object.
 * Assumes UTC to avoid timezone issues with date-only strings.
 * Returns null if the string is invalid or empty.
 */
function parseDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    try {
        // Check if the string matches the expected YYYY-MM-DD format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
             console.warn("Invalid date format encountered:", dateString, "- Expected YYYY-MM-DD");
             return null; // Return null for invalid formats
        }
        // Append time and Z to ensure UTC parsing
        const date = new Date(dateString + 'T00:00:00Z');
        // Check if the resulting date is valid
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        console.error("Error parsing date:", dateString, e);
        return null;
    }
}

/**
 * Safely parses a string value into a float.
 * Handles null, undefined, empty strings, and strings with commas.
 * Returns null if the value cannot be parsed into a valid number.
 */
function parseFloatSafe(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    // Remove commas and attempt parsing
    const parsed = parseFloat(String(value).replace(/,/g, ''));
    return isNaN(parsed) ? null : parsed;
}

/** Generates an array of distinct HSL colors for charts. */
function generateDistinctColors(count) {
    const colors = [];
    if (count <= 0) return colors;
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        // Use slightly varied saturation/lightness for better visibility
        const saturation = 70 + (i % 3) * 5; // e.g., 70%, 75%, 80%
        const lightness = 60 + (i % 4) * 5; // e.g., 60%, 65%, 70%, 75%
        colors.push(`hsl(${i * hueStep}, ${saturation}%, ${lightness}%)`);
    }
    return colors;
}

/** Displays a status message (success or error) in a specified status area. */
function showStatusMessageGeneric(statusElement, message, isError = false, duration = 5000) {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.className = 'status-message'; // Reset classes
    statusElement.classList.add(isError ? 'error' : 'success');
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

// --- Filter UI Management ---

// --- Holdings Filters ---

/** Generates HTML <option> elements for the HOLDINGS filter column dropdown based on table headers. */
function generateColumnOptions() {
    columnOptionsHtml = '';
    tableHeaders.forEach(th => {
        const key = th.dataset.key;
        const type = th.dataset.type || 'string'; // Default to string if type is missing
        const text = th.textContent.replace(/[▲▼]/g, '').trim(); // Clean header text
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

    // Event listeners are handled by delegation on filtersContainer

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

    // Trigger update ONLY IF an initial value was set (applies filters and fetches page 1)
    // Do NOT trigger fetch for adding an empty row.
    if (newFilter.value) {
        applyHoldingsFiltersAndFetchPage(1);
    }
}

/** Updates the operator dropdown options based on the selected column's data type. */
function updateOperatorOptionsForRow(filterRow, preferredOperator = null) {
    const columnSelect = filterRow.querySelector('.filter-column, .muni-filter-column'); // Works for both types
    const operatorSelect = filterRow.querySelector('.filter-operator, .muni-filter-operator');
    const valueInput = filterRow.querySelector('.filter-value, .muni-filter-value');

    if (!columnSelect || !operatorSelect || !valueInput) {
        console.warn("updateOperatorOptionsForRow: Missing elements in filter row:", filterRow);
        return;
    }
    if (!columnSelect.options || columnSelect.options.length === 0) {
        console.warn("updateOperatorOptionsForRow called before column options were ready for:", filterRow);
        return; // Exit if options aren't ready
    }

    const selectedOption = columnSelect.options[columnSelect.selectedIndex];
    const columnType = selectedOption ? selectedOption.dataset.type : 'string'; // Default to string

    // Define operators and corresponding backend lookup suffix
    // See: https://django-filter.readthedocs.io/en/stable/ref/filters.html#lookup-choices
    // And: https://docs.djangoproject.com/en/stable/ref/models/querysets/#field-lookups
    const numberOperators = {
        '=': 'exact', '!=': 'exact', // Use negation logic later for '!='
        '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte'
    };
    const stringOperators = {
        'contains': 'icontains', // Use case-insensitive contains
        '=': 'iexact', '!=': 'iexact', // Use case-insensitive exact, negate later
        'startsWith': 'istartswith', 'endsWith': 'iendswith'
    };
    const dateOperators = {
        '=': 'exact', '!=': 'exact', // Negate later
        '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte'
    };

    let availableOperatorsMap;
    let defaultOperatorSymbol;

    // Set operators and input type based on column type
    switch (columnType) {
        case 'number':
            availableOperatorsMap = numberOperators;
            valueInput.type = 'number';
            valueInput.step = 'any'; // Allow decimals
            defaultOperatorSymbol = '=';
            break;
        case 'date':
            availableOperatorsMap = dateOperators;
            valueInput.type = 'date'; // Use HTML5 date picker
            valueInput.step = '';
            defaultOperatorSymbol = '=';
            break;
        case 'string':
        default: // Treat any other type as string
            availableOperatorsMap = stringOperators;
            valueInput.type = 'text';
            valueInput.step = '';
            defaultOperatorSymbol = 'contains';
            break;
    }

    const availableOperatorSymbols = Object.keys(availableOperatorsMap);

    // Preserve current selection if valid, otherwise use preferred or default
    const currentOperatorSymbol = operatorSelect.value;
    operatorSelect.innerHTML = ''; // Clear existing options
    availableOperatorSymbols.forEach(opSymbol => {
        const option = document.createElement('option');
        option.value = opSymbol;
        // Use symbols for better display
        option.textContent = opSymbol.replace('>=', '≥').replace('<=', '≤').replace('!=', '≠');
        option.dataset.lookup = availableOperatorsMap[opSymbol]; // Store the backend lookup
        operatorSelect.appendChild(option);
    });

    // Set the selected operator symbol
    if (preferredOperator && availableOperatorSymbols.includes(preferredOperator)) {
        operatorSelect.value = preferredOperator;
    } else if (availableOperatorSymbols.includes(currentOperatorSymbol)) {
        operatorSelect.value = currentOperatorSymbol; // Keep current if still valid
    } else {
        operatorSelect.value = defaultOperatorSymbol; // Fallback to default
    }

    // Update the filter state immediately after changing operators
    if (filterRow.dataset.filterId) { // Check if it's a holdings filter
        updateFilterState(filterRow);
    } else if (filterRow.dataset.muniFilterId) { // Check if it's a muni filter
        updateMuniFilterState(filterRow);
    }
}

/** Updates the state object for a specific HOLDINGS filter row based on its UI elements. */
function updateFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.filterId, 10);
    const filterIndex = activeFilters.findIndex(f => f.id === filterId);
    if (filterIndex === -1) return false; // Filter not found in state

    // Get current values from the UI elements
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');
    const selectedOperatorOption = operatorSelect.options[operatorSelect.selectedIndex];

    // Update the corresponding object in the activeFilters array
    activeFilters[filterIndex] = {
        id: filterId,
        column: columnSelect.value, // e.g., 'book_yield'
        operator: operatorSelect.value, // e.g., '>='
        value: valueInput.value.trim(), // Trim whitespace from value
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string',
        lookup: selectedOperatorOption?.dataset.lookup || 'exact' // Store backend lookup, e.g., 'gte'
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

    // Prevent removing the last filter
    const currentFilterRows = filtersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) {
        console.log("Cannot remove the last holdings filter.");
        // Optionally, provide user feedback (e.g., flash the button)
        return; // Stop the function here
    }

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
        const text = th.textContent.replace(/[▲▼]/g, '').trim();
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

    // Event listeners handled by delegation on muniFiltersContainer

    // Create the initial state object for this muni filter
    const newFilter = {
        id: filterId,
        column: initialFilter?.column || columnSelect.value,
        operator: initialFilter?.operator,
        value: initialFilter?.value || '',
        type: initialFilter?.type || columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string',
        lookup: 'exact' // Default lookup, will be updated
    };
    activeMuniFilters.push(newFilter);

    // Apply initial values if provided
    if (initialFilter) {
        columnSelect.value = initialFilter.column;
        valueInput.value = initialFilter.value;
    }

    // Populate operator options based on the selected column type (reuse generic function)
    updateOperatorOptionsForRow(filterRow, newFilter.operator);

    // Trigger update ONLY IF an initial value was set
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
    const selectedOperatorOption = operatorSelect.options[operatorSelect.selectedIndex];

    // Update the corresponding object in the activeMuniFilters array
    activeMuniFilters[filterIndex] = {
        id: filterId,
        column: columnSelect.value,
        operator: operatorSelect.value,
        value: valueInput.value.trim(),
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string',
        lookup: selectedOperatorOption?.dataset.lookup || 'exact' // Store backend lookup
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

    // Prevent removing the last filter
    const currentFilterRows = muniFiltersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) {
         console.log("Cannot remove the last muni filter.");
        return; // Stop the function here
    }

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

/** Fetches the list of customers accessible to the current user. */
async function loadCustomers(page = 1) {
    console.log(`Attempting to load customers (page ${page})...`);
    // Show loading state in dropdown
    customerSelect.innerHTML = '<option value="">Loading customers...</option>';
    customerSelect.disabled = true;
    portfolioFilterContainer.classList.add('hidden'); // Hide portfolio dropdown

    try {
        // NOTE: Assuming customer list isn't huge, fetch page 1 for now.
        // TODO: Implement full pagination for customer list if necessary.
        const res = await fetch(`${apiRoot}/customers/?page=${page}`);
        console.log("Load customers response status:", res.status);
        if (!res.ok) throw new Error(`HTTP error loading customers! Status: ${res.status}`);

        const data = await res.json(); // Expect paginated response { count, next, previous, results }
        customers = data.results || []; // Store fetched customers
        console.log("Customers loaded:", customers.length, "Total:", data.count);

        // Populate the main customer dropdown
        customerSelect.innerHTML = ''; // Clear loading message
        if (data.count === 0) {
             customerSelect.innerHTML = '<option value="">No customers found</option>';
             portfolioNameEl.textContent = "No customers available for this user.";
             clearTableAndCharts();
             return; // Stop if no customers
        }

        // Add a default selection prompt if multiple customers exist
        if (data.count > 1 || !IS_ADMIN_USER) { // Show prompt if multiple or if non-admin (even if only 1)
             customerSelect.innerHTML = '<option value="">-- Select Customer --</option>';
        }

        // Add customer options
        customers.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id; // Use internal ID
            option.textContent = `${c.name || 'Unnamed'} (${c.customer_number || 'No Number'})`;
            customerSelect.appendChild(option);
        });

        customerSelect.disabled = false; // Enable dropdown

        // Handle initial state: If only one customer and it's an admin, auto-select.
        // Otherwise, wait for user selection via the '-- Select Customer --' prompt.
        if (data.count === 1 && IS_ADMIN_USER) {
            customerSelect.value = customers[0].id;
            await handleCustomerSelection(); // Auto-trigger selection
        } else {
             // Reset portfolio dropdown and main content area until customer is selected
             portfolioNameEl.textContent = "Please select a customer";
             clearTableAndCharts();
             portfolioFilterContainer.classList.add('hidden');
             deletePortfolioBtn.disabled = true;
        }

    } catch (error) {
        console.error("Failed to load customers:", error);
        customerSelect.innerHTML = '<option value="">Error loading</option>';
        portfolioNameEl.textContent = "Error loading customers";
        clearTableAndCharts();
    }
}

/** Handles the selection of a customer from the main dropdown. */
async function handleCustomerSelection() {
    const previousCustomerId = selectedCustomerId;
    selectedCustomerId = customerSelect.value; // Update global state

    // Only proceed if the customer ID actually changed or was initially null
    if (selectedCustomerId === previousCustomerId && previousCustomerId !== null) {
        return;
    }

    console.log(`Customer selected: ID ${selectedCustomerId}`);

    // Clear selections from previous customer/portfolio
    clearHoldingSelection();
    clearMuniOfferingSelection();

    if (!selectedCustomerId) {
        // Handle case where "-- Select Customer --" is chosen
        portfolioNameEl.textContent = "Please select a customer.";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true;
        return;
    }

    // Find the selected customer object (should be in 'customers' array from loadCustomers)
    const selectedCustomer = customers.find(c => c.id == selectedCustomerId);
    const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || selectedCustomerId}`;

    // Update UI and fetch portfolios for the selected customer
    portfolioNameEl.textContent = `Loading portfolios for ${customerDisplayName}...`;
    clearTableAndCharts(); // Clear previous data
    portfolioFilterContainer.classList.add('hidden'); // Hide portfolio dropdown until loaded
    deletePortfolioBtn.disabled = true; // Disable delete until a portfolio is selected

    await loadPortfolios(selectedCustomerId); // Fetch and display portfolios
}

/** Fetches portfolios for the selected customer (Handles pagination). */
async function loadPortfolios(customerId, page = 1) {
    console.log(`Attempting to load portfolios for customer ID: ${customerId} (page ${page})`);
    portfolioFilterSelect.innerHTML = '<option value="">Loading portfolios...</option>';
    portfolioFilterSelect.disabled = true;
    portfolioFilterContainer.classList.remove('hidden'); // Show container while loading

    try {
        // Fetch portfolios filtered by owner ID (backend handles permission)
        // Add page parameter
        const res = await fetch(`${apiRoot}/portfolios/?owner=${customerId}&page=${page}`);
        console.log("Load portfolios response status:", res.status);
        if (!res.ok) throw new Error(`HTTP error fetching portfolios! Status: ${res.status}`);

        const data = await res.json(); // Expect paginated response { count, next, previous, results }
        currentPortfolios = data.results || []; // Store portfolios for the current page
        console.log(`Portfolios loaded for customer ${customerId}:`, currentPortfolios.length, "Total:", data.count);

        portfolioFilterSelect.innerHTML = ''; // Clear loading message

        if (data.count === 0) {
            // No portfolios found for this customer
            portfolioFilterSelect.innerHTML = '<option value="">No portfolios found</option>';
            const selectedCustomer = customers.find(c => c.id == customerId);
            const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || customerId}`;
            portfolioNameEl.textContent = `${customerDisplayName} - No Portfolios Found`;
            portfolioFilterContainer.classList.add('hidden'); // Hide dropdown again
            deletePortfolioBtn.disabled = true;
            clearTableAndCharts();
            return; // Stop if no portfolios
        }

        // Add a default selection prompt if multiple portfolios exist
        if (data.count > 1) {
             portfolioFilterSelect.innerHTML = '<option value="">-- Select Portfolio --</option>';
        }

        // Populate the portfolio dropdown with the fetched portfolios (current page)
        currentPortfolios.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.name || `Portfolio ${p.id}`;
            option.dataset.isDefault = p.is_default || false; // Store default status
            portfolioFilterSelect.appendChild(option);
            // If this is the default portfolio, select it automatically
            if (p.is_default) {
                portfolioFilterSelect.value = p.id;
            }
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

        portfolioFilterSelect.disabled = false; // Enable dropdown

        // Trigger selection handler to load holdings for the initially selected/default portfolio
        await handlePortfolioSelection();

    } catch (error) {
        console.error("Failed to load or process portfolios:", error);
        portfolioFilterSelect.innerHTML = '<option value="">Error loading</option>';
        portfolioNameEl.textContent = "Error loading portfolios";
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true;
        clearTableAndCharts();
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

    const selectedCustomer = customers.find(c => c.id == selectedCustomerId);
    const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || selectedCustomerId}`;

    if (!selectedPortfolioId) {
        // Handle case where "-- Select Portfolio --" is chosen
        console.log("No specific portfolio selected.");
        portfolioNameEl.textContent = `${customerDisplayName} - Select a Portfolio`;
        clearTableAndCharts();
        return;
    }

    // Find the portfolio name
    const selectedPortfolio = currentPortfolios.find(p => p.id == selectedPortfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${selectedPortfolioId}`;
    portfolioNameEl.textContent = `Loading ${portfolioDisplayName}...`; // Set loading title
    clearTableAndCharts(); // Clear previous data

    // Fetch the first page of holdings for the selected portfolio using current filters/sort
    await applyHoldingsFiltersAndFetchPage(1);
}


/**
 * Fetches a specific page of holdings for a given portfolio ID, applying current filters and sorting.
 * Updates the `currentHoldingsData` state and triggers UI rendering.
 */
async function fetchHoldings(portfolioId, page = 1) {
    const selectedPortfolio = currentPortfolios.find(p => p.id == portfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${portfolioId}`;
    console.log(`Fetching holdings page ${page} for portfolio ID: ${portfolioId} with filters/sort.`);
    portfolioNameEl.textContent = `Loading ${portfolioDisplayName} (Page ${page})...`;
    // Show loading state in table
    const colSpan = (tableHeaders.length || 11) + 1;
    if(tableBody) tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading holdings...</td></tr>`;
    renderPaginationControls(holdingsPaginationControls, null); // Clear pagination during load

    // Construct API URL with portfolio filter, page, sorting, and active filters
    const sortParam = `ordering=${currentSortDir === 'desc' ? '-' : ''}${currentSortKey}`;

    // Build filter query parameters from activeFilters state
    const filterParams = activeFilters
        .filter(f => f.value !== '') // Only include filters with values
        .map(f => {
            // Map frontend column key to backend field name if necessary
            let backendColumn = f.column;
            if (f.column === 'wal') backendColumn = 'holding_average_life';
            if (f.column === 'security_cusip') backendColumn = 'security__cusip';
            if (f.column === 'security_description') backendColumn = 'security__description';
            // Add other mappings as needed...

            // Handle negation for '!=' operator
            const lookup = (f.operator === '!=') ? `exclude=true&${backendColumn}__${f.lookup}` : `${backendColumn}__${f.lookup}`;
            return `${lookup}=${encodeURIComponent(f.value)}`;
        })
        .join('&');

    const fetchUrl = `${apiRoot}/holdings/?portfolio=${portfolioId}&page=${page}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    console.log("Fetching holdings URL:", fetchUrl);

    try {
        const res = await fetch(fetchUrl);
        console.log(`Load holdings response status for portfolio '${portfolioDisplayName}' page ${page}:`, res.status);

        if (!res.ok) {
            if (res.status === 404 && page > 1) {
                console.warn(`Page ${page} not found for portfolio ${portfolioId}. Fetching page 1 instead.`);
                await fetchHoldings(portfolioId, 1); // Go back to page 1
                return;
            } else {
                 let errorData = { detail: `HTTP error! Status: ${res.status}` };
                 try { errorData = await res.json(); } catch (e) { /* ignore if response body is not JSON */ }
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }

        // Successfully fetched holdings data for the page
        const data = await res.json(); // Expect { count, next, previous, results }
        console.log(`Holdings page ${page} loaded for portfolio '${portfolioDisplayName}':`, data.results?.length, "Total:", data.count);

        // Update global state for holdings
        currentHoldingsData = {
            results: data.results || [], // Store raw results from server
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        };

        // Set final title
        portfolioNameEl.textContent = portfolioDisplayName;

        // Process and display the fetched holdings page
        processAndDisplayHoldings(); // Renders table, totals, charts (using current page data)
        // Render pagination controls based on the new state
        renderPaginationControls(holdingsPaginationControls, currentHoldingsData, 'holdings');

    } catch (error) {
        console.error("Failed to fetch or process holdings:", error);
        portfolioNameEl.textContent = `Error loading holdings for ${portfolioDisplayName}`;
        currentHoldingsData = { results: [], count: 0, nextUrl: null, previousUrl: null, currentPage: 1 }; // Reset state
        clearTableAndCharts(); // Clear UI elements
        if(tableBody) tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading holdings. Check console.</td></tr>`;
        renderPaginationControls(holdingsPaginationControls, null); // Clear pagination
    }
}


/**
 * Processes the raw holding data received from the server for the current page.
 * Adds calculated/parsed fields needed for display, sorting, charts, and export.
 * Triggers rendering of table, totals, and charts.
 */
function processAndDisplayHoldings() {
    const holdingsPage = currentHoldingsData.results; // Use data from the current page
    console.log("Processing and displaying holdings page:", holdingsPage.length);

    // Iterate through each holding on the current page and add processed fields
    holdingsPage.forEach(h => {
        // ASSUMPTION: Field names below match the CustomerHoldingSerializer output.
        // Verify these against the actual serializer definition if possible.

        // Parse numbers provided as strings (due to potential Decimal serialization)
        h.par_value_num = parseFloatSafe(h.par_value); // Use value directly from serializer
        h.settlement_price_num = parseFloatSafe(h.settlement_price);
        h.book_price_num = parseFloatSafe(h.book_price);
        h.book_yield_num = parseFloatSafe(h.book_yield);
        h.holding_duration_num = parseFloatSafe(h.holding_duration);
        h.holding_average_life_num = parseFloatSafe(h.holding_average_life); // WAL field name? Verify.
        h.market_price_num = parseFloatSafe(h.market_price);
        h.market_yield_num = parseFloatSafe(h.market_yield);
        // Coupon likely comes from the nested security object
        h.coupon_num = parseFloatSafe(h.security?.coupon); // Access nested security data

        // Parse date strings into Date objects
        h.maturity_date_obj = parseDate(h.security?.maturity_date); // Access nested security data
        h.call_date_obj = parseDate(h.security?.call_date);       // Access nested security data
        h.settlement_date_obj = parseDate(h.settlement_date);
        h.holding_average_life_date_obj = parseDate(h.holding_average_life_date);
        h.market_date_obj = parseDate(h.market_date);

        // Add ISO formatted date strings for potential export consistency
        h.maturity_date_str_iso = h.maturity_date_obj ? h.maturity_date_obj.toISOString().split('T')[0] : (h.security?.maturity_date || '');
        h.call_date_str_iso = h.call_date_obj ? h.call_date_obj.toISOString().split('T')[0] : (h.security?.call_date || '');
        h.settlement_date_str_iso = h.settlement_date_obj ? h.settlement_date_obj.toISOString().split('T')[0] : (h.settlement_date || '');

        // Add direct access to nested security fields used in table/sort/filter
        // These should match the data-key values in the HTML table headers
        h.security_cusip = h.security?.cusip;
        h.security_description = h.security?.description;
        // 'intention_code' is directly on the holding model/serializer
        // 'wal' data-key maps to 'holding_average_life'
        // 'holding_duration' data-key maps to 'holding_duration'
    });

    // Render the table with the current page's processed data
    renderTable(holdingsPage);
    // Calculate totals based ONLY on the current page's data for display consistency
    renderTotals(holdingsPage);
    // Update sort indicators in the table header
    updateSortIndicators();
    // Render charts based on the current page's processed data
    // WARNING: Charts only reflect the data visible on the current page.
    renderCharts(holdingsPage);
}


// --- Muni Offerings Fetching and Rendering (Paginated) ---

/**
 * Fetches a specific page of municipal offerings data from the API, applying filters/sorting.
 * Updates `currentMuniOfferingsData` state and triggers UI rendering.
 */
async function loadMuniOfferings(page = 1) {
    console.log(`Attempting to load municipal offerings (page ${page}) with filters/sort...`);
    if (!muniOfferingsTableBody) {
        console.warn("Muni offerings table body not found. Skipping load.");
        return;
    }

    // Display loading message
    const colSpan = (muniTableHeaders.length || 14); // Calculate colspan
    muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading offerings (Page ${page})...</td></tr>`;
    renderPaginationControls(muniPaginationControls, null); // Clear pagination during load

    // Build filter query parameters
    const filterParams = activeMuniFilters
        .filter(f => f.value !== '')
        .map(f => {
            const lookup = (f.operator === '!=') ? `exclude=true&${f.column}__${f.lookup}` : `${f.column}__${f.lookup}`;
            return `${lookup}=${encodeURIComponent(f.value)}`;
        })
        .join('&');
    // Build sort query parameters
    const sortParam = `ordering=${currentMuniSortDir === 'desc' ? '-' : ''}${currentMuniSortKey}`;

    const fetchUrl = `${apiRoot}/muni-offerings/?page=${page}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    console.log("Fetching Muni Offerings URL:", fetchUrl);

    try {
        const response = await fetch(fetchUrl);
        console.log("Load muni offerings response status:", response.status);
        if (!response.ok) {
            if (response.status === 404 && page > 1) {
                console.warn(`Page ${page} not found for muni offerings. Fetching page 1 instead.`);
                await loadMuniOfferings(1); // Go back to page 1
                return;
            } else {
                 let errorData = { detail: `HTTP error! Status: ${response.status}` };
                 try { errorData = await response.json(); } catch (e) { /* ignore */ }
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }

        const data = await response.json(); // Expect { count, next, previous, results }
        console.log(`Muni offerings page ${page} loaded:`, data.results?.length, "Total:", data.count);

        // Update global state for muni offerings
        currentMuniOfferingsData = {
            results: data.results || [], // Store raw results
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
        if(muniOfferingsTableBody) muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading offerings. Check console.</td></tr>`;
        currentMuniOfferingsData = { results: [], count: 0, nextUrl: null, previousUrl: null, currentPage: 1 }; // Reset state
        renderPaginationControls(muniPaginationControls, null); // Clear pagination
    }
}

/** Processes and renders the current page of muni offerings. */
function processAndDisplayMuniOfferings() {
    const offeringsPage = currentMuniOfferingsData.results;
    console.log("Processing and displaying muni offerings page:", offeringsPage.length);

    // Process raw data: parse numbers and dates
    offeringsPage.forEach(offering => {
        // ASSUMPTION: Field names match MunicipalOfferingSerializer output
        offering.amount_num = parseFloatSafe(offering.amount);
        offering.coupon_num = parseFloatSafe(offering.coupon);
        offering.yield_rate_num = parseFloatSafe(offering.yield_rate);
        offering.price_num = parseFloatSafe(offering.price);
        offering.call_price_num = parseFloatSafe(offering.call_price);
        // Parse date fields into Date objects
        offering.maturity_date_obj = parseDate(offering.maturity_date);
        offering.call_date_obj = parseDate(offering.call_date);
        // Keep original string dates as fallback for display
        offering.maturity_date_str = offering.maturity_date;
        offering.call_date_str = offering.call_date;
         // Add ISO formatted date strings for potential export consistency
        offering.maturity_date_str_iso = offering.maturity_date_obj ? offering.maturity_date_obj.toISOString().split('T')[0] : (offering.maturity_date || '');
        offering.call_date_str_iso = offering.call_date_obj ? offering.call_date_obj.toISOString().split('T')[0] : (offering.call_date || '');
    });

    // Render the processed data for the current page
    renderMuniOfferingsTable(offeringsPage);
}


/** Renders the municipal offerings data into the HTML table. */
function renderMuniOfferingsTable(offeringsData) {
    if (!muniOfferingsTableBody) return; // Safety check
    muniOfferingsTableBody.innerHTML = ''; // Clear previous content

    const colSpan = (muniTableHeaders.length || 14);

    if (!offeringsData || offeringsData.length === 0) {
        // Display message if no offerings match filters or none exist
        const hasActiveFilters = activeMuniFilters.some(f => f.value !== '');
        const message = hasActiveFilters ? 'No offerings match filter criteria.' : (currentMuniOfferingsData.count === 0 ? 'No municipal offerings available.' : 'No offerings on this page.');
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">${message}</td></tr>`;
        // Reset select-all checkbox and disable buy button
        if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
        if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; }
        return;
    }

    // Create table rows for each offering
    offeringsData.forEach(o => {
        const row = document.createElement('tr');
        row.dataset.offeringId = o.id; // Store ID (integer PK) for selection

        // Checkbox cell
        const isChecked = selectedMuniOfferingIds.has(o.id);
        const checkboxCell = document.createElement('td');
        checkboxCell.className = 'checkbox-column';
        checkboxCell.innerHTML = `<input type="checkbox" class="muni-checkbox" data-offering-id="${o.id}" data-cusip="${o.cusip || ''}" data-amount="${(o.amount_num ?? 0).toFixed(2)}" ${isChecked ? 'checked' : ''} aria-label="Select offering ${o.cusip || 'N/A'}">`;
        row.appendChild(checkboxCell);

        // Helper function to add a table cell with content, alignment, and dataKey
        // ** FIX: Pass dataKey to addCell **
        const addCell = (content, align = 'left', dataKey = null) => {
            const cell = document.createElement('td');
            // Display 'N/A' for null or undefined values, format numbers/dates
            let displayContent = 'N/A';
            if (content instanceof Date) {
                displayContent = content.toLocaleDateString();
            } else if (typeof content === 'number') {
                 // Basic number formatting (can be customized)
                 // ** FIX: Use passed dataKey for formatting check **
                 if (dataKey && ['amount', 'price', 'call_price'].includes(dataKey)) {
                     displayContent = content.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                 } else if (dataKey && ['coupon', 'yield_rate'].includes(dataKey)) {
                     displayContent = content.toFixed(3);
                 } else {
                     displayContent = content.toString();
                 }
            } else if (content !== null && content !== undefined && content !== '') {
                displayContent = content;
            }
            cell.textContent = displayContent;
            cell.style.textAlign = align;
            row.appendChild(cell); // Append AFTER setting content/style
        };

        // Add cells using the processed values (_num, _obj) and pass dataKey
        // Match the order defined in index.html muni-offerings-table headers
        addCell(o.cusip, 'left', 'cusip');
        addCell(o.amount_num, 'right', 'amount');
        addCell(o.description, 'left', 'description');
        addCell(o.coupon_num, 'right', 'coupon');
        addCell(o.maturity_date_obj ?? o.maturity_date_str, 'center', 'maturity_date'); // Use Date obj or fallback string
        addCell(o.yield_rate_num, 'right', 'yield_rate');
        addCell(o.price_num, 'right', 'price');
        addCell(o.moody_rating || 'N/A', 'left', 'moody_rating');
        addCell(o.sp_rating || 'N/A', 'left', 'sp_rating');
        addCell(o.call_date_obj ?? o.call_date_str, 'center', 'call_date'); // Use Date obj or fallback string
        addCell(o.call_price_num, 'right', 'call_price');
        addCell(o.state || 'N/A', 'left', 'state');
        addCell(o.insurance || 'N/A', 'left', 'insurance');

        // ** ERROR WAS HERE: Original code appended row inside addCell, now appending outside **
        // No, the original code appended the cell inside addCell, which was correct.
        // The error was trying to access cell.parentElement *before* appending.
        // The fix is passing dataKey, not changing the append location.
        // The code above reflects the fix by passing dataKey.

        // Append the completed row to the table body
        muniOfferingsTableBody.appendChild(row);
    });

    // Update the state of the "Select All" checkbox and the "Buy" button
    updateSelectAllMunisCheckboxState();
    emailBuyInterestBtn.disabled = selectedMuniOfferingIds.size === 0;
}


// --- Client-Side Filtering/Sorting Logic (REMOVED) ---
// Filtering and sorting are now handled server-side via API parameters.

// --- UI Rendering ---

/** Renders the holdings data for the current page into the HTML table body. */
function renderTable(holdingsPage) {
    // console.log("Rendering holdings table with page data:", holdingsPage.length); // Keep commented unless debugging
    const colSpan = (tableHeaders.length || 13) + 1; // Dynamic colspan based on header count (13 data + 1 checkbox)

    if (!tableBody) {
        console.error("Holdings table body not found!");
        return;
    }
    tableBody.innerHTML = ''; // Clear previous content

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
    holdingsPage.forEach(h => {
        const row = document.createElement('tr');
        // Use ticket_id (UUID string) for the data attribute
        row.dataset.holdingId = h.ticket_id;

        // Format values for display using processed fields (_num, _obj)
        const maturityDisplay = h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : (h.security?.maturity_date || 'N/A');
        const callDisplay = h.call_date_obj ? h.call_date_obj.toLocaleDateString() : (h.security?.call_date || 'N/A');
        const parDisplay = (h.par_value_num ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const bookPriceDisplay = (h.book_price_num ?? 0).toFixed(6); // Book Price
        const marketPriceDisplay = (h.market_price_num ?? 0).toFixed(6); // Market Price
        const couponDisplay = (h.coupon_num ?? 0).toFixed(3); // Coupon from security
        const bookYieldDisplay = (h.book_yield_num ?? 0).toFixed(3); // Book Yield
        const walDisplay = (h.holding_average_life_num ?? 0).toFixed(2); // WAL (Avg Life)
        const durationDisplay = (h.holding_duration_num ?? 0).toFixed(2); // Duration
        const intentionDisplay = h.intention_code || 'N/A'; // Intention Code

        const isChecked = selectedHoldingIds.has(h.ticket_id); // Use internal ticket_id for selection tracking

        // Create cells in the order defined by index.html headers
        row.innerHTML = `
            <td class="checkbox-column">
                <input type="checkbox" class="holding-checkbox" data-holding-id="${h.ticket_id}" data-cusip="${h.security_cusip || ''}" data-par="${(h.par_value_num ?? 0).toFixed(2)}" ${isChecked ? 'checked' : ''} aria-label="Select holding ${h.security_cusip || 'N/A'}">
            </td>
            <td style="text-align: left;">${h.security_cusip || 'N/A'}</td>
            <td style="text-align: left;">${h.security_description || ''}</td>
            <td style="text-align: right;">${parDisplay}</td>
            <td style="text-align: right;">${bookPriceDisplay}</td>
            <td style="text-align: right;">${marketPriceDisplay}</td>
            <td style="text-align: right;">${couponDisplay}</td>
            <td style="text-align: right;">${bookYieldDisplay}</td>
            <td style="text-align: right;">${walDisplay}</td>
            <td style="text-align: right;">${durationDisplay}</td>
            <td style="text-align: center;">${maturityDisplay}</td>
            <td style="text-align: center;">${callDisplay}</td>
            <td style="text-align: center;">${intentionDisplay}</td>
        `;
         tableBody.appendChild(row);
    });

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

        // Map frontend key to potential backend key if necessary
        // Example: If HTML uses 'wal' but backend uses 'holding_average_life'
        let backendKey = key;
        if (key === 'wal') backendKey = 'holding_average_life';
        if (key === 'security_cusip') backendKey = 'security__cusip'; // Handle related field
        if (key === 'security_description') backendKey = 'security__description'; // Handle related field
        // Add other mappings as needed

        if (backendKey === currentSortKey) {
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

    // Weighted averages require totalPar > 0 to avoid division by zero
    const weightedYieldSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + ((h.par_value_num ?? 0) * (h.book_yield_num ?? 0)), 0) : 0;
    const totalYield = totalPar > 0 ? weightedYieldSum / totalPar : 0;

    const weightedWalSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + ((h.par_value_num ?? 0) * (h.holding_average_life_num ?? 0)), 0) : 0;
    const totalWal = totalPar > 0 ? weightedWalSum / totalPar : 0;

    const weightedDurationSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + ((h.par_value_num ?? 0) * (h.holding_duration_num ?? 0)), 0) : 0;
    const totalDuration = totalPar > 0 ? weightedDurationSum / totalPar : 0;


    // Update the footer cells with formatted values
    // Ensure the IDs match the tfoot elements in index.html
    const totalsParEl = document.getElementById('totals-par');
    const totalsYieldEl = document.getElementById('totals-yield');
    const totalsWalEl = document.getElementById('totals-wal');
    const totalsDurationEl = document.getElementById('totals-duration'); // Added Duration

    if (totalsParEl) totalsParEl.textContent = totalPar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (totalsYieldEl) totalsYieldEl.textContent = totalYield.toFixed(3); // Using Book Yield
    if (totalsWalEl) totalsWalEl.textContent = totalWal.toFixed(2); // Using Avg Life (WAL)
    if (totalsDurationEl) totalsDurationEl.textContent = totalDuration.toFixed(2); // Using Duration
}

/** Destroys an existing Chart.js instance if it exists. */
function destroyChart(chartId) {
    if (chartInstances[chartId]?.destroy) { // Check if instance exists and has destroy method
        chartInstances[chartId].destroy();
        delete chartInstances[chartId]; // Remove from tracking object
    }
}

/**
 * Renders all the charts based on the holdings data from the CURRENT PAGE.
 * WARNING: Charts only reflect the data visible on the current page.
 */
function renderCharts(holdingsDataForCharts) {
    console.log("Rendering charts with CURRENT PAGE data count:", holdingsDataForCharts.length);

    // Destroy existing charts before creating new ones
    Object.keys(chartInstances).forEach(destroyChart);
    chartInstances = {}; // Reset tracking object

    // Check if Chart.js library is loaded
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js library not loaded. Skipping chart rendering.");
        return;
    }

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
    // Uses 'holding_average_life_num' (mapped from 'wal' key in HTML) and 'book_yield_num'
    const yieldLifePoints = holdingsDataForCharts
        .filter(h => h.holding_average_life_num !== null && h.book_yield_num !== null)
        .map(h => ({ x: h.holding_average_life_num, y: h.book_yield_num }));

    if (yieldLifePoints.length > 0 && contexts.yieldVsMaturityChart) {
        const options1 = structuredClone(baseChartOptionsStatic); // Deep clone base options
        options1.plugins.title.text = 'Book Yield vs. Holding Avg Life (Current Page)'; // Updated Title
        options1.scales.x.type = 'linear';
        options1.scales.x.position = 'bottom';
        options1.scales.x.title.text = 'Holding Average Life (Years)'; // Updated X Axis Label
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

        // Add trendline if plugin is available and registered
        if (window.pluginTrendlineLinear && Chart.registry.plugins.get('pluginTrendlineLinear')) {
            dataset1.trendlineLinear = {
                style: isDark ? "rgba(255, 80, 80, 0.9)" : "rgba(255, 50, 50, 0.8)", // Reddish trendline
                lineStyle: "solid",
                width: 2,
                projection: false // Don't project beyond data range
            };
        } else {
             console.log("Trendline plugin not available or not registered for Yield/Life chart.");
        }

        chartInstances.yieldVsMaturityChart = new Chart(contexts.yieldVsMaturityChart, {
            type: 'scatter',
            data: { datasets: [dataset1] },
            options: options1,
             plugins: [pdfBackgroundPlugin] // Register background plugin
        });
    }

    // --- 2. Total Par by Maturity Year (Bar Chart) ---
    // Uses 'maturity_date_obj' and 'par_value_num'
    const maturityBuckets = {};
    holdingsDataForCharts.forEach(h => {
        const year = h.maturity_date_obj ? h.maturity_date_obj.getFullYear() : 'Unknown';
        if (year !== 'Unknown' && !isNaN(year)) {
            maturityBuckets[year] = (maturityBuckets[year] || 0) + (h.par_value_num ?? 0);
        }
    });
    const sortedYears = Object.keys(maturityBuckets).map(Number).sort((a, b) => a - b); // Sort years numerically

    if (sortedYears.length > 0 && contexts.parByMaturityYearChart) {
        const options2 = structuredClone(baseChartOptionsStatic);
        options2.plugins.title.text = 'Total Par by Maturity Year (Current Page)'; // Updated Title
        options2.scales.x.title.text = 'Maturity Year';
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
            options: options2,
            plugins: [pdfBackgroundPlugin] // Register background plugin
        });
    }

    // --- 3. Portfolio Par Distribution by Coupon Rate (Pie Chart) ---
    // Uses 'coupon_num' and 'par_value_num'
    const couponBuckets = {};
    holdingsDataForCharts.forEach(h => {
        const couponRate = (h.coupon_num ?? 0).toFixed(3); // Group by coupon rate (from security)
        couponBuckets[couponRate] = (couponBuckets[couponRate] || 0) + (h.par_value_num ?? 0);
    });
    const sortedCoupons = Object.keys(couponBuckets).sort((a, b) => parseFloat(a) - parseFloat(b)); // Sort coupons numerically

    if (sortedCoupons.length > 0 && contexts.couponPieChart) {
        const pieColors = generateDistinctColors(sortedCoupons.length); // Generate colors for slices
        const options3 = structuredClone(baseChartOptionsStatic);
        delete options3.scales; // Pie charts don't have scales
        options3.plugins.title.text = 'Par Distribution by Coupon Rate (Current Page)';
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
            options: options3,
            plugins: [pdfBackgroundPlugin] // Register background plugin
        });
    }

    // --- 4. Book Price vs. Book Yield (Scatter Plot) ---
    // Uses 'book_price_num' and 'book_yield_num'
    const priceYieldPoints = holdingsDataForCharts
        .filter(h => h.book_price_num !== null && h.book_price_num > 0 && h.book_yield_num !== null)
        .map(h => ({ x: h.book_price_num, y: h.book_yield_num }));

    if (priceYieldPoints.length > 0 && contexts.priceVsYieldChart) {
        const options4 = structuredClone(baseChartOptionsStatic);
        options4.plugins.title.text = 'Book Price vs. Book Yield (Current Page)'; // Updated Title
        options4.scales.x.beginAtZero = false; // Price usually not zero
        options4.scales.x.title.text = 'Book Price';
        options4.scales.y.beginAtZero = false; // Yield can be negative
        options4.scales.y.title.text = 'Book Yield (%)'; // Updated Y Axis
        options4.plugins.tooltip.callbacks = { label: ctx => `Price: ${ctx.parsed.x.toFixed(6)}, Yield: ${ctx.parsed.y.toFixed(3)}` }; // Updated precision
        options4.plugins.pdfBackground = pdfBackgroundPlugin;

        chartInstances.priceVsYieldChart = new Chart(contexts.priceVsYieldChart, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Book Price vs Yield',
                    data: priceYieldPoints,
                    backgroundColor: isDark ? 'rgba(255, 200, 50, 0.7)' : 'rgba(255, 193, 7, 0.6)', // Yellow/Orange points
                    borderColor: isDark ? 'rgba(255, 210, 70, 1)' : 'rgba(255, 193, 7, 1)',
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    showLine: false
                }]
            },
            options: options4,
            plugins: [pdfBackgroundPlugin] // Register background plugin
        });
    }
}


// --- UI Update Triggers ---

/** Applies server-side filters and sorting by fetching the specified page for Holdings. */
function applyHoldingsFiltersAndFetchPage(page = 1) {
    const portfolioId = portfolioFilterSelect.value;
    if (portfolioId) {
        // Clear current selection when filters/sort change
        clearHoldingSelection();
        fetchHoldings(portfolioId, page); // Fetch the requested page with current filters/sort
    } else {
        console.warn("Cannot apply holdings filters: No portfolio selected.");
        // Optionally clear the table or show a message
        clearTableAndCharts();
    }
}

/** Applies server-side filters and sorting by fetching the specified page for Munis. */
function applyMuniFiltersAndFetchPage(page = 1) {
    // Clear current selection when filters/sort change
    clearMuniOfferingSelection();
    loadMuniOfferings(page); // Fetch the requested page with current filters/sort
}


/** Clears the holdings table, totals, charts, selections, and pagination. */
function clearTableAndCharts() {
    const colSpan = (tableHeaders.length || 13) + 1; // Adjusted colspan for 13 data columns + checkbox
    if (tableBody) {
        // Display a generic loading/cleared message
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Select customer/portfolio...</td></tr>`;
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
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    darkModeToggle.textContent = isDark ? 'Toggle Light Mode' : 'Toggle Dark Mode';

    // Re-render charts to apply new theme colors, only if charts exist
    try {
        // Check if localStorage is accessible before potentially using it for theme persistence
        localStorage.setItem('themeCheck', '1');
        localStorage.removeItem('themeCheck');
        // Re-render charts if they have been initialized
        if (Object.keys(chartInstances).length > 0 && currentHoldingsData.results.length > 0) {
             renderCharts(currentHoldingsData.results); // Re-render holdings charts with new colors
        }
    } catch (e) {
        console.warn("localStorage not accessible, charts will not update theme colors dynamically if persistence fails.");
        // Still attempt to re-render charts even if localStorage fails, theme class on body changed anyway
        if (Object.keys(chartInstances).length > 0 && currentHoldingsData.results.length > 0) {
             renderCharts(currentHoldingsData.results);
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
    // WARNING: This exports ONLY the holdings shown on the current page.
    console.warn("PDF export currently only includes data from the current page.");

    // Check if jsPDF and autoTable are loaded
    if (typeof jsPDF === 'undefined') {
        console.error("jsPDF library not loaded.");
        alert("Error: PDF export library (jsPDF) not loaded. Please check the console.");
        return;
    }
     if (typeof window.jspdf.jsPDF.autoTable !== 'function') {
        console.error("jsPDF-AutoTable plugin not loaded or attached correctly.");
        alert("Error: PDF export library (jsPDF-AutoTable) not loaded. Please check the console.");
        return;
    }

    const doc = new jsPDF({
        orientation: 'landscape', // Use landscape for potentially wide table
        unit: 'pt',
        format: 'a4'
    });

    // Determine colors based on current theme for PDF elements
    const isDark = document.body.classList.contains('dark-mode');
    const pdfHeaderBg = isDark ? '#3a3a3a' : '#e9ecef';
    const pdfHeaderText = isDark ? '#e0e0e0' : '#495057';
    const pdfTextColor = isDark ? '#f1f1f1' : '#333333'; // Use theme text color
    const pdfBorderColor = isDark ? '#444444' : '#dee2e6';
    const pdfRowBg = isDark ? '#2c2c2c' : '#ffffff';
    const pdfAlternateRowBg = isDark ? '#303030' : '#f8f9fa';

    // Page dimensions and margins
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40; // Points
    const usableWidth = pageWidth - (2 * margin);
    const usableHeight = pageHeight - (2 * margin);
    let currentY = margin; // Track current Y position

    // --- Title ---
    doc.setFontSize(18);
    doc.setTextColor(isDark ? 241 : 51); // Use theme-aware text color
    const viewTitle = portfolioNameEl.textContent || 'Portfolio Analysis';
    const pageInfo = `(Page ${currentHoldingsData.currentPage} of ${Math.ceil(currentHoldingsData.count / PAGE_SIZE)})`;
    doc.text(`${viewTitle} - Analysis ${pageInfo}`, margin, currentY);
    currentY += 30; // Add space after title

    // --- Charts ---
    doc.setFontSize(14);
    doc.setTextColor(isDark ? 200 : 70);
    doc.text("Charts (Current Page View)", margin, currentY);
    currentY += 20;

    const chartGap = 20;
    const chartWidth = (usableWidth - chartGap) / 2;
    // Adjust chart height - make them smaller in landscape to fit table better
    const chartHeight = Math.min(150, (usableHeight - currentY - margin - 50) / 2); // Limit height
    const chartStartX1 = margin;
    const chartStartX2 = margin + chartWidth + chartGap;
    const chartStartY1 = currentY;
    const chartStartY2 = chartStartY1 + chartHeight + chartGap;

    // Get chart images as Base64 PNGs (using the white background plugin)
    const chartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart', 'priceVsYieldChart'];
    const chartImages = [];
    for (const chartId of chartIds) {
        const chartInstance = chartInstances[chartId];
        try {
            if (chartInstance) {
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
    let chartBottomY = chartStartY1; // Track bottom of charts
    if (chartImages[0]) { doc.addImage(chartImages[0], 'PNG', chartStartX1, chartStartY1, chartWidth, chartHeight); chartBottomY = Math.max(chartBottomY, chartStartY1 + chartHeight); }
    if (chartImages[1]) { doc.addImage(chartImages[1], 'PNG', chartStartX2, chartStartY1, chartWidth, chartHeight); chartBottomY = Math.max(chartBottomY, chartStartY1 + chartHeight); }
    if (chartImages[2]) { doc.addImage(chartImages[2], 'PNG', chartStartX1, chartStartY2, chartWidth, chartHeight); chartBottomY = Math.max(chartBottomY, chartStartY2 + chartHeight); }
    if (chartImages[3]) { doc.addImage(chartImages[3], 'PNG', chartStartX2, chartStartY2, chartWidth, chartHeight); chartBottomY = Math.max(chartBottomY, chartStartY2 + chartHeight); }

    currentY = chartBottomY + 30; // Update Y position below charts

    // --- Holdings Table (Current Page) ---
    doc.setFontSize(14);
    doc.setTextColor(isDark ? 200 : 70);
    doc.text("Holdings Table (Current Page View)", margin, currentY);
    currentY += 20;

    // Use jsPDF-AutoTable to generate the table from HTML element
    // Ensure the table has finished rendering before calling this
    if (!tableElement) {
        alert("Error: Holdings table element not found for PDF export.");
        return;
    }

    doc.autoTable({
        html: '#holdings-table', // Target the holdings table element
        startY: currentY, // Start below the title
        theme: 'grid', // Use grid theme for borders
        // Specify which columns to include (by index, skipping checkbox)
        columns: [
            { header: 'CUSIP', dataKey: 1 },
            { header: 'Description', dataKey: 2 },
            { header: 'Par', dataKey: 3 },
            { header: 'Book Price', dataKey: 4 },
            { header: 'Mkt Price', dataKey: 5 },
            { header: 'Coupon', dataKey: 6 },
            { header: 'Book Yield', dataKey: 7 },
            { header: 'WAL', dataKey: 8 },
            { header: 'Duration', dataKey: 9 },
            { header: 'Maturity', dataKey: 10 },
            { header: 'Call Date', dataKey: 11 },
            { header: 'Intention', dataKey: 12 },
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
        // Define column widths and alignments (adjust indices for selected columns)
        columnStyles: {
            // Index corresponds to the *selected* columns above (0=CUSIP, 1=Desc, etc.)
            0: { cellWidth: 55, halign: 'left' },    // CUSIP
            1: { cellWidth: 'auto', halign: 'left'}, // Description (auto width)
            2: { cellWidth: 60, halign: 'right' },   // Par
            3: { cellWidth: 45, halign: 'right' },   // Book Price
            4: { cellWidth: 45, halign: 'right' },   // Mkt Price
            5: { cellWidth: 40, halign: 'right' },   // Coupon
            6: { cellWidth: 40, halign: 'right' },   // Book Yield
            7: { cellWidth: 40, halign: 'right' },   // WAL
            8: { cellWidth: 40, halign: 'right' },   // Duration
            9: { cellWidth: 55, halign: 'center' },  // Maturity Date
            10: { cellWidth: 55, halign: 'center' }, // Call Date
            11: { cellWidth: 40, halign: 'center' }  // Intention
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
    } else if (selectedCustomerOption && selectedCustomerOption.value !== "") {
         baseFilename = selectedCustomerOption.text.split('(')[0].trim(); // Fallback to customer name
    }
    // Sanitize filename (replace non-alphanumeric with underscore)
    const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`portfolio_${safeFilename}_page${currentHoldingsData.currentPage}.pdf`); // Add page number
}

// --- Excel (XLSX) Export using SheetJS ---

/**
 * Exports the holdings data from the CURRENT PAGE ONLY to an XLSX file.
 */
function exportToXlsx() {
    // WARNING: This exports ONLY the holdings shown on the current page.
    console.warn("XLSX export currently only includes data from the current page.");

    // Check if SheetJS library is loaded
    if (typeof XLSX === 'undefined') {
        console.error("SheetJS library (XLSX) not loaded.");
        alert("Error: Excel export library not loaded. Please check the console.");
        return;
    }

    // Use the processed data from the current page
    const holdingsToExport = currentHoldingsData.results;

    if (!holdingsToExport || holdingsToExport.length === 0) {
        alert("No holdings data on the current page to export.");
        return;
    }

    // Define Headers (match the PDF export columns / table order)
    const headers = [
        "CUSIP", "Description", "Par", "Book Price", "Market Price", "Coupon",
        "Book Yield", "WAL", "Duration", "Maturity Date", "Call Date", "Intention"
    ];

    // Prepare data rows for SheetJS (Array of Arrays - AoA)
    // Use processed values for consistency
    const data = holdingsToExport.map(h => [
        h.security_cusip || '',             // String
        h.security_description || '',       // String
        h.par_value_num ?? null,            // Number or null
        h.book_price_num ?? null,           // Number or null
        h.market_price_num ?? null,         // Number or null
        h.coupon_num ?? null,               // Number or null (from security)
        h.book_yield_num ?? null,           // Number or null
        h.holding_average_life_num ?? null, // Number or null (WAL)
        h.holding_duration_num ?? null,     // Number or null (Duration)
        h.maturity_date_str_iso || '',      // String (YYYY-MM-DD)
        h.call_date_str_iso || '',          // String (YYYY-MM-DD)
        h.intention_code || ''              // String
    ]);

    // Combine headers and data
    const sheetData = [headers, ...data];

    // Create a worksheet from the array of arrays
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Optional: Set column widths (example - adjust as needed)
    ws['!cols'] = [
        { wch: 12 }, // CUSIP
        { wch: 40 }, // Description
        { wch: 15 }, // Par
        { wch: 12 }, // Book Price
        { wch: 12 }, // Market Price
        { wch: 10 }, // Coupon
        { wch: 10 }, // Book Yield
        { wch: 10 }, // WAL
        { wch: 10 }, // Duration
        { wch: 12 }, // Maturity Date
        { wch: 12 }, // Call Date
        { wch: 10 }  // Intention
    ];

    // Optional: Apply number formats (example)
    // Find columns with numeric data (e.g., Par, Prices, Coupon, Yields, WAL, Duration)
    const numberCols = [2, 3, 4, 5, 6, 7, 8]; // 0-based indices matching sheetData
    const precision6Cols = [3, 4]; // Book Price, Market Price
    const precision3Cols = [5, 6]; // Coupon, Book Yield
    const precision2Cols = [2, 7, 8]; // Par, WAL, Duration

    // Iterate through rows (skip header row 0) and apply formats
    for (let R = 1; R < sheetData.length; ++R) {
        numberCols.forEach(C => {
            const cell_address = { c: C, r: R };
            const cell_ref = XLSX.utils.encode_cell(cell_address);
            if (ws[cell_ref] && typeof ws[cell_ref].v === 'number') {
                if (precision6Cols.includes(C)) {
                    ws[cell_ref].z = '#,##0.000000'; // 6 decimal places
                } else if (precision3Cols.includes(C)) {
                    ws[cell_ref].z = '#,##0.000';   // 3 decimal places
                } else if (precision2Cols.includes(C)) {
                    ws[cell_ref].z = '#,##0.00';    // 2 decimal places
                } else {
                     ws[cell_ref].z = '#,##0.######'; // Default number format if needed
                }
            }
        });
        // Format Date columns (Maturity, Call)
        [9, 10].forEach(C => {
             const cell_address = { c: C, r: R };
             const cell_ref = XLSX.utils.encode_cell(cell_address);
             if (ws[cell_ref] && ws[cell_ref].v) { // Check if value exists
                 // Ensure it's treated as text if already string, or format if Date object
                 if (!(ws[cell_ref].v instanceof Date)) {
                     // If it's a string like 'YYYY-MM-DD', Excel usually handles it, but set type 's' just in case
                     if (typeof ws[cell_ref].v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ws[cell_ref].v)) {
                         ws[cell_ref].t = 's'; // Explicitly string
                     }
                 }
                 ws[cell_ref].z = 'yyyy-mm-dd'; // Apply date format hint
             }
        });
    }


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
    console.log("Showing create portfolio modal. Admin:", IS_ADMIN_USER);

    // Reset form and error message
    createPortfolioForm.reset();
    modalErrorMessage.textContent = '';
    modalErrorMessage.style.display = 'none';
    adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>'; // Reset dropdown

    // Configure the customer selection dropdown based on user type
    if (IS_ADMIN_USER) {
        // Admin: Show dropdown, fetch all customers if not already loaded
        adminCustomerSelectGroup.classList.remove('hidden');
        // Fetch full list for admin (handles potential pagination)
        fetchCustomersForAdminModal();
    } else {
        // Non-Admin: Hide the dropdown. Backend will assign owner based on logged-in user.
        adminCustomerSelectGroup.classList.add('hidden');
    }

    // Make the modal visible
    createPortfolioModal.classList.add('visible');
}

/** Hides the create portfolio modal. */
function hideCreatePortfolioModal() {
    createPortfolioModal.classList.remove('visible');
}

/** Fetches the full customer list for the admin modal dropdown, handling pagination. */
async function fetchCustomersForAdminModal(page = 1, accumulatedCustomers = []) {
    // Only run if user is admin
    if (!IS_ADMIN_USER) return;

    // Show loading state on first call
    if (page === 1) {
        console.log("Fetching customers for admin modal...");
        adminCustomerSelect.innerHTML = '<option value="">Loading customers...</option>';
        adminCustomerSelect.disabled = true;
    }

    try {
        // Fetch a page of customers (admin permission assumed)
        const response = await fetch(`${apiRoot}/customers/?page=${page}`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const data = await response.json(); // Expect paginated response
        const fetchedCustomers = data.results || [];
        accumulatedCustomers = accumulatedCustomers.concat(fetchedCustomers);

        // If there's a next page, fetch it recursively
        if (data.next) {
            // Extract next page number (safer parsing)
            let nextPageNum = null;
            try {
                const url = new URL(data.next);
                nextPageNum = parseInt(url.searchParams.get('page'), 10);
            } catch (e) { console.error("Error parsing next page URL:", data.next, e); }

            if (nextPageNum) {
                await fetchCustomersForAdminModal(nextPageNum, accumulatedCustomers); // Recurse
            } else {
                 // Stop recursion if next page number can't be determined
                 console.warn("Could not determine next page number from URL:", data.next);
                 // Populate dropdown with what we have so far
                 populateAdminCustomerDropdown(accumulatedCustomers);
            }
        } else {
            // Last page reached, populate dropdown with all accumulated customers
            console.log("Finished fetching all customers for admin modal:", accumulatedCustomers.length);
            populateAdminCustomerDropdown(accumulatedCustomers);
        }
    } catch (error) {
        console.error("Failed to fetch customers for admin modal:", error);
        adminCustomerSelect.innerHTML = '<option value="">Error loading customers</option>';
        adminCustomerSelect.disabled = false; // Enable even on error? Or keep disabled?
        modalErrorMessage.textContent = 'Error loading customer list for modal.';
        modalErrorMessage.style.display = 'block';
    }
}

/** Populates the admin customer select dropdown in the modal. */
function populateAdminCustomerDropdown(customerList) {
     availableCustomers = customerList; // Store full list
     adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>'; // Reset header
     availableCustomers.sort((a, b) => (a.name || '').localeCompare(b.name || '')); // Sort by name
     availableCustomers.forEach(customer => {
         const option = document.createElement('option');
         option.value = customer.id; // Use Customer ID as value for admin selection
         option.textContent = `${customer.name || 'Unnamed'} (${customer.customer_number || 'No Number'})`;
         adminCustomerSelect.appendChild(option);
     });
     adminCustomerSelect.disabled = false; // Enable dropdown
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
        // 'initial_holding_ids' is intentionally omitted based on backend comments/limitations.
        // The backend PortfolioSerializer handles copying based on context if implemented there.
    };

    // Determine owner based on admin status and selection
    let ownerIdForPayload = null;
    const isCustomerSelectionVisible = !adminCustomerSelectGroup.classList.contains('hidden');

    if (isCustomerSelectionVisible) { // Admin user selecting owner
        ownerIdForPayload = adminCustomerSelect.value;
        if (!ownerIdForPayload) {
            modalErrorMessage.textContent = 'Please select a customer.';
            modalErrorMessage.style.display = 'block';
            return;
        }
        // Add owner_id_input to the payload for the backend serializer
        payload.owner_id_input = parseInt(ownerIdForPayload, 10);
        console.log("Admin selected owner_id_input:", payload.owner_id_input);
        if (isNaN(payload.owner_id_input)) {
             modalErrorMessage.textContent = 'Invalid customer ID selected.';
             modalErrorMessage.style.display = 'block';
             return;
        }
    } else {
        // Non-Admin: Backend serializer should determine owner from request.user
        console.log("Non-admin creating portfolio. Backend will assign owner.");
        // Do NOT send owner_id_input in this case.
    }

    // --- OMITTING initial_holding_ids ---
    // If copying holdings is re-enabled, the logic to get IDs needs to be added here.
    // The backend serializer might handle this based on context['request'] data instead.
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
        const responseData = await response.json().catch(() => ({ detail: response.statusText })); // Try to parse JSON error

        if (!response.ok) {
            // Handle API errors (e.g., validation errors from serializer)
            console.error("API Error Data:", responseData); // Log the error data from backend
            let errorMsg = `Error ${response.status}: ${responseData.detail || JSON.stringify(responseData)}`;
            // Format validation errors nicely
            if (typeof responseData === 'object' && responseData !== null) {
                errorMsg = Object.entries(responseData)
                                 .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`)
                                 .join('; ');
            }
            throw new Error(errorMsg); // Throw error to be caught below
        }

        // Success!
        const newPortfolio = responseData; // The created portfolio object
        console.log('Successfully created portfolio:', newPortfolio);
        hideCreatePortfolioModal(); // Close the modal
        alert(`Portfolio "${newPortfolio.name}" created successfully!`); // Simple success message

        // Refresh the portfolio list for the relevant customer
        const ownerIdToRefresh = payload.owner_id_input || selectedCustomerId; // Use explicit owner if admin, else current customer
        if (ownerIdToRefresh) {
            // Refresh the portfolio list (await ensures list is updated before selection)
            await loadPortfolios(ownerIdToRefresh, 1);

            // Automatically select the newly created portfolio in the dropdown
            if (Array.from(portfolioFilterSelect.options).some(opt => opt.value == newPortfolio.id)) {
                portfolioFilterSelect.value = newPortfolio.id;
                await handlePortfolioSelection(); // Load the new portfolio's data
            } else {
                 console.warn("Newly created portfolio not found in dropdown immediately after refresh.");
                 // Fallback: just reload the first portfolio listed if any exist
                 if (portfolioFilterSelect.options.length > 0 && portfolioFilterSelect.options[0].value) {
                     portfolioFilterSelect.value = portfolioFilterSelect.options[0].value;
                     await handlePortfolioSelection();
                 } else {
                     // No portfolios left or only "-- Select --" option
                     portfolioNameEl.textContent = "Select a Portfolio";
                     clearTableAndCharts();
                 }
            }
        } else {
            // If no customer was selected initially (shouldn't happen?), reload customers
            console.warn("No owner ID determined after portfolio creation, reloading customer list.");
            await loadCustomers();
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
                 await loadPortfolios(selectedCustomerId, 1); // Reload and let it select default/first
            }
        } else {
            // Handle deletion errors (including 400 for trying to delete default)
            let errorMsg = `Error ${response.status}: Failed to delete portfolio.`;
            try {
                const errorData = await response.json();
                errorMsg += ` ${errorData.detail || JSON.stringify(errorData)}`;
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
            // Update the selectedHoldingIds Set accordingly using internal ticket_id (UUID string)
            const holdingId = checkbox.dataset.holdingId;
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
    // console.log("Selected Holdings (ticket_ids):", selectedHoldingIds); // Keep commented unless debugging
}
/** Updates the state (checked, indeterminate) of the "Select All" checkbox for holdings. */
function updateSelectAllCheckboxState() {
    if (!selectAllCheckbox || !tableBody) return; // Ensure elements exist

    // Get all visible checkboxes in the current table view
    const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox');
    const totalVisible = visibleCheckboxes.length;
    // Count how many of the visible ones are checked
    const totalSelectedOnPage = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;

    if (totalVisible === 0) {
        // No rows visible
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (totalSelectedOnPage === totalVisible) {
        // All visible rows are selected
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (totalSelectedOnPage > 0) {
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
    // Iterate through the *currently displayed page* holdings to get details for selected IDs
    const selectedBondsPayload = [];
    currentHoldingsData.results.forEach(holding => {
        // Check if this holding's ticket_id (UUID string) is in the selected set
        if (selectedHoldingIds.has(holding.ticket_id)) {
            selectedBondsPayload.push({
                cusip: holding.security_cusip || 'N/A',
                par: (holding.par_value_num ?? 0).toFixed(2) // Send calculated par number as string
            });
        }
    });

    // If somehow no payload was generated (e.g., selection cleared between click and processing)
    if (selectedBondsPayload.length === 0) {
         showStatusMessageGeneric(emailStatusMessage, "Error: Could not find details for selected bonds.", true);
         emailInterestBtn.disabled = false; // Re-enable
         return;
    }

    // Construct the final payload for the API
    const payload = {
        customer_id: parseInt(selectedCustomerId, 10), // Send customer ID (internal integer PK)
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
            const offeringId = parseInt(checkbox.dataset.offeringId, 10); // ID is integer PK
            if (!isNaN(offeringId)) {
                if (isChecked) { selectedMuniOfferingIds.add(offeringId); }
                else { selectedMuniOfferingIds.delete(offeringId); }
            }
        });
    } else if (target.classList.contains('muni-checkbox')) {
        // Individual muni offering checkbox
        const offeringId = parseInt(target.dataset.offeringId, 10); // ID is integer PK
        if (!isNaN(offeringId)) {
            if (target.checked) { selectedMuniOfferingIds.add(offeringId); }
            else { selectedMuniOfferingIds.delete(offeringId); }
            updateSelectAllMunisCheckboxState(); // Update main checkbox state
        }
    }

    // Enable/disable the "Buy Interest" button
    emailBuyInterestBtn.disabled = selectedMuniOfferingIds.size === 0;
    // console.log("Selected Muni Offerings (IDs):", selectedMuniOfferingIds); // Keep commented unless debugging
}
/** Updates the "Select All" checkbox state for muni offerings. */
function updateSelectAllMunisCheckboxState() {
    if (!selectAllMunisCheckbox || !muniOfferingsTableBody) return; // Ensure elements exist

    const visibleCheckboxes = muniOfferingsTableBody.querySelectorAll('.muni-checkbox');
    const totalVisible = visibleCheckboxes.length;
    const totalSelectedOnPage = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;

    if (totalVisible === 0) {
        selectAllMunisCheckbox.checked = false;
        selectAllMunisCheckbox.indeterminate = false;
    } else if (totalSelectedOnPage === totalVisible) {
        selectAllMunisCheckbox.checked = true;
        selectAllMunisCheckbox.indeterminate = false;
    } else if (totalSelectedOnPage > 0) {
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
        // Check if this offering's id (integer PK) is in the selected set
        if (selectedMuniOfferingIds.has(offering.id)) {
            selectedOfferingsPayload.push({
                cusip: offering.cusip || 'N/A',
                description: offering.description || 'N/A' // Include description
            });
        }
    });

     // If somehow no payload was generated
    if (selectedOfferingsPayload.length === 0) {
         showStatusMessageGeneric(emailBuyStatusMessage, "Error: Could not find details for selected offerings.", true);
         emailBuyInterestBtn.disabled = false; // Re-enable
         return;
    }

    // Construct the final payload
    const payload = {
        customer_id: parseInt(selectedCustomerId, 10), // Internal integer PK
        selected_offerings: selectedOfferingsPayload
    };

    console.log("Sending email buy interest payload:", payload);
    // Use CORRECTED API URL from urls.py
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
            showStatusMessageGeneric(emailBuyStatusMessage, `Error: ${errorDetail}`, true);
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

    // Hide if no data or pagination info, or only one page
    if (!paginationData || paginationData.count === 0 || paginationData.count <= PAGE_SIZE) {
        containerElement.style.display = 'none';
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

    // Helper to create pagination button
    const createButton = (text, url, pageNum) => {
        const button = document.createElement('button');
        button.textContent = text;
        button.disabled = !url; // Disable if URL is null
        if (url && pageNum) {
            button.dataset.page = pageNum;
            button.dataset.type = dataType; // Store data type
            button.addEventListener('click', handlePaginationClick);
        } else if (!pageNum && url) {
            // Attempt to extract page number if not explicitly provided (fallback)
             try {
                const urlObj = new URL(url);
                const pageParam = urlObj.searchParams.get('page');
                if (pageParam) {
                     button.dataset.page = pageParam;
                     button.dataset.type = dataType;
                     button.addEventListener('click', handlePaginationClick);
                } else {
                     console.warn(`Could not extract page number from URL: ${url}`);
                     button.disabled = true;
                }
            } catch (e) {
                console.error("Error parsing pagination URL:", url, e);
                button.disabled = true; // Disable if URL is invalid
            }
        }
        return button;
    };

    // Previous Button
    const prevPageNum = currentPage > 1 ? currentPage - 1 : null;
    const prevButton = createButton('Previous', previousUrl, prevPageNum);

    // Next Button
    const nextPageNum = currentPage < totalPages ? currentPage + 1 : null;
    const nextButton = createButton('Next', nextUrl, nextPageNum);

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

    const pageNum = parseInt(page, 10);
    if (isNaN(pageNum) || pageNum < 1) {
         console.error("Invalid page number on pagination button:", page);
         return;
    }

    console.log(`Pagination click: Type=${type}, Page=${pageNum}`);

    // Fetch the requested page for the correct data type using the appropriate function
    if (type === 'holdings') {
        applyHoldingsFiltersAndFetchPage(pageNum);
    } else if (type === 'munis') {
        applyMuniFiltersAndFetchPage(pageNum);
    }
}


// --- Event Listeners Setup ---

/** Attaches all necessary event listeners on DOMContentLoaded. */
function setupEventListeners() {
    // Customer/Portfolio Dropdowns & Delete Button
    if(customerSelect) customerSelect.addEventListener('change', handleCustomerSelection);
    if(portfolioFilterSelect) portfolioFilterSelect.addEventListener('change', handlePortfolioSelection);
    if(deletePortfolioBtn) deletePortfolioBtn.addEventListener('click', handleDeletePortfolio);

    // Holdings Filters Buttons & Container Delegation
    if(addFilterBtn) addFilterBtn.addEventListener('click', () => addFilterRow());
    if(clearAllFiltersBtn) clearAllFiltersBtn.addEventListener('click', handleClearAllFilters);
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

    // Holdings Table Sorting (attach to each header with data-key)
    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return; // Ignore clicks on non-sortable headers (like checkbox)

            // Map frontend key to potential backend key if necessary
            let backendKey = key;
            if (key === 'wal') backendKey = 'holding_average_life'; // Map WAL to backend field
            if (key === 'security_cusip') backendKey = 'security__cusip'; // Handle related field
            if (key === 'security_description') backendKey = 'security__description'; // Handle related field
             // Add other mappings if needed

            // Toggle direction or change sort key
            if (backendKey === currentSortKey) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortKey = backendKey; // Use the backend key for sorting state
                currentSortDir = 'asc'; // Default to ascending on new column
            }
            // Apply sort and re-fetch page 1
            applyHoldingsFiltersAndFetchPage(1);
        });
    });

    // Muni Offerings Table Sorting (attach to each header with data-key)
    muniTableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return;

            // Toggle direction or change sort key
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
    if(darkModeToggle) darkModeToggle.addEventListener('click', toggleTheme);
    if(exportPdfBtn) exportPdfBtn.addEventListener('click', exportToPdf);
    if(exportExcelBtn) exportExcelBtn.addEventListener('click', exportToXlsx);

    // Create Portfolio Modal Interactions
    if(createPortfolioBtn) createPortfolioBtn.addEventListener('click', showCreatePortfolioModal);
    if(modalCloseBtn) modalCloseBtn.addEventListener('click', hideCreatePortfolioModal);
    if(modalCancelBtn) modalCancelBtn.addEventListener('click', hideCreatePortfolioModal);
    if(createPortfolioForm) createPortfolioForm.addEventListener('submit', handleCreatePortfolioSubmit);
    // Close modal if overlay is clicked
    if(createPortfolioModal) createPortfolioModal.addEventListener('click', (event) => {
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
    console.log("DOM fully loaded and parsed. Initializing Portfolio Analyzer.");

    // Initial setup for filters (generate options, add first empty row)
    generateColumnOptions(); // Generate <option> HTML for holdings filters
    addFilterRow(); // Add the initial (empty) holdings filter row
    generateMuniColumnOptions(); // Generate <option> HTML for muni filters
    addMuniFilterRow(); // Add the initial (empty) muni filter row

    // Register Chart.js plugins if available
    // Add check for Chart object itself
    if (typeof Chart !== 'undefined') {
        if (window.pluginTrendlineLinear) {
            try {
                Chart.register(window.pluginTrendlineLinear);
                console.log("Trendline plugin registered.");
            } catch (e) {
                console.error("Error registering Trendline plugin:", e);
            }
        } else {
            console.warn("Trendline plugin (pluginTrendlineLinear) not found.");
        }
    } else {
        console.warn("Chart.js library not loaded.");
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
    loadCustomers(); // This triggers the chain reaction
    loadMuniOfferings(); // Load municipal offerings data in parallel (page 1, no filters initially)

    console.log("Portfolio Analyzer Initialized.");
});
