// api.js
// Handles all communication with the backend API.
// VERSION: Added runPortfolioSwapSimulation function.
// MODIFIED: Corrected handleEmailInterestClick to fetch all selected holdings.
// MODIFIED: Corrected calls to showStatusMessageGeneric.

"use strict";

import { API_ROOT, CSRF_TOKEN, IS_ADMIN, PAGE_SIZE } from './config.js';
import * as state from './state.js';
import * as ui from './ui.js'; // For updating UI during/after API calls
import * as filters from './filters.js'; // To get filter state and trigger fetches
// Renamed import for clarity (ui.js functions are used directly now)
// import { processAndDisplayHoldingsPage, processAndDisplayMuniOfferings, renderChartsWithAllData } from './ui.js';
// Import showStatusMessageGeneric directly from utils.js
import { parseFloatSafe, showStatusMessageGeneric } from './utils.js';

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
const modalErrorMessageCreatePortfolio = document.getElementById('modal-error-message-create-portfolio'); // Specific ID
const emailInterestBtn = document.getElementById('email-interest-btn');
const emailStatusMessage = document.getElementById('email-status-message');
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const emailBuyStatusMessage = document.getElementById('email-buy-status-message');
const createPortfolioSubmitButton = document.querySelector('#create-portfolio-form button[type="submit"]');


// --- Helper Function for Backend Field Mapping (Primarily for ORDERING) ---
/**
 * Maps frontend data keys to the corresponding backend field names for ordering.
 * @param {string} frontendKey - The key used in the frontend (e.g., 'security_cusip', 'wal').
 * @returns {string} The corresponding backend field name for ordering (e.g., 'security__cusip', 'holding_average_life').
 */
function mapFrontendKeyToBackend(frontendKey) {
    // This mapping aligns frontend keys with backend model field paths for ordering.
    switch (frontendKey) {
        case 'intention_code': return 'intention_code';
        case 'settlement_date': return 'settlement_date';
        case 'book_price': return 'book_price';
        case 'market_price': return 'market_price';
        case 'book_yield': return 'book_yield';
        case 'market_yield': return 'market_yield';
        case 'holding_duration': return 'holding_duration';
        case 'wal': return 'holding_average_life';
        case 'security_cusip': return 'security__cusip';
        case 'security_description': return 'security__description';
        case 'coupon': return 'security__coupon';
        case 'maturity_date': return 'security__maturity_date';
        case 'call_date': return 'security__call_date';
        case 'security_type_name': return 'security__security_type__name';
        case 'security_tax_code': return 'security__tax_code';
        case 'security_allows_paydown': return 'security__allows_paydown';
        case 'security_sector': return 'security__sector';
        case 'security_state_of_issuer': return 'security__state_of_issuer';
        case 'security_wal': return 'security__wal';
        case 'security_cpr': return 'security__cpr';
        case 'par_value': return 'calculated_par_value'; // Use annotated field for sorting Par
        default:
            // Assume direct mapping for fields not explicitly listed (like par_value, external_ticket)
            // if (!frontendKey.includes('__')) { // Avoid warning for already nested keys
            //     console.warn(`[mapFrontendKeyToBackend] Unhandled frontend key for ordering: ${frontendKey}. Using directly.`);
            // }
            return frontendKey;
    }
}

/**
 * Constructs the filter query parameter string based on the active filters state.
 * Parameter names match the filter names in the backend FilterSet.
 * @param {Array} activeFilterArray - The array of active filter objects (e.g., state.activeFilters).
 * @returns {string} The filter query parameter string (e.g., "security__cusip__icontains=123&book_price_range_min=99").
 */
