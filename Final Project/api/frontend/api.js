// api.js
// Handles all communication with the backend API.

"use strict";

import { API_ROOT, CSRF_TOKEN, IS_ADMIN, PAGE_SIZE } from './config.js';
import * as state from './state.js';
import * as ui from './ui.js'; // For updating UI during/after API calls
import * as filters from './filters.js'; // To get filter state and trigger fetches
// Renamed import for clarity
import { processAndDisplayHoldingsPage, processAndDisplayMuniOfferings, renderChartsWithAllData } from './ui.js';

// --- DOM Element References (needed for UI updates within API functions) ---
const customerSelect = document.getElementById('customer-select');
const portfolioFilterContainer = document.getElementById('portfolio-filter-container');
const portfolioFilterSelect = document.getElementById('portfolio-filter-select');
const portfolioNameEl = document.getElementById('portfolio-name');
const deletePortfolioBtn = document.getElementById('delete-portfolio-btn');
const tableBody = document.querySelector('#holdings-table tbody');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]'); // Needed for colspan
const holdingsPaginationControls = document.getElementById('holdings-pagination-controls');
const muniOfferingsTableBody = document.querySelector('#muni-offerings-table tbody');
const muniTableHeaders = document.querySelectorAll('#muni-offerings-table th[data-key]'); // Needed for colspan
const muniPaginationControls = document.getElementById('muni-pagination-controls');
const createPortfolioModal = document.getElementById('create-portfolio-modal');
const adminCustomerSelectGroup = document.getElementById('admin-customer-select-group');
const adminCustomerSelect = document.getElementById('admin-customer-select');
const modalErrorMessage = document.getElementById('modal-error-message');
const emailInterestBtn = document.getElementById('email-interest-btn');
const emailStatusMessage = document.getElementById('email-status-message');
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const emailBuyStatusMessage = document.getElementById('email-buy-status-message');

// --- Helper Function for Backend Field Mapping ---
/**
 * Maps frontend data keys (from table headers/filter dropdown)
 * to the corresponding backend field names used in API filtering/sorting.
 * @param {string} frontendKey - The key used in the frontend (e.g., 'security_cusip', 'wal').
 * @returns {string} The corresponding backend field name (e.g., 'security__cusip', 'holding_average_life').
 */
function mapFrontendKeyToBackend(frontendKey) {
    switch (frontendKey) {
        case 'security_cusip': return 'security__cusip';
        case 'security_description': return 'security__description';
        // *** MODIFIED: Map frontend 'par_value' to backend 'calculated_par_value' ***
        case 'par_value': return 'calculated_par_value';
        // *** END MODIFICATION ***
        case 'book_price': return 'book_price';
        case 'market_price': return 'market_price';
        case 'coupon': return 'security__coupon'; // Nested field
        case 'book_yield': return 'book_yield';
        case 'wal': return 'holding_average_life'; // Specific mapping for Weighted Average Life
        case 'holding_duration': return 'holding_duration';
        case 'maturity_date': return 'security__maturity_date'; // Nested field
        case 'call_date': return 'security__call_date'; // Nested field
        case 'intention_code': return 'intention_code';
        // Add other mappings if needed based on backend model structure
        default:
            console.warn(`Unhandled frontend key mapping: ${frontendKey}. Using directly.`);
            return frontendKey; // Default to using the key directly if no specific mapping
    }
}


