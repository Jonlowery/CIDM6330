// api.js
// Handles all communication with the backend API.
// VERSION: Added runPortfolioSwapSimulation function.
// MODIFIED: Corrected handleEmailInterestClick to fetch all selected holdings.
// MODIFIED: Corrected calls to showStatusMessageGeneric.
// MODIFIED: Corrected sort key usage in fetchHoldingsPage.
// MODIFIED: Defensively corrected query parameter construction in buildFilterParamString.

"use strict";

import { API_ROOT, CSRF_TOKEN, IS_ADMIN, PAGE_SIZE } from './config.js';
import * as state from './state.js';
import * as ui from './ui.js'; // For updating UI during/after API calls
import * as filters from './filters.js'; // To get filter state and trigger fetches
import { parseFloatSafe, showStatusMessageGeneric } from './utils.js';

// --- DOM Element References ---
const customerSelect = document.getElementById('customer-select');
const portfolioFilterContainer = document.getElementById('portfolio-filter-container');
const portfolioFilterSelect = document.getElementById('portfolio-filter-select');
const portfolioNameEl = document.getElementById('portfolio-name');
const deletePortfolioBtn = document.getElementById('delete-portfolio-btn');
const tableBody = document.querySelector('#holdings-table tbody');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]');
const holdingsPaginationControls = document.getElementById('holdings-pagination-controls');
const muniOfferingsTableBody = document.querySelector('#muni-offerings-table tbody');
const muniTableHeaders = document.querySelectorAll('#muni-offerings-table th[data-key]');
const muniPaginationControls = document.getElementById('muni-pagination-controls');
const createPortfolioModal = document.getElementById('create-portfolio-modal');
const adminCustomerSelectGroup = document.getElementById('admin-customer-select-group');
const adminCustomerSelect = document.getElementById('admin-customer-select');
const modalErrorMessageCreatePortfolio = document.getElementById('modal-error-message-create-portfolio');
const emailInterestBtn = document.getElementById('email-interest-btn');
const emailStatusMessage = document.getElementById('email-status-message');
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const emailBuyStatusMessage = document.getElementById('email-buy-status-message');
const createPortfolioSubmitButton = document.querySelector('#create-portfolio-form button[type="submit"]');
const newPortfolioNameInput = document.getElementById('new-portfolio-name');


// --- Helper Function for Backend Field Mapping (Primarily for ORDERING) ---
export function mapFrontendKeyToBackend(frontendKey) {
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
        case 'par_value': return 'calculated_par_value';
        default:
            return frontendKey;
    }
}

/**
 * Constructs the filter query parameter string based on the active filters state.
 * Parameter names match the filter names in the backend FilterSet.
 * @param {Array} activeFilterArray - The array of active filter objects (e.g., state.activeFilters).
 * @returns {string} The filter query parameter string (e.g., "security_description=ABC&book_price_min=99").
 */