function buildFilterParamString(activeFilterArray) {
    // console.log("[buildFilterParamString] Building filter string with activeFilters:", JSON.stringify(activeFilterArray));

    const params = activeFilterArray
        .filter(f => f.value !== '' && f.value !== null) // Only include filters with a non-empty value
        .map(f => {
            const frontendKey = f.column; // This is the base name for the filter parameter
            let paramName = frontendKey;  // Initialize paramName with the frontendKey
             if (!paramName) {
                 console.warn(`[buildFilterParamString] Skipping filter due to missing column name:`, f);
                 return null;
            }

            const operator = f.operator;
            const paramValue = encodeURIComponent(f.value);
            let finalParamString = null;
            let useExclude = false;

            // --- 1. Handle Negation ---
            if (operator === '!=') {
                useExclude = true;
                // For CUSIP negation, use the '_exact' version if defined for exclusion
                if (frontendKey === 'security_cusip') {
                    // Check if the backend filterset uses security_cusip_exact for exclusion
                    // Assuming it does based on previous patterns:
                    paramName = 'security_cusip_exact';
                }
                // For other fields, paramName usually remains frontendKey for exclusion
                // e.g., exclude=true&intention_code=A
                // console.log(`[buildFilterParamString] Negation for ${frontendKey}. Param base for exclusion: ${paramName}`);
            }
            // --- 2. Determine Parameter Name based on type/operator ---
            else if (f.type === 'date') {
                // Backend filterset uses _after and _before for ranges
                if (operator === '=') { // Exact date match becomes a range of one day
                    finalParamString = `${paramName}_after=${paramValue}&${paramName}_before=${paramValue}`;
                } else if (['>', '>='].includes(operator)) {
                    paramName += '_after';
                } else if (['<', '<='].includes(operator)) {
                    paramName += '_before';
                }
            }
            else if (f.type === 'number') {
                 // Backend filterset uses _min and _max suffixes for ranges
                 // e.g., book_price_range_min, coupon_max, amount_min
                 let baseForRange = paramName;
                 // Specific handling for known range filters
                 if (frontendKey === 'book_price' || frontendKey === 'market_price') {
                     baseForRange += '_range'; // Matches CustomerHoldingFilterSet
                 }
                 // For other numeric fields (coupon, amount, yield_rate, etc.),
                 // the filter name is the base itself + _min/_max.
                 if (['>', '>='].includes(operator)) {
                    paramName = `${baseForRange}_min`;
                 } else if (['<', '<='].includes(operator)) {
                    paramName = `${baseForRange}_max`;
                 }
                 // If operator is '=', paramName remains frontendKey (e.g. amount=100000)
            }
            else if (frontendKey === 'security_cusip') {
                // Backend uses specific names for cusip lookups
                if (operator === '=') { paramName = 'security_cusip_exact'; }
                else if (operator === 'contains') { paramName = 'security_cusip'; } // Assumes 'security_cusip' is the icontains filter
                // '!=' handled above
            }
            else if (operator === 'contains') {
                 // For 'contains' on general text fields (e.g., description, insurance),
                 // paramName remains frontendKey. Assumes FilterSet filter name matches.
                 paramName = `${frontendKey}__icontains`; // More explicit: Use Django lookup style
            }
            else if (operator === 'startsWith') {
                 paramName = `${frontendKey}__istartswith`;
            }
            else if (operator === 'endsWith') {
                 paramName = `${frontendKey}__iendswith`;
            }
            else if (operator === '=') {
                // For exact matches on strings/choices, often use __iexact or just the key
                // Let's default to __iexact for case-insensitivity unless it's a known exact field
                if (['intention_code', 'state', 'moody_rating', 'sp_rating'].includes(frontendKey)) {
                    paramName = frontendKey; // Assume these are exact match filters
                } else {
                    paramName = `${frontendKey}__iexact`; // Default to case-insensitive exact
                }
            }
            // Add other operator mappings if needed (e.g., startsWith, endsWith)

            // --- 3. Construct final string ---
            if (finalParamString === null) {
                 finalParamString = `${paramName}=${paramValue}`;
            }

            // --- 4. Prepend exclude if needed ---
            if (useExclude) {
                finalParamString = `exclude=true&${finalParamString}`;
            }

            // console.log(`[buildFilterParamString] Filter: ${JSON.stringify(f)} => Param: ${finalParamString}`);
            return finalParamString;
        })
        .filter(p => p !== null && p !== undefined); // Filter out any nulls from skipped filters

    const filterString = params.join('&');
    // console.log("[buildFilterParamString] Final Constructed Filter String:", filterString);
    return filterString;
}


/** Fetches the list of customers accessible to the current user. */
export async function loadCustomers(page = 1) {
    console.log(`Attempting to load customers (page ${page})...`);
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

            // Always add the "Select Customer" option unless only one customer AND user is NOT admin
            if (data.count > 1 || IS_ADMIN) {
                 customerSelect.innerHTML = '<option value="">-- Select Customer --</option>';
            }

            state.customers.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = `${c.name || 'Unnamed'} (${c.customer_number || 'No Number'})`;
                customerSelect.appendChild(option);
            });

            customerSelect.disabled = false; // Enable dropdown

            // Handle initial state: If only one customer and it's NOT an admin, auto-select.
            if (data.count === 1 && !IS_ADMIN) {
                customerSelect.value = state.customers[0].id;
                await ui.handleCustomerSelection(); // Call handler manually
            } else {
                if (portfolioNameEl) portfolioNameEl.textContent = "Please select a customer";
                ui.clearHoldingsUI();
                if (portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');
                if (deletePortfolioBtn) deletePortfolioBtn.disabled = true;
            }
        }

    } catch (error) {
        console.error("Failed to load customers:", error);
        if (customerSelect) customerSelect.innerHTML = '<option value="">Error loading</option>';
        if (portfolioNameEl) portfolioNameEl.textContent = "Error loading customers";
        ui.clearTableAndCharts();
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
        // Fetch portfolios specifically for the owner
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
                ui.clearHoldingsUI();
                return;
            }

            // Always add "Select Portfolio" if more than one exists
            if (data.count > 1) {
                portfolioFilterSelect.innerHTML = '<option value="">-- Select Portfolio --</option>';
            }

            let defaultPortfolioSelected = false;
            let portfolioToSelectId = null;

            state.currentPortfolios.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name || `Portfolio ${p.id}`;
                option.dataset.isDefault = p.is_default || false;
                portfolioFilterSelect.appendChild(option);
                if (p.is_default) {
                    portfolioToSelectId = p.id;
                    defaultPortfolioSelected = true;
                }
            });

            if (data.next) console.warn("Multiple pages of portfolios exist, UI only shows first page.");

            portfolioFilterSelect.disabled = false;

            // Auto-select logic: Select default, or the single one if no default
            if (!defaultPortfolioSelected && data.count === 1) {
                portfolioToSelectId = state.currentPortfolios[0].id;
            }

            if (portfolioToSelectId) {
                portfolioFilterSelect.value = portfolioToSelectId;
                ui.handlePortfolioSelection(); // Update UI elements
                // Fetch data for the selected portfolio
                await filters.applyHoldingsFiltersAndRefreshAll(1);
            } else {
                // If multiple portfolios and no default, just call the UI handler
                ui.handlePortfolioSelection();
            }
        }

    } catch (error) {
        console.error("Failed to load or process portfolios:", error);
        if (portfolioFilterSelect) portfolioFilterSelect.innerHTML = '<option value="">Error loading</option>';
        if (portfolioNameEl) portfolioNameEl.textContent = "Error loading portfolios";
        if (portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');
        if (deletePortfolioBtn) deletePortfolioBtn.disabled = true;
        ui.clearTableAndCharts();
    }
}


