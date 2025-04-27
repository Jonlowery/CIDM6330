// --- JAVASCRIPT for Portfolio Analyzer ---

// Ensure external libraries (jsPDF, Chart.js, etc.) are loaded before this script runs.

// Use strict mode for better error handling and preventing common mistakes
"use strict";

// Check if IS_ADMIN_USER is defined (should be set in the HTML before this script)
if (typeof IS_ADMIN_USER === 'undefined') {
    console.error("CRITICAL: IS_ADMIN_USER is not defined. Ensure it's set in the HTML before loading script.js.");
    // Provide a fallback or stop execution if necessary
    // const IS_ADMIN_USER = false; // Example fallback (use with caution)
} else {
    console.log("User admin status (from script.js):", IS_ADMIN_USER); // Confirm it's accessible
}


// --- Constants & Global Variables ---
const { jsPDF } = window.jspdf; // Destructure jsPDF from the global window object
const apiRoot = '/api'; // Base URL for API calls
let customers = []; // Holds the list of customers fetched for the main dropdown (populated by loadCustomers)
let currentPortfolios = []; // Holds the list of portfolios fetched for the selected customer
let allHoldings = []; // Holds all holdings for the currently selected view (customer or portfolio)
let filteredHoldings = []; // Holdings after applying filters (THIS IS THE ARRAY USED FOR THE SNAPSHOT)
let chartInstances = {}; // Stores active Chart.js instances for later destruction/update
let columnOptionsHtml = ''; // HTML string for filter column dropdown options
let currentSortKey = 'security_cusip'; // Default sort column key
let currentSortDir = 'asc'; // Default sort direction
let activeFilters = []; // Array to store active filter objects
let nextFilterId = 0; // Counter for generating unique filter IDs
let availableCustomers = []; // Stores the full customer list fetched for the admin modal dropdown
let selectedCustomerId = null; // Store the currently selected customer ID

// --- DOM Element References ---
// Using const for elements that are expected to always exist
const customerSelect = document.getElementById('customer-select'); // Renamed from portfolioSelect for clarity
const portfolioFilterContainer = document.getElementById('portfolio-filter-container'); // New container for portfolio dropdown
const portfolioFilterSelect = document.getElementById('portfolio-filter-select'); // New portfolio dropdown
const deletePortfolioBtn = document.getElementById('delete-portfolio-btn'); // New delete button
const portfolioNameEl = document.getElementById('portfolio-name'); // Displays the selected customer/portfolio name
const tableBody = document.querySelector('#holdings-table tbody');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]'); // Select only sortable headers
const tableElement = document.getElementById('holdings-table');
const filtersContainer = document.getElementById('filters-container');
const addFilterBtn = document.getElementById('add-filter-btn');
const clearAllFiltersBtn = document.getElementById('clear-all-filters-btn');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const exportPdfBtn = document.getElementById('export-pdf-btn');
// Modal Elements
const createPortfolioBtn = document.getElementById('create-portfolio-btn'); // Consider renaming this button's text in HTML
const createPortfolioModal = document.getElementById('create-portfolio-modal');
const createPortfolioForm = document.getElementById('create-portfolio-form');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const newPortfolioNameInput = document.getElementById('new-portfolio-name');
const adminCustomerSelectGroup = document.getElementById('admin-customer-select-group');
const adminCustomerSelect = document.getElementById('admin-customer-select');
const modalErrorMessage = document.getElementById('modal-error-message');


// --- Utility Functions ---

/**
 * Retrieves a cookie value by name.
 * @param {string} name - The name of the cookie to retrieve.
 * @returns {string|null} The cookie value or null if not found.
 */
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

// Get CSRF token once for making state-changing requests (POST, PUT, DELETE)
const csrfToken = getCookie('csrftoken');
console.log("CSRF Token:", csrfToken); // Debug log

/**
 * Parses a date string (YYYY-MM-DD) into a Date object.
 * Handles null or invalid dates gracefully.
 * @param {string|null} dateString - The date string to parse.
 * @returns {Date|null} The Date object or null if invalid.
 */
function parseDate(dateString) {
    if (!dateString) return null;
    try {
        // Appending T00:00:00 helps avoid timezone issues during parsing
        const date = new Date(dateString + 'T00:00:00');
        // Check if the parsed date is valid
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        console.error("Error parsing date:", dateString, e);
        return null;
    }
}

/**
 * Generates an array of distinct HSL colors.
 * Useful for chart datasets like pie charts.
 * @param {number} count - The number of distinct colors needed.
 * @returns {string[]} An array of HSL color strings.
 */
function generateDistinctColors(count) {
    const colors = [];
    if (count <= 0) return colors;
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        // Use HSL color space for better visual distinction
        colors.push(`hsl(${i * hueStep}, 70%, 60%)`);
    }
    return colors;
}

// --- Filter Functions ---

/**
 * Generates HTML <option> elements for the filter column dropdown
 * based on the data-key attributes of the table headers.
 */
function generateColumnOptions() {
    columnOptionsHtml = ''; // Reset the HTML string
    tableHeaders.forEach(th => {
        const key = th.dataset.key;
        const type = th.dataset.type || 'string'; // Default to string type if not specified
        // Get text content, remove sort arrows if present
        const text = th.textContent.replace('▲', '').replace('▼', '').trim();
        if (key) { // Only add options for headers with a data-key
            columnOptionsHtml += `<option value="${key}" data-type="${type}">${text}</option>`;
        }
    });
}

/**
 * Adds a new filter row UI element to the filters container.
 * @param {object|null} initialFilter - Optional object to pre-populate the filter row.
 */
function addFilterRow(initialFilter = null) {
    const filterId = nextFilterId++; // Increment and get unique ID
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';
    filterRow.dataset.filterId = filterId; // Store ID on the element

    // Set inner HTML for the filter row structure
    filterRow.innerHTML = `
        <label for="filter-column-${filterId}">Filter by:</label>
        <select class="filter-column" id="filter-column-${filterId}">${columnOptionsHtml}</select>
        <select class="filter-operator" id="filter-operator-${filterId}"></select>
        <input type="text" class="filter-value" id="filter-value-${filterId}" placeholder="Value...">
        <button class="remove-filter-btn" title="Remove this filter">X</button>
    `;

    filtersContainer.appendChild(filterRow); // Add the row to the DOM

    // Get references to the new elements within the row
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');
    const removeBtn = filterRow.querySelector('.remove-filter-btn');

    // Add event listeners
    columnSelect.addEventListener('change', handleFilterDropdownChange);
    operatorSelect.addEventListener('change', handleFilterDropdownChange);
    valueInput.addEventListener('input', handleFilterValueChange); // Use 'input' for immediate feedback
    removeBtn.addEventListener('click', handleRemoveFilter);

    // Create the initial state object for this filter
    const newFilter = {
        id: filterId,
        column: initialFilter?.column || columnSelect.value, // Use initial value or default
        operator: initialFilter?.operator, // Operator might be null initially
        value: initialFilter?.value || '',
        type: initialFilter?.type || columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    activeFilters.push(newFilter); // Add to the global list of active filters

    // If initialFilter data was provided, set the dropdown/input values
    if (initialFilter) {
        columnSelect.value = initialFilter.column;
        valueInput.value = initialFilter.value;
    }

    // Update the operator dropdown based on the selected column type
    updateOperatorOptionsForRow(filterRow, newFilter.operator);

    // If an initial value was provided, trigger a full update immediately
    if (newFilter.value) {
        triggerFullUpdate();
    }
}

/**
 * Updates the operator dropdown options based on the selected column's data type.
 * @param {HTMLElement} filterRow - The filter row element containing the dropdowns.
 * @param {string|null} preferredOperator - An operator to select by default if available.
 */
function updateOperatorOptionsForRow(filterRow, preferredOperator = null) {
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');
    const selectedOption = columnSelect.options[columnSelect.selectedIndex];
    const columnType = selectedOption ? selectedOption.dataset.type : 'string';

    // Define available operators for different data types
    const numberOperators = ['=', '!=', '>', '<', '>=', '<='];
    const stringOperators = ['contains', '=', '!=', 'startsWith', 'endsWith'];
    const dateOperators = ['=', '!=', '>', '<', '>=', '<=']; // Same as number for date comparisons

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
            valueInput.type = 'date';
            valueInput.step = ''; // No step for dates
            defaultOperator = '=';
            break;
        case 'string':
        default: // Default to string
            availableOperators = stringOperators;
            valueInput.type = 'text';
            valueInput.step = '';
            defaultOperator = 'contains';
            break;
    }

    const currentOperatorValue = operatorSelect.value; // Store current selection
    operatorSelect.innerHTML = ''; // Clear existing options

    // Populate the operator dropdown
    availableOperators.forEach(op => {
        const option = document.createElement('option');
        option.value = op;
        // Use more readable symbols for operators
        option.textContent = op.replace('>=', '≥').replace('<=', '≤').replace('!=', '≠');
        operatorSelect.appendChild(option);
    });

    // Set the selected operator
    if (preferredOperator && availableOperators.includes(preferredOperator)) {
        operatorSelect.value = preferredOperator;
    } else if (availableOperators.includes(currentOperatorValue)) {
        // Keep the current operator if it's still valid for the new type
        operatorSelect.value = currentOperatorValue;
    } else {
        // Otherwise, set the default operator for the type
        operatorSelect.value = defaultOperator;
    }
}