/** Fetches the list of customers accessible to the current user. */
export async function loadCustomers(page = 1) {
    console.log(`Attempting to load customers (page ${page})...`);
    // Ensure elements exist before manipulating
    if (customerSelect) {
        customerSelect.innerHTML = '<option value="">Loading customers...</option>';
        customerSelect.disabled = true;
    }
    if (portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');

    try {
        const res = await fetch(`${API_ROOT}/customers/?page=${page}`);
        console.log("Load customers response status:", res.status);
        if (!res.ok) throw new Error(`HTTP error loading customers! Status: ${res.status}`);

        const data = await res.json();
        state.setCustomers(data.results || []); // Update state
        console.log("Customers loaded:", state.customers.length, "Total:", data.count);

        if (customerSelect) {
            customerSelect.innerHTML = ''; // Clear loading message
            if (data.count === 0) {
                customerSelect.innerHTML = '<option value="">No customers found</option>';
                if (portfolioNameEl) portfolioNameEl.textContent = "No customers available for this user.";
                ui.clearTableAndCharts(); // Clear everything if no customers
                return;
            }

            if (data.count > 1 || !IS_ADMIN) {
                customerSelect.innerHTML = '<option value="">-- Select Customer --</option>';
            }

            state.customers.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = `${c.name || 'Unnamed'} (${c.customer_number || 'No Number'})`;
                customerSelect.appendChild(option);
            });

            customerSelect.disabled = false; // Enable dropdown

            // Handle initial state: If only one customer and it's an admin, auto-select.
            if (data.count === 1 && IS_ADMIN) {
                customerSelect.value = state.customers[0].id;
                // Programmatic selection doesn't fire 'change', so call handler manually
                await ui.handleCustomerSelection(); // This will trigger loadPortfolios
            } else {
                // Reset portfolio dropdown and main content area until customer is selected
                if (portfolioNameEl) portfolioNameEl.textContent = "Please select a customer";
                // Only clear holdings section when waiting for customer selection
                ui.clearHoldingsUI(); // Clears table, totals, charts, pagination
                if (portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');
                if (deletePortfolioBtn) deletePortfolioBtn.disabled = true;
            }
        }

    } catch (error) {
        console.error("Failed to load customers:", error);
        if (customerSelect) customerSelect.innerHTML = '<option value="">Error loading</option>';
        if (portfolioNameEl) portfolioNameEl.textContent = "Error loading customers";
        ui.clearTableAndCharts(); // Clear everything on major error
    }
}

