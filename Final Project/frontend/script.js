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
let allHoldings = []; // Holds all holdings for the currently selected view (customer or portfolio)
let filteredHoldings = []; // Holdings after applying filters (THIS IS THE ARRAY USED FOR THE SNAPSHOT)
let allMuniOfferings = []; // Holds all municipal offerings
let chartInstances = {}; // Stores active Chart.js instances for later destruction/update
let columnOptionsHtml = ''; // HTML string for filter column dropdown options
let currentSortKey = 'security_cusip'; // Default sort column key
let currentSortDir = 'asc'; // Default sort direction
let activeFilters = []; // Array to store active filter objects
let nextFilterId = 0; // Counter for generating unique filter IDs
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
const tableBody = document.querySelector('#holdings-table tbody');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]'); // Select only sortable headers
const tableElement = document.getElementById('holdings-table');
const selectAllCheckbox = document.getElementById('select-all-holdings');
const filtersContainer = document.getElementById('filters-container');
const addFilterBtn = document.getElementById('add-filter-btn');
const clearAllFiltersBtn = document.getElementById('clear-all-filters-btn');
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
const selectAllMunisCheckbox = document.getElementById('select-all-munis');
// Email Action Elements (Buy)
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const emailBuyStatusMessage = document.getElementById('email-buy-status-message');


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
console.log("CSRF Token:", csrfToken);

/**
 * Parses a date string (YYYY-MM-DD) into a Date object.
 * Handles null or invalid dates gracefully.
 * @param {string|null} dateString - The date string to parse.
 * @returns {Date|null} The Date object or null if invalid.
 */
function parseDate(dateString) {
    if (!dateString) return null;
    try {
        const date = new Date(dateString + 'T00:00:00'); // Use T00:00:00 for timezone consistency
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        console.error("Error parsing date:", dateString, e);
        return null;
    }
}

/**
 * Safely parses a string value into a float, returning null for invalid/empty inputs.
 * @param {string|number|null} value - The value to parse.
 * @returns {number|null} The parsed float or null.
 */
function parseFloatSafe(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
}


/**
 * Generates an array of distinct HSL colors.
 * @param {number} count - The number of distinct colors needed.
 * @returns {string[]} An array of HSL color strings.
 */
function generateDistinctColors(count) {
    const colors = [];
    if (count <= 0) return colors;
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        colors.push(`hsl(${i * hueStep}, 70%, 60%)`);
    }
    return colors;
}

/**
 * Displays a status message (success or error) in a specified status area.
 * @param {HTMLElement} statusElement - The DOM element to display the message in.
 * @param {string} message - The message text to display.
 * @param {boolean} isError - True if the message is an error, false for success.
 * @param {number} duration - How long to display the message in milliseconds (0 = permanent).
 */
function showStatusMessageGeneric(statusElement, message, isError = false, duration = 5000) {
    if (!statusElement) return; // Exit if element doesn't exist

    statusElement.textContent = message;
    statusElement.className = 'status-message'; // Reset classes
    if (isError) {
        statusElement.classList.add('error');
    } else {
        statusElement.classList.add('success');
    }
    statusElement.style.display = 'block'; // Make it visible

    if (duration > 0) {
        setTimeout(() => {
            // Only clear if the message hasn't changed in the meantime
            if (statusElement.textContent === message) {
                statusElement.textContent = '';
                statusElement.style.display = 'none';
            }
        }, duration);
    }
}

// --- Filter Functions --- (No changes needed here for muni offerings)

/**
 * Generates HTML <option> elements for the filter column dropdown.
 */
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

/**
 * Adds a new filter row UI element.
 * @param {object|null} initialFilter - Optional object to pre-populate.
 */
function addFilterRow(initialFilter = null) {
    const filterId = nextFilterId++;
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';
    filterRow.dataset.filterId = filterId;

    filterRow.innerHTML = `
        <label for="filter-column-${filterId}">Filter by:</label>
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

/**
 * Updates the operator dropdown options based on the selected column's data type.
 * @param {HTMLElement} filterRow - The filter row element.
 * @param {string|null} preferredOperator - An operator to select by default.
 */
function updateOperatorOptionsForRow(filterRow, preferredOperator = null) {
    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');
    const selectedOption = columnSelect.options[columnSelect.selectedIndex];
    const columnType = selectedOption ? selectedOption.dataset.type : 'string';

    const numberOperators = ['=', '!=', '>', '<', '>=', '<='];
    const stringOperators = ['contains', '=', '!=', 'startsWith', 'endsWith'];
    const dateOperators = ['=', '!=', '>', '<', '>=', '<='];

    let availableOperators;
    let defaultOperator;

    switch (columnType) {
        case 'number':
            availableOperators = numberOperators;
            valueInput.type = 'number'; valueInput.step = 'any'; defaultOperator = '=';
            break;
        case 'date':
            availableOperators = dateOperators;
            valueInput.type = 'date'; valueInput.step = ''; defaultOperator = '=';
            break;
        case 'string':
        default:
            availableOperators = stringOperators;
            valueInput.type = 'text'; valueInput.step = ''; defaultOperator = 'contains';
            break;
    }

    const currentOperatorValue = operatorSelect.value;
    operatorSelect.innerHTML = '';

    availableOperators.forEach(op => {
        const option = document.createElement('option');
        option.value = op;
        option.textContent = op.replace('>=', '≥').replace('<=', '≤').replace('!=', '≠');
        operatorSelect.appendChild(option);
    });

    if (preferredOperator && availableOperators.includes(preferredOperator)) {
        operatorSelect.value = preferredOperator;
    } else if (availableOperators.includes(currentOperatorValue)) {
        operatorSelect.value = currentOperatorValue;
    } else {
        operatorSelect.value = defaultOperator;
    }
}

/**
 * Updates the state object for a specific filter row.
 * @param {HTMLElement} filterRow - The filter row element.
 * @returns {boolean} True if the state was updated.
 */
function updateFilterState(filterRow) {
    const filterId = parseInt(filterRow.dataset.filterId, 10);
    const filterIndex = activeFilters.findIndex(f => f.id === filterId);
    if (filterIndex === -1) return false;

    const columnSelect = filterRow.querySelector('.filter-column');
    const operatorSelect = filterRow.querySelector('.filter-operator');
    const valueInput = filterRow.querySelector('.filter-value');

    activeFilters[filterIndex] = {
        id: filterId,
        column: columnSelect.value,
        operator: operatorSelect.value,
        value: valueInput.value.trim(),
        type: columnSelect.options[columnSelect.selectedIndex]?.dataset.type || 'string'
    };
    return true;
}

/**
 * Event handler for changes in filter column or operator dropdowns.
 * @param {Event} event - The change event object.
 */
function handleFilterDropdownChange(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow) return;
    if (event.target.classList.contains('filter-column')) {
        updateOperatorOptionsForRow(filterRow);
    }
    if (updateFilterState(filterRow)) {
        triggerTableUpdate();
    }
}

/**
 * Event handler for changes in the filter value input field.
 * @param {Event} event - The input event object.
 */
function handleFilterValueChange(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow) return;
    if (updateFilterState(filterRow)) {
        triggerFullUpdate();
    }
}

/**
 * Event handler for removing a filter row.
 * @param {Event} event - The click event object.
 */
function handleRemoveFilter(event) {
    const filterRow = event.target.closest('.filter-row');
    if (!filterRow) return;
    const currentFilterRows = filtersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) return;

    const filterIdToRemove = parseInt(filterRow.dataset.filterId, 10);
    activeFilters = activeFilters.filter(f => f.id !== filterIdToRemove);
    filterRow.remove();
    triggerFullUpdate();
}

/**
 * Clears all active filters and resets the filter UI.
 */
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

// --- Data Fetching and Processing ---

/**
 * Fetches the list of customers.
 */
async function loadCustomers() {
    console.log("Attempting to load customers...");
    try {
        const res = await fetch(`${apiRoot}/customers/`);
        console.log("Load customers response status:", res.status);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        customers = await res.json();
        console.log("Customers loaded:", customers);

        customerSelect.innerHTML = customers.map(c =>
            `<option value="${c.id}">${c.name || `Customer ${c.customer_number}`}</option>`
        ).join('');

        if (customers.length > 0) {
            await handleCustomerSelection(); // Trigger selection of the first customer
        } else {
            portfolioNameEl.textContent = "No customers available for this user.";
            clearTableAndCharts();
            portfolioFilterContainer.classList.add('hidden');
            const colSpan = (tableHeaders.length || 10) + 1;
            tableBody.innerHTML = `<tr><td colspan="${colSpan}">No customers found.</td></tr>`;
        }
    } catch (error) {
        console.error("Failed to load customers:", error);
        portfolioNameEl.textContent = "Error loading customers";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden');
        const colSpan = (tableHeaders.length || 10) + 1;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading customer list. Check console.</td></tr>`;
    }
}