/**
 * Updates the state object for a specific filter row in the activeFilters array.
 * @param {HTMLElement} filterRow - The filter row element whose state needs updating.
 * @returns {boolean} True if the state was found and updated, false otherwise.
 */
function updateFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.filterId, 10);
    const filterIndex = activeFilters.findIndex(f => f.id === filterId);

    if (filterIndex === -1) {
        console.error("Filter state not found for ID:", filterId);
        return false; // Filter not found
    }

    // Get current values from the row's elements
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');

    // Update the filter object in the array
    activeFilters[filterIndex] = {
        id: filterId,
        column: columnSelect.value,
        operator: operatorSelect.value,
        value: valueInput.value.trim(), // Trim whitespace from value
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    // console.log("Updated filter state:", activeFilters[filterIndex]); // Debug log
    return true;
}

/**
 * Event handler for changes in filter column or operator dropdowns.
 * Updates operator options if needed and triggers a table update.
 * @param {Event} event - The change event object.
 */
function handleFilterDropdownChange(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow) return; // Exit if the event didn't originate within a filter row

    // If the column dropdown changed, update the available operators
    if (event.target.classList.contains('filter-column')) {
        updateOperatorOptionsForRow(filterRow);
    }

    // Update the filter state and re-render the table (no need to re-render charts yet)
    if (updateFilterState(filterRow)) {
        triggerTableUpdate(); // Only update table/totals/sort
    }
}

/**
 * Event handler for changes in the filter value input field.
 * Triggers a full update (table, totals, charts).
 * @param {Event} event - The input event object.
 */
function handleFilterValueChange(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow) return;

    // Update the filter state and trigger a full re-render
    if (updateFilterState(filterRow)) {
        triggerFullUpdate(); // Update table, totals, and charts
    }
}

/**
 * Event handler for removing a filter row.
 * @param {Event} event - The click event object.
 */
function handleRemoveFilter(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow) return;

    // Prevent removing the very last filter row (optional, but can be good UX)
    const currentFilterRows = filtersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) {
        console.log("Cannot remove the last filter row.");
        // Optionally provide user feedback here (e.g., flash the row)
        return;
    }

    // Remove the filter state from the array
    const filterIdToRemove = parseInt(filterRow.dataset.filterId, 10);
    activeFilters = activeFilters.filter(f => f.id !== filterIdToRemove);

    // Remove the row from the DOM
    filterRow.remove();

    // Trigger a full update
    triggerFullUpdate();
}

/**
 * Clears all active filters and resets the filter UI.
 */
function handleClearAllFilters() {
    activeFilters = []; // Clear the state array
    filtersContainer.innerHTML = ''; // Clear the filter rows from the DOM
    addFilterRow(); // Add back a single, empty filter row

    // Reset portfolio dropdown to the first option if visible and trigger update
    if (!portfolioFilterContainer.classList.contains('hidden') && portfolioFilterSelect.options.length > 0) {
         portfolioFilterSelect.value = portfolioFilterSelect.options[0].value; // Select first portfolio
         handlePortfolioSelection(); // Trigger update based on the first portfolio
    } else if (selectedCustomerId) {
        // If only customer was selected, trigger update for that customer (will reload portfolios)
        handleCustomerSelection();
    }
    // No need for separate triggerFullUpdate() as handlePortfolioSelection/handleCustomerSelection does it
}

// --- Data Fetching and Processing ---

/**
 * Fetches the list of customers associated with the logged-in user.
 * Populates the main customer dropdown and triggers the initial customer selection.
 */