/**
 * Fetches a specific page of holdings for a given portfolio ID, applying current filters and sorting.
 * Updates the state and triggers UI rendering for THAT PAGE ONLY.
 */
export async function fetchHoldingsPage(portfolioId, page = 1) {
    const selectedPortfolio = state.currentPortfolios.find(p => p.id == portfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${portfolioId}`;
    console.log(`Fetching holdings page ${page} for portfolio ID: ${portfolioId} ('${portfolioDisplayName}') with filters/sort.`);
    if(portfolioNameEl && page === 1) {
        portfolioNameEl.textContent = `Loading ${portfolioDisplayName}...`;
    } else if (portfolioNameEl) {
        portfolioNameEl.textContent = portfolioDisplayName;
    }

    const colSpan = (tableHeaders?.length || 13) + 1;
    if (page === 1 && tableBody) {
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading holdings...</td></tr>`;
    }
    ui.renderPaginationControls(holdingsPaginationControls, null);

    const backendSortKey = mapFrontendKeyToBackend(state.currentSortKey);
    const sortParam = `ordering=${state.currentSortDir === 'desc' ? '-' : ''}${backendSortKey}`;
    const filterParams = buildFilterParamString(state.activeFilters); // Use helper

    const baseUrl = `${API_ROOT}/holdings/?portfolio=${portfolioId}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    const fetchUrl = `${baseUrl}&page=${page}`;
    console.log(`[fetchHoldingsPage] Fetching URL: ${fetchUrl}`);

    try {
        const res = await fetch(fetchUrl);
        console.log(`Load holdings response status for portfolio '${portfolioDisplayName}' page ${page}:`, res.status);

        if (!res.ok) {
            if (res.status === 404 && page > 1) {
                console.warn(`Page ${page} not found for portfolio ${portfolioId}. Fetching page 1 instead.`);
                await fetchHoldingsPage(portfolioId, 1);
                return;
            } else {
                 let errorData = { detail: `HTTP error! Status: ${res.status}` };
                 try { errorData = await res.json(); } catch (e) { /* ignore */ }
                 console.error(`[fetchHoldingsPage] API Error Response:`, errorData);
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }

        const data = await res.json();
        console.log(`Holdings page ${page} loaded for portfolio '${portfolioDisplayName}':`, data.results?.length, "Total:", data.count);

        state.setCurrentHoldingsData({
            results: data.results || [],
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        });

        if(portfolioNameEl) portfolioNameEl.textContent = portfolioDisplayName;
        ui.processAndDisplayHoldingsPage(); // Use ui.js function
        ui.renderPaginationControls(holdingsPaginationControls, state.currentHoldingsData, 'holdings');

    } catch (error) {
        console.error("Failed to fetch or process holdings page:", error);
        if(portfolioNameEl) portfolioNameEl.textContent = `Error loading holdings for ${portfolioDisplayName}`;
        state.setCurrentHoldingsData({ results: [], count: 0, nextUrl: null, previousUrl: null, currentPage: 1 });
        ui.clearHoldingsUI();
        if(tableBody) tableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading holdings: ${error.message}. Check console.</td></tr>`;
        ui.renderPaginationControls(holdingsPaginationControls, null);
    }
}

/**
 * Fetches ALL pages of holdings for the current portfolio and filters.
 * Used for exports, chart rendering, and saving filtered portfolios.
 */