/**
 * Handles the selection of a customer.
 */
async function handleCustomerSelection() {
    selectedCustomerId = customerSelect.value;
    console.log(`Customer selected: ID ${selectedCustomerId}`);
    clearHoldingSelection();
    clearMuniOfferingSelection(); // Clear muni selections too

    if (!selectedCustomerId) {
        portfolioNameEl.textContent = "Please select a customer.";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true;
        return;
    }

    const selectedCustomer = customers.find(c => c.id == selectedCustomerId);
    if (!selectedCustomer) {
        console.error(`Selected customer with ID ${selectedCustomerId} not found.`);
        portfolioNameEl.textContent = "Error: Selected customer not found.";
        clearTableAndCharts();
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true;
        return;
    }

    portfolioNameEl.textContent = `Loading portfolios for ${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`}...`;
    clearTableAndCharts();
    portfolioFilterContainer.classList.add('hidden');
    deletePortfolioBtn.disabled = true;

    await loadPortfolios(selectedCustomerId);
}

/**
 * Fetches portfolios for the selected customer.
 * @param {string|number} customerId - The ID of the customer.
 */
async function loadPortfolios(customerId) {
    console.log(`Attempting to load portfolios for customer ID: ${customerId}`);
    try {
        const res = await fetch(`${apiRoot}/portfolios/`);
        console.log("Load portfolios response status:", res.status);
        if (!res.ok) throw new Error(`HTTP error fetching portfolios! status: ${res.status}`);
        currentPortfolios = await res.json();
        console.log("All accessible portfolios loaded:", currentPortfolios.length);

        const customerPortfolios = currentPortfolios.filter(p => p.owner?.id == customerId);
        console.log(`Portfolios found for customer ${customerId}:`, customerPortfolios.length);

        portfolioFilterSelect.innerHTML = '';

        if (customerPortfolios.length > 0) {
            customerPortfolios.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name || `Portfolio ${p.id}`;
                option.dataset.isDefault = p.is_default || false;
                portfolioFilterSelect.appendChild(option);
            });
            portfolioFilterContainer.classList.remove('hidden');
            handlePortfolioSelection(); // Trigger loading holdings for the first portfolio
        } else {
            const selectedCustomer = customers.find(c => c.id == customerId);
            portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - No Portfolios Found`;
            portfolioFilterContainer.classList.add('hidden');
            deletePortfolioBtn.disabled = true;
            clearTableAndCharts();
            const colSpan = (tableHeaders.length || 10) + 1;
            tableBody.innerHTML = `<tr><td colspan="${colSpan}">No portfolios found for this customer.</td></tr>`;
        }
    } catch (error) {
        console.error("Failed to load or process portfolios:", error);
        portfolioNameEl.textContent = "Error loading portfolios";
        portfolioFilterContainer.classList.add('hidden');
        deletePortfolioBtn.disabled = true;
        clearTableAndCharts();
        const colSpan = (tableHeaders.length || 10) + 1;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading portfolio list. Check console.</td></tr>`;
    }
}


/**
 * Handles the selection of a portfolio.
 */
async function handlePortfolioSelection() {
    const selectedPortfolioId = portfolioFilterSelect.value;
    const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    const isDefaultPortfolio = selectedOption?.dataset?.isDefault === 'true';
    console.log(`Portfolio selected: ID '${selectedPortfolioId}' (Default: ${isDefaultPortfolio}), Customer ID: ${selectedCustomerId}`);
    clearHoldingSelection();
    // Don't clear muni selection when portfolio changes

    deletePortfolioBtn.disabled = (!selectedPortfolioId || isDefaultPortfolio);

    const selectedCustomer = customers.find(c => c.id == selectedCustomerId);
    if (!selectedCustomer) {
         console.error("Customer not found during portfolio selection."); return;
    }

    if (!selectedPortfolioId) {
        console.log("No specific portfolio selected.");
         portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - Select a Portfolio`;
         clearTableAndCharts();
         const colSpan = (tableHeaders.length || 10) + 1;
         tableBody.innerHTML = `<tr><td colspan="${colSpan}">Please select a portfolio.</td></tr>`;
         return;
    }

    const fetchUrl = `${apiRoot}/holdings/?portfolio=${selectedPortfolioId}`;
    const selectedPortfolio = currentPortfolios.find(p => p.id == selectedPortfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${selectedPortfolioId}`;
    const viewName = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - ${portfolioDisplayName}`;
    console.log("Fetching holdings for specific portfolio:", fetchUrl);

    portfolioNameEl.textContent = `Loading ${viewName}...`;
    clearTableAndCharts();

    try {
        const res = await fetch(fetchUrl);
        console.log(`Load holdings response status for view '${viewName}':`, res.status);

        if (!res.ok) {
            if (res.status === 404) {
                allHoldings = [];
                portfolioNameEl.textContent = `${viewName} (No Holdings)`;
                const colSpan = (tableHeaders.length || 10) + 1;
                tableBody.innerHTML = `<tr><td colspan="${colSpan}">No holdings found for this portfolio.</td></tr>`;
            } else {
                let errorText = `HTTP error! status: ${res.status}`;
                try { errorText += ` - ${JSON.stringify(await res.json())}`; } catch (e) {}
                throw new Error(errorText);
            }
        } else {
            allHoldings = await res.json();
            console.log(`Holdings loaded for view '${viewName}':`, allHoldings.length);
            portfolioNameEl.textContent = viewName;
        }
        processAndDisplayHoldings();

    } catch (error) {
        console.error("Failed to update holdings view:", error);
        portfolioNameEl.textContent = `Error loading holdings for ${viewName}`;
        allHoldings = [];
        clearTableAndCharts();
        const colSpan = (tableHeaders.length || 10) + 1;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading holdings. Check console.</td></tr>`;
    }
}


/**
 * Processes the raw holding data fetched from the API.
 */
function processAndDisplayHoldings() {
    console.log("Processing and displaying holdings:", allHoldings.length);
    const today = new Date();
    allHoldings.forEach(h => {
        const wal = parseFloatSafe(h.wal);
        h.estimated_maturity_date = !isNaN(wal) ? today.getFullYear() + Math.floor(wal) : null;

        h.original_face_amount = parseFloatSafe(h.original_face_amount) ?? 0;
        h.settlement_price = parseFloatSafe(h.settlement_price) ?? 0;
        h.coupon = parseFloatSafe(h.coupon) ?? 0;
        h.book_yield = parseFloatSafe(h.book_yield) ?? 0;
        // Assuming factor comes from security via serializer or is copied
        h.security_factor = parseFloatSafe(h.factor || h.security?.factor) ?? 1.0;

        h.par_calculated = (h.original_face_amount * h.security_factor);
        h.yield_val = h.book_yield || parseFloatSafe(h.yield) || 0;
        h.wal = wal ?? 0; // Use the parsed WAL

        h.maturity_date_obj = parseDate(h.maturity_date);
        h.call_date_obj = parseDate(h.call_date);
    });

    triggerFullUpdate();
}

// --- Muni Offerings Fetching and Rendering ---

/**
 * Fetches municipal offerings data from the API.
 */
async function loadMuniOfferings() {
    console.log("Attempting to load municipal offerings...");
    if (!muniOfferingsTableBody) {
        console.warn("Muni offerings table body not found. Skipping load.");
        return;
    }

    muniOfferingsTableBody.innerHTML = `<tr><td colspan="14">Loading offerings...</td></tr>`; // Adjusted colspan

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
            maturity_date_str: offering.maturity_date,
            call_date_str: offering.call_date,
        }));

        console.log("Processed muni offerings:", allMuniOfferings.length);
        renderMuniOfferingsTable(allMuniOfferings);

    } catch (error) {
        console.error("Failed to load municipal offerings:", error);
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="14">Error loading offerings. Check console.</td></tr>`; // Adjusted colspan
    }
}