async function loadCustomers() {
    console.log("Attempting to load customers...");
    try {
        const res = await fetch(`${apiRoot}/customers/`);
        console.log("Load customers response status:", res.status);
        if (!res.ok) {
            // Handle non-successful responses (e.g., 403 Forbidden, 500 Server Error)
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        customers = await res.json(); // Store fetched customers globally
        console.log("Customers loaded:", customers);

        // Populate the main customer selection dropdown
        customerSelect.innerHTML = customers.map(c =>
            `<option value="${c.id}">${c.name || `Customer ${c.customer_number}`}</option>`
        ).join('');

        // If customers were loaded, trigger the handler for the first customer
        if (customers.length > 0) {
            await handleCustomerSelection(); // Load portfolios and initial view for the default selected customer
        } else {
            // Handle case where user has no associated customers
            portfolioNameEl.textContent = "No customers available for this user.";
            clearTableAndCharts();
            portfolioFilterContainer.classList.add('hidden'); // Hide portfolio dropdown
            const colSpan = tableHeaders.length || 10;
            tableBody.innerHTML = `<tr><td colspan="${colSpan}">No customers found.</td></tr>`;
        }
    } catch (error) {
        console.error("Failed to load customers:", error);
        portfolioNameEl.textContent = "Error loading customers";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden'); // Hide portfolio dropdown
        const colSpan = tableHeaders.length || 10;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading customer list. Check console.</td></tr>`;
    }
}

/**
 * Handles the selection of a customer from the dropdown.
 * Fetches the portfolios for the selected customer.
 */
async function handleCustomerSelection() {
    selectedCustomerId = customerSelect.value; // Get selected customer ID
    console.log(`Customer selected: ID ${selectedCustomerId}`);

    if (!selectedCustomerId) {
        portfolioNameEl.textContent = "Please select a customer.";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden'); // Hide portfolio dropdown
        deletePortfolioBtn.disabled = true; // Disable delete button
        return;
    }

    // Find the selected customer object
    const selectedCustomer = customers.find(c => c.id == selectedCustomerId);
    if (!selectedCustomer) {
        console.error(`Selected customer with ID ${selectedCustomerId} not found in local list.`);
        portfolioNameEl.textContent = "Error: Selected customer not found.";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true; // Disable delete button
        return;
    }

    // Update title temporarily
    portfolioNameEl.textContent = `Loading portfolios for ${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`}...`;
    clearTableAndCharts(); // Clear previous view
    portfolioFilterContainer.classList.add('hidden'); // Hide portfolio dropdown while loading
    deletePortfolioBtn.disabled = true; // Disable delete button while loading

    // Load portfolios for this customer
    await loadPortfolios(selectedCustomerId);
}

/**
 * Fetches portfolios relevant to the logged-in user and populates the portfolio dropdown
 * filtered for the selected customer.
 * @param {string|number} customerId - The ID of the currently selected customer.
 */
async function loadPortfolios(customerId) {
    console.log(`Attempting to load portfolios for customer ID: ${customerId}`);
    try {
        // Fetch all portfolios accessible by the user
        const res = await fetch(`${apiRoot}/portfolios/`);
        console.log("Load portfolios response status:", res.status);
        if (!res.ok) {
            throw new Error(`HTTP error fetching portfolios! status: ${res.status}`);
        }
        currentPortfolios = await res.json(); // Store all accessible portfolios
        console.log("All accessible portfolios loaded:", currentPortfolios.length);

        // Filter portfolios to show only those owned by the selected customer
        const customerPortfolios = currentPortfolios.filter(p => p.owner?.id == customerId);
        console.log(`Portfolios found for customer ${customerId}:`, customerPortfolios.length);

        // Populate the portfolio dropdown
        portfolioFilterSelect.innerHTML = ''; // Clear existing options

        if (customerPortfolios.length > 0) {
            // Add options for each specific portfolio
            customerPortfolios.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id; // Use portfolio ID as value
                option.textContent = p.name || `Portfolio ${p.id}`;
                // Store is_default flag on the option element for the delete check later
                option.dataset.isDefault = p.is_default || false;
                portfolioFilterSelect.appendChild(option);
            });

            // Show the portfolio dropdown
            portfolioFilterContainer.classList.remove('hidden');
            // Trigger the holdings display for the first portfolio in the list
            handlePortfolioSelection();
        } else {
            // No portfolios found for this customer
            const selectedCustomer = customers.find(c => c.id == customerId);
            portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - No Portfolios Found`;
            portfolioFilterContainer.classList.add('hidden'); // Hide dropdown
            deletePortfolioBtn.disabled = true; // Ensure delete is disabled
            clearTableAndCharts(); // Clear table/charts
            const colSpan = tableHeaders.length || 10;
            tableBody.innerHTML = `<tr><td colspan="${colSpan}">No portfolios found for this customer.</td></tr>`;
        }

    } catch (error) {
        console.error("Failed to load or process portfolios:", error);
        portfolioNameEl.textContent = "Error loading portfolios";
        // Keep portfolio dropdown hidden on error
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true; // Ensure delete is disabled
        clearTableAndCharts(); // Clear view on error
        const colSpan = tableHeaders.length || 10;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading portfolio list. Check console.</td></tr>`;
    }
}


/**
 * Handles the selection of a portfolio from the dropdown.
 * Fetches and displays holdings for the selected portfolio.
 * Enables/disables the delete button.
 */
async function handlePortfolioSelection() {
    const selectedPortfolioId = portfolioFilterSelect.value; // This will now always be an ID if portfolios exist
    const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    const isDefaultPortfolio = selectedOption?.dataset?.isDefault === 'true'; // Check if it's the default portfolio

    console.log(`Portfolio selected: ID '${selectedPortfolioId}' (Default: ${isDefaultPortfolio}), Customer ID: ${selectedCustomerId}`);

    // Enable delete button only if a specific, non-default portfolio is selected
    // Disable if no portfolio ID is selected (e.g., if the list was empty)
    deletePortfolioBtn.disabled = (!selectedPortfolioId || isDefaultPortfolio);

    // Find the selected customer object again (needed for display name)
    const selectedCustomer = customers.find(c => c.id == selectedCustomerId);
    if (!selectedCustomer) {
         console.error("Customer not found during portfolio selection.");
         return; // Should not happen if customer was selected first
    }

    // If no portfolio ID is selected (e.g., after deleting the last one), don't fetch holdings
    if (!selectedPortfolioId) {
        console.log("No specific portfolio selected.");
         portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - Select a Portfolio`;
         clearTableAndCharts();
         const colSpan = tableHeaders.length || 10;
         tableBody.innerHTML = `<tr><td colspan="${colSpan}">Please select a portfolio.</td></tr>`;
         return;
    }

    // --- Fetch holdings for the selected portfolio ---
    const fetchUrl = `${apiRoot}/holdings/?portfolio=${selectedPortfolioId}`;
    const selectedPortfolio = currentPortfolios.find(p => p.id == selectedPortfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${selectedPortfolioId}`;
    const viewName = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - ${portfolioDisplayName}`;
    console.log("Fetching holdings for specific portfolio:", fetchUrl);


    portfolioNameEl.textContent = `Loading ${viewName}...`;
    clearTableAndCharts(); // Clear previous view

    // --- Fetch Holdings ---
    try {
        const res = await fetch(fetchUrl);
        console.log(`Load holdings response status for view '${viewName}':`, res.status);

        if (!res.ok) {
            if (res.status === 404) { // Handle no holdings found
                allHoldings = [];
                portfolioNameEl.textContent = `${viewName} (No Holdings)`;
                const colSpan = tableHeaders.length || 10;
                tableBody.innerHTML = `<tr><td colspan="${colSpan}">No holdings found for this portfolio.</td></tr>`;
            } else { // Handle other errors
                let errorText = `HTTP error! status: ${res.status}`;
                try {
                    const errorData = await res.json();
                    errorText += ` - ${JSON.stringify(errorData)}`;
                } catch (e) { /* Ignore if response is not JSON */ }
                throw new Error(errorText);
            }
        } else {
            // Holdings loaded successfully
            allHoldings = await res.json();
            console.log(`Holdings loaded for view '${viewName}':`, allHoldings.length);
            portfolioNameEl.textContent = viewName; // Update display name
        }
        // Process and display the fetched holdings
        processAndDisplayHoldings();

    } catch (error) {
        console.error("Failed to update holdings view:", error);
        portfolioNameEl.textContent = `Error loading holdings for ${viewName}`;
        allHoldings = []; // Reset holdings
        clearTableAndCharts();
        const colSpan = tableHeaders.length || 10;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading holdings. Check console.</td></tr>`;
    }
}


/**
 * Processes the raw holding data fetched from the API.
 * Calculates derived fields (e.g., estimated maturity year) and parses numbers/dates.
 * Triggers a full UI update afterwards.
 */
function processAndDisplayHoldings() {
    console.log("Processing and displaying holdings:", allHoldings.length);
    const today = new Date();
    allHoldings.forEach(h => {
        // Calculate estimated maturity year based on WAL (Weighted Average Life)
        const wal = parseFloat(h.wal);
        h.estimated_maturity_date = !isNaN(wal) ? today.getFullYear() + Math.floor(wal) : null;

        // Ensure numeric fields are parsed correctly, defaulting to 0 if null/invalid
        h.par = parseFloat(h.par) || 0;
        h.settlement_price = parseFloat(h.settlement_price) || 0;
        h.coupon = parseFloat(h.coupon) || 0;
        h.book_yield = parseFloat(h.book_yield) || 0;

        // Determine the primary yield value to use (prefer book_yield if available)
        // Ensure the field name 'yield' matches the API response if book_yield is null
        h.yield_val = h.book_yield || parseFloat(h.yield) || 0;
        h.wal = parseFloat(h.wal) || 0; // Ensure WAL is also parsed as a number

        // Parse date strings into Date objects for easier manipulation/sorting
        h.maturity_date_obj = parseDate(h.maturity_date);
        h.call_date_obj = parseDate(h.call_date);
    });

    // Trigger a full update to apply filters, sort, render table, totals, and charts
    triggerFullUpdate();
}


// --- Filtering and Sorting Logic ---

/**
 * Checks if a single holding matches a given filter criteria.
 * @param {object} holding - The holding object to check.
 * @param {object} filter - The filter object containing column, operator, value, and type.
 * @returns {boolean} True if the holding matches the filter, false otherwise.
 */
function checkFilter(holding, filter) {
    // If filter is invalid or has no value, it doesn't filter anything out
    if (!filter || filter.value === null || filter.value === '') return true;

    // Get the value from the holding based on the filter's column key
    const holdingValue = getSortValue(holding, filter.column);
    let filterValue = filter.value; // Value entered by the user

    // If the holding doesn't have the specified property, it doesn't match
    if (holdingValue === null || holdingValue === undefined) {
        return false;
    }

    try {
        let compareHolding = holdingValue;
        let compareFilter = filterValue;

        // Perform comparison based on filter type
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
                default: return false; // Unknown operator
            }
        } else if (filter.type === 'number') {
            compareHolding = parseFloat(holdingValue);
            compareFilter = parseFloat(filterValue);
            // If parsing fails, consider it a non-match
            if (isNaN(compareHolding) || isNaN(compareFilter)) return false;
            switch (filter.operator) {
                case '=': return compareHolding === compareFilter;
                case '!=': return compareHolding !== compareFilter;
                case '>': return compareHolding > compareFilter;
                case '<': return compareHolding < compareFilter;
                case '>=': return compareHolding >= compareFilter;
                case '<=': return compareHolding <= compareFilter;
                default: return false;
            }
        } else if (filter.type === 'date') {
            // Use getTime() for reliable date comparison
            compareHolding = holdingValue instanceof Date ? holdingValue.getTime() : null;
            compareFilter = parseDate(filterValue)?.getTime(); // Parse filter value to date
            if (compareHolding === null || compareFilter === null) return false; // Invalid date(s)
            switch (filter.operator) {
                case '=': return compareHolding === compareFilter;
                case '!=': return compareHolding !== compareFilter;
                case '>': return compareHolding > compareFilter;
                case '<': return compareHolding < compareFilter;
                case '>=': return compareHolding >= compareFilter;
                case '<=': return compareHolding <= compareFilter;
                default: return false;
            }
        }
    } catch (e) {
        console.error("Error during filter comparison:", e, { holdingValue, filter });
        return false; // Error during comparison means no match
    }
    return false; // Default to no match if type is unknown
}