export async function fetchAllFilteredHoldings(sourcePortfolioId = null) {
    const portfolioId = sourcePortfolioId || portfolioFilterSelect?.value;
    if (!portfolioId) {
        console.warn("fetchAllFilteredHoldings: No portfolio ID provided or selected.");
        return [];
    }

    console.log(`Fetching ALL holdings for portfolio ID: ${portfolioId} with current filters/sort.`);
    let allHoldings = [];
    let currentPage = 1;
    let nextUrl = null;

    const backendSortKey = mapFrontendKeyToBackend(state.currentSortKey);
    const sortParam = `ordering=${state.currentSortDir === 'desc' ? '-' : ''}${backendSortKey}`;
    const filterParams = buildFilterParamString(state.activeFilters); // Use helper

    const fetchAllPageSize = 100; // Fetch in larger chunks for "all"
    const baseUrl = `${API_ROOT}/holdings/?portfolio=${portfolioId}&page_size=${fetchAllPageSize}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    console.log(`[fetchAllFilteredHoldings] Base URL: ${baseUrl}`);

    try {
        do {
            const fetchUrl = nextUrl || `${baseUrl}&page=${currentPage}`;
            console.log(`Fetching page chunk for all holdings: ${fetchUrl}`);
            const res = await fetch(fetchUrl);

            if (!res.ok) {
                if (res.status === 404) {
                    console.warn(`Page ${currentPage} not found while fetching all holdings. Stopping.`);
                    break; // Stop if a page is not found (e.g., if total count was miscalculated or data changed)
                } else {
                    let errorData = { detail: `HTTP error! Status: ${res.status}` };
                    try { errorData = await res.json(); } catch (e) { /* ignore */ }
                    console.error(`[fetchAllFilteredHoldings] API Error Response:`, errorData);
                    throw new Error(`Failed to fetch page ${currentPage}: ${errorData.detail || JSON.stringify(errorData)}`);
                }
            }

            const data = await res.json();
            if (data.results && data.results.length > 0) {
                allHoldings = allHoldings.concat(data.results);
            }
            nextUrl = data.next; // Get the URL for the next page
            currentPage++; // Increment for logging, though nextUrl is the source of truth

        } while (nextUrl); // Continue as long as there's a next page URL

        console.log(`Fetched a total of ${allHoldings.length} holdings.`);
        return allHoldings;

    } catch (error) {
        console.error("Error fetching all holdings:", error);
        throw error; // Re-throw to be handled by caller
    }
}

/**
 * Fetches aggregated cash flow data for a specific portfolio, applying current filters.
 */
export async function fetchPortfolioCashFlows(portfolioId) {
    if (!portfolioId) {
        console.warn("fetchPortfolioCashFlows: No portfolio ID provided.");
        return [];
    }

    const filterParams = buildFilterParamString(state.activeFilters); // Use helper
    const baseUrl = `${API_ROOT}/portfolios/${portfolioId}/aggregated-cash-flows/`;
    const fetchUrl = `${baseUrl}${filterParams ? '?' + filterParams : ''}`;

    console.log(`Fetching aggregated cash flows for portfolio ID: ${portfolioId} with filters: ${filterParams}`);
    console.log("[fetchPortfolioCashFlows] Full cash flow fetch URL:", fetchUrl);

    try {
        const response = await fetch(fetchUrl);
        console.log(`Aggregated cash flow response status for portfolio ${portfolioId}:`, response.status);

        if (!response.ok) {
            let errorData = { detail: `HTTP error! Status: ${response.status}` };
            try { errorData = await response.json(); } catch (e) { /* ignore */ }
            console.error(`Failed URL: ${fetchUrl}`);
            console.error(`[fetchPortfolioCashFlows] API Error Response:`, errorData);
            throw new Error(`Failed to fetch aggregated cash flows: ${errorData.detail || JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
             console.error("Aggregated cash flow response was not an array:", data);
             throw new Error("Invalid data format received for aggregated cash flows.");
        }
        console.log(`Fetched ${data.length} aggregated cash flow dates for portfolio ${portfolioId} (filtered).`);
        return data;

    } catch (error) {
        console.error(`Error fetching aggregated cash flows for portfolio ${portfolioId}:`, error);
        return [];
    }
}


/**
 * Fetches a specific page of municipal offerings data from the API, applying filters/sorting.
 */