/**
 * Renders the municipal offerings data into the HTML table.
 * @param {object[]} offeringsData - The array of processed offering objects.
 */
function renderMuniOfferingsTable(offeringsData) {
    if (!muniOfferingsTableBody) return;
    muniOfferingsTableBody.innerHTML = ''; // Clear existing

    if (!offeringsData || offeringsData.length === 0) {
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="14">No municipal offerings available.</td></tr>`; // Adjusted colspan
        if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
        if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; }
        return;
    }

    offeringsData.forEach(o => {
        const row = document.createElement('tr');
        row.dataset.offeringId = o.id; // Add offering ID to row
        const isChecked = selectedMuniOfferingIds.has(o.id);

        // Checkbox cell
        const checkboxCell = document.createElement('td');
        checkboxCell.className = 'checkbox-column';
        checkboxCell.innerHTML = `<input type="checkbox"
                                         class="muni-checkbox"
                                         data-offering-id="${o.id}"
                                         data-cusip="${o.cusip || ''}"
                                         data-amount="${(o.amount_num ?? 0).toFixed(2)}"
                                         ${isChecked ? 'checked' : ''}
                                         aria-label="Select offering ${o.cusip || 'N/A'}">`;
        row.appendChild(checkboxCell);

        // Helper to create and append a data cell
        const addCell = (content, align = 'left') => {
            const cell = document.createElement('td');
            cell.textContent = (content !== null && content !== undefined) ? content : 'N/A';
            cell.style.textAlign = align;
            row.appendChild(cell);
        };

        // Populate data cells
        addCell(o.cusip, 'left');
        addCell(o.amount_num?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? 'N/A', 'right');
        addCell(o.description, 'left');
        addCell(o.coupon_num?.toFixed(3) ?? 'N/A', 'right');
        addCell(o.maturity_date_str, 'center');
        addCell(o.yield_rate_num?.toFixed(3) ?? 'N/A', 'right');
        addCell(o.price_num?.toFixed(2) ?? 'N/A', 'right');
        addCell(o.moody_rating || 'N/A', 'left');
        addCell(o.sp_rating || 'N/A', 'left');
        addCell(o.call_date_str, 'center');
        addCell(o.call_price_num?.toFixed(2) ?? 'N/A', 'right');
        addCell(o.state || 'N/A', 'left');
        addCell(o.insurance || 'N/A', 'left');

        muniOfferingsTableBody.appendChild(row);
    });

    updateSelectAllMunisCheckboxState();
    emailBuyInterestBtn.disabled = selectedMuniOfferingIds.size === 0;
}


// --- Filtering and Sorting Logic ---

/**
 * Checks if a single holding matches a given filter criteria.
 * @param {object} holding - The holding object to check.
 * @param {object} filter - The filter object containing column, operator, value, and type.
 * @returns {boolean} True if the holding matches the filter, false otherwise.
 */
function checkFilter(holding, filter) {
    if (!filter || filter.value === null || filter.value === '') return true;
    const holdingValue = getHoldingSortValue(holding, filter.column); // Use HOLDING getter
    let filterValue = filter.value;
    if (holdingValue === null || holdingValue === undefined) return false;

    try {
        let compareHolding = holdingValue;
        let compareFilter = filterValue;
        if (filter.type === 'string') {
            compareHolding = String(holdingValue).toLowerCase();
            compareFilter = String(filterValue).toLowerCase();
            switch (filter.operator) {
                case 'contains': return compareHolding.includes(compareFilter);
                case 'startsWith': return compareHolding.startsWith(compareFilter);
                case 'endsWith': return compareHolding.endsWith(compareFilter);
                case '=': return compareHolding === compareFilter;
                case '!=': return compareHolding !== compareFilter;
                default: return false;
            }
        } else if (filter.type === 'number') {
            compareHolding = parseFloatSafe(holdingValue);
            compareFilter = parseFloatSafe(filterValue);
            if (compareHolding === null || compareFilter === null) return false;
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
            compareHolding = holdingValue instanceof Date ? holdingValue.getTime() : null;
            compareFilter = parseDate(filterValue)?.getTime();
            if (compareHolding === null || compareFilter === null) return false;
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
        return false;
    }
    return false;
}

/**
 * Sorts an array of data based on a key and direction.
 * @param {object[]} data - The array of objects to sort.
 * @param {string} key - The key (column) to sort by.
 * @param {string} direction - 'asc' or 'desc'.
 * @param {function} getSortValueFunc - Function to extract the sortable value.
 */
function sortDataGeneric(data, key, direction, getSortValueFunc) {
    data.sort((a, b) => {
        let valA = getSortValueFunc(a, key);
        let valB = getSortValueFunc(b, key);

        const nullOrder = direction === 'asc' ? 1 : -1;
        if (valA === null || valA === undefined) return (valB === null || valB === undefined) ? 0 : nullOrder;
        if (valB === null || valB === undefined) return -nullOrder;

        let comparison = 0;
        if (valA instanceof Date && valB instanceof Date) {
            comparison = valA.getTime() - valB.getTime();
        } else if (typeof valA === 'number' && typeof valB === 'number') {
            comparison = valA - valB;
        } else {
            valA = String(valA).toUpperCase();
            valB = String(valB).toUpperCase();
            if (valA < valB) comparison = -1;
            else if (valA > valB) comparison = 1;
        }
        return direction === 'desc' ? (comparison * -1) : comparison;
    });
}

/**
 * Retrieves the appropriate value from a HOLDING object for sorting/filtering.
 * @param {object} holding - The holding object.
 * @param {string} key - The key representing the column/property.
 * @returns {*} The value to be used for comparison.
 */
function getHoldingSortValue(holding, key) {
    switch (key) {
        case 'yield': return holding.yield_val;
        case 'maturity_date': return holding.maturity_date_obj;
        case 'call_date': return holding.call_date_obj;
        case 'par': return holding.par_calculated;
        case 'security_cusip': return holding.security_cusip;
        default: return holding[key];
    }
}
// TODO: Add getMuniOfferingSortValue if sorting is implemented for munis

// --- UI Rendering ---

/**
 * Renders the holdings data into the HTML table body.
 * @param {object[]} holdings - The array of holdings to render.
 */
function renderTable(holdings) {
    console.log("Rendering holdings table with:", holdings.length);
    const colSpan = (tableHeaders.length || 10) + 1;

    if (!tableBody) { console.error("Holdings table body not found!"); return; }

    if (!holdings || holdings.length === 0) {
        const hasActiveFilters = activeFilters.some(f => f.value !== '');
        const noDataMessage = portfolioFilterSelect.value ? 'No holdings match filter criteria.' : 'No holdings to display.';
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">${noDataMessage}</td></tr>`;
        if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
        if (emailInterestBtn) { emailInterestBtn.disabled = true; }
        return;
    }

    tableBody.innerHTML = holdings.map(h => {
        const maturityDisplay = h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : (h.maturity_date || '');
        const callDisplay = h.call_date_obj ? h.call_date_obj.toLocaleDateString() : (h.call_date || '');
        const parDisplay = (h.par_calculated ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const priceDisplay = (h.settlement_price ?? 0).toFixed(2);
        const couponDisplay = (h.coupon ?? 0).toFixed(3);
        const yieldDisplay = (h.yield_val ?? 0).toFixed(3);
        const walDisplay = (h.wal ?? 0).toFixed(2);
        const isChecked = selectedHoldingIds.has(h.id);

        return `
            <tr data-holding-id="${h.id}">
                <td class="checkbox-column">
                    <input type="checkbox" class="holding-checkbox"
                           data-holding-id="${h.id}"
                           data-cusip="${h.security_cusip || ''}"
                           data-par="${(h.par_calculated ?? 0).toFixed(2)}"
                           ${isChecked ? 'checked' : ''}
                           aria-label="Select holding ${h.security_cusip || 'N/A'}">
                </td>
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
    }).join('');

    updateSelectAllCheckboxState(); // Update holdings select-all
    emailInterestBtn.disabled = selectedHoldingIds.size === 0; // Update sell button
}

/**
 * Updates the sort indicator arrows in the holdings table headers.
 */
function updateSortIndicators() {
    tableHeaders.forEach(th => {
        const key = th.dataset.key;
        const arrowSpan = th.querySelector('.sort-arrow');
        if (!arrowSpan) return;
        if (key === currentSortKey) {
            th.classList.add('sorted');
            arrowSpan.textContent = currentSortDir === 'asc' ? ' ▲' : ' ▼';
        } else {
            th.classList.remove('sorted');
            arrowSpan.textContent = '';
        }
    });
    // TODO: Add similar logic for muni offerings table headers if sorting is implemented
}

/**
 * Calculates and renders the total values for the holdings table footer.
 * @param {object[]} holdings - The array of holdings to calculate totals from.
 */
function renderTotals(holdings) {
    const totalPar = holdings.reduce((sum, h) => sum + (h.par_calculated ?? 0), 0);
    const weightedYieldSum = holdings.reduce((sum, h) => sum + ((h.par_calculated ?? 0) * (h.yield_val ?? 0)), 0);
    const totalYield = totalPar > 0 ? weightedYieldSum / totalPar : 0;
    const weightedWalSum = holdings.reduce((sum, h) => sum + ((h.par_calculated ?? 0) * (h.wal ?? 0)), 0);
    const totalWal = totalPar > 0 ? weightedWalSum / totalPar : 0;

    document.getElementById('totals-par').textContent = totalPar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('totals-yield').textContent = totalYield.toFixed(3);
    document.getElementById('totals-wal').textContent = totalWal.toFixed(2);
}

/**
 * Destroys an existing Chart.js instance.
 * @param {string} chartId - The ID of the chart instance.
 */
function destroyChart(chartId) {
    if (chartInstances[chartId]?.destroy) {
        chartInstances[chartId].destroy();
        delete chartInstances[chartId];
    }
}

/**
 * Renders all the charts based on the holdings data.
 * @param {object[]} holdings - The array of holdings data.
 */
function renderCharts(holdings) {
    console.log("Rendering charts with holdings:", holdings.length);
    Object.keys(chartInstances).forEach(destroyChart);
    chartInstances = {};

    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
    const labelColor = isDark ? '#aaa' : '#666';
    const titleColor = isDark ? '#4dabf7' : '#0056b3';
    const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)';
    const tooltipColor = isDark ? '#f1f1f1' : '#fff';

    const baseChartOptionsStatic = {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: labelColor } },
            title: { color: titleColor, display: true },
            tooltip: { backgroundColor: tooltipBgColor, titleColor: tooltipColor, bodyColor: tooltipColor, footerColor: tooltipColor }
        },
        scales: {
            x: { ticks: { color: labelColor }, grid: { color: gridColor, borderColor: gridColor }, title: { color: labelColor, display: true } },
            y: { ticks: { color: labelColor }, grid: { color: gridColor, borderColor: gridColor }, title: { color: labelColor, display: true } }
        },
    };

    const pdfBackgroundPlugin = {
        id: 'pdfBackground',
        beforeDraw: (chart) => {
            const ctx = chart.canvas.getContext('2d');
            ctx.save(); ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, chart.width, chart.height);
            ctx.restore();
        }
    };

    const contexts = {
        yieldVsMaturityChart: document.getElementById('yieldVsMaturityChart')?.getContext('2d'),
        parByMaturityYearChart: document.getElementById('parByMaturityYearChart')?.getContext('2d'),
        couponPieChart: document.getElementById('couponPieChart')?.getContext('2d'),
        priceVsYieldChart: document.getElementById('priceVsYieldChart')?.getContext('2d'),
    };

    if (Object.values(contexts).some(ctx => !ctx)) {
        console.error("One or more chart canvas elements not found."); return;
    }

    // Chart 1: Yield vs. Estimated Maturity Year (Scatter)
    const yieldMaturityPoints = holdings.filter(h => h.estimated_maturity_date !== null && typeof h.yield_val === 'number').map(h => ({ x: h.estimated_maturity_date, y: h.yield_val }));
    if (yieldMaturityPoints.length > 0 && contexts.yieldVsMaturityChart) { /* ... chart 1 config ... */
        const options1 = structuredClone(baseChartOptionsStatic);
        options1.plugins.title.text = 'Yield vs. Estimated Maturity Year';
        options1.scales.x.type = 'linear'; options1.scales.x.position = 'bottom'; options1.scales.x.title.text = 'Estimated Maturity Year';
        options1.scales.x.ticks = { ...options1.scales.x.ticks, stepSize: 1, callback: value => Math.round(value) };
        options1.scales.y.beginAtZero = false; options1.scales.y.title.text = 'Yield (%)';
        options1.plugins.tooltip.callbacks = { label: ctx => `Year: ${ctx.parsed.x}, Yield: ${ctx.parsed.y.toFixed(3)}` };
        options1.plugins.pdfBackground = pdfBackgroundPlugin;
        const dataset1 = { label: 'Yield vs Est Maturity Year', data: yieldMaturityPoints, backgroundColor: isDark ? 'rgba(66, 135, 245, 0.7)' : 'rgba(0, 123, 255, 0.5)', borderColor: isDark ? 'rgba(86, 155, 255, 1)' : 'rgba(0, 123, 255, 1)', pointRadius: 5, pointHoverRadius: 7, showLine: false };
        if (typeof Chart !== 'undefined' && window.pluginTrendlineLinear) { dataset1.trendlineLinear = { style: isDark ? "rgba(255, 80, 80, 0.9)" : "rgba(255, 50, 50, 0.8)", lineStyle: "solid", width: 2, projection: false }; }
        chartInstances.yieldVsMaturityChart = new Chart(contexts.yieldVsMaturityChart, { type: 'scatter', data: { datasets: [dataset1] }, options: options1 });
     }

    // Chart 2: Total Par by Estimated Maturity Year (Bar)
    const maturityBuckets = {}; holdings.forEach(h => { const year = h.estimated_maturity_date || (h.maturity_date_obj ? h.maturity_date_obj.getFullYear() : 'Unknown'); if (year !== 'Unknown' && !isNaN(year)) { maturityBuckets[year] = (maturityBuckets[year] || 0) + (h.par_calculated ?? 0); } }); const sortedYears = Object.keys(maturityBuckets).map(Number).sort((a, b) => a - b);
    if (sortedYears.length > 0 && contexts.parByMaturityYearChart) { /* ... chart 2 config ... */
        const options2 = structuredClone(baseChartOptionsStatic);
        options2.plugins.title.text = 'Total Par by Estimated Maturity Year'; options2.scales.x.title.text = 'Year'; options2.scales.y.beginAtZero = true; options2.scales.y.title.text = 'Total Par Value';
        options2.scales.y.ticks = { ...options2.scales.y.ticks, callback: value => value.toLocaleString() };
        options2.plugins.tooltip.callbacks = { label: ctx => `Year: ${ctx.label}, Par: ${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` };
        options2.plugins.pdfBackground = pdfBackgroundPlugin;
        chartInstances.parByMaturityYearChart = new Chart(contexts.parByMaturityYearChart, { type: 'bar', data: { labels: sortedYears, datasets: [{ label: 'Total Par by Est. Maturity Year', data: sortedYears.map(year => maturityBuckets[year]), backgroundColor: isDark ? 'rgba(40, 167, 69, 0.85)' : 'rgba(40, 167, 69, 0.7)', borderColor: isDark ? 'rgba(60, 187, 89, 1)' : 'rgba(40, 167, 69, 1)', borderWidth: 1 }] }, options: options2 });
     }

    // Chart 3: Portfolio Par Distribution by Coupon Rate (Pie)
    const couponBuckets = {}; holdings.forEach(h => { const couponRate = (h.coupon ?? 0).toFixed(3); couponBuckets[couponRate] = (couponBuckets[couponRate] || 0) + (h.par_calculated ?? 0); }); const sortedCoupons = Object.keys(couponBuckets).sort((a, b) => parseFloat(a) - parseFloat(b));
    if (sortedCoupons.length > 0 && contexts.couponPieChart) { /* ... chart 3 config ... */
        const pieColors = generateDistinctColors(sortedCoupons.length); const options3 = structuredClone(baseChartOptionsStatic); delete options3.scales; options3.plugins.title.text = 'Portfolio Par Distribution by Coupon Rate'; options3.plugins.title.align = 'center'; options3.plugins.legend.position = 'bottom';
        options3.plugins.tooltip.callbacks = { label: ctx => { const label = ctx.label || ''; const value = ctx.parsed || 0; const total = ctx.dataset.data.reduce((acc, val) => acc + val, 0); const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0; return `${label}: ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`; } };
        options3.plugins.pdfBackground = pdfBackgroundPlugin;
        chartInstances.couponPieChart = new Chart(contexts.couponPieChart, { type: 'pie', data: { labels: sortedCoupons.map(c => `${c}% Coupon`), datasets: [{ label: 'Par by Coupon Rate', data: sortedCoupons.map(c => couponBuckets[c]), backgroundColor: pieColors, hoverOffset: 4 }] }, options: options3 });
     }

    // Chart 4: Settlement Price vs. Yield (Scatter)
    const priceYieldPoints = holdings.filter(h => typeof h.settlement_price === 'number' && h.settlement_price > 0 && typeof h.yield_val === 'number').map(h => ({ x: h.settlement_price, y: h.yield_val }));
    if (priceYieldPoints.length > 0 && contexts.priceVsYieldChart) { /* ... chart 4 config ... */
        const options4 = structuredClone(baseChartOptionsStatic);
        options4.plugins.title.text = 'Settlement Price vs. Yield'; options4.scales.x.beginAtZero = false; options4.scales.x.title.text = 'Settlement Price'; options4.scales.y.beginAtZero = false; options4.scales.y.title.text = 'Yield (%)';
        options4.plugins.tooltip.callbacks = { label: ctx => `Price: ${ctx.parsed.x.toFixed(2)}, Yield: ${ctx.parsed.y.toFixed(3)}` };
        options4.plugins.pdfBackground = pdfBackgroundPlugin;
        chartInstances.priceVsYieldChart = new Chart(contexts.priceVsYieldChart, { type: 'scatter', data: { datasets: [{ label: 'Price vs Yield', data: priceYieldPoints, backgroundColor: isDark ? 'rgba(255, 200, 50, 0.7)' : 'rgba(255, 193, 7, 0.6)', borderColor: isDark ? 'rgba(255, 210, 70, 1)' : 'rgba(255, 193, 7, 1)', pointRadius: 5, pointHoverRadius: 7, showLine: false }] }, options: options4 });
     }
}


// --- UI Update Triggers ---

/**
 * Applies filters and sorting to holdings, then renders table and totals.
 */
function triggerTableUpdate() {
    applyFilterAndSort();
    renderTotals(filteredHoldings);
}

/**
 * Applies filters and sorting to holdings, then renders table, totals, and charts.
 */
function triggerFullUpdate() {
    applyFilterAndSort();
    renderTotals(filteredHoldings);
    renderCharts(filteredHoldings); // Only render charts based on holdings
}

/**
 * Applies filters and sorting to `allHoldings`, storing result in `filteredHoldings`.
 * Renders the filtered holdings table and updates sort indicators.
 */
function applyFilterAndSort() {
    const filtersToApply = activeFilters.filter(f => f.value !== null && f.value !== '');
    if (filtersToApply.length > 0) {
        filteredHoldings = allHoldings.filter(holding => {
            return filtersToApply.every(filter => checkFilter(holding, filter));
        });
    } else {
        filteredHoldings = [...allHoldings];
    }
    // Use generic sort function with holding-specific value getter
    sortDataGeneric(filteredHoldings, currentSortKey, currentSortDir, getHoldingSortValue);
    renderTable(filteredHoldings); // Render holdings table
    updateSortIndicators(); // Update holdings table indicators
}

/**
 * Clears the holdings table, totals, charts, and selections.
 */
function clearTableAndCharts() {
    const colSpan = (tableHeaders.length || 10) + 1;
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading...</td></tr>`;
    }
    renderTotals([]);
    Object.keys(chartInstances).forEach(destroyChart);
    chartInstances = {};
    clearHoldingSelection();
}

// --- Theme Toggling ---

/**
 * Applies the specified theme and re-renders charts.
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
    try {
        localStorage.setItem('themeCheck', '1'); localStorage.removeItem('themeCheck');
        if (Object.keys(chartInstances).length > 0) {
             renderCharts(filteredHoldings); // Re-render holdings charts
        }
    } catch (e) { console.warn("localStorage not accessible for theme update."); }
}

/**
 * Toggles the theme and saves preference.
 */
function toggleTheme() {
    const currentTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    try { localStorage.setItem('portfolioTheme', currentTheme); }
    catch (e) { console.warn("Could not save theme preference to localStorage:", e); }
    applyTheme(currentTheme);
}

// --- PDF Export --- (No changes needed for muni offerings)

/**
 * Exports the current view (charts and holdings table) to PDF.
 */
async function exportToPdf() {
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const isDark = document.body.classList.contains('dark-mode');
    const pdfHeaderBg = isDark ? '#3a3a3a' : '#e9ecef'; const pdfHeaderText = isDark ? '#e0e0e0' : '#495057'; const pdfTextColor = isDark ? '#f1f1f1' : '#333333'; const pdfBorderColor = isDark ? '#444444' : '#dee2e6'; const pdfRowBg = isDark ? '#2c2c2c' : '#ffffff'; const pdfAlternateRowBg = isDark ? '#303030' : '#f8f9fa';
    const pageHeight = doc.internal.pageSize.getHeight(); const pageWidth = doc.internal.pageSize.getWidth(); const margin = 40; const usableWidth = pageWidth - (2 * margin); const usableHeight = pageHeight - (2 * margin);

    // Page 1: Charts
    const chartGap = 25; const chartWidth = ((usableWidth - chartGap) / 2) * 0.95; const chartHeight = ((usableHeight - chartGap - 30) / 2) * 0.95; const chartStartX1 = margin; const chartStartX2 = margin + chartWidth + chartGap; const chartStartY1 = margin + 25; const chartStartY2 = chartStartY1 + chartHeight + chartGap;
    doc.setFontSize(18); doc.setTextColor(isDark ? 241 : 51); const viewTitle = portfolioNameEl.textContent || 'Portfolio Analysis'; doc.text(viewTitle + " - Charts", margin, margin + 5);
    const chartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart', 'priceVsYieldChart']; const chartImages = [];
    for (const chartId of chartIds) { const chartInstance = chartInstances[chartId]; try { if (chartInstance) { chartImages.push(chartInstance.toBase64Image('image/png', 1.0)); } else { chartImages.push(null); } } catch (e) { console.error(`Error getting image for chart ${chartId}:`, e); chartImages.push(null); } }
    if (chartImages[0]) doc.addImage(chartImages[0], 'PNG', chartStartX1, chartStartY1, chartWidth, chartHeight); if (chartImages[1]) doc.addImage(chartImages[1], 'PNG', chartStartX2, chartStartY1, chartWidth, chartHeight); if (chartImages[2]) doc.addImage(chartImages[2], 'PNG', chartStartX1, chartStartY2, chartWidth, chartHeight); if (chartImages[3]) doc.addImage(chartImages[3], 'PNG', chartStartX2, chartStartY2, chartWidth, chartHeight);

    // Page 2: Holdings Table
    doc.addPage(); doc.setFontSize(18); doc.setTextColor(isDark ? 241 : 51); doc.text(viewTitle + " - Holdings Table", margin, margin + 5);
    doc.autoTable({
        html: '#holdings-table', startY: margin + 25, theme: 'grid',
        columns: [ { header: 'CUSIP', dataKey: 1 }, { header: 'Description', dataKey: 2 }, { header: 'Par', dataKey: 3 }, { header: 'Price', dataKey: 4 }, { header: 'Coupon', dataKey: 5 }, { header: 'Yield', dataKey: 6 }, { header: 'WAL', dataKey: 7 }, { header: 'Est. Maturity Year', dataKey: 8 }, { header: 'Maturity Date', dataKey: 9 }, { header: 'Call Date', dataKey: 10 }, ],
        styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak', textColor: pdfTextColor, lineColor: pdfBorderColor, lineWidth: 0.5, },
        headStyles: { fillColor: pdfHeaderBg, textColor: pdfHeaderText, fontStyle: 'bold', halign: 'center', lineColor: pdfBorderColor, lineWidth: 0.5, },
        bodyStyles: { fillColor: pdfRowBg, textColor: pdfTextColor, lineColor: pdfBorderColor, lineWidth: 0.5, },
        alternateRowStyles: { fillColor: pdfAlternateRowBg },
        columnStyles: { 0: { cellWidth: 55, halign: 'left' }, 1: { cellWidth: 'auto', halign: 'left'}, 2: { cellWidth: 60, halign: 'right' }, 3: { cellWidth: 40, halign: 'right' }, 4: { cellWidth: 40, halign: 'right' }, 5: { cellWidth: 40, halign: 'right' }, 6: { cellWidth: 40, halign: 'right' }, 7: { cellWidth: 55, halign: 'center' }, 8: { cellWidth: 55, halign: 'center' }, 9: { cellWidth: 55, halign: 'center' } },
        margin: { left: margin, right: margin },
        didDrawPage: function (data) { let footerStr = "Page " + doc.internal.getCurrentPageInfo().pageNumber; doc.setFontSize(8); doc.setTextColor(isDark ? 150 : 100); doc.text(footerStr, data.settings.margin.left, pageHeight - 15, { baseline: 'bottom' }); }
    });

    const selectedCustomerOption = customerSelect.options[customerSelect.selectedIndex]; const selectedPortfolioOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex]; let baseFilename = 'export'; if (selectedCustomerOption) { baseFilename = selectedCustomerOption.text.split('(')[0].trim(); if (selectedPortfolioOption && selectedPortfolioOption.value !== "") { baseFilename += '_' + selectedPortfolioOption.text.split('(')[0].trim(); } } const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`portfolio_${safeFilename}.pdf`);
}


// --- Modal Functions (Create Portfolio) --- (No changes needed)

/** Shows the create portfolio modal. */
function showCreatePortfolioModal() {
    console.log("Showing create portfolio modal. Admin:", IS_ADMIN_USER, "Customer Count:", customers.length);
    createPortfolioForm.reset(); modalErrorMessage.textContent = ''; modalErrorMessage.style.display = 'none'; adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>';
    if (IS_ADMIN_USER) { adminCustomerSelectGroup.classList.remove('hidden'); fetchCustomersForAdmin(); }
    else if (customers && customers.length > 1) { adminCustomerSelectGroup.classList.remove('hidden'); customers.forEach(customer => { const option = document.createElement('option'); option.value = customer.id; option.textContent = `${customer.name} (${customer.customer_number})`; adminCustomerSelect.appendChild(option); }); }
    else { adminCustomerSelectGroup.classList.add('hidden'); }
    createPortfolioModal.classList.add('visible');
}
/** Hides the create portfolio modal. */
function hideCreatePortfolioModal() { createPortfolioModal.classList.remove('visible'); }
/** Fetches customers for the admin modal dropdown. */
async function fetchCustomersForAdmin() { /* ... implementation ... */
    if (!IS_ADMIN_USER) return; console.log("Fetching customers for admin modal...");
    if (adminCustomerSelect.options.length > 1 && adminCustomerSelect.options[0].value === "") { console.log("Admin customer list already populated/loading."); return; }
    adminCustomerSelect.innerHTML = '<option value="">Loading customers...</option>';
    try { const response = await fetch(`${apiRoot}/customers/`); if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`); availableCustomers = await response.json(); console.log("Fetched customers for admin modal:", availableCustomers.length); adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>'; availableCustomers.forEach(customer => { const option = document.createElement('option'); option.value = customer.customer_number; option.textContent = `${customer.name} (${customer.customer_number})`; adminCustomerSelect.appendChild(option); }); }
    catch (error) { console.error("Failed to fetch customers for admin:", error); adminCustomerSelect.innerHTML = '<option value="">Error loading customers</option>'; modalErrorMessage.textContent = 'Error loading customer list for modal.'; modalErrorMessage.style.display = 'block'; }
 }
/** Handles the create portfolio form submission. */
async function handleCreatePortfolioSubmit(event) { /* ... implementation ... */
    event.preventDefault(); console.log("Handling create portfolio submit..."); modalErrorMessage.textContent = ''; modalErrorMessage.style.display = 'none';
    const portfolioName = newPortfolioNameInput.value.trim(); if (!portfolioName) { modalErrorMessage.textContent = 'Portfolio name is required.'; modalErrorMessage.style.display = 'block'; return; }
    const payload = { name: portfolioName }; const isCustomerSelectionVisible = !adminCustomerSelectGroup.classList.contains('hidden');
    if (isCustomerSelectionVisible) { const selectedValue = adminCustomerSelect.value; if (!selectedValue) { modalErrorMessage.textContent = 'Please select a customer.'; modalErrorMessage.style.display = 'block'; return; } if (IS_ADMIN_USER) { payload.customer_number_input = selectedValue; } else { payload.owner_customer_id = parseInt(selectedValue, 10); if (isNaN(payload.owner_customer_id)) { modalErrorMessage.textContent = 'Invalid customer selected.'; modalErrorMessage.style.display = 'block'; return; } } }
    const initialHoldingIds = filteredHoldings.map(holding => holding.id).filter(id => id != null); if (initialHoldingIds.length > 0) { payload.initial_holding_ids = initialHoldingIds; }
    console.log("Final create portfolio payload:", payload);
    try { const response = await fetch(`${apiRoot}/portfolios/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, }, body: JSON.stringify(payload), }); console.log("Create portfolio response status:", response.status); if (!response.ok) { const errorData = await response.json().catch(() => ({ detail: response.statusText })); let errorMsg = `Error ${response.status}: ${errorData.detail || JSON.stringify(errorData)}`; if (typeof errorData === 'object' && errorData !== null) { errorMsg = Object.entries(errorData).map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`).join('; '); } throw new Error(errorMsg); } const newPortfolio = await response.json(); console.log('Successfully created portfolio:', newPortfolio); hideCreatePortfolioModal(); alert(`Portfolio "${newPortfolio.name}" created successfully!`); if (selectedCustomerId) { await loadPortfolios(selectedCustomerId); portfolioFilterSelect.value = newPortfolio.id; await handlePortfolioSelection(); } else { loadCustomers(); } }
    catch (error) { console.error('Failed to create portfolio:', error); modalErrorMessage.textContent = `Creation failed: ${error.message}`; modalErrorMessage.style.display = 'block'; }
 }

/** Handles the delete portfolio button click. */
async function handleDeletePortfolio() { /* ... implementation ... */
    const portfolioIdToDelete = portfolioFilterSelect.value; const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex]; const portfolioNameToDelete = selectedOption ? selectedOption.textContent : `Portfolio ID ${portfolioIdToDelete}`;
    if (!portfolioIdToDelete || selectedOption?.dataset?.isDefault === 'true') { alert("Please select a non-default portfolio to delete."); return; }
    if (!confirm(`Are you sure you want to delete portfolio "${portfolioNameToDelete}"? This action cannot be undone.`)) { return; }
    console.log(`Attempting to delete portfolio ID: ${portfolioIdToDelete}`);
    try { const response = await fetch(`${apiRoot}/portfolios/${portfolioIdToDelete}/`, { method: 'DELETE', headers: { 'X-CSRFToken': csrfToken, 'Accept': 'application/json', } }); console.log(`Delete portfolio response status: ${response.status}`); if (response.status === 204) { alert(`Portfolio "${portfolioNameToDelete}" deleted successfully.`); selectedOption.remove(); if (portfolioFilterSelect.options.length > 0) { portfolioFilterSelect.value = portfolioFilterSelect.options[0].value; await handlePortfolioSelection(); } else { portfolioFilterContainer.classList.add('hidden'); deletePortfolioBtn.disabled = true; const selectedCustomer = customers.find(c => c.id == selectedCustomerId); portfolioNameEl.textContent = `${selectedCustomer.name || `Customer ${selectedCustomer.customer_number}`} - No Portfolios Found`; clearTableAndCharts(); const colSpan = (tableHeaders.length || 10) + 1; tableBody.innerHTML = `<tr><td colspan="${colSpan}">No portfolios found.</td></tr>`; } } else { let errorMsg = `Error ${response.status}: Failed to delete portfolio.`; try { const errorData = await response.json(); errorMsg += ` ${errorData.detail || JSON.stringify(errorData)}`; } catch (e) { errorMsg += ` ${response.statusText}`; } throw new Error(errorMsg); } }
    catch (error) { console.error("Failed to delete portfolio:", error); alert(`Error deleting portfolio: ${error.message}`); }
 }


// --- Holding Selection and Email Action ---

/** Handles checkbox changes for holdings. */
function handleCheckboxChange(event) {
    const target = event.target;
    if (target === selectAllCheckbox) { const isChecked = target.checked; const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox'); visibleCheckboxes.forEach(checkbox => { checkbox.checked = isChecked; const holdingId = parseInt(checkbox.dataset.holdingId, 10); if (!isNaN(holdingId)) { if (isChecked) { selectedHoldingIds.add(holdingId); } else { selectedHoldingIds.delete(holdingId); } } }); }
    else if (target.classList.contains('holding-checkbox')) { const holdingId = parseInt(target.dataset.holdingId, 10); if (!isNaN(holdingId)) { if (target.checked) { selectedHoldingIds.add(holdingId); } else { selectedHoldingIds.delete(holdingId); } updateSelectAllCheckboxState(); } }
    emailInterestBtn.disabled = selectedHoldingIds.size === 0; console.log("Selected Holdings:", selectedHoldingIds);
}
/** Updates the "Select All" checkbox state for holdings. */
function updateSelectAllCheckboxState() {
    if (!selectAllCheckbox || !tableBody) return;
    const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox');
    const totalVisible = visibleCheckboxes.length;
    const totalSelected = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;
    if (totalVisible === 0) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
    else if (totalSelected === totalVisible) { selectAllCheckbox.checked = true; selectAllCheckbox.indeterminate = false; }
    else if (totalSelected > 0) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = true; }
    else { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
}
/** Clears holding selection. */
function clearHoldingSelection() {
    selectedHoldingIds.clear();
    if(tableBody) tableBody.querySelectorAll('.holding-checkbox').forEach(cb => cb.checked = false);
    if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
    if (emailInterestBtn) { emailInterestBtn.disabled = true; }
    if (emailStatusMessage) { emailStatusMessage.textContent = ''; emailStatusMessage.style.display = 'none'; }
}
/** Handles the "Sell Bonds" button click. */
async function handleEmailInterestClick() {
    if (!selectedCustomerId) { showStatusMessageGeneric(emailStatusMessage, "Error: No customer selected.", true); return; }
    if (selectedHoldingIds.size === 0) { showStatusMessageGeneric(emailStatusMessage, "Error: No bonds selected.", true); return; }
    emailInterestBtn.disabled = true; showStatusMessageGeneric(emailStatusMessage, "Sending email...", false, 0);
    const selectedBondsPayload = []; filteredHoldings.forEach(holding => { if (selectedHoldingIds.has(holding.id)) { selectedBondsPayload.push({ cusip: holding.security_cusip || 'N/A', par: (holding.par_calculated ?? 0).toFixed(2) }); } });
    const payload = { customer_id: parseInt(selectedCustomerId, 10), selected_bonds: selectedBondsPayload }; console.log("Sending email interest payload:", payload);
    try { const response = await fetch(`${apiRoot}/email-salesperson-interest/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, }, body: JSON.stringify(payload), }); const responseData = await response.json(); if (response.ok) { console.log("Email sent successfully:", responseData); showStatusMessageGeneric(emailStatusMessage, responseData.message || "Email sent successfully!", false); clearHoldingSelection(); } else { console.error("API Error sending email:", response.status, responseData); const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.'; showStatusMessageGeneric(emailStatusMessage, `Error: ${errorDetail}`, true); emailInterestBtn.disabled = false; } }
    catch (error) { console.error("Network/Fetch Error sending email:", error); showStatusMessageGeneric(emailStatusMessage, "Network error. Please try again.", true); emailInterestBtn.disabled = false; }
}