function buildFilterParamString(activeFilterArray) {
    console.log('[buildFilterParamString] INPUT activeFilterArray:', JSON.stringify(activeFilterArray));

    const params = activeFilterArray
        .filter(f => f.value !== '' && f.value !== null)
        .map(f => {
            console.log('[buildFilterParamString] Processing filter object (f):', JSON.stringify(f));

            let columnFromFilterState = f.column; // This is what the state holds (e.g., "security_description")
            let paramNameForKey; // This will be the actual key used in the query string
            const operator = f.operator;
            const paramValue = encodeURIComponent(f.value);
            let finalParamString = null; // Used for complex params like exact date match
            let useExclude = false; // For '!=' operator

            if (!columnFromFilterState) {
                console.warn(`[buildFilterParamString] Skipping filter due to missing column name in filter state:`, f);
                return null;
            }

            // --- 1. Handle Negation ('!=') ---
            if (operator === '!=') {
                useExclude = true;
                // The paramNameForKey will be determined below, then `exclude=true&` will be prepended.
            }

            // --- 2. Determine Parameter Name (paramNameForKey) based on type/operator ---

            // For CUSIP exact match, the backend filter is specifically 'security_cusip_exact'
            if (columnFromFilterState === 'security_cusip' && operator === '=') {
                paramNameForKey = 'security_cusip_exact';
            }
            // For CUSIP 'contains' or other direct CUSIP operations, paramNameForKey will be 'security_cusip'
            else if (columnFromFilterState === 'security_cusip') {
                paramNameForKey = 'security_cusip';
            }
            // For Date and Number range filters, append _after, _before, _min, _max
            else if (f.type === 'date') {
                paramNameForKey = columnFromFilterState; // Base name, e.g., "settlement_date"
                if (operator === '=') {
                    finalParamString = `${paramNameForKey}_after=${paramValue}&${paramNameForKey}_before=${paramValue}`;
                } else if (['>', '>='].includes(operator)) {
                    paramNameForKey = `${paramNameForKey}_after`;
                } else if (['<', '<='].includes(operator)) {
                    paramNameForKey = `${paramNameForKey}_before`;
                }
                // If not a range operator for date, paramNameForKey remains columnFromFilterState
            }
            else if (f.type === 'number') {
                paramNameForKey = columnFromFilterState; // Base name, e.g., "book_price_range" or "coupon"
                if (['>', '>='].includes(operator)) {
                    paramNameForKey = `${paramNameForKey}_min`;
                } else if (['<', '<='].includes(operator)) {
                    paramNameForKey = `${paramNameForKey}_max`;
                }
                // If operator is '=', paramNameForKey remains columnFromFilterState (e.g. coupon=3.5)
                // The backend FilterSet needs a NumberFilter for 'coupon' in this case.
            }
            // For general string filters (like description, intention_code)
            // The parameter name should be the base name defined in the FilterSet.
            // Example: If f.column is "security_description", paramNameForKey should be "security_description".
            // The backend FilterSet's `lookup_expr` (e.g., 'icontains') handles the type of match.
            // This also acts as a fallback if no specific type handling above changed paramNameForKey.
            else {
                 // Default: paramNameForKey is the column name from the filter state.
                 // This assumes f.column is ALREADY the correct base name (e.g., "security_description").
                 // If f.column could be "dirty" (e.g., "security_description__icontains"),
                 // and the backend expects "security_description", this is where a strip would happen.
                 // The log shows backend received "security_description__icontains",
                 // but FilterSet expects "security_description".
                 // This means paramNameForKey became "security_description__icontains".
                 // If f.column was "security_description", this function didn't add "__icontains".
                 // If f.column was "security_description__icontains", this function would use it as is.

                 // DEFENSIVE FIX: Ensure for string types, we use the base name if f.column might be "dirty".
                 if (f.type === 'string') {
                    paramNameForKey = columnFromFilterState.split('__')[0];
                 } else {
                    paramNameForKey = columnFromFilterState;
                 }
            }

            // --- 3. Construct final parameter string ---
            if (finalParamString === null) { // If not already set by date exact match
                 finalParamString = `${paramNameForKey}=${paramValue}`;
            }

            // --- 4. Prepend exclude if needed ---
            if (useExclude) {
                // This assumes the backend FilterSet handles `exclude=true` in conjunction with the `paramNameForKey`.
                console.warn(`[buildFilterParamString] Using 'exclude=true' for operator '!=' on param '${paramNameForKey}'. Backend must support this or have specific negated filters.`);
                finalParamString = `exclude=true&${finalParamString}`;
            }
            console.log(`[buildFilterParamString] For f.column "${f.column}", operator "${operator}", type "${f.type}" => finalParamString: ${finalParamString}`);
            return finalParamString;
        })
        .filter(p => p !== null && p !== undefined);

    const filterString = params.join('&');
    console.log("[buildFilterParamString] FINAL Constructed Filter String:", filterString);
    return filterString;
}