/**
 * Sorts an array of holding data based on a key and direction.
 * Handles null/undefined values and different data types (number, date, string).
 * @param {object[]} data - The array of holdings to sort (will be modified in place).
 * @param {string} key - The key (column) to sort by.
 * @param {string} direction - 'asc' or 'desc'.
 */
function sortData(data, key, direction) {
    data.sort((a, b) => {
        let valA = getSortValue(a, key);
        let valB = getSortValue(b, key);

        // Define how null/undefined values are ordered
        const nullOrder = direction === 'asc' ? 1 : -1; // Push nulls to end in asc, beginning in desc
        if (valA === null || valA === undefined) return (valB === null || valB === undefined) ? 0 : nullOrder;
        if (valB === null || valB === undefined) return -nullOrder;

        let comparison = 0;
        // Compare based on data type
        if (valA instanceof Date && valB instanceof Date) {
            comparison = valA.getTime() - valB.getTime();
        } else if (typeof valA === 'number' && typeof valB === 'number') {
            comparison = valA - valB;
        } else {
            // Default to case-insensitive string comparison
            valA = String(valA).toUpperCase();
            valB = String(valB).toUpperCase();
            if (valA < valB) comparison = -1;
            else if (valA > valB) comparison = 1;
        }

        // Apply direction
        return direction === 'desc' ? (comparison * -1) : comparison;
    });
}

/**
 * Retrieves the appropriate value from a holding object for sorting/filtering.
 * Handles special cases like dates or calculated yield.
 * @param {object} holding - The holding object.
 * @param {string} key - The key representing the column/property.
 * @returns {*} The value to be used for comparison.
 */
function getSortValue(holding, key) {
    switch (key) {
        case 'yield': return holding.yield_val; // Use the calculated yield value
        case 'maturity_date': return holding.maturity_date_obj; // Use the Date object
        case 'call_date': return holding.call_date_obj; // Use the Date object
        default: return holding[key]; // Return the property directly
    }
}

// --- UI Rendering ---

/**
 * Renders the holdings data into the HTML table body.
 * @param {object[]} holdings - The array of holdings to render.
 */