// --- Muni Offering Selection and Email Action ---

/** Handles checkbox changes for muni offerings. */
function handleMuniCheckboxChange(event) {
    const target = event.target;

    if (target === selectAllMunisCheckbox) {
        // Handle "Select All" muni checkbox click
        const isChecked = target.checked;
        const visibleCheckboxes = muniOfferingsTableBody.querySelectorAll('.muni-checkbox');
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const offeringId = parseInt(checkbox.dataset.offeringId, 10);
            if (!isNaN(offeringId)) {
                if (isChecked) {
                    selectedMuniOfferingIds.add(offeringId);
                } else {
                    selectedMuniOfferingIds.delete(offeringId);
                }
            }
        });
    } else if (target.classList.contains('muni-checkbox')) {
        // Handle individual muni offering checkbox click
        const offeringId = parseInt(target.dataset.offeringId, 10);
        if (!isNaN(offeringId)) {
            if (target.checked) {
                selectedMuniOfferingIds.add(offeringId);
            } else {
                selectedMuniOfferingIds.delete(offeringId);
            }
            updateSelectAllMunisCheckboxState(); // Update muni select-all state
        }
    }

    // Enable/disable the "Buy" email button
    emailBuyInterestBtn.disabled = selectedMuniOfferingIds.size === 0;
    console.log("Selected Muni Offerings:", selectedMuniOfferingIds);
}