/** Fetches the list of customers accessible to the current user. */
export async function loadCustomers(page = 1) {
    if (customerSelect) {
        customerSelect.innerHTML = '<option value="">Loading customers...</option>';
        customerSelect.disabled = true;
    }
    if (portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');

    try {
        const res = await fetch(`${API_ROOT}/customers/?page=${page}`);
        if (!res.ok) throw new Error(`HTTP error loading customers! Status: ${res.status}`);
        const data = await res.json();
        state.setCustomers(data.results || []);

        if (customerSelect) {
            customerSelect.innerHTML = '';
            if (data.count === 0) {
                customerSelect.innerHTML = '<option value="">No customers found</option>';
                if (portfolioNameEl) portfolioNameEl.textContent = "No customers available for this user.";
                ui.clearTableAndCharts();
                return;
            }
            if (data.count > 1 || IS_ADMIN) {
                 customerSelect.innerHTML = '<option value="">-- Select Customer --</option>';
            }
            state.customers.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = `${c.name || 'Unnamed'} (${c.customer_number || 'No Number'})`;
                customerSelect.appendChild(option);
            });
            customerSelect.disabled = false;
            if (data.count === 1 && !IS_ADMIN) {
                customerSelect.value = state.customers[0].id;
                await ui.handleCustomerSelection();
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
    if (portfolioFilterSelect) {
        portfolioFilterSelect.innerHTML = '<option value="">Loading portfolios...</option>';
        portfolioFilterSelect.disabled = true;
    }
    if (portfolioFilterContainer) portfolioFilterContainer.classList.remove('hidden');

    try {
        const res = await fetch(`${API_ROOT}/portfolios/?owner=${customerId}&page=${page}`);
        if (!res.ok) throw new Error(`HTTP error fetching portfolios! Status: ${res.status}`);
        const data = await res.json();
        state.setCurrentPortfolios(data.results || []);

        if (portfolioFilterSelect) {
            portfolioFilterSelect.innerHTML = '';
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
            portfolioFilterSelect.disabled = false;
            if (!defaultPortfolioSelected && data.count === 1) {
                portfolioToSelectId = state.currentPortfolios[0].id;
            }
            if (portfolioToSelectId) {
                portfolioFilterSelect.value = portfolioToSelectId;
                ui.handlePortfolioSelection();
                await filters.applyHoldingsFiltersAndRefreshAll(1);
            } else {
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
 */
export async function fetchHoldingsPage(portfolioId, page = 1) {
    const selectedPortfolio = state.currentPortfolios.find(p => p.id == portfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${portfolioId}`;
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

    const sortParam = `ordering=${state.currentSortDir === 'desc' ? '-' : ''}${state.currentSortKey}`;
    const filterParams = buildFilterParamString(state.activeFilters);

    const baseUrl = `${API_ROOT}/holdings/?portfolio=${portfolioId}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    const fetchUrl = `${baseUrl}&page=${page}`;
    console.log(`[fetchHoldingsPage] Fetching URL: ${fetchUrl}`);

    try {
        const res = await fetch(fetchUrl);
        if (!res.ok) {
            if (res.status === 404 && page > 1) {
                await fetchHoldingsPage(portfolioId, 1);
                return;
            } else {
                 let errorData = { detail: `HTTP error! Status: ${res.status}` };
                 try { errorData = await res.json(); } catch (e) { /* ignore */ }
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }
        const data = await res.json();
        state.setCurrentHoldingsData({
            results: data.results || [],
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        });
        if(portfolioNameEl) portfolioNameEl.textContent = portfolioDisplayName;
        ui.processAndDisplayHoldingsPage();
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
 */
export async function fetchAllFilteredHoldings(sourcePortfolioId = null) {
    const portfolioId = sourcePortfolioId || portfolioFilterSelect?.value;
    if (!portfolioId) {
        return [];
    }
    let allHoldings = [];
    let currentPage = 1;
    let nextUrl = null;

    const sortParam = `ordering=${state.currentSortDir === 'desc' ? '-' : ''}${state.currentSortKey}`;
    const filterParams = buildFilterParamString(state.activeFilters);

    const fetchAllPageSize = 100;
    const baseUrl = `${API_ROOT}/holdings/?portfolio=${portfolioId}&page_size=${fetchAllPageSize}&${sortParam}${filterParams ? '&' + filterParams : ''}`;

    try {
        do {
            const fetchUrl = nextUrl || `${baseUrl}&page=${currentPage}`;
            const res = await fetch(fetchUrl);
            if (!res.ok) {
                if (res.status === 404) break;
                let errorData = { detail: `HTTP error! Status: ${res.status}` };
                try { errorData = await res.json(); } catch (e) { /* ignore */ }
                throw new Error(`Failed to fetch page ${currentPage}: ${errorData.detail || JSON.stringify(errorData)}`);
            }
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                allHoldings = allHoldings.concat(data.results);
            }
            nextUrl = data.next;
            currentPage++;
        } while (nextUrl);
        return allHoldings;
    } catch (error) {
        console.error("Error fetching all holdings:", error);
        throw error;
    }
}

/**
 * Fetches aggregated cash flow data for a specific portfolio, applying current filters.
 */
export async function fetchPortfolioCashFlows(portfolioId) {
    if (!portfolioId) return [];
    const filterParams = buildFilterParamString(state.activeFilters);
    const baseUrl = `${API_ROOT}/portfolios/${portfolioId}/aggregated-cash-flows/`;
    const fetchUrl = `${baseUrl}${filterParams ? '?' + filterParams : ''}`;

    try {
        const response = await fetch(fetchUrl);
        if (!response.ok) {
            let errorData = { detail: `HTTP error! Status: ${response.status}` };
            try { errorData = await response.json(); } catch (e) { /* ignore */ }
            throw new Error(`Failed to fetch aggregated cash flows: ${errorData.detail || JSON.stringify(errorData)}`);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
             throw new Error("Invalid data format received for aggregated cash flows.");
        }
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
    if (!muniOfferingsTableBody) return;
    const colSpan = (muniTableHeaders?.length || 14);
    if (!muniOfferingsTableBody.querySelector('tr[data-offering-id]')) {
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading offerings (Page ${page})...</td></tr>`;
    }
    ui.renderPaginationControls(muniPaginationControls, null);

    const sortParam = `ordering=${state.currentMuniSortDir === 'desc' ? '-' : ''}${state.currentMuniSortKey}`;
    const filterParams = buildFilterParamString(state.activeMuniFilters);
    const fetchUrl = `${API_ROOT}/muni-offerings/?page=${page}&${sortParam}${filterParams ? '&' + filterParams : ''}`;
    console.log(`[loadMuniOfferings] Fetching URL: ${fetchUrl}`);

    try {
        const response = await fetch(fetchUrl);
        if (!response.ok) {
            if (response.status === 404 && page > 1) {
                await loadMuniOfferings(1);
                return;
            } else {
                 let errorData = { detail: `HTTP error! Status: ${res.status}` };
                 try { errorData = await response.json(); } catch (e) { /* ignore */ }
                 throw new Error(errorData.detail || JSON.stringify(errorData));
            }
        }
        const data = await response.json();
        state.setCurrentMuniOfferingsData({
            results: data.results || [],
            count: data.count || 0,
            nextUrl: data.next,
            previousUrl: data.previous,
            currentPage: page,
        });
        ui.processAndDisplayMuniOfferings();
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
    if (page === 1 && adminCustomerSelect) {
        adminCustomerSelect.innerHTML = '<option value="">Loading customers...</option>';
        adminCustomerSelect.disabled = true;
    }
    try {
        const adminPageSize = 100;
        const response = await fetch(`${API_ROOT}/customers/?page_size=${adminPageSize}&page=${page}`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        const fetchedCustomers = data.results || [];
        accumulatedCustomers = accumulatedCustomers.concat(fetchedCustomers);
        if (data.next) {
            let nextPageNum = null;
            try {
                const url = new URL(data.next);
                nextPageNum = parseInt(url.searchParams.get('page'), 10);
            } catch (e) { console.error("Error parsing next page URL for admin customers:", data.next, e); }
            if (nextPageNum && !isNaN(nextPageNum)) {
                await fetchCustomersForAdminModal(nextPageNum, accumulatedCustomers);
            } else {
                 ui.populateAdminCustomerDropdown(accumulatedCustomers);
            }
        } else {
            ui.populateAdminCustomerDropdown(accumulatedCustomers);
        }
    } catch (error) {
        console.error("Failed to fetch customers for admin modal:", error);
        if(adminCustomerSelect) {
            adminCustomerSelect.innerHTML = '<option value="">Error loading customers</option>';
            adminCustomerSelect.disabled = false;
        }
        if(modalErrorMessageCreatePortfolio) {
            modalErrorMessageCreatePortfolio.textContent = 'Error loading customer list for modal.';
            modalErrorMessageCreatePortfolio.style.display = 'block';
        }
    }
}

/** Handles the create portfolio form submission. */
export async function handleCreatePortfolioSubmit(event) {
    event.preventDefault();
    if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = true;
    if(modalErrorMessageCreatePortfolio) {
        modalErrorMessageCreatePortfolio.textContent = 'Processing...';
        modalErrorMessageCreatePortfolio.style.display = 'block';
        modalErrorMessageCreatePortfolio.classList.remove('error');
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
    let ownerIdForPayload = null;
    const isCustomerSelectionVisible = adminCustomerSelectGroup && !adminCustomerSelectGroup.classList.contains('hidden');
    if (isCustomerSelectionVisible) {
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
            payload.owner_id_input = parseInt(ownerIdForPayload, 10);
            if (isNaN(payload.owner_id_input)) throw new Error("Invalid ID");
        } catch (e) {
             if(modalErrorMessageCreatePortfolio) {
                 modalErrorMessageCreatePortfolio.textContent = 'Invalid customer ID selected.';
                 modalErrorMessageCreatePortfolio.classList.add('error');
             }
             if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = false;
             return;
        }
    } else {
        ownerIdForPayload = state.selectedCustomerId;
    }
    try {
        const sourcePortfolioId = portfolioFilterSelect?.value;
        if (!sourcePortfolioId) throw new Error("Please select the source portfolio to filter and save from.");
        if(modalErrorMessageCreatePortfolio) modalErrorMessageCreatePortfolio.textContent = 'Fetching filtered holdings...';
        const filteredHoldings = await fetchAllFilteredHoldings(sourcePortfolioId);
        if (filteredHoldings && filteredHoldings.length > 0) {
            payload.initial_holding_ids = filteredHoldings
                .map(h => h.external_ticket)
                .filter(id => typeof id === 'number' && Number.isInteger(id));
            if (payload.initial_holding_ids.length !== filteredHoldings.length) {
                console.warn("Some filtered holdings were missing a valid integer 'external_ticket'.");
            }
        } else {
            payload.initial_holding_ids = [];
        }
    } catch (error) {
        if(modalErrorMessageCreatePortfolio) {
            modalErrorMessageCreatePortfolio.textContent = `Error preparing holdings: ${error.message}`;
            modalErrorMessageCreatePortfolio.classList.add('error');
        }
        if (createPortfolioSubmitButton) createPortfolioSubmitButton.disabled = false;
        return;
    }
    if(modalErrorMessageCreatePortfolio) modalErrorMessageCreatePortfolio.textContent = 'Sending request...';
    try {
        const response = await fetch(`${API_ROOT}/portfolios/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
            body: JSON.stringify(payload),
        });
        const responseData = await response.json().catch(() => ({ detail: response.statusText }));
        if (!response.ok) {
            let errorMsg = `Error ${response.status}: ${responseData.detail || JSON.stringify(responseData)}`;
             if (typeof responseData === 'object' && responseData !== null && !responseData.detail) {
                 errorMsg = Object.entries(responseData)
                     .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : String(errors)}`)
                     .join('; ');
             }
            throw new Error(errorMsg);
        }
        const newPortfolio = responseData;
        ui.hideCreatePortfolioModal();
        alert(`Portfolio "${newPortfolio.name}" created successfully!`);
        const customerIdToRefresh = payload.owner_id_input || ownerIdForPayload;
        if (customerIdToRefresh) {
            const isCurrentCustomer = customerIdToRefresh == state.selectedCustomerId;
            if (isCurrentCustomer) {
                await loadPortfolios(customerIdToRefresh, 1);
                if (portfolioFilterSelect && Array.from(portfolioFilterSelect.options).some(opt => opt.value == newPortfolio.id)) {
                    portfolioFilterSelect.value = newPortfolio.id;
                    ui.handlePortfolioSelection();
                    await filters.applyHoldingsFiltersAndRefreshAll(1);
                } else {
                     if (portfolioFilterSelect && portfolioFilterSelect.options.length > 0 && portfolioFilterSelect.options[0].value) {
                         portfolioFilterSelect.value = portfolioFilterSelect.options[0].value;
                         ui.handlePortfolioSelection();
                         await filters.applyHoldingsFiltersAndRefreshAll(1);
                     } else {
                         if(portfolioNameEl) portfolioNameEl.textContent = "Select a Portfolio";
                         ui.clearHoldingsUI();
                     }
                }
            }
        } else {
            await loadCustomers();
        }
    } catch (error) {
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
    try {
        const response = await fetch(`${API_ROOT}/portfolios/${portfolioIdToDelete}/`, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': CSRF_TOKEN, 'Accept': 'application/json' }
        });
        if (response.status === 204) {
            alert(`Portfolio "${portfolioNameToDelete}" deleted successfully.`);
            if (state.selectedCustomerId) {
                 await loadPortfolios(state.selectedCustomerId, 1);
            }
        } else {
            let errorMsg = `Error ${response.status}: Failed to delete portfolio.`;
            try {
                const errorData = await response.json();
                errorMsg += ` ${errorData.detail || JSON.stringify(errorData)}`;
            } catch (e) { errorMsg += ` ${response.statusText}`; }
            throw new Error(errorMsg);
        }
    } catch (error) {
        alert(`Error deleting portfolio: ${error.message}`);
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
        const allFilteredHoldingsRaw = await fetchAllFilteredHoldings();
        if (!allFilteredHoldingsRaw || allFilteredHoldingsRaw.length === 0) {
            showStatusMessageGeneric(emailStatusMessage, "Error: Could not retrieve holding details.", true);
            if(emailInterestBtn) emailInterestBtn.disabled = false;
            return;
        }
        const allFilteredHoldingsProcessed = ui.processHoldings(allFilteredHoldingsRaw);
        const selectedBondsPayload = [];
        for (const selectedTicketId of state.selectedHoldingIds) {
            const holdingDetail = allFilteredHoldingsProcessed.find(h => h.ticket_id === selectedTicketId);
            if (holdingDetail) {
                const parValue = holdingDetail.par_value ? parseFloatSafe(holdingDetail.par_value) : (holdingDetail.par_value_num ?? 0);
                selectedBondsPayload.push({
                    cusip: holdingDetail.security_cusip || 'N/A',
                    par: parValue.toFixed(2)
                });
            } else {
                console.warn(`Details for selected holding ID ${selectedTicketId} not found in allFilteredHoldingsProcessed.`);
            }
        }
        if (selectedBondsPayload.length === 0 && state.selectedHoldingIds.size > 0) {
             showStatusMessageGeneric(emailStatusMessage, "Error: Could not find details for any of the selected bonds. They might not match current filters.", true);
             if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0;
             return;
        }
        if (selectedBondsPayload.length === 0) {
             showStatusMessageGeneric(emailStatusMessage, "Error: No bond details to send.", true);
             if(emailInterestBtn) emailInterestBtn.disabled = false;
             return;
        }
        showStatusMessageGeneric(emailStatusMessage, "Sending email...", false, 0);
        const payload = {
            customer_id: parseInt(state.selectedCustomerId, 10),
            selected_bonds: selectedBondsPayload
        };
        const response = await fetch(`${API_ROOT}/email-salesperson-interest/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
            body: JSON.stringify(payload),
        });
        const responseData = await response.json().catch(() => ({}));
        if (response.ok) {
            showStatusMessageGeneric(emailStatusMessage, responseData.message || "Email sent successfully!", false);
            ui.clearHoldingSelection();
        } else {
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            showStatusMessageGeneric(emailStatusMessage, `Error: ${errorDetail}`, true);
        }
    } catch (error) {
        showStatusMessageGeneric(emailStatusMessage, `Error preparing or sending email: ${error.message || "Network error. Please try again."}`, true);
    } finally {
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
    const selectedOfferingsPayload = [];
    state.currentMuniOfferingsData.results.forEach(offering => {
        if (state.selectedMuniOfferingIds.has(offering.id)) {
            selectedOfferingsPayload.push({
                cusip: offering.cusip || 'N/A',
                description: offering.description || 'N/A'
            });
        }
    });
    if (selectedOfferingsPayload.length !== state.selectedMuniOfferingIds.size) {
        console.warn("Some selected offering details not found on current page. Email might be incomplete.");
    }
    if (selectedOfferingsPayload.length === 0 && state.selectedMuniOfferingIds.size > 0) {
         showStatusMessageGeneric(emailBuyStatusMessage, "Error: Could not find details for selected offerings on the current page.", true);
         if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0;
         return;
    }
    if (selectedOfferingsPayload.length === 0) {
         showStatusMessageGeneric(emailBuyStatusMessage, "Error: No offering details to send.", true);
         if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = false;
         return;
    }
    showStatusMessageGeneric(emailBuyStatusMessage, "Sending email...", false, 0);
    const payload = {
        customer_id: parseInt(state.selectedCustomerId, 10),
        selected_offerings: selectedOfferingsPayload
    };
    const buyInterestApiUrl = `${API_ROOT}/email-buy-muni-interest/`;
    try {
        const response = await fetch(buyInterestApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
            body: JSON.stringify(payload),
        });
        const responseData = await response.json().catch(() => ({}));
        if (response.ok) {
            showStatusMessageGeneric(emailBuyStatusMessage, responseData.message || "Buy interest email sent successfully!", false);
            ui.clearMuniOfferingSelection();
        } else {
            const errorDetail = responseData.error || responseData.detail || response.statusText || 'Failed.';
            showStatusMessageGeneric(emailBuyStatusMessage, `Error: ${errorDetail}`, true);
        }
    } catch (error) {
        showStatusMessageGeneric(emailBuyStatusMessage, "Network error. Please try again.", true);
    } finally {
        if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0;
    }
}

/**
 * Calls the backend API to simulate a portfolio swap.
 */
export async function runPortfolioSwapSimulation(portfolioId, holdingsToRemove, offeringsToBuy) {
    if (!portfolioId) throw new Error("Portfolio ID is required to run simulation.");
    if (!CSRF_TOKEN) throw new Error("CSRF Token not found. Cannot perform simulation.");
    const apiUrl = `${API_ROOT}/portfolios/${portfolioId}/simulate_swap/`;
    const payload = {
        holdings_to_remove: holdingsToRemove,
        offerings_to_buy: offeringsToBuy,
    };
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
        const responseData = await response.json().catch(() => ({ detail: response.statusText }));
        if (!response.ok) {
            let errorMsg = `Error ${response.status}: ${responseData.detail || responseData.error || JSON.stringify(responseData)}`;
             if (typeof responseData === 'object' && responseData !== null && !responseData.detail && !responseData.error) {
                 errorMsg = Object.entries(responseData)
                     .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : String(errors)}`)
                     .join('; ');
             }
            throw new Error(`Simulation failed: ${errorMsg}`);
        }
        return responseData;
    } catch (error) {
        throw new Error(`Network error during simulation: ${error.message}`);
    }
}