export async function loadMuniOfferings(page = 1) {
    console.log(`Attempting to load municipal offerings (page ${page}) with filters/sort...`);
    if (!muniOfferingsTableBody) {
        console.warn("Muni offerings table body not found. Skipping load.");
        return;
    }

    const colSpan = (muniTableHeaders?.length || 14);
    if (!muniOfferingsTableBody.querySelector('tr[data-offering-id]')) { // Check if table is empty or has initial message
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading offerings (Page ${page})...</td></tr>`;
    }
    ui.renderPaginationControls(muniPaginationControls, null);

    const sortParam = `ordering=${state.currentMuniSortDir === 'desc' ? '-' : ''}${state.currentMuniSortKey}`;
    const filterParams = buildFilterParamString(state.activeMuniFilters); // Use helper

    const fetchUrl = `${API_ROOT}/muni-offerings/?page=${page}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    console.log("Fetching Muni Offerings URL:", fetchUrl);

    try {
        const response = await fetch(fetchUrl);
        console.log("Load muni offerings response status:", response.status);
        if (!response.ok) {
            if (response.status === 404 && page > 1) {
                console.warn(`Page ${page} not found for muni offerings. Fetching page 1 instead.`);
                await loadMuniOfferings(1); // Attempt to load page 1
                return;
            } else {
                 let errorData = { detail: `HTTP error! Status: ${response.status}` };
                 try { errorData = await response.json(); } catch (e) { /* ignore */ }
                 console.error(`[loadMuniOfferings] API Error Response:`, errorData);
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }

        const data = await response.json();
        console.log(`Muni offerings page ${page} loaded:`, data.results?.length, "Total:", data.count);

        state.setCurrentMuniOfferingsData({
            results: data.results || [],
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        });

        ui.processAndDisplayMuniOfferings(); // Use ui.js function
        ui.renderPaginationControls(muniPaginationControls, state.currentMuniOfferingsData, 'munis');
        ui.updateMuniSortIndicators();

    } catch (error) {
        console.error("Failed to load municipal offerings:", error);
        if(muniOfferingsTableBody) muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Error loading offerings: ${error.message}. Check console.</td></tr>`;
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
        const adminPageSize = 100; // Fetch in larger chunks for admin modal
        const response = await fetch(`${API_ROOT}/customers/?page_size=${adminPageSize}&page=${page}`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const data = await response.json();
        const fetchedCustomers = data.results || [];
        accumulatedCustomers = accumulatedCustomers.concat(fetchedCustomers);

        if (data.next) {
            // Extract page number from the 'next' URL
            let nextPageNum = null;
            try {
                const url = new URL(data.next); // data.next is a full URL
                nextPageNum = parseInt(url.searchParams.get('page'), 10);
            } catch (e) { console.error("Error parsing next page URL for admin customers:", data.next, e); }

            if (nextPageNum && !isNaN(nextPageNum)) {
                await fetchCustomersForAdminModal(nextPageNum, accumulatedCustomers); // Recursive call
            } else {
                 console.warn("Could not determine next page number from URL:", data.next, "- displaying accumulated customers.");
                 ui.populateAdminCustomerDropdown(accumulatedCustomers); // Populate with what we have
            }
        } else {
            // No more pages, all customers fetched
            console.log("Finished fetching all customers for admin modal:", accumulatedCustomers.length);
            ui.populateAdminCustomerDropdown(accumulatedCustomers);
        }
    } catch (error) {
        console.error("Failed to fetch customers for admin modal:", error);
        if(adminCustomerSelect) {
            adminCustomerSelect.innerHTML = '<option value="">Error loading customers</option>';
            adminCustomerSelect.disabled = false; // Re-enable for manual retry if desired
        }
        if(modalErrorMessageCreatePortfolio) { // Use specific ID
            modalErrorMessageCreatePortfolio.textContent = 'Error loading customer list for modal.';
            modalErrorMessageCreatePortfolio.style.display = 'block';
        }
    }
}

/** Handles the create portfolio form submission. */
export async function handleCreatePortfolioSubmit(event) {
    event.preventDefault();
    console.log("Handling create portfolio submit...");

    if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = true;
    if(modalErrorMessageCreatePortfolio) { // Use specific ID
        modalErrorMessageCreatePortfolio.textContent = 'Processing...';
        modalErrorMessageCreatePortfolio.style.display = 'block';
        modalErrorMessageCreatePortfolio.classList.remove('error'); // Clear previous error class
    }

    const portfolioName = newPortfolioNameInput ? newPortfolioNameInput.value.trim() : '';
    if (!portfolioName) {
        if(modalErrorMessageCreatePortfolio) {
            modalErrorMessageCreatePortfolio.textContent = 'Portfolio name is required.';
            modalErrorMessageCreatePortfolio.classList.add('error');
        }
        if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = false;
        return;
    }

    const payload = { name: portfolioName };
    let ownerIdForPayload = null; // This will be the customer ID whose portfolio list needs refresh
    const isCustomerSelectionVisible = adminCustomerSelectGroup && !adminCustomerSelectGroup.classList.contains('hidden');

    if (isCustomerSelectionVisible) { // Admin is creating for a specific customer
        ownerIdForPayload = adminCustomerSelect ? adminCustomerSelect.value : null;
        if (!ownerIdForPayload) {
            if(modalErrorMessageCreatePortfolio) {
                modalErrorMessageCreatePortfolio.textContent = 'Please select a customer.';
                modalErrorMessageCreatePortfolio.classList.add('error');
            }
            if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = false;
            return;
        }
        try {
            payload.owner_id_input = parseInt(ownerIdForPayload, 10); // Backend expects owner_id_input
            if (isNaN(payload.owner_id_input)) throw new Error("Invalid ID");
        } catch (e) {
             if(modalErrorMessageCreatePortfolio) {
                 modalErrorMessageCreatePortfolio.textContent = 'Invalid customer ID selected.';
                 modalErrorMessageCreatePortfolio.classList.add('error');
             }
             if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = false;
             return;
        }
        console.log("Admin selected owner_id_input:", payload.owner_id_input);
    } else { // Non-admin creating for themselves
        console.log("Non-admin creating portfolio. Backend will assign owner.");
        ownerIdForPayload = state.selectedCustomerId; // Store for potential refresh
        // For non-admins, owner_id_input is not sent; backend uses request.user
    }

    // Fetch filtered holdings to include their IDs in the new portfolio
    try {
        const sourcePortfolioId = portfolioFilterSelect?.value;
        if (!sourcePortfolioId) throw new Error("Please select the source portfolio to filter and save from.");

        if(modalErrorMessageCreatePortfolio) modalErrorMessageCreatePortfolio.textContent = 'Fetching filtered holdings...';
        console.log(`Fetching filtered holdings from source portfolio ID: ${sourcePortfolioId} to copy...`);

        const filteredHoldings = await fetchAllFilteredHoldings(sourcePortfolioId); // Use the source portfolio

        if (filteredHoldings && filteredHoldings.length > 0) {
            // The backend expects a list of 'external_ticket' (which are integers)
            payload.initial_holding_ids = filteredHoldings
                .map(h => h.external_ticket) // Assuming 'external_ticket' is the correct integer ID
                .filter(id => typeof id === 'number' && Number.isInteger(id)); // Ensure they are numbers

            if (payload.initial_holding_ids.length !== filteredHoldings.length) {
                console.warn("Some filtered holdings were missing a valid integer 'external_ticket'.");
                // This could happen if 'external_ticket' is null or not a number for some holdings.
            }
            console.log(`Adding ${payload.initial_holding_ids.length} external_ticket IDs to the payload.`);
        } else {
            console.log("No holdings matched the current filters. Creating an empty portfolio.");
            payload.initial_holding_ids = []; // Send empty array if no holdings
        }

    } catch (error) {
        console.error('Failed to fetch or process filtered holdings:', error);
        if(modalErrorMessageCreatePortfolio) {
            modalErrorMessageCreatePortfolio.textContent = `Error preparing holdings: ${error.message}`;
            modalErrorMessageCreatePortfolio.classList.add('error');
        }
        if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = false;
        return;
    }


    if(modalErrorMessageCreatePortfolio) modalErrorMessageCreatePortfolio.textContent = 'Sending request...';
    console.log("Final create portfolio payload:", JSON.stringify(payload));

    try {
        const response = await fetch(`${API_ROOT}/portfolios/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
            body: JSON.stringify(payload),
        });

        console.log("Create portfolio response status:", response.status);
        const responseData = await response.json().catch(() => ({ detail: response.statusText })); // Graceful JSON parse

        if (!response.ok) {
            console.error("Raw API Error Response Data:", responseData);
            let errorMsg = `Error ${response.status}: ${responseData.detail || JSON.stringify(responseData)}`;
            // Try to format validation errors better if they come as an object
             if (typeof responseData === 'object' && responseData !== null && !responseData.detail) {
                 errorMsg = Object.entries(responseData)
                     .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : String(errors)}`)
                     .join('; ');
             }
            throw new Error(errorMsg);
        }

        const newPortfolio = responseData;
        console.log('Successfully created portfolio:', newPortfolio);
        ui.hideCreatePortfolioModal();
        alert(`Portfolio "${newPortfolio.name}" created successfully!`); // Simple success alert

        // Determine which customer's portfolio list to refresh
        const customerIdToRefresh = payload.owner_id_input || ownerIdForPayload; // Admin choice or current user's customer ID

        if (customerIdToRefresh) {
            // If the new portfolio belongs to the currently selected customer, refresh their portfolio list
            const isCurrentCustomer = customerIdToRefresh == state.selectedCustomerId;
            if (isCurrentCustomer) {
                await loadPortfolios(customerIdToRefresh, 1); // Refresh portfolio dropdown for this customer
                // Try to auto-select the newly created portfolio
                if (portfolioFilterSelect && Array.from(portfolioFilterSelect.options).some(opt => opt.value == newPortfolio.id)) {
                    portfolioFilterSelect.value = newPortfolio.id;
                    ui.handlePortfolioSelection(); // Update UI
                    await filters.applyHoldingsFiltersAndRefreshAll(1); // Load its data
                } else {
                     console.warn("Newly created portfolio not found in dropdown after refresh. Defaulting or clearing.");
                     // Fallback: select the first available portfolio or clear if none
                     if (portfolioFilterSelect && portfolioFilterSelect.options.length > 0 && portfolioFilterSelect.options[0].value) {
                         portfolioFilterSelect.value = portfolioFilterSelect.options[0].value;
                         ui.handlePortfolioSelection();
                         await filters.applyHoldingsFiltersAndRefreshAll(1);
                     } else {
                         if(portfolioNameEl) portfolioNameEl.textContent = "Select a Portfolio";
                         ui.clearHoldingsUI();
                     }
                }
            } else {
                 // If admin created for a different customer, no UI change for current view, but log it.
                 console.log(`Portfolio created for other customer ${customerIdToRefresh}. Current view for customer ${state.selectedCustomerId} remains.`);
            }
        } else {
            // Should not happen if logic is correct, but as a fallback, reload main customer list.
            console.warn("No customer ID determined after portfolio creation. Reloading main customer list.");
            await loadCustomers(); // Fallback: reload all customers
        }

    } catch (error) {
        console.error('Failed to create portfolio:', error);
        if(modalErrorMessageCreatePortfolio) {
            modalErrorMessageCreatePortfolio.textContent = `Creation failed: ${error.message}`;
            modalErrorMessageCreatePortfolio.classList.add('error');
        }
    } finally {
        if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = false;
    }
 }

/** Handles the delete portfolio button click. */
export async function handleDeletePortfolio() {
    if (!portfolioFilterSelect) return;

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
            headers: { 'X-CSRFToken': CSRF_TOKEN, 'Accept': 'application/json' } // Ensure CSRF and Accept
        });

        console.log(`Delete portfolio response status: ${response.status}`);

        if (response.status === 204) { // Successfully deleted (No Content)
            alert(`Portfolio "${portfolioNameToDelete}" deleted successfully.`);
            // Refresh the portfolio list for the current customer
            if (state.selectedCustomerId) {
                 await loadPortfolios(state.selectedCustomerId, 1); // Reload page 1 of portfolios
            }
        } else {
            // Handle errors (e.g., 403 Forbidden, 404 Not Found, 500 Server Error)
            let errorMsg = `Error ${response.status}: Failed to delete portfolio.`;
            try {
                const errorData = await response.json(); // Try to parse JSON error response
                errorMsg += ` ${errorData.detail || JSON.stringify(errorData)}`;
            } catch (e) { errorMsg += ` ${response.statusText}`; } // Fallback to statusText
            throw new Error(errorMsg);
        }
    } catch (error) {
        console.error("Failed to delete portfolio:", error);
        alert(`Error deleting portfolio: ${error.message}`); // Show error to user
    }
 }

/** Handles the "Sell Bonds" button click, sending data to the backend. */
export async function handleEmailInterestClick() {
    if (!state.selectedCustomerId) {
        showStatusMessageGeneric(emailStatusMessage, "Error: No customer selected.", true);
        return;
    }
    if (state.selectedHoldingIds.size === 0) {
        showStatusMessageGeneric(emailStatusMessage, "Error: No bonds selected.", true);
        return;
    }

    if(emailInterestBtn) emailInterestBtn.disabled = true;
    showStatusMessageGeneric(emailStatusMessage, "Preparing email data...", false, 0);

    try {
        // *** MODIFICATION START ***
        // Fetch details for ALL selected holdings, not just those on the current page.
        // We use fetchAllFilteredHoldings which gets all holdings matching current filters.
        // Then we filter this list by state.selectedHoldingIds.
        console.log("Fetching all filtered holdings to get details for selected bonds...");
        const allFilteredHoldingsRaw = await fetchAllFilteredHoldings(); // Uses current portfolio and filters

        if (!allFilteredHoldingsRaw || allFilteredHoldingsRaw.length === 0) {
            showStatusMessageGeneric(emailStatusMessage, "Error: Could not retrieve holding details.", true);
            if(emailInterestBtn) emailInterestBtn.disabled = false; // Re-enable button
            return;
        }

        // Process these holdings to ensure consistent data structure (e.g., par_value_num)
        const allFilteredHoldingsProcessed = ui.processHoldings(allFilteredHoldingsRaw);

        const selectedBondsPayload = [];
        // Iterate over the set of selected IDs
        for (const selectedTicketId of state.selectedHoldingIds) {
            const holdingDetail = allFilteredHoldingsProcessed.find(h => h.ticket_id === selectedTicketId);
            if (holdingDetail) {
                const parValue = holdingDetail.par_value ? parseFloatSafe(holdingDetail.par_value) : (holdingDetail.par_value_num ?? 0);
                selectedBondsPayload.push({
                    cusip: holdingDetail.security_cusip || 'N/A',
                    par: parValue.toFixed(2) // Send formatted par
                });
            } else {
                console.warn(`Details for selected holding ID ${selectedTicketId} not found in allFilteredHoldingsProcessed. It might have been filtered out or an issue with data consistency.`);
                // Optionally, inform the user or skip this item
            }
        }

        if (selectedBondsPayload.length === 0 && state.selectedHoldingIds.size > 0) {
             showStatusMessageGeneric(emailStatusMessage, "Error: Could not find details for any of the selected bonds. They might not match current filters.", true);
             if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0; // Check original set size
             return;
        }
        // *** MODIFICATION END ***

        if (selectedBondsPayload.length === 0) { // Should be caught by state.selectedHoldingIds.size === 0, but double check
             showStatusMessageGeneric(emailStatusMessage, "Error: No bond details to send.", true);
             if(emailInterestBtn) emailInterestBtn.disabled = false;
             return;
        }
        
        showStatusMessageGeneric(emailStatusMessage, "Sending email...", false, 0); // Update status

        const payload = {
            customer_id: parseInt(state.selectedCustomerId, 10),
            selected_bonds: selectedBondsPayload
        };
        console.log("Sending email interest payload:", payload);

        const response = await fetch(`${API_ROOT}/email-salesperson-interest/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
            body: JSON.stringify(payload),
        });
        const responseData = await response.json().catch(() => ({})); // Graceful JSON parse

        if (response.ok) {
            console.log("Email sent successfully:", responseData);
            showStatusMessageGeneric(emailStatusMessage, responseData.message || "Email sent successfully!", false);
            ui.clearHoldingSelection(); // Clear selection after successful send
        } else {
            console.error("API Error sending email:", response.status, responseData);
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            showStatusMessageGeneric(emailStatusMessage, `Error: ${errorDetail}`, true);
        }
    } catch (error) {
        console.error("Error during email interest process:", error);
        showStatusMessageGeneric(emailStatusMessage, `Error preparing or sending email: ${error.message || "Network error. Please try again."}`, true);
    } finally {
        // Re-enable button based on whether there are still selections (e.g. if send failed but selections remain)
        if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0;
    }
}