/** Updates the "Select All" checkbox state for muni offerings. */
function updateSelectAllMunisCheckboxState() {
    if (!selectAllMunisCheckbox || !muniOfferingsTableBody) return;
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

/** Clears muni offering selection. */
function clearMuniOfferingSelection() {
    selectedMuniOfferingIds.clear();
    if(muniOfferingsTableBody) muniOfferingsTableBody.querySelectorAll('.muni-checkbox').forEach(cb => cb.checked = false);
    if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
    if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; }
    if (emailBuyStatusMessage) { emailBuyStatusMessage.textContent = ''; emailBuyStatusMessage.style.display = 'none'; }
}

/** Handles the "Indicate Interest in Buying" button click. */
async function handleEmailBuyInterestClick() {
    if (!selectedCustomerId) {
        showStatusMessageGeneric(emailBuyStatusMessage, "Error: No customer selected.", true);
        return;
    }
    if (selectedMuniOfferingIds.size === 0) {
        showStatusMessageGeneric(emailBuyStatusMessage, "Error: No offerings selected.", true);
        return;
    }

    emailBuyInterestBtn.disabled = true;
    showStatusMessageGeneric(emailBuyStatusMessage, "Sending email...", false, 0);

    // Prepare the list of selected offerings for the payload
    const selectedOfferingsPayload = [];
    // Iterate through *all* muni offerings data to find selected ones by ID
    allMuniOfferings.forEach(offering => {
        if (selectedMuniOfferingIds.has(offering.id)) {
            // *** FIX: Include description along with cusip ***
            selectedOfferingsPayload.push({
                cusip: offering.cusip || 'N/A',
                description: offering.description || 'N/A' // Add description
                // Amount is not needed according to the backend error log,
                // but keep it in the data object if needed elsewhere
                // amount: (offering.amount_num ?? 0).toFixed(2)
            });
        }
    });

    // Construct the final payload
    const payload = {
        customer_id: parseInt(selectedCustomerId, 10),
        selected_offerings: selectedOfferingsPayload // Use a distinct key
    };

    console.log("Sending email buy interest payload:", payload); // Log the corrected payload

    // Define the NEW API endpoint URL
    const buyInterestApiUrl = `${apiRoot}/email-buy-muni-interest/`;

    try {
        const response = await fetch(buyInterestApiUrl, { // Use the new URL
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify(payload),
        });

        const responseData = await response.json();

        if (response.ok) {
            console.log("Buy interest email sent successfully:", responseData);
            showStatusMessageGeneric(emailBuyStatusMessage, responseData.message || "Buy interest email sent successfully!", false);
            clearMuniOfferingSelection(); // Clear selection on success
        } else {
            console.error("API Error sending buy interest email:", response.status, responseData);
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            // Check for specific validation error structure
            let displayError = `Error: ${errorDetail}`;
            if (responseData.selected_offerings && typeof responseData.selected_offerings === 'object') {
                 // Try to extract nested validation errors if they exist
                 const nestedErrors = Object.values(responseData.selected_offerings)
                     .map(itemErrors => Object.values(itemErrors).flat().map(e => e.string || e).join(' '))
                     .join('; ');
                 if (nestedErrors) {
                     displayError = `Error: Invalid data in selected offerings - ${nestedErrors}`;
                 }
            }
            showStatusMessageGeneric(emailBuyStatusMessage, displayError, true);
            emailBuyInterestBtn.disabled = false; // Re-enable button on failure
        }
    } catch (error) {
        console.error("Network/Fetch Error sending buy interest email:", error);
        showStatusMessageGeneric(emailBuyStatusMessage, "Network error. Please try again.", true);
        emailBuyInterestBtn.disabled = false; // Re-enable button for retry
    }
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

    // Filters
    addFilterBtn.addEventListener('click', () => addFilterRow());
    clearAllFiltersBtn.addEventListener('click', handleClearAllFilters);

    // Holdings Table Sorting
    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key; if (!key) return;
            if (key === currentSortKey) { currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc'; }
            else { currentSortKey = key; currentSortDir = 'asc'; }
            applySortAndRenderTable(); // Apply sort to holdings table
        });
    });
    // TODO: Add listeners for muni offerings table headers if sorting is implemented

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
    if (tableBody) tableBody.addEventListener('change', handleCheckboxChange); // Use delegation
    if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', handleCheckboxChange);
    if (emailInterestBtn) emailInterestBtn.addEventListener('click', handleEmailInterestClick);

    // Muni Offerings Table Checkboxes & Email Button (Buy)
    if (muniOfferingsTableBody) muniOfferingsTableBody.addEventListener('change', handleMuniCheckboxChange); // Use delegation
    if (selectAllMunisCheckbox) selectAllMunisCheckbox.addEventListener('change', handleMuniCheckboxChange);
    if (emailBuyInterestBtn) emailBuyInterestBtn.addEventListener('click', handleEmailBuyInterestClick);
}