/** Fetches portfolios for the selected customer (Handles pagination). */
export async function loadPortfolios(customerId, page = 1) {
    console.log(`Attempting to load portfolios for customer ID: ${customerId} (page ${page})`);
    if (portfolioFilterSelect) {
        portfolioFilterSelect.innerHTML = '<option value="">Loading portfolios...</option>';
        portfolioFilterSelect.disabled = true;
    }
    if (portfolioFilterContainer) portfolioFilterContainer.classList.remove('hidden');

    try {
        const res = await fetch(`${API_ROOT}/portfolios/?owner=${customerId}&page=${page}`);
        console.log("Load portfolios response status:", res.status);
        if (!res.ok) throw new Error(`HTTP error fetching portfolios! Status: ${res.status}`);

        const data = await res.json();
        state.setCurrentPortfolios(data.results || []); // Update state
        console.log(`Portfolios loaded for customer ${customerId}:`, state.currentPortfolios.length, "Total:", data.count);

        if (portfolioFilterSelect) {
            portfolioFilterSelect.innerHTML = ''; // Clear loading message

            if (data.count === 0) {
                portfolioFilterSelect.innerHTML = '<option value="">No portfolios found</option>';
                const selectedCustomer = state.customers.find(c => c.id == customerId);
                const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || customerId}`;
                if (portfolioNameEl) portfolioNameEl.textContent = `${customerDisplayName} - No Portfolios Found`;
                if (portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');
                if (deletePortfolioBtn) deletePortfolioBtn.disabled = true;
                // Only clear holdings if no portfolios found
                ui.clearHoldingsUI(); // Clears table, totals, charts, pagination
                return;
            }

            if (data.count > 1) {
                portfolioFilterSelect.innerHTML = '<option value="">-- Select Portfolio --</option>';
            }

            let defaultPortfolioSelected = false;
            let portfolioToSelectId = null; // Track which portfolio ID to potentially auto-select

            state.currentPortfolios.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name || `Portfolio ${p.id}`;
                option.dataset.isDefault = p.is_default || false;
                portfolioFilterSelect.appendChild(option);
                if (p.is_default) {
                    portfolioToSelectId = p.id; // Mark default for selection
                    defaultPortfolioSelected = true;
                }
            });

            // Handle multiple pages info
            if (data.next) {
                console.warn("Multiple pages of portfolios exist, but UI only shows first page.");
                // Consider adding logic to fetch all pages if needed, or adjust UI
            }

            portfolioFilterSelect.disabled = false; // Enable dropdown

            // Auto-select logic
            if (!defaultPortfolioSelected && data.count === 1) {
                portfolioToSelectId = state.currentPortfolios[0].id; // Select the single one if no default
            }

            if (portfolioToSelectId) {
                portfolioFilterSelect.value = portfolioToSelectId;
                ui.handlePortfolioSelection(); // Update UI elements (non-async)
                // Explicitly fetch data for the selected portfolio
                // *** This call now implicitly triggers chart update via filters.js ***
                await filters.applyHoldingsFiltersAndRefreshAll(1);
            } else {
                // If multiple portfolios and no default, just call the UI handler
                // (which sets the title to "Select a Portfolio" and clears data via clearHoldingsUI)
                ui.handlePortfolioSelection();
            }
        }

    } catch (error) {
        console.error("Failed to load or process portfolios:", error);
        if (portfolioFilterSelect) portfolioFilterSelect.innerHTML = '<option value="">Error loading</option>';
        if (portfolioNameEl) portfolioNameEl.textContent = "Error loading portfolios";
        if (portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');
        if (deletePortfolioBtn) deletePortfolioBtn.disabled = true;
        ui.clearTableAndCharts(); // Clear everything on major error
    }
}


/**
 * Fetches a specific page of holdings for a given portfolio ID, applying current filters and sorting.
 * Updates the state and triggers UI rendering for THAT PAGE ONLY.
 * **Does NOT trigger chart redraw.**
 */
export async function fetchHoldingsPage(portfolioId, page = 1) {
    const selectedPortfolio = state.currentPortfolios.find(p => p.id == portfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${portfolioId}`;
    console.log(`Fetching holdings page ${page} for portfolio ID: ${portfolioId} with filters/sort.`);
    if(portfolioNameEl && page === 1) { // Only show loading on title for first page load/filter/sort
        portfolioNameEl.textContent = `Loading ${portfolioDisplayName}...`;
    } else if (portfolioNameEl) {
        // Keep existing title for pagination clicks
        portfolioNameEl.textContent = portfolioDisplayName;
    }


    const colSpan = (tableHeaders?.length || 13) + 1; // Assuming 13 data cols + checkbox
    // Show loading message in table only if it's the first page load for this portfolio/filter/sort
    if (page === 1 && tableBody) {
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading holdings...</td></tr>`;
    }
    ui.renderPaginationControls(holdingsPaginationControls, null); // Clear pagination during load

    // --- Construct URL with Filters and Sorting (using current state) ---
    const backendSortKey = mapFrontendKeyToBackend(state.currentSortKey); // Map sort key
    console.log(`Mapped frontend sort key '${state.currentSortKey}' to backend key '${backendSortKey}'`); // Log the mapping result
    const sortParam = `ordering=${state.currentSortDir === 'desc' ? '-' : ''}${backendSortKey}`;

    // *** FILTER FIX: Use mapFrontendKeyToBackend and correct lookup construction ***
    const filterParams = state.activeFilters
        .filter(f => f.value !== '') // Only include filters with a value
        .map(f => {
            const backendColumn = mapFrontendKeyToBackend(f.column); // Map the column key
            // 'lookup' (e.g., 'icontains', 'exact', 'gte') should be correctly set in state by filters.js
            const lookupType = f.lookup || 'exact'; // Default to exact if lookup is missing
            // Handle '!=' operator by setting exclude=true and using the base lookup
            const excludeParam = (f.operator === '!=') ? 'exclude=true&' : '';
            return `${excludeParam}${backendColumn}__${lookupType}=${encodeURIComponent(f.value)}`;
        })
        .join('&');
    // --- End Filter Fix ---

    const baseUrl = `${API_ROOT}/holdings/?portfolio=${portfolioId}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    // --- End URL Construction ---

    const fetchUrl = `${baseUrl}&page=${page}`; // Add page parameter
    console.log("Fetching holdings page URL:", fetchUrl); // Log the final URL being fetched

    try {
        const res = await fetch(fetchUrl);
        console.log(`Load holdings response status for portfolio '${portfolioDisplayName}' page ${page}:`, res.status);

        if (!res.ok) {
            if (res.status === 404 && page > 1) {
                console.warn(`Page ${page} not found for portfolio ${portfolioId}. Fetching page 1 instead.`);
                await fetchHoldingsPage(portfolioId, 1); // Try fetching page 1 again
                return; // Exit current fetch attempt
            } else {
                 let errorData = { detail: `HTTP error! Status: ${res.status}` };
                 try { errorData = await res.json(); } catch (e) { /* ignore */ }
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }

        const data = await res.json();
        console.log(`Holdings page ${page} loaded for portfolio '${portfolioDisplayName}':`, data.results?.length, "Total:", data.count);

        // Update global state for holdings (current page view)
        state.setCurrentHoldingsData({
            results: data.results || [],
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        });

        if(portfolioNameEl) portfolioNameEl.textContent = portfolioDisplayName; // Set final title
        processAndDisplayHoldingsPage(); // Process and render THIS PAGE's table/totals (from ui.js)
        ui.renderPaginationControls(holdingsPaginationControls, state.currentHoldingsData, 'holdings'); // Render pagination for THIS PAGE

        // *** REMOVED chart rendering trigger ***
        // renderChartsWithAllData();

    } catch (error) {
        console.error("Failed to fetch or process holdings page:", error);
        if(portfolioNameEl) portfolioNameEl.textContent = `Error loading holdings for ${portfolioDisplayName}`;
        state.setCurrentHoldingsData({ results: [], count: 0, nextUrl: null, previousUrl: null, currentPage: 1 });
        ui.clearHoldingsUI(); // Use specific clear function (clears table, totals, charts, pagination)
        if(tableBody) tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading holdings. Check console.</td></tr>`;
        ui.renderPaginationControls(holdingsPaginationControls, null);
    }
}

/**
 * Fetches ALL pages of holdings for the current portfolio and filters.
 * Used specifically for exports and chart rendering that need the full dataset.
 * WARNING: Can be slow and memory-intensive for large datasets.
 */
export async function fetchAllFilteredHoldings() {
    const portfolioId = portfolioFilterSelect?.value;
    if (!portfolioId) {
        console.warn("fetchAllFilteredHoldings: No portfolio selected.");
        return []; // Return empty array if no portfolio is selected
    }

    console.log(`Fetching ALL holdings for portfolio ID: ${portfolioId} with current filters/sort.`);
    // Status message handled by calling function (e.g., export or chart render)

    let allHoldings = [];
    let currentPage = 1;
    let nextUrl = null; // Initialize nextUrl

    // --- Construct Base URL with Filters and Sorting (using current state) ---
    const backendSortKey = mapFrontendKeyToBackend(state.currentSortKey); // Map sort key
    const sortParam = `ordering=${state.currentSortDir === 'desc' ? '-' : ''}${backendSortKey}`;

    // *** FILTER FIX: Use mapFrontendKeyToBackend and correct lookup construction ***
    const filterParams = state.activeFilters
        .filter(f => f.value !== '') // Only include filters with a value
        .map(f => {
            const backendColumn = mapFrontendKeyToBackend(f.column); // Map the column key
            const lookupType = f.lookup || 'exact'; // Default to exact if lookup is missing
            const excludeParam = (f.operator === '!=') ? 'exclude=true&' : '';
            return `${excludeParam}${backendColumn}__${lookupType}=${encodeURIComponent(f.value)}`;
        })
        .join('&');
    // --- End Filter Fix ---

    // Use a larger page size for fetching all data to reduce requests
    const fetchAllPageSize = 100;
    const baseUrl = `${API_ROOT}/holdings/?portfolio=${portfolioId}&page_size=${fetchAllPageSize}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    // --- End Base URL Construction ---


    try {
        do {
            // Use nextUrl if available from previous response, otherwise construct based on currentPage
            const fetchUrl = nextUrl || `${baseUrl}&page=${currentPage}`;
            console.log(`Fetching page chunk for all holdings: ${fetchUrl}`);
            const res = await fetch(fetchUrl);

            if (!res.ok) {
                // If a page is not found mid-fetch, log it but continue (might be transient)
                if (res.status === 404) {
                    console.warn(`Page ${currentPage} not found while fetching all holdings. Stopping fetch loop.`);
                    break; // Stop fetching if a page is missing
                } else {
                    let errorData = { detail: `HTTP error! Status: ${res.status}` };
                    try { errorData = await res.json(); } catch (e) { /* ignore */ }
                    throw new Error(`Failed to fetch page ${currentPage}: ${errorData.detail || JSON.stringify(errorData)}`);
                }
            }

            const data = await res.json();
            if (data.results && data.results.length > 0) {
                allHoldings = allHoldings.concat(data.results);
            }

            nextUrl = data.next; // Get the URL for the next page from the response
            currentPage++; // Increment page counter (mainly for logging if nextUrl fails)

        } while (nextUrl); // Continue as long as the backend provides a next page URL

        console.log(`Fetched a total of ${allHoldings.length} holdings.`);
        return allHoldings;

    } catch (error) {
        console.error("Error fetching all holdings:", error);
        throw error; // Re-throw error so calling function knows it failed
    }
}


/**
 * Fetches a specific page of municipal offerings data from the API, applying filters/sorting.
 * Updates state and triggers UI rendering.
 */
export async function loadMuniOfferings(page = 1) {
    console.log(`Attempting to load municipal offerings (page ${page}) with filters/sort...`);
    if (!muniOfferingsTableBody) {
        console.warn("Muni offerings table body not found. Skipping load.");
        return;
    }

    const colSpan = (muniTableHeaders?.length || 14);
    // Show loading message only if table is currently empty or showing a non-data message
    if (!muniOfferingsTableBody.querySelector('tr[data-offering-id]')) {
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading offerings (Page ${page})...</td></tr>`;
    }
    ui.renderPaginationControls(muniPaginationControls, null); // Clear pagination during load

    // --- Construct URL with Filters and Sorting (using current state) ---
    // NOTE: Muni filters use direct keys, no mapping needed based on current code
    const sortParam = `ordering=${state.currentMuniSortDir === 'desc' ? '-' : ''}${state.currentMuniSortKey}`;
    const filterParams = state.activeMuniFilters
        .filter(f => f.value !== '')
        .map(f => {
            const lookupType = f.lookup || 'exact'; // Default to exact if lookup is missing
            const excludeParam = (f.operator === '!=') ? 'exclude=true&' : '';
            // Assuming muni backend fields match frontend keys directly
            return `${excludeParam}${f.column}__${lookupType}=${encodeURIComponent(f.value)}`;
        })
        .join('&');
    // --- End Filter Construction ---

    const fetchUrl = `${API_ROOT}/muni-offerings/?page=${page}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    console.log("Fetching Muni Offerings URL:", fetchUrl);

    try {
        const response = await fetch(fetchUrl);
        console.log("Load muni offerings response status:", response.status);
        if (!response.ok) {
            if (response.status === 404 && page > 1) {
                console.warn(`Page ${page} not found for muni offerings. Fetching page 1 instead.`);
                await loadMuniOfferings(1);
                return;
            } else {
                 let errorData = { detail: `HTTP error! Status: ${response.status}` };
                 try { errorData = await response.json(); } catch (e) { /* ignore */ }
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }

        const data = await response.json();
        console.log(`Muni offerings page ${page} loaded:`, data.results?.length, "Total:", data.count);

        // Update global state for muni offerings
        state.setCurrentMuniOfferingsData({
            results: data.results || [],
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        });

        processAndDisplayMuniOfferings(); // Process and render (from ui.js)
        ui.renderPaginationControls(muniPaginationControls, state.currentMuniOfferingsData, 'munis');
        ui.updateMuniSortIndicators();

    } catch (error) {
        console.error("Failed to load municipal offerings:", error);
        if(muniOfferingsTableBody) muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading offerings. Check console.</td></tr>`;
        state.setCurrentMuniOfferingsData({ results: [], count: 0, nextUrl: null, previousUrl: null, currentPage: 1 });
        ui.renderPaginationControls(muniPaginationControls, null);
    }
}


/** Fetches the full customer list for the admin modal dropdown, handling pagination. */
export async function fetchCustomersForAdminModal(page = 1, accumulatedCustomers = []) {
    if (!IS_ADMIN) return;

    if (page === 1) {
        console.log("Fetching customers for admin modal...");
        if(adminCustomerSelect) {
            adminCustomerSelect.innerHTML = '<option value="">Loading customers...</option>';
            adminCustomerSelect.disabled = true;
        }
    }

    try {
        // Use a larger page size for efficiency if the backend supports it
        const adminPageSize = 100;
        const response = await fetch(`${API_ROOT}/customers/?page_size=${adminPageSize}&page=${page}`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const data = await response.json();
        const fetchedCustomers = data.results || [];
        accumulatedCustomers = accumulatedCustomers.concat(fetchedCustomers);

        if (data.next) {
            // Extract next page number more robustly
            let nextPageNum = null;
            try {
                const url = new URL(data.next); // Assumes backend returns full URL or relative that browser can resolve
                nextPageNum = parseInt(url.searchParams.get('page'), 10);
            } catch (e) { console.error("Error parsing next page URL for admin customers:", data.next, e); }

            if (nextPageNum && !isNaN(nextPageNum)) {
                await fetchCustomersForAdminModal(nextPageNum, accumulatedCustomers); // Recursive call
            } else {
                 console.warn("Could not determine next page number from URL:", data.next, "- displaying accumulated customers.");
                 ui.populateAdminCustomerDropdown(accumulatedCustomers); // Populate with what we have
            }
        } else {
            console.log("Finished fetching all customers for admin modal:", accumulatedCustomers.length);
            ui.populateAdminCustomerDropdown(accumulatedCustomers); // Populate dropdown
        }
    } catch (error) {
        console.error("Failed to fetch customers for admin modal:", error);
        if(adminCustomerSelect) {
            adminCustomerSelect.innerHTML = '<option value="">Error loading customers</option>';
            adminCustomerSelect.disabled = false;
        }
        if(modalErrorMessage) {
            modalErrorMessage.textContent = 'Error loading customer list for modal.';
            modalErrorMessage.style.display = 'block';
        }
    }
}

/** Handles the create portfolio form submission. */
export async function handleCreatePortfolioSubmit(event) {
    event.preventDefault();
    console.log("Handling create portfolio submit...");

    if(modalErrorMessage) {
        modalErrorMessage.textContent = '';
        modalErrorMessage.style.display = 'none';
    }

    const newPortfolioNameInput = document.getElementById('new-portfolio-name');
    const portfolioName = newPortfolioNameInput ? newPortfolioNameInput.value.trim() : '';
    if (!portfolioName) {
        if(modalErrorMessage) {
            modalErrorMessage.textContent = 'Portfolio name is required.';
            modalErrorMessage.style.display = 'block';
        }
        return;
    }

    const payload = { name: portfolioName };
    let ownerIdForPayload = null;
    const isCustomerSelectionVisible = adminCustomerSelectGroup && !adminCustomerSelectGroup.classList.contains('hidden');

    if (isCustomerSelectionVisible) {
        ownerIdForPayload = adminCustomerSelect ? adminCustomerSelect.value : null;
        if (!ownerIdForPayload) {
            if(modalErrorMessage) {
                modalErrorMessage.textContent = 'Please select a customer.';
                modalErrorMessage.style.display = 'block';
            }
            return;
        }
        payload.owner_id_input = parseInt(ownerIdForPayload, 10);
        console.log("Admin selected owner_id_input:", payload.owner_id_input);
        if (isNaN(payload.owner_id_input)) {
             if(modalErrorMessage) {
                 modalErrorMessage.textContent = 'Invalid customer ID selected.';
                 modalErrorMessage.style.display = 'block';
             }
             return;
        }
    } else {
        console.log("Non-admin creating portfolio. Backend will assign owner.");
        // Use the currently selected customer ID if available (for refreshing later)
        ownerIdForPayload = state.selectedCustomerId;
    }

    console.log("Final create portfolio payload:", JSON.stringify(payload));

    try {
        const response = await fetch(`${API_ROOT}/portfolios/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN,
            },
            body: JSON.stringify(payload),
        });

        console.log("Create portfolio response status:", response.status);
        const responseData = await response.json().catch(() => ({ detail: response.statusText }));

        if (!response.ok) {
            console.error("API Error Data:", responseData);
            let errorMsg = `Error ${response.status}: ${responseData.detail || JSON.stringify(responseData)}`;
            if (typeof responseData === 'object' && responseData !== null) {
                errorMsg = Object.entries(responseData)
                                 .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`)
                                 .join('; ');
            }
            throw new Error(errorMsg);
        }

        const newPortfolio = responseData;
        console.log('Successfully created portfolio:', newPortfolio);
        ui.hideCreatePortfolioModal(); // Use ui.js function
        alert(`Portfolio "${newPortfolio.name}" created successfully!`);

        // Determine which customer's portfolios to refresh
        const customerIdToRefresh = payload.owner_id_input || ownerIdForPayload || state.selectedCustomerId;

        if (customerIdToRefresh) {
            // Check if the refresh is for the currently selected customer
            const isCurrentCustomer = customerIdToRefresh == state.selectedCustomerId;

            if (isCurrentCustomer) {
                // Reload portfolios for the *current* customer
                await loadPortfolios(customerIdToRefresh, 1);

                // Check if portfolioFilterSelect exists before accessing options
                if (portfolioFilterSelect && Array.from(portfolioFilterSelect.options).some(opt => opt.value == newPortfolio.id)) {
                    portfolioFilterSelect.value = newPortfolio.id;
                    // Manually trigger the portfolio selection logic, including fetch
                    ui.handlePortfolioSelection(); // Update UI
                    // *** This call now implicitly triggers chart update via filters.js ***
                    await filters.applyHoldingsFiltersAndRefreshAll(1);
                } else {
                     console.warn("Newly created portfolio not found in dropdown immediately after refresh for current customer.");
                     // Fallback: select the first available portfolio if any
                     if (portfolioFilterSelect && portfolioFilterSelect.options.length > 0 && portfolioFilterSelect.options[0].value) {
                         portfolioFilterSelect.value = portfolioFilterSelect.options[0].value;
                         ui.handlePortfolioSelection();
                         await filters.applyHoldingsFiltersAndRefreshAll(1);
                     } else {
                         // No portfolios left or dropdown issue
                         if(portfolioNameEl) portfolioNameEl.textContent = "Select a Portfolio";
                         ui.clearHoldingsUI();
                     }
                }
            } else {
                 console.log(`Portfolio created for customer ${customerIdToRefresh}, but not the currently selected one (${state.selectedCustomerId}). No UI refresh needed.`);
            }
        } else {
            console.warn("No customer ID determined after portfolio creation. Reloading main customer list.");
            await loadCustomers(); // Fallback: reload the main customer list
        }

    } catch (error) {
        console.error('Failed to create portfolio:', error);
        if(modalErrorMessage) {
            modalErrorMessage.textContent = `Creation failed: ${error.message}`;
            modalErrorMessage.style.display = 'block';
        }
    }
 }

/** Handles the delete portfolio button click. */
export async function handleDeletePortfolio() {
    if (!portfolioFilterSelect) return; // Ensure select exists

    const portfolioIdToDelete = portfolioFilterSelect.value;
    const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    const portfolioNameToDelete = selectedOption ? selectedOption.textContent : `Portfolio ID ${portfolioIdToDelete}`;

    if (!portfolioIdToDelete || selectedOption?.dataset?.isDefault === 'true') {
        alert("Please select a non-default portfolio to delete.");
        return;
    }

    if (!confirm(`Are you sure you want to delete portfolio "${portfolioNameToDelete}"? This action cannot be undone.`)) {
        return;
    }

    console.log(`Attempting to delete portfolio ID: ${portfolioIdToDelete}`);
    try {
        const response = await fetch(`${API_ROOT}/portfolios/${portfolioIdToDelete}/`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': CSRF_TOKEN,
                'Accept': 'application/json',
            }
        });

        console.log(`Delete portfolio response status: ${response.status}`);

        if (response.status === 204) {
            alert(`Portfolio "${portfolioNameToDelete}" deleted successfully.`);
            // Reload portfolios for the currently selected customer
            if (state.selectedCustomerId) {
                 await loadPortfolios(state.selectedCustomerId, 1);
                 // After reloading, the dropdown might reset. handlePortfolioSelection()
                 // will be called implicitly if a default/single portfolio exists,
                 // or the user will need to re-select. clearHoldingsUI() was called by loadPortfolios.
            }
        } else {
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

/** Handles the "Sell Bonds" button click, sending data to the backend. */
export async function handleEmailInterestClick() {
    if (!state.selectedCustomerId) {
        ui.showStatusMessageGeneric(emailStatusMessage, "Error: No customer selected.", true);
        return;
    }
    if (state.selectedHoldingIds.size === 0) {
        ui.showStatusMessageGeneric(emailStatusMessage, "Error: No bonds selected.", true);
        return;
    }

    if(emailInterestBtn) emailInterestBtn.disabled = true;
    ui.showStatusMessageGeneric(emailStatusMessage, "Sending email...", false, 0);

    // Fetch details for selected bonds (potentially from full dataset if needed, but current page might suffice)
    // For now, assume current page data is sufficient for CUSIP/Par
    const selectedBondsPayload = [];
    state.currentHoldingsData.results.forEach(holding => {
        if (state.selectedHoldingIds.has(holding.ticket_id)) {
            selectedBondsPayload.push({
                cusip: holding.security_cusip || 'N/A',
                par: (holding.par_value_num ?? 0).toFixed(2)
            });
        }
    });

    // If some selected IDs weren't found on the current page, we might need fetchAllFilteredHoldings
    if (selectedBondsPayload.length !== state.selectedHoldingIds.size) {
        console.warn("Some selected bond details not found on current page. Email might be incomplete.");
        // TODO: Optionally implement fetching all data here if accuracy is critical
    }

    if (selectedBondsPayload.length === 0) {
         ui.showStatusMessageGeneric(emailStatusMessage, "Error: Could not find details for selected bonds.", true);
         if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0; // Re-enable based on selection state
         return;
    }

    const payload = {
        customer_id: parseInt(state.selectedCustomerId, 10),
        selected_bonds: selectedBondsPayload
    };

    console.log("Sending email interest payload:", payload);

    try {
        const response = await fetch(`${API_ROOT}/email-salesperson-interest/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN,
            },
            body: JSON.stringify(payload),
        });

        const responseData = await response.json().catch(() => ({}));

        if (response.ok) {
            console.log("Email sent successfully:", responseData);
            ui.showStatusMessageGeneric(emailStatusMessage, responseData.message || "Email sent successfully!", false);
            ui.clearHoldingSelection(); // Use ui.js function
        } else {
            console.error("API Error sending email:", response.status, responseData);
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            ui.showStatusMessageGeneric(emailStatusMessage, `Error: ${errorDetail}`, true);
            if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0; // Re-enable based on selection state
        }
    } catch (error) {
        console.error("Network/Fetch Error sending email:", error);
        ui.showStatusMessageGeneric(emailStatusMessage, "Network error. Please try again.", true);
        if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0; // Re-enable based on selection state
    }
}

/** Handles the "Indicate Interest in Buying" button click. */
export async function handleEmailBuyInterestClick() {
    if (!state.selectedCustomerId) {
        ui.showStatusMessageGeneric(emailBuyStatusMessage, "Error: No customer selected.", true);
        return;
    }
    if (state.selectedMuniOfferingIds.size === 0) {
        ui.showStatusMessageGeneric(emailBuyStatusMessage, "Error: No offerings selected.", true);
        return;
    }

    if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = true;
    ui.showStatusMessageGeneric(emailBuyStatusMessage, "Sending email...", false, 0);

    // Fetch details for selected offerings from the current page data
    const selectedOfferingsPayload = [];
    state.currentMuniOfferingsData.results.forEach(offering => {
        if (state.selectedMuniOfferingIds.has(offering.id)) {
            selectedOfferingsPayload.push({
                cusip: offering.cusip || 'N/A',
                description: offering.description || 'N/A'
            });
        }
    });

    // If some selected IDs weren't found on the current page, we might need fetchAllFilteredOfferings (if implemented)
    if (selectedOfferingsPayload.length !== state.selectedMuniOfferingIds.size) {
        console.warn("Some selected offering details not found on current page. Email might be incomplete.");
        // TODO: Optionally implement fetching all muni data if accuracy is critical
    }

    if (selectedOfferingsPayload.length === 0) {
         ui.showStatusMessageGeneric(emailBuyStatusMessage, "Error: Could not find details for selected offerings.", true);
         if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0; // Re-enable
         return;
    }

    const payload = {
        customer_id: parseInt(state.selectedCustomerId, 10),
        selected_offerings: selectedOfferingsPayload
    };

    console.log("Sending email buy interest payload:", payload);
    const buyInterestApiUrl = `${API_ROOT}/email-buy-muni-interest/`;

    try {
        const response = await fetch(buyInterestApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN,
            },
            body: JSON.stringify(payload),
        });

        const responseData = await response.json().catch(() => ({}));

        if (response.ok) {
            console.log("Buy interest email sent successfully:", responseData);
            ui.showStatusMessageGeneric(emailBuyStatusMessage, responseData.message || "Buy interest email sent successfully!", false);
            ui.clearMuniOfferingSelection(); // Use ui.js function
        } else {
            console.error("API Error sending buy interest email:", response.status, responseData);
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            ui.showStatusMessageGeneric(emailBuyStatusMessage, `Error: ${errorDetail}`, true);
            if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0; // Re-enable
        }
    } catch (error) {
        console.error("Network/Fetch Error sending buy interest email:", error);
        ui.showStatusMessageGeneric(emailBuyStatusMessage, "Network error. Please try again.", true);
        if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0; // Re-enable
    }
}