/** Handles the "Indicate Interest in Buying" button click. */
export async function handleEmailBuyInterestClick() {
    if (!state.selectedCustomerId) {
        showStatusMessageGeneric(emailBuyStatusMessage, "Error: No customer selected.", true);
        return;
    }
    if (state.selectedMuniOfferingIds.size === 0) {
        showStatusMessageGeneric(emailBuyStatusMessage, "Error: No offerings selected.", true);
        return;
    }

    if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = true;
    showStatusMessageGeneric(emailBuyStatusMessage, "Preparing email data...", false, 0);

    // *** POTENTIAL IMPROVEMENT AREA START ***
    // Similar to handleEmailInterestClick, to ensure ALL selected muni offerings are included,
    // you would ideally fetch details for all IDs in state.selectedMuniOfferingIds.
    // This would require a function like `fetchAllFilteredMuniOfferings()` which currently
    // does not exist in this codebase.
    // The current implementation below will only find details for offerings on the CURRENTLY VISIBLE PAGE.
    // If you implement `fetchAllFilteredMuniOfferings()`, you would call it here,
    // then filter its results by `state.selectedMuniOfferingIds`.

    const selectedOfferingsPayload = [];
    // This iterates only the current page's data.
    state.currentMuniOfferingsData.results.forEach(offering => {
        if (state.selectedMuniOfferingIds.has(offering.id)) { // offering.id is the integer PK
            selectedOfferingsPayload.push({
                cusip: offering.cusip || 'N/A',
                description: offering.description || 'N/A' // Send description
            });
        }
    });

    if (selectedOfferingsPayload.length !== state.selectedMuniOfferingIds.size) {
        console.warn("Some selected offering details not found on current page. Email might be incomplete. Consider implementing fetchAllFilteredMuniOfferings().");
        // For now, we'll proceed with what we found on the current page.
        // A more robust solution would fetch all details.
    }

    if (selectedOfferingsPayload.length === 0 && state.selectedMuniOfferingIds.size > 0) {
         showStatusMessageGeneric(emailBuyStatusMessage, "Error: Could not find details for selected offerings on the current page.", true);
         if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0;
         return;
    }
    // *** POTENTIAL IMPROVEMENT AREA END ***

    if (selectedOfferingsPayload.length === 0) {
         showStatusMessageGeneric(emailBuyStatusMessage, "Error: No offering details to send.", true);
         if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = false;
         return;
    }

    showStatusMessageGeneric(emailBuyStatusMessage, "Sending email...", false, 0); // Update status

    const payload = {
        customer_id: parseInt(state.selectedCustomerId, 10),
        selected_offerings: selectedOfferingsPayload
    };
    console.log("Sending email buy interest payload:", payload);
    const buyInterestApiUrl = `${API_ROOT}/email-buy-muni-interest/`;

    try {
        const response = await fetch(buyInterestApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
            body: JSON.stringify(payload),
        });
        const responseData = await response.json().catch(() => ({})); // Graceful JSON parse

        if (response.ok) {
            console.log("Buy interest email sent successfully:", responseData);
            showStatusMessageGeneric(emailBuyStatusMessage, responseData.message || "Buy interest email sent successfully!", false);
            ui.clearMuniOfferingSelection(); // Clear selection on success
        } else {
            console.error("API Error sending buy interest email:", response.status, responseData);
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            showStatusMessageGeneric(emailBuyStatusMessage, `Error: ${errorDetail}`, true);
        }
    } catch (error) {
        console.error("Network/Fetch Error sending buy interest email:", error);
        showStatusMessageGeneric(emailBuyStatusMessage, "Network error. Please try again.", true);
    } finally {
        if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0;
    }
}