/**
 * Applies sorting and re-renders the holdings table and totals.
 */
function applySortAndRenderTable() {
    sortDataGeneric(filteredHoldings, currentSortKey, currentSortDir, getHoldingSortValue);
    renderTable(filteredHoldings);
    renderTotals(filteredHoldings);
    updateSortIndicators();
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // Initial setup
    generateColumnOptions();
    addFilterRow();

    // Register Chart.js plugins
    if (typeof Chart !== 'undefined' && window.pluginTrendlineLinear) {
        try { Chart.register(window.pluginTrendlineLinear); console.log("Trendline plugin registered."); }
        catch (e) { console.error("Error registering Trendline plugin:", e); }
    } else { console.warn("Chart.js or Trendline plugin not found."); }

    // Apply theme
    let preferredTheme = 'light';
    try { localStorage.setItem('themeCheck', '1'); localStorage.removeItem('themeCheck'); preferredTheme = localStorage.getItem('portfolioTheme') || 'light'; console.log("Theme preference loaded:", preferredTheme); }
    catch (e) { console.warn("Could not access localStorage for theme preference:", e); }
    applyTheme(preferredTheme);

    // Setup event listeners
    setupEventListeners();

    // Start loading initial data
    loadCustomers(); // This triggers portfolio/holdings load
    loadMuniOfferings(); // Load municipal offerings data
});