function renderTable(holdings) {
    console.log("Rendering table with holdings:", holdings.length);
    const colSpan = tableHeaders.length || 10; // Calculate colspan for messages

    // Handle empty data state
    if (!holdings || holdings.length === 0) {
        const hasActiveFilters = activeFilters.some(f => f.value !== '');
        // Adjust message based on whether a portfolio is selected
        const noDataMessage = portfolioFilterSelect.value ? 'No holdings match filter criteria.' : 'No holdings to display.';
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">${noDataMessage}</td></tr>`;
        return;
    }

    // Generate table rows from holdings data
    tableBody.innerHTML = holdings.map(h => {
        // Format dates for display
        const maturityDisplay = h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : (h.maturity_date || '');
        const callDisplay = h.call_date_obj ? h.call_date_obj.toLocaleDateString() : (h.call_date || '');

        // Format numbers for display (using optional chaining and nullish coalescing for safety)
        const parDisplay = (h.par ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const priceDisplay = (h.settlement_price ?? 0).toFixed(2);
        const couponDisplay = (h.coupon ?? 0).toFixed(3);
        const yieldDisplay = (h.yield_val ?? 0).toFixed(3); // Use calculated yield
        const walDisplay = (h.wal ?? 0).toFixed(2);

        // Return the HTML string for the table row
        return `
            <tr>
                <td>${h.security_cusip || 'N/A'}</td>
                <td>${h.description || ''}</td>
                <td>${parDisplay}</td>
                <td>${priceDisplay}</td>
                <td>${couponDisplay}</td>
                <td>${yieldDisplay}</td>
                <td>${walDisplay}</td>
                <td>${h.estimated_maturity_date ?? 'N/A'}</td>
                <td>${maturityDisplay}</td>
                <td>${callDisplay}</td>
            </tr>
        `;
    }).join(''); // Join the array of row strings into a single HTML string
}

/**
 * Updates the sort indicator arrows (▲/▼) in the table headers.
 */
function updateSortIndicators() {
    tableHeaders.forEach(th => {
        const key = th.dataset.key;
        const arrowSpan = th.querySelector('.sort-arrow');
        if (!arrowSpan) return; // Skip headers without arrows

        if (key === currentSortKey) {
            th.classList.add('sorted'); // Mark header as sorted
            arrowSpan.textContent = currentSortDir === 'asc' ? ' ▲' : ' ▼'; // Set arrow direction
        } else {
            th.classList.remove('sorted');
            arrowSpan.textContent = ''; // Clear arrow for non-sorted columns
        }
    });
}

/**
 * Calculates and renders the total values (Par, Yield, WAL) in the table footer.
 * @param {object[]} holdings - The array of holdings to calculate totals from.
 */
function renderTotals(holdings) {
    // Calculate total Par value
    const totalPar = holdings.reduce((sum, h) => sum + (h.par ?? 0), 0);

    // Calculate weighted average yield (weighted by Par)
    const weightedYieldSum = holdings.reduce((sum, h) => sum + ((h.par ?? 0) * (h.yield_val ?? 0)), 0);
    const totalYield = totalPar > 0 ? weightedYieldSum / totalPar : 0; // Avoid division by zero

    // Calculate weighted average WAL (weighted by Par)
    const weightedWalSum = holdings.reduce((sum, h) => sum + ((h.par ?? 0) * (h.wal ?? 0)), 0);
    const totalWal = totalPar > 0 ? weightedWalSum / totalPar : 0; // Avoid division by zero

    // Update the DOM elements in the table footer
    document.getElementById('totals-par').textContent = totalPar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('totals-yield').textContent = totalYield.toFixed(3);
    document.getElementById('totals-wal').textContent = totalWal.toFixed(2);
}

/**
 * Destroys an existing Chart.js instance if it exists.
 * @param {string} chartId - The ID of the chart instance to destroy.
 */
function destroyChart(chartId) {
    if (chartInstances[chartId]?.destroy) { // Check if instance and destroy method exist
        chartInstances[chartId].destroy();
        delete chartInstances[chartId]; // Remove reference
    }
}

/**
 * Renders all the charts based on the provided holdings data.
 * Destroys existing charts before creating new ones.
 * @param {object[]} holdings - The array of holdings data to visualize.
 */
function renderCharts(holdings) {
    console.log("Rendering charts with holdings:", holdings.length);
    // Destroy all existing chart instances first
    Object.keys(chartInstances).forEach(destroyChart);
    chartInstances = {}; // Reset the instances object

    // Determine theme for chart colors
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
    const labelColor = isDark ? '#aaa' : '#666';
    const titleColor = isDark ? '#4dabf7' : '#0056b3'; // Use header colors for titles
    const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)';
    const tooltipColor = isDark ? '#f1f1f1' : '#fff';

    // Base options common to most charts
    const baseChartOptionsStatic = {
        responsive: true,
        maintainAspectRatio: false, // Allow charts to fill container height
        plugins: {
            legend: { labels: { color: labelColor } },
            title: { color: titleColor, display: true }, // Enable titles
            tooltip: {
                backgroundColor: tooltipBgColor,
                titleColor: tooltipColor,
                bodyColor: tooltipColor,
                footerColor: tooltipColor
            }
        },
        scales: { // Default scales (can be overridden)
            x: {
                ticks: { color: labelColor },
                grid: { color: gridColor, borderColor: gridColor },
                title: { color: labelColor, display: true } // Enable axis titles
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
            ctx.fillStyle = 'white'; // Use white for PDF background
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

    // --- Chart 1: Yield vs. Estimated Maturity Year (Scatter) ---
    const yieldMaturityPoints = holdings
        .filter(h => h.estimated_maturity_date !== null && typeof h.yield_val === 'number')
        .map(h => ({ x: h.estimated_maturity_date, y: h.yield_val }));

    if (yieldMaturityPoints.length > 0 && contexts.yieldVsMaturityChart) {
        const options1 = structuredClone(baseChartOptionsStatic); // Deep clone base options
        options1.plugins.title.text = 'Yield vs. Estimated Maturity Year';
        options1.scales.x.type = 'linear'; // Use linear scale for year
        options1.scales.x.position = 'bottom';
        options1.scales.x.title.text = 'Estimated Maturity Year';
        options1.scales.x.ticks = {
            ...options1.scales.x.ticks,
            stepSize: 1, // Show integer years
            callback: value => Math.round(value) // Display rounded year values
        };
        options1.scales.y.beginAtZero = false; // Yield can be negative
        options1.scales.y.title.text = 'Yield (%)';
        options1.plugins.tooltip.callbacks = { // Custom tooltip format
            label: ctx => `Year: ${ctx.parsed.x}, Yield: ${ctx.parsed.y.toFixed(3)}`
        };
        options1.plugins.pdfBackground = pdfBackgroundPlugin; // Add background for PDF

        const dataset1 = {
            label: 'Yield vs Est Maturity Year',
            data: yieldMaturityPoints,
            backgroundColor: isDark ? 'rgba(66, 135, 245, 0.7)' : 'rgba(0, 123, 255, 0.5)',
            borderColor: isDark ? 'rgba(86, 155, 255, 1)' : 'rgba(0, 123, 255, 1)',
            pointRadius: 5,
            pointHoverRadius: 7,
            showLine: false // Scatter plot, no connecting line
        };

        // Add trendline if plugin is available
        if (typeof Chart !== 'undefined' && window.pluginTrendlineLinear) {
            dataset1.trendlineLinear = {
                style: isDark ? "rgba(255, 80, 80, 0.9)" : "rgba(255, 50, 50, 0.8)", // Trendline color
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

    // --- Chart 2: Total Par by Estimated Maturity Year (Bar) ---
    const maturityBuckets = {}; // Object to store par sum per year
    holdings.forEach(h => {
        const year = h.estimated_maturity_date || (h.maturity_date_obj ? h.maturity_date_obj.getFullYear() : 'Unknown');
        if (year !== 'Unknown' && !isNaN(year)) { // Only include valid years
            maturityBuckets[year] = (maturityBuckets[year] || 0) + (h.par ?? 0);
        }
    });
    const sortedYears = Object.keys(maturityBuckets).map(Number).sort((a, b) => a - b); // Get sorted years

    if (sortedYears.length > 0 && contexts.parByMaturityYearChart) {
        const options2 = structuredClone(baseChartOptionsStatic);
        options2.plugins.title.text = 'Total Par by Estimated Maturity Year';
        options2.scales.x.title.text = 'Year';
        // options2.scales.x.type = 'category'; // Implicit for bar chart labels
        options2.scales.y.beginAtZero = true; // Par value starts at 0
        options2.scales.y.title.text = 'Total Par Value';
        options2.scales.y.ticks = {
            ...options2.scales.y.ticks,
            callback: value => value.toLocaleString() // Format Y-axis labels
        };
        options2.plugins.tooltip.callbacks = { // Custom tooltip
            label: ctx => `Year: ${ctx.label}, Par: ${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        };
        options2.plugins.pdfBackground = pdfBackgroundPlugin;

        chartInstances.parByMaturityYearChart = new Chart(contexts.parByMaturityYearChart, {
            type: 'bar',
            data: {
                labels: sortedYears, // Years on X-axis
                datasets: [{
                    label: 'Total Par by Est. Maturity Year',
                    data: sortedYears.map(year => maturityBuckets[year]), // Par values for each year
                    backgroundColor: isDark ? 'rgba(40, 167, 69, 0.85)' : 'rgba(40, 167, 69, 0.7)',
                    borderColor: isDark ? 'rgba(60, 187, 89, 1)' : 'rgba(40, 167, 69, 1)',
                    borderWidth: 1
                }]
            },
            options: options2
        });
    }

    // --- Chart 3: Portfolio Par Distribution by Coupon Rate (Pie) ---
    const couponBuckets = {}; // Object to store par sum per coupon rate
    holdings.forEach(h => {
        const couponRate = (h.coupon ?? 0).toFixed(3); // Group by coupon rate (formatted)
        couponBuckets[couponRate] = (couponBuckets[couponRate] || 0) + (h.par ?? 0);
    });
    const sortedCoupons = Object.keys(couponBuckets).sort((a, b) => parseFloat(a) - parseFloat(b)); // Sort coupon rates numerically

    if (sortedCoupons.length > 0 && contexts.couponPieChart) {
        const pieColors = generateDistinctColors(sortedCoupons.length); // Generate colors for slices
        const options3 = structuredClone(baseChartOptionsStatic);
        delete options3.scales; // Pie charts don't have scales
        options3.plugins.title.text = 'Portfolio Par Distribution by Coupon Rate';
        options3.plugins.title.align = 'center'; // Center title for pie chart
        options3.plugins.legend.position = 'bottom'; // Position legend below chart
        options3.plugins.tooltip.callbacks = { // Custom tooltip showing value and percentage
            label: ctx => {
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
                labels: sortedCoupons.map(c => `${c}% Coupon`), // Labels for slices
                datasets: [{
                    label: 'Par by Coupon Rate',
                    data: sortedCoupons.map(c => couponBuckets[c]), // Data values for slices
                    backgroundColor: pieColors,
                    hoverOffset: 4 // Slightly enlarge slice on hover
                }]
            },
            options: options3
        });
    }

    // --- Chart 4: Settlement Price vs. Yield (Scatter) ---
    const priceYieldPoints = holdings
        .filter(h => typeof h.settlement_price === 'number' && h.settlement_price > 0 && typeof h.yield_val === 'number')
        .map(h => ({ x: h.settlement_price, y: h.yield_val }));

    if (priceYieldPoints.length > 0 && contexts.priceVsYieldChart) {
        const options4 = structuredClone(baseChartOptionsStatic);
        options4.plugins.title.text = 'Settlement Price vs. Yield';
        options4.scales.x.beginAtZero = false; // Price usually not zero
        options4.scales.x.title.text = 'Settlement Price';
        options4.scales.y.beginAtZero = false; // Yield can be negative
        options4.scales.y.title.text = 'Yield (%)';
        options4.plugins.tooltip.callbacks = { // Custom tooltip
            label: ctx => `Price: ${ctx.parsed.x.toFixed(2)}, Yield: ${ctx.parsed.y.toFixed(3)}`
        };
        options4.plugins.pdfBackground = pdfBackgroundPlugin;

        chartInstances.priceVsYieldChart = new Chart(contexts.priceVsYieldChart, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Price vs Yield',
                    data: priceYieldPoints,
                    backgroundColor: isDark ? 'rgba(255, 200, 50, 0.7)' : 'rgba(255, 193, 7, 0.6)',
                    borderColor: isDark ? 'rgba(255, 210, 70, 1)' : 'rgba(255, 193, 7, 1)',
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    showLine: false // No line for scatter
                }]
            },
            options: options4
        });
    }
}


// --- UI Update Triggers ---

/**
 * Applies the current filters and sorting, then renders the table and totals.
 * Used when only the table needs updating (e.g., after sorting or changing filter operators).
 */
function triggerTableUpdate() {
    applyFilterAndSort(); // Apply filters and sort the data
    renderTotals(filteredHoldings); // Update totals based on filtered data
}

/**
 * Applies filters and sorting, then renders the table, totals, and charts.
 * Used when data changes significantly (e.g., loading new data, changing filter values).
 */
function triggerFullUpdate() {
    applyFilterAndSort(); // Filter and sort
    renderTotals(filteredHoldings); // Update totals
    renderCharts(filteredHoldings); // Re-render all charts
}

/**
 * Applies filters and sorting to the `allHoldings` array, storing the result in `filteredHoldings`.
 * Then renders the filtered table and updates sort indicators.
 */
function applyFilterAndSort() {
    // Filter holdings based on active filters that have a value
    const filtersToApply = activeFilters.filter(f => f.value !== null && f.value !== '');
    if (filtersToApply.length > 0) {
        // IMPORTANT: When saving a filtered view, we need the IDs of the holdings *before* filtering
        // For display purposes, we filter `allHoldings`
        filteredHoldings = allHoldings.filter(holding => {
            // Holding must match ALL active filters
            return filtersToApply.every(filter => checkFilter(holding, filter));
        });
    } else {
        // If no filters have values, show all holdings
        filteredHoldings = [...allHoldings]; // Create a shallow copy
    }

    // Sort the filtered data for display
    sortData(filteredHoldings, currentSortKey, currentSortDir);

    // Render the filtered and sorted data into the table
    renderTable(filteredHoldings);

    // Update the sort indicator arrows in the table headers
    updateSortIndicators();
}

/**
 * Clears the table body, resets totals, and destroys all chart instances.
 * Used before loading new data.
 */
function clearTableAndCharts() {
    const colSpan = tableHeaders.length || 10;
    tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading...</td></tr>`; // Show loading message
    renderTotals([]); // Clear totals
    Object.keys(chartInstances).forEach(destroyChart); // Destroy existing charts
    chartInstances = {}; // Reset chart instances object
}

// --- Theme Toggling ---

/**
 * Applies the specified theme (light or dark) to the body and re-renders charts.
 * @param {string} theme - 'light' or 'dark'.
 */
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
        darkModeToggle.textContent = 'Toggle Light Mode';
    } else {
        document.body.classList.remove('dark-mode');
        darkModeToggle.textContent = 'Toggle Dark Mode';
    }

    // Re-render charts with updated theme colors, only if charts exist
    // Check localStorage access first as a proxy for ability to save theme preference
    try {
        localStorage.setItem('themeCheck', '1'); // Test write
        localStorage.removeItem('themeCheck'); // Clean up test write
        if (Object.keys(chartInstances).length > 0) {
             renderCharts(filteredHoldings); // Re-render charts with current data
        }
    } catch (e) {
        console.warn("localStorage not accessible, charts will not update theme colors dynamically.");
    }
}

/**
 * Toggles the theme between light and dark mode and saves the preference.
 */
function toggleTheme() {
    const currentTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    try {
        // Save the new theme preference to localStorage
        localStorage.setItem('portfolioTheme', currentTheme);
    } catch (e) {
        console.warn("Could not save theme preference to localStorage:", e);
    }
    // Apply the new theme
    applyTheme(currentTheme);
}

// --- PDF Export ---

/**
 * Exports the current view (charts and table) to a PDF document.
 */
async function exportToPdf() {
    // Initialize jsPDF
    const doc = new jsPDF({
        orientation: 'p', // Portrait
        unit: 'pt', // Points as unit
        format: 'a4' // A4 paper size
    });

    // Determine colors based on current theme for PDF styling
    const isDark = document.body.classList.contains('dark-mode');
    const pdfHeaderBg = isDark ? '#3a3a3a' : '#e9ecef';
    const pdfHeaderText = isDark ? '#e0e0e0' : '#495057';
    const pdfTextColor = isDark ? '#f1f1f1' : '#333333';
    const pdfBorderColor = isDark ? '#444444' : '#dee2e6';
    const pdfRowBg = isDark ? '#2c2c2c' : '#ffffff';
    const pdfAlternateRowBg = isDark ? '#303030' : '#f8f9fa';

    // PDF page dimensions and margins
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    const usableWidth = pageWidth - (2 * margin);
    const usableHeight = pageHeight - (2 * margin); // Usable height considering margins

    // --- Page 1: Charts ---
    const chartGap = 25; // Gap between charts
    // Calculate dimensions for 2x2 chart layout
    const chartWidth = ((usableWidth - chartGap) / 2) * 0.95; // Reduce slightly for padding
    const chartHeight = ((usableHeight - chartGap - 30) / 2) * 0.95; // Reduce height for title and padding
    const chartStartX1 = margin;
    const chartStartX2 = margin + chartWidth + chartGap;
    const chartStartY1 = margin + 25; // Start below title
    const chartStartY2 = chartStartY1 + chartHeight + chartGap;

    // Add title for the charts page
    doc.setFontSize(18);
    doc.setTextColor(isDark ? 241 : 51); // Use appropriate text color
    const viewTitle = portfolioNameEl.textContent || 'Portfolio Analysis'; // Use current view title
    doc.text(viewTitle + " - Charts", margin, margin + 5);

    // Get base64 image data for each chart
    const chartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart', 'priceVsYieldChart'];
    const chartImages = [];
    for (const chartId of chartIds) {
        const chartInstance = chartInstances[chartId];
        try {
            if (chartInstance) {
                // Ensure background is white using the pdfBackgroundPlugin
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

    // --- Page 2: Holdings Table ---
    doc.addPage(); // Add a new page for the table
    doc.setFontSize(18);
    doc.setTextColor(isDark ? 241 : 51);
    doc.text(viewTitle + " - Holdings Table", margin, margin + 5); // Title for table page

    // Use jsPDF-AutoTable to generate the table from HTML
    doc.autoTable({
        html: '#holdings-table', // Target the table element
        startY: margin + 25, // Start table below the title
        theme: 'grid', // Use grid theme for borders
        styles: { // General cell styles
            fontSize: 7,
            cellPadding: 3,
            overflow: 'linebreak', // Allow text wrapping
            textColor: pdfTextColor,
            lineColor: pdfBorderColor,
            lineWidth: 0.5,
        },
        headStyles: { // Header row styles
            fillColor: pdfHeaderBg,
            textColor: pdfHeaderText,
            fontStyle: 'bold',
            halign: 'center',
            lineColor: pdfBorderColor,
            lineWidth: 0.5,
        },
        bodyStyles: { // Body row styles
            fillColor: pdfRowBg,
            textColor: pdfTextColor,
            lineColor: pdfBorderColor,
            lineWidth: 0.5,
        },
        alternateRowStyles: { // Zebra striping
            fillColor: pdfAlternateRowBg,
        },
        columnStyles: { // Specific column widths and alignments
            0: { cellWidth: 55, halign: 'left' }, // CUSIP
            1: { cellWidth: 'auto', halign: 'left'}, // Description (auto width)
            2: { cellWidth: 60, halign: 'right' }, // Par
            3: { cellWidth: 40, halign: 'right' }, // Price
            4: { cellWidth: 40, halign: 'right' }, // Coupon
            5: { cellWidth: 40, halign: 'right' }, // Yield
            6: { cellWidth: 40, halign: 'right' }, // WAL
            7: { cellWidth: 55, halign: 'center' }, // Est. Maturity Year
            8: { cellWidth: 55, halign: 'center' }, // Maturity Date
            9: { cellWidth: 55, halign: 'center' }  // Call Date
        },
        margin: { left: margin, right: margin }, // Page margins for the table
        didDrawPage: function (data) { // Add page numbers in footer
            let footerStr = "Page " + doc.internal.getCurrentPageInfo().pageNumber;
            doc.setFontSize(8);
            doc.setTextColor(isDark ? 150 : 100); // Dimmed text color for footer
            doc.text(footerStr, data.settings.margin.left, pageHeight - 15, { baseline: 'bottom' });
        }
    });

    // Save the generated PDF
    const selectedCustomerOption = customerSelect.options[customerSelect.selectedIndex];
    const selectedPortfolioOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    let baseFilename = 'export';
    if (selectedCustomerOption) {
        baseFilename = selectedCustomerOption.text.split('(')[0].trim(); // Get customer name
        if (selectedPortfolioOption && selectedPortfolioOption.value !== "") {
             baseFilename += '_' + selectedPortfolioOption.text.split('(')[0].trim(); // Add portfolio name if selected
        }
    }
    // Sanitize filename (basic example)
    const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`portfolio_${safeFilename}.pdf`);
}


// --- Modal Functions (Create Portfolio) ---

/**
 * Shows the modal dialog for creating a new sub-portfolio.
 * Handles logic for showing/hiding the customer selection dropdown based on
 * whether the user is an admin or a regular user associated with multiple customers.
 * Populates the dropdown with appropriate values (customer ID or number) based on user type.
 */
function showCreatePortfolioModal() {
    // Log current state for debugging
    console.log("Showing create portfolio modal. Admin:", IS_ADMIN_USER, "Customer Count:", customers.length);

    // Reset form fields and error messages
    createPortfolioForm.reset();
    modalErrorMessage.textContent = '';
    modalErrorMessage.style.display = 'none';

    // Clear previous customer options and set a default placeholder
    adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>';

    // Determine if the customer selection dropdown should be shown and populate it
    if (IS_ADMIN_USER) {
        // Admin users ALWAYS see the customer selection dropdown.
        console.log("Admin user: showing customer select, fetching all customers.");
        adminCustomerSelectGroup.classList.remove('hidden'); // Ensure the dropdown group is visible
        // Fetch the full list of customers for the admin to choose from.
        // fetchCustomersForAdmin will populate the dropdown with customer NUMBER as value.
        fetchCustomersForAdmin();
    } else if (customers && customers.length > 1) {
        // Non-admin user associated with MORE THAN ONE customer needs to select.
        console.log("Non-admin, multiple customers: showing customer select.");
        adminCustomerSelectGroup.classList.remove('hidden'); // Ensure the dropdown group is visible
        // Populate the dropdown with the customers already fetched for this specific user (from loadCustomers)
        customers.forEach(customer => {
            const option = document.createElement('option');
            // IMPORTANT: Backend now expects customer ID for non-admins selecting from multiple.
            option.value = customer.id; // Use customer ID as the value
            option.textContent = `${customer.name} (${customer.customer_number})`;
            adminCustomerSelect.appendChild(option);
        });
    } else {
        // Non-admin user with 0 or 1 associated customer - no selection needed.
        // The backend will handle assignment automatically for the single customer case.
        console.log("Non-admin, single/zero customers: hiding customer select.");
        adminCustomerSelectGroup.classList.add('hidden'); // Hide the dropdown group
    }

    // Make the modal overlay visible
    createPortfolioModal.classList.add('visible');
}

/**
 * Hides the create portfolio modal.
 */
function hideCreatePortfolioModal() {
    createPortfolioModal.classList.remove('visible');
}

/**
 * Fetches the full list of customers specifically for the admin's dropdown in the modal.
 * Populates the dropdown with customer NUMBER as the value.
 */
async function fetchCustomersForAdmin() {
    // Only admins should call this function.
    if (!IS_ADMIN_USER) return;
    console.log("Fetching customers for admin modal...");

    // Avoid refetching if the dropdown seems populated (simple check)
    if (adminCustomerSelect.options.length > 1 && adminCustomerSelect.options[0].value === "") {
         console.log("Admin customer list already populated or loading.");
         return;
    }
    // Set loading state in the dropdown
    adminCustomerSelect.innerHTML = '<option value="">Loading customers...</option>';

    try {
        // Fetch the full list of customers from the API
        const response = await fetch(`${apiRoot}/customers/`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        // Store the fetched customers in the 'availableCustomers' variable (can be useful)
        availableCustomers = await response.json();
        console.log("Fetched customers for admin modal:", availableCustomers.length);

        // Reset dropdown and add the default "-- Select Customer --" option first
        adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>';
        // Populate the dropdown with fetched customers
        availableCustomers.forEach(customer => {
            const option = document.createElement('option');
            // IMPORTANT: Admins use customer_number_input, so the value needs to be the customer number.
            option.value = customer.customer_number;
            option.textContent = `${customer.name} (${customer.customer_number})`;
            adminCustomerSelect.appendChild(option);
        });
    } catch (error) {
        console.error("Failed to fetch customers for admin:", error);
        // Update dropdown to show error and display error message in the modal
        adminCustomerSelect.innerHTML = '<option value="">Error loading customers</option>';
        modalErrorMessage.textContent = 'Error loading customer list for modal.';
        modalErrorMessage.style.display = 'block';
    }
}

/**
 * Handles the submission of the create portfolio form.
 * Sends the correct payload (including name and potentially customer identifier)
 * to the backend API based on user type and context.
 * Includes the IDs of currently filtered holdings if the "Save Filtered View" approach is used.
 * @param {Event} event - The form submission event.
 */
async function handleCreatePortfolioSubmit(event) {
    event.preventDefault(); // Prevent default form submission which reloads the page
    console.log("Handling create portfolio submit (Save Filtered View)...");

    // Clear previous error messages
    modalErrorMessage.textContent = '';
    modalErrorMessage.style.display = 'none';

    // Get the portfolio name from the input field
    const portfolioName = newPortfolioNameInput.value.trim();
    if (!portfolioName) {
        modalErrorMessage.textContent = 'Portfolio name is required.';
        modalErrorMessage.style.display = 'block';
        return; // Stop if name is missing
    }

    // Prepare the base data payload for the API request
    const payload = { name: portfolioName };

    // Check if the customer selection dropdown is currently visible
    const isCustomerSelectionVisible = !adminCustomerSelectGroup.classList.contains('hidden');

    // If the dropdown is visible, a customer selection is required
    if (isCustomerSelectionVisible) {
        const selectedValue = adminCustomerSelect.value;
        if (!selectedValue) {
            // If dropdown is visible, but no value selected, show error
            modalErrorMessage.textContent = 'Please select a customer.';
            modalErrorMessage.style.display = 'block';
            return; // Stop if selection is required but not made
        }

        // Determine which identifier field to add based on user type
        if (IS_ADMIN_USER) {
            // Admin sends 'customer_number_input' with the selected customer NUMBER
            payload.customer_number_input = selectedValue;
            console.log("Admin submitting with customer_number_input:", selectedValue);
        } else {
            // Non-admin (multi-customer user) sends 'owner_customer_id' with the selected customer ID
            payload.owner_customer_id = parseInt(selectedValue, 10); // Ensure it's sent as an integer
            // Check if parsing failed (though dropdown value should be valid ID)
            if (isNaN(payload.owner_customer_id)) {
                 console.error("Invalid customer ID selected:", selectedValue);
                 modalErrorMessage.textContent = 'Invalid customer selected. Please try again.';
                 modalErrorMessage.style.display = 'block';
                 return;
            }
            console.log("Non-admin submitting with owner_customer_id:", payload.owner_customer_id);
        }
    } else {
         console.log("Single customer user or dropdown hidden, no customer identifier needed in payload.");
         // For non-admin single-customer users, the backend handles association automatically.
         // No need to add customer_number_input or owner_customer_id to the payload.
    }

    // --- Add filtered holding IDs to the payload ---
    // Get the IDs of the holdings currently displayed in the filtered view
    const initialHoldingIds = filteredHoldings.map(holding => holding.id).filter(id => id != null); // Ensure IDs are not null/undefined
    if (initialHoldingIds.length > 0) {
        payload.initial_holding_ids = initialHoldingIds;
        console.log(`Adding ${initialHoldingIds.length} filtered holding IDs to the payload.`);
    } else {
        console.log("No filtered holdings to add to the new portfolio.");
        // No need to send empty array, backend should handle absence of the key
    }
    // -------------------------------------------------

    console.log("Final create portfolio payload:", payload); // Log the final payload being sent

    // --- API Call ---
    try {
        // Send the POST request to the portfolio API endpoint
        const response = await fetch(`${apiRoot}/portfolios/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken, // Include CSRF token for security
            },
            body: JSON.stringify(payload), // Send the data as JSON string
        });
        console.log("Create portfolio response status:", response.status); // Log response status

        // Check if the request was successful (status code 2xx)
        if (!response.ok) {
            // Attempt to parse error details from the response body (if JSON)
            const errorData = await response.json().catch(() => ({ detail: response.statusText })); // Fallback to status text
            // Format a user-friendly error message from the response
            let errorMsg = `Error ${response.status}: ${errorData.detail || JSON.stringify(errorData)}`;
             if (typeof errorData === 'object' && errorData !== null) {
                 // Handle DRF validation errors (often field-specific)
                 errorMsg = Object.entries(errorData)
                     .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`)
                     .join('; ');
             }
            throw new Error(errorMsg); // Throw an error to be caught by the catch block
        }

        // If successful:
        const newPortfolio = await response.json(); // Parse the newly created portfolio data
        console.log('Successfully created portfolio:', newPortfolio);
        hideCreatePortfolioModal(); // Close the modal
        alert(`Portfolio "${newPortfolio.name}" created successfully!`); // Show success message to user

        // --- UI Update after successful creation ---
        // Re-fetch portfolios for the currently selected customer to include the new one
        if (selectedCustomerId) {
            await loadPortfolios(selectedCustomerId);
            // Automatically select the newly created portfolio in the dropdown
            portfolioFilterSelect.value = newPortfolio.id;
            // Trigger view update for the new portfolio
            await handlePortfolioSelection();
        } else {
            // If no customer was selected (shouldn't happen if creation succeeded), reload customers
             loadCustomers();
        }


    } catch (error) {
        // Handle errors during the API call or response processing
        console.error('Failed to create portfolio:', error);
        modalErrorMessage.textContent = `Creation failed: ${error.message}`; // Display specific error in the modal
        modalErrorMessage.style.display = 'block';
    }
}

/**
 * Handles the click event for the delete portfolio button.
 */
async function handleDeletePortfolio() {
    const portfolioIdToDelete = portfolioFilterSelect.value;
    const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    const portfolioNameToDelete = selectedOption ? selectedOption.textContent : `Portfolio ID ${portfolioIdToDelete}`;

    // Double-check that a specific portfolio is selected and it's not marked as default
    if (!portfolioIdToDelete || selectedOption?.dataset?.isDefault === 'true') { // Ensure ID is not empty
        alert("Please select a non-default portfolio to delete.");
        return;
    }

    // Confirm deletion with the user
    if (!confirm(`Are you sure you want to delete portfolio "${portfolioNameToDelete}"? This action cannot be undone and will delete all holdings within it.`)) {
        return; // User cancelled
    }

    console.log(`Attempting to delete portfolio ID: ${portfolioIdToDelete}`);

    try {
        const response = await fetch(`${apiRoot}/portfolios/${portfolioIdToDelete}/`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': csrfToken, // Include CSRF token
                'Accept': 'application/json',
            }
        });

        console.log(`Delete portfolio response status: ${response.status}`);

        // Check if deletion was successful (status 204 No Content is typical for successful DELETE)
        if (response.status === 204) {
            alert(`Portfolio "${portfolioNameToDelete}" deleted successfully.`);

            // Remove the portfolio from the dropdown
            selectedOption.remove();

            // Check if any portfolios remain
            if (portfolioFilterSelect.options.length > 0) {
                // Select the first remaining portfolio
                portfolioFilterSelect.value = portfolioFilterSelect.options[0].value;
                // Refresh the view to show the newly selected portfolio
                await handlePortfolioSelection();
            } else {
                // No portfolios left, hide dropdown and show message
                portfolioFilterContainer.classList.add('hidden');
                deletePortfolioBtn.disabled = true;
                const selectedCustomer = customers.find(c => c.id == selectedCustomerId);
                portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - No Portfolios Found`;
                clearTableAndCharts();
                const colSpan = tableHeaders.length || 10;
                tableBody.innerHTML = `<tr><td colspan="${colSpan}">No portfolios found for this customer.</td></tr>`;
            }

        } else {
            // Handle errors (e.g., 403 Forbidden, 404 Not Found, 500 Server Error)
            let errorMsg = `Error ${response.status}: Failed to delete portfolio.`;
            try {
                 const errorData = await response.json();
                 errorMsg += ` ${errorData.detail || JSON.stringify(errorData)}`;
            } catch (e) {
                 errorMsg += ` ${response.statusText}`;
            }
            throw new Error(errorMsg);
        }

    } catch (error) {
        console.error("Failed to delete portfolio:", error);
        alert(`Error deleting portfolio: ${error.message}`);
    }
}


// --- Event Listeners Setup ---

/**
 * Attaches all necessary event listeners when the DOM is ready.
 */
function setupEventListeners() {
    // Customer dropdown change
    customerSelect.addEventListener('change', handleCustomerSelection);

    // Portfolio dropdown change
    portfolioFilterSelect.addEventListener('change', handlePortfolioSelection);

    // Delete Portfolio button click
    deletePortfolioBtn.addEventListener('click', handleDeletePortfolio); // Add listener for delete button

    // Filter buttons
    addFilterBtn.addEventListener('click', () => addFilterRow()); // Pass no args to add empty row
    clearAllFiltersBtn.addEventListener('click', handleClearAllFilters);

    // Table header clicks for sorting
    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return; // Ignore clicks on non-sortable headers

            // Toggle direction or change sort key
            if (key === currentSortKey) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortKey = key;
                currentSortDir = 'asc'; // Default to ascending on new column
            }
            // Apply sort and re-render table (no need to re-render charts)
            applySortAndRenderTable();
        });
    });

    // Theme toggle button
    darkModeToggle.addEventListener('click', toggleTheme);

    // PDF export button
    exportPdfBtn.addEventListener('click', exportToPdf);

    // Create Portfolio Modal listeners
    createPortfolioBtn.addEventListener('click', showCreatePortfolioModal);
    modalCloseBtn.addEventListener('click', hideCreatePortfolioModal);
    modalCancelBtn.addEventListener('click', hideCreatePortfolioModal);
    createPortfolioForm.addEventListener('submit', handleCreatePortfolioSubmit);
    // Close modal if user clicks on the overlay background
    createPortfolioModal.addEventListener('click', (event) => {
        if (event.target === createPortfolioModal) { // Check if click was directly on the overlay
            hideCreatePortfolioModal();
        }
    });
}

/**
 * Applies sorting and re-renders the table and totals.
 * Used after a sort key or direction changes.
 */
function applySortAndRenderTable() {
    sortData(filteredHoldings, currentSortKey, currentSortDir);
    renderTable(filteredHoldings);
    renderTotals(filteredHoldings);
    updateSortIndicators();
}


// --- Initial Load ---
// Wait for the DOM to be fully loaded before running setup code
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // Initial setup tasks
    generateColumnOptions(); // Prepare column options for filters based on table headers
    addFilterRow(); // Add the initial (empty) filter row UI

    // Register Chart.js plugins if they are available
    if (typeof Chart !== 'undefined' && window.pluginTrendlineLinear) {
        try {
            Chart.register(window.pluginTrendlineLinear);
            console.log("Trendline plugin registered.");
        } catch (e) { console.error("Error registering Trendline plugin:", e) }
    } else { console.warn("Chart.js or Trendline plugin not found."); }
    // Add registration for other plugins if needed (e.g., Chartjs-adapter-date-fns is usually auto-registered or used internally)

    // Apply initial theme preference from localStorage (or default to light)
    let preferredTheme = 'light';
    try {
        localStorage.setItem('themeCheck', '1'); // Check if localStorage is accessible
        localStorage.removeItem('themeCheck');
        preferredTheme = localStorage.getItem('portfolioTheme') || 'light'; // Get saved theme or default
        console.log("Theme preference loaded:", preferredTheme);
    } catch (e) {
        console.warn("Could not access localStorage for theme preference:", e);
    }
    applyTheme(preferredTheme); // Apply the determined theme

    // Setup all event listeners
    setupEventListeners();

    // Start loading initial data (customers, which then triggers portfolio/holdings loading)
    loadCustomers();
});