// --- NEW: Portfolio Swap Simulation API Call ---

/**
 * Calls the backend API to simulate a portfolio swap.
 * @param {string|number} portfolioId - The ID of the portfolio to simulate against.
 * @param {Array<object>} holdingsToRemove - Array of { external_ticket: number }.
 * @param {Array<object>} offeringsToBuy - Array of { offering_cusip: string, par_to_buy: string }.
 * @returns {Promise<object>} - A promise that resolves with the simulation results object from the API.
 * @throws {Error} - Throws an error if the API call fails or returns an error status.
 */
export async function runPortfolioSwapSimulation(portfolioId, holdingsToRemove, offeringsToBuy) {
    if (!portfolioId) {
        throw new Error("Portfolio ID is required to run simulation.");
    }
    if (!CSRF_TOKEN) {
        throw new Error("CSRF Token not found. Cannot perform simulation.");
    }

    const apiUrl = `${API_ROOT}/portfolios/${portfolioId}/simulate_swap/`;
    const payload = {
        holdings_to_remove: holdingsToRemove,
        offerings_to_buy: offeringsToBuy, // Changed from securities_to_add to match serializer
    };

    console.log(`Running portfolio swap simulation for Portfolio ID: ${portfolioId}`);
    console.log("Simulation Payload:", JSON.stringify(payload));

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN,
                'Accept': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        console.log(`Simulation response status for portfolio ${portfolioId}:`, response.status);
        const responseData = await response.json().catch(() => ({ detail: response.statusText })); // Graceful JSON parse

        if (!response.ok) {
            console.error("API Error during simulation:", response.status, responseData);
            // Try to extract a meaningful error message
            let errorMsg = `Error ${response.status}: ${responseData.detail || responseData.error || JSON.stringify(responseData)}`;
             if (typeof responseData === 'object' && responseData !== null && !responseData.detail && !responseData.error) {
                 errorMsg = Object.entries(responseData)
                     .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : String(errors)}`)
                     .join('; ');
             }
            throw new Error(`Simulation failed: ${errorMsg}`);
        }

        console.log("Simulation successful. Response:", responseData);
        return responseData; // Return the simulation results

    } catch (error) {
        console.error("Network or fetch error during simulation:", error);
        // Re-throw the error so the calling function can handle it (e.g., display in modal)
        throw new Error(`Network error during simulation: ${error.message}`);
    }
}
