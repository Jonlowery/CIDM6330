// ui.js
// Handles DOM manipulation and rendering UI components (tables, totals, pagination, modals, etc.),
// EXCLUDING filter UI and charts which are in their own modules.

"use strict";

import { parseDate, parseFloatSafe } from './utils.js';
import * as state from './state.js';
import * as api from './api.js'; // Needed for selection handlers that might trigger API calls indirectly
import * as charts from './charts.js'; // Needed for theme changes, clearing, and rendering
import { PAGE_SIZE, IS_ADMIN } from './config.js'; // Needed for pagination info and admin checks

// --- DOM Element References ---
const customerSelect = document.getElementById('customer-select');
const portfolioFilterSelect = document.getElementById('portfolio-filter-select');
const deletePortfolioBtn = document.getElementById('delete-portfolio-btn');
const portfolioNameEl = document.getElementById('portfolio-name');
const tableBody = document.querySelector('#holdings-table tbody');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]');
const selectAllCheckbox = document.getElementById('select-all-holdings');
const holdingsPaginationControls = document.getElementById('holdings-pagination-controls');
const muniOfferingsTableBody = document.querySelector('#muni-offerings-table tbody');
const muniTableHeaders = document.querySelectorAll('#muni-offerings-table th[data-key]');
const selectAllMunisCheckbox = document.getElementById('select-all-munis');
const muniPaginationControls = document.getElementById('muni-pagination-controls');
const createPortfolioModal = document.getElementById('create-portfolio-modal');
const createPortfolioForm = document.getElementById('create-portfolio-form');
const newPortfolioNameInput = document.getElementById('new-portfolio-name');
const adminCustomerSelectGroup = document.getElementById('admin-customer-select-group');
const adminCustomerSelect = document.getElementById('admin-customer-select');
const modalErrorMessage = document.getElementById('modal-error-message');
const emailInterestBtn = document.getElementById('email-interest-btn');
const emailStatusMessage = document.getElementById('email-status-message');
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const emailBuyStatusMessage = document.getElementById('email-buy-status-message');
const darkModeToggle = document.getElementById('dark-mode-toggle'); // Needed for applyTheme
const portfolioFilterContainer = document.getElementById('portfolio-filter-container'); // Added reference
// References for Totals Row
const totalsParEl = document.getElementById('totals-par');
const totalsYieldEl = document.getElementById('totals-yield');
const totalsWalEl = document.getElementById('totals-wal');
const totalsDurationEl = document.getElementById('totals-duration');
// References for Chart Containers (for loading state)
const chartContainers = document.querySelectorAll('.chart-container');

// --- Data Processing ---

/** Processes raw holding data for display. */
export function processHoldings(holdingsPage) {
    // console.log("Processing holdings data (raw):", JSON.stringify(holdingsPage)); // Log raw data string
    holdingsPage.forEach((h, index) => {
        // console.log(`Processing holding ${index}:`, h); // Log each raw holding

        // Basic fields
        h.par_value_num = parseFloatSafe(h.par_value);
        h.settlement_price_num = parseFloatSafe(h.settlement_price);
        h.book_price_num = parseFloatSafe(h.book_price);
        h.book_yield_num = parseFloatSafe(h.book_yield);
        h.holding_duration_num = parseFloatSafe(h.holding_duration);
        h.holding_average_life_num = parseFloatSafe(h.holding_average_life); // WAL
        h.market_price_num = parseFloatSafe(h.market_price);
        h.market_yield_num = parseFloatSafe(h.market_yield);
        h.intention_code = h.intention_code || 'N/A'; // Ensure intention code exists

        // Fields from nested security object
        h.security_cusip = h.security?.cusip || 'N/A'; // Use optional chaining and default
        h.security_description = h.security?.description || '';
        h.coupon_num = parseFloatSafe(h.security?.coupon);
        h.maturity_date_obj = parseDate(h.security?.maturity_date);
        h.call_date_obj = parseDate(h.security?.call_date);

        // Other date fields
        h.settlement_date_obj = parseDate(h.settlement_date);
        // NOTE: holding_average_life_date is often null/not useful, using holding_average_life_num (WAL) instead
        h.market_date_obj = parseDate(h.market_date);

        // ISO date strings (for export)
        h.maturity_date_str_iso = h.maturity_date_obj ? h.maturity_date_obj.toISOString().split('T')[0] : (h.security?.maturity_date || '');
        h.call_date_str_iso = h.call_date_obj ? h.call_date_obj.toISOString().split('T')[0] : (h.security?.call_date || '');
        h.settlement_date_str_iso = h.settlement_date_obj ? h.settlement_date_obj.toISOString().split('T')[0] : (h.settlement_date || '');

    });
    return holdingsPage; // Return processed data
}

/** Processes raw muni offering data for display. */
export function processMuniOfferings(offeringsPage) {
    // console.log("Processing muni offerings data:", offeringsPage); // Log raw data
    offeringsPage.forEach(offering => {
        // *** FIX: Multiply amount by 1000 ***
        const parsedAmount = parseFloatSafe(offering.amount);
        offering.amount_num = parsedAmount !== null ? parsedAmount * 1000 : null; // Multiply by 1000
        // *** End Fix ***

        offering.coupon_num = parseFloatSafe(offering.coupon);
        offering.yield_rate_num = parseFloatSafe(offering.yield_rate);
        offering.price_num = parseFloatSafe(offering.price);
        offering.call_price_num = parseFloatSafe(offering.call_price);
        offering.maturity_date_obj = parseDate(offering.maturity_date);
        offering.call_date_obj = parseDate(offering.call_date);
        // Keep original strings as fallbacks if needed, but prefer parsed objects
        offering.maturity_date_str = offering.maturity_date || 'N/A';
        offering.call_date_str = offering.call_date || 'N/A';
        // ISO date strings (for export)
        offering.maturity_date_str_iso = offering.maturity_date_obj ? offering.maturity_date_obj.toISOString().split('T')[0] : (offering.maturity_date || '');
        offering.call_date_str_iso = offering.call_date_obj ? offering.call_date_obj.toISOString().split('T')[0] : (offering.call_date || '');
        // Add defaults for potentially missing string fields
        offering.cusip = offering.cusip || 'N/A';
        offering.description = offering.description || '';
        offering.moody_rating = offering.moody_rating || 'N/A';
        offering.sp_rating = offering.sp_rating || 'N/A';
        offering.state = offering.state || 'N/A';
        offering.insurance = offering.insurance || 'N/A';

        // console.log("Processed muni offering (amount * 1000):", offering); // Debug log
    });
    return offeringsPage; // Return processed data
}

// --- UI Rendering Functions ---

/** Renders the holdings data for the current page into the HTML table body. */
export function renderTable(holdingsPage) {
    const colSpan = (tableHeaders?.length || 13) + 1; // 13 data cols + 1 checkbox

    if (!tableBody) {
        console.error("Holdings table body not found!");
        return;
    }
    tableBody.innerHTML = ''; // Clear previous content

    if (!holdingsPage || holdingsPage.length === 0) {
        const hasActiveFilters = state.activeFilters.some(f => f.value !== '');
        const noDataMessage = hasActiveFilters ? 'No holdings match filter criteria.' : (state.currentHoldingsData.count === 0 ? 'No holdings to display.' : 'No holdings on this page.');
        tableBody.innerHTML = `<tr><td colspan="${colSpan}">${noDataMessage}</td></tr>`;
        if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
        if (emailInterestBtn) { emailInterestBtn.disabled = true; }
        return;
    }

    // Map intention codes to display values
    const intentionMap = {
        'A': 'AFS', // Available for Sale
        'M': 'HTM', // Held to Maturity
        // Add other mappings if necessary
    };

    // Generate HTML for each holding row using the processed data
    holdingsPage.forEach((h, index) => {
        const row = document.createElement('tr');
        row.dataset.holdingId = h.ticket_id; // Use ticket_id (UUID)

        // Use processed properties directly - ensure they exist after processing
        const cusipDisplay = h.security_cusip ?? 'N/A'; // Use nullish coalescing for safety
        const descriptionDisplay = h.security_description ?? '';
        const couponDisplay = (h.coupon_num ?? 0).toFixed(3);
        const maturityDisplay = h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : 'N/A';
        const callDisplay = h.call_date_obj ? h.call_date_obj.toLocaleDateString() : 'N/A';

        // Other fields (using processed numbers)
        const parDisplay = (h.par_value_num ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const bookPriceDisplay = (h.book_price_num ?? 0).toFixed(6);
        const marketPriceDisplay = (h.market_price_num ?? 0).toFixed(6);
        const bookYieldDisplay = (h.book_yield_num ?? 0).toFixed(3);
        const walDisplay = (h.holding_average_life_num ?? 0).toFixed(2); // WAL
        const durationDisplay = (h.holding_duration_num ?? 0).toFixed(2);

        // *** FIX: Map intention code ***
        const intentionCodeRaw = h.intention_code?.toUpperCase() ?? 'N/A'; // Get raw code, ensure uppercase
        const intentionDisplay = intentionMap[intentionCodeRaw] || intentionCodeRaw; // Map or use raw if no match
        // *** End Fix ***

        const isChecked = state.selectedHoldingIds.has(h.ticket_id);

        // Create cells in the order defined by index.html headers
        row.innerHTML = `
            <td class="checkbox-column">
                <input type="checkbox" class="holding-checkbox" data-holding-id="${h.ticket_id}" data-cusip="${cusipDisplay}" data-par="${(h.par_value_num ?? 0).toFixed(2)}" ${isChecked ? 'checked' : ''} aria-label="Select holding ${cusipDisplay}">
            </td>
            <td style="text-align: left;">${cusipDisplay}</td>
            <td style="text-align: left;">${descriptionDisplay}</td>
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
    // console.log(`Holdings table rendering complete (${holdingsPage.length} rows).`); // Log completion

    updateSelectAllCheckboxState();
    if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0;
}

/** Updates the sort indicator arrows in the holdings table headers. */
export function updateSortIndicators() {
    if (!tableHeaders) return;
    tableHeaders.forEach(th => {
        const key = th.dataset.key;
        const arrowSpan = th.querySelector('.sort-arrow');
        if (!arrowSpan) return;

        let backendKey = key;
        // Ensure these mappings match the backend serializer/filter fields exactly
        if (key === 'wal') backendKey = 'holding_average_life';
        if (key === 'security_cusip') backendKey = 'security__cusip';
        if (key === 'security_description') backendKey = 'security__description';
        if (key === 'coupon') backendKey = 'security__coupon';
        if (key === 'maturity_date') backendKey = 'security__maturity_date';
        if (key === 'call_date') backendKey = 'security__call_date';
        // Add other mappings if necessary (e.g., book_yield -> book_yield)

        if (backendKey === state.currentSortKey) {
            th.classList.add('sorted');
            arrowSpan.textContent = state.currentSortDir === 'asc' ? ' ▲' : ' ▼';
        } else {
            th.classList.remove('sorted');
            arrowSpan.textContent = '';
        }
    });
}

/** Calculates and renders the total values for the holdings table footer (based on current page). */
export function renderTotals(holdingsPage) {
    const totalPar = holdingsPage.reduce((sum, h) => sum + (h.par_value_num ?? 0), 0);

    const weightedYieldSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + ((h.par_value_num ?? 0) * (h.book_yield_num ?? 0)), 0) : 0;
    const totalYield = totalPar > 0 ? weightedYieldSum / totalPar : 0;

    const weightedWalSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + ((h.par_value_num ?? 0) * (h.holding_average_life_num ?? 0)), 0) : 0;
    const totalWal = totalPar > 0 ? weightedWalSum / totalPar : 0;

    const weightedDurationSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + ((h.par_value_num ?? 0) * (h.holding_duration_num ?? 0)), 0) : 0;
    const totalDuration = totalPar > 0 ? weightedDurationSum / totalPar : 0;

    // Use specific element references defined at the top
    if (totalsParEl) totalsParEl.textContent = totalPar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (totalsYieldEl) totalsYieldEl.textContent = totalYield.toFixed(3);
    if (totalsWalEl) totalsWalEl.textContent = totalWal.toFixed(2);
    if (totalsDurationEl) totalsDurationEl.textContent = totalDuration.toFixed(2);
}

/** Renders the municipal offerings data into the HTML table. */
export function renderMuniOfferingsTable(offeringsData) {
    if (!muniOfferingsTableBody) {
         console.error("Muni offerings table body not found!");
         return;
    }
    muniOfferingsTableBody.innerHTML = ''; // Clear previous content

    const colSpan = (muniTableHeaders?.length || 14);

    if (!offeringsData || offeringsData.length === 0) {
        const hasActiveFilters = state.activeMuniFilters.some(f => f.value !== '');
        // Modify message slightly to reflect it might be loading or empty
        const message = state.currentMuniOfferingsData.count === -1 // Use -1 as a loading indicator if needed
            ? 'Loading offerings...'
            : (hasActiveFilters ? 'No offerings match filter criteria.' : (state.currentMuniOfferingsData.count === 0 ? 'No municipal offerings available.' : 'No offerings on this page.'));
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">${message}</td></tr>`;
        if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
        if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; }
        return;
    }

    // Generate rows using processed data
    offeringsData.forEach(o => {
        const row = document.createElement('tr');
        row.dataset.offeringId = o.id; // Use integer PK

        const isChecked = state.selectedMuniOfferingIds.has(o.id); // Check against the Set
        const checkboxCell = document.createElement('td');
        checkboxCell.className = 'checkbox-column';
        // *** FIX: Update data-amount attribute to reflect multiplied value ***
        checkboxCell.innerHTML = `<input type="checkbox" class="muni-checkbox" data-offering-id="${o.id}" data-cusip="${o.cusip ?? 'N/A'}" data-amount="${(o.amount_num ?? 0).toFixed(2)}" ${isChecked ? 'checked' : ''} aria-label="Select offering ${o.cusip ?? 'N/A'}">`;
        // *** End Fix ***
        row.appendChild(checkboxCell);

        // Helper function to add cells, using processed values
        const addCell = (content, align = 'left', dataKey = null) => {
            const cell = document.createElement('td');
            let displayContent = 'N/A'; // Default display value

            if (content instanceof Date) {
                // Format Date objects
                displayContent = content.toLocaleDateString();
            } else if (typeof content === 'number') {
                // Format numbers based on dataKey
                 if (dataKey && ['amount', 'price', 'call_price'].includes(dataKey)) {
                    // Use localeString for amount (which is now multiplied)
                     displayContent = content.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                 } else if (dataKey && ['coupon', 'yield_rate'].includes(dataKey)) {
                     displayContent = content.toFixed(3);
                 } else {
                     // Default number formatting (e.g., for ID if it were displayed)
                     displayContent = content.toString();
                 }
            } else if (content !== null && content !== undefined && content !== '') {
                // Use the string content directly if it's valid
                displayContent = content;
            }
            // If content is still null/undefined after checks, it remains 'N/A'

            cell.textContent = displayContent;
            cell.style.textAlign = align;
            row.appendChild(cell);
        };

        // Add cells using processed properties
        addCell(o.cusip, 'left', 'cusip');
        addCell(o.amount_num, 'right', 'amount'); // Use processed number (now * 1000)
        addCell(o.description, 'left', 'description');
        addCell(o.coupon_num, 'right', 'coupon'); // Use processed number
        addCell(o.maturity_date_obj, 'center', 'maturity_date'); // Use processed date object
        addCell(o.yield_rate_num, 'right', 'yield_rate'); // Use processed number
        addCell(o.price_num, 'right', 'price'); // Use processed number
        addCell(o.moody_rating, 'left', 'moody_rating');
        addCell(o.sp_rating, 'left', 'sp_rating');
        addCell(o.call_date_obj, 'center', 'call_date'); // Use processed date object
        addCell(o.call_price_num, 'right', 'call_price'); // Use processed number
        addCell(o.state, 'left', 'state');
        addCell(o.insurance, 'left', 'insurance');

        muniOfferingsTableBody.appendChild(row);
    });

    updateSelectAllMunisCheckboxState();
    if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0;
}


/** Updates the sort indicator arrows in the muni offerings table headers. */
export function updateMuniSortIndicators() {
    if (!muniTableHeaders) return;
    muniTableHeaders.forEach(th => {
        const key = th.dataset.key;
        const arrowSpan = th.querySelector('.sort-arrow');
        if (!arrowSpan) return;

        // No complex mapping needed here based on original code
        if (key === state.currentMuniSortKey) {
            th.classList.add('sorted');
            arrowSpan.textContent = state.currentMuniSortDir === 'asc' ? ' ▲' : ' ▼';
        } else {
            th.classList.remove('sorted');
            arrowSpan.textContent = '';
        }
    });
}

/**
 * Renders pagination controls.
 * @param {HTMLElement} containerElement - The DOM element to render controls into.
 * @param {object | null} paginationData - The pagination state object. Null to clear.
 * @param {string} dataType - Identifier ('holdings' or 'munis').
 */
export function renderPaginationControls(containerElement, paginationData, dataType) {
    if (!containerElement) return;
    containerElement.innerHTML = '';

    // Ensure paginationData and count are valid before proceeding
    if (!paginationData || typeof paginationData.count !== 'number' || paginationData.count <= 0 || paginationData.count <= PAGE_SIZE) {
        containerElement.style.display = 'none';
        return;
    }

    containerElement.style.display = 'flex';

    const { count, nextUrl, previousUrl, currentPage } = paginationData;
    const totalPages = Math.ceil(count / PAGE_SIZE);

    const pageInfo = document.createElement('div');
    pageInfo.className = 'page-info';
    const startItem = (currentPage - 1) * PAGE_SIZE + 1;
    const endItem = Math.min(currentPage * PAGE_SIZE, count);
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${startItem}-${endItem} of ${count} items)`;

    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'pagination-buttons';

    const createButton = (text, url, pageNum) => {
        const button = document.createElement('button');
        button.textContent = text;
        button.disabled = !url;
        if (url && pageNum) {
            button.dataset.page = pageNum;
            button.dataset.type = dataType;
            // Event listener added in main.js using delegation
        } else if (!pageNum && url) {
             try {
                // Ensure the URL is absolute or relative to the current origin before parsing
                const absoluteUrl = new URL(url, window.location.origin);
                const pageParam = absoluteUrl.searchParams.get('page');
                if (pageParam) {
                     button.dataset.page = pageParam;
                     button.dataset.type = dataType;
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


    const prevPageNum = currentPage > 1 ? currentPage - 1 : null;
    const prevButton = createButton('Previous', previousUrl, prevPageNum);

    const nextPageNum = currentPage < totalPages ? currentPage + 1 : null;
    const nextButton = createButton('Next', nextUrl, nextPageNum);

    buttonsContainer.appendChild(prevButton);
    buttonsContainer.appendChild(nextButton);

    containerElement.appendChild(pageInfo);
    containerElement.appendChild(buttonsContainer);
}

/** Clears ONLY the holdings-related UI elements (Table, Totals, Charts, Selection, Pagination). */
export function clearHoldingsUI() {
    console.log("Clearing Holdings UI (Table, Totals, Charts, Selection, Pagination)...");
    const colSpanHoldings = (tableHeaders?.length || 13) + 1;

    // Clear Table Body
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="${colSpanHoldings}">Select customer/portfolio...</td></tr>`;
    }
    // Clear Totals Row
    renderTotals([]); // Render empty totals

    // Destroy Charts
    // Object.keys(state.chartInstances).forEach(charts.destroyChart); // Keep existing instances but clear data
    charts.renderCharts([]); // Render empty charts to clear them
    // state.resetChartInstances(); // Don't reset state, just clear data

    // Clear Selections
    clearHoldingSelection();

    // Clear Pagination
    renderPaginationControls(holdingsPaginationControls, null);
}

/** Clears the entire table/chart area (Holdings AND Munis). Used less often now. */
export function clearTableAndCharts() {
    console.log("Clearing BOTH Holdings and Muni UI..."); // Log clearing action

    // Clear Holdings part
    clearHoldingsUI(); // Use the specific function

    // Also clear muni table/pagination
    const colSpanMunis = (muniTableHeaders?.length || 14);
     if (muniOfferingsTableBody) {
        // Set a generic loading/cleared message for munis
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpanMunis}">Offerings will load here...</td></tr>`;
     }
     clearMuniOfferingSelection(); // Clear selections
     renderPaginationControls(muniPaginationControls, null); // Clear pagination
}


/** Applies the specified theme ('light' or 'dark') and re-renders charts. */
export function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    if(darkModeToggle) darkModeToggle.textContent = isDark ? 'Toggle Light Mode' : 'Toggle Dark Mode';

    // Wrap localStorage check in try...catch
    try {
        localStorage.setItem('themeCheck', '1');
        localStorage.removeItem('themeCheck');
        // Re-render charts only if they have data (now uses full data)
        // The trigger to re-render with full data should happen elsewhere (e.g., after initial load or filter change)
        // However, we still need to update the *existing* charts if the theme changes *after* they've been rendered.
        if (Object.keys(state.chartInstances).length > 0) {
            console.log("Theme changed, attempting to re-render charts with existing data (if any)...");
            // Re-rendering requires fetching all data again, which might be slow.
            // A better approach for *just* theme change might be to update options and call chart.update()
            // For now, we'll trigger the full refresh as it's simpler, but be aware of potential performance impact.
            renderChartsWithAllData(); // Re-fetch all data and render charts for the new theme
        }
    } catch (e) {
        console.warn("localStorage not accessible, charts will not update theme colors dynamically if persistence fails.");
        // Attempt re-render even if localStorage fails
        if (Object.keys(state.chartInstances).length > 0) {
             renderChartsWithAllData();
        }
    }
}


/** Shows the create portfolio modal and populates customer dropdown if needed. */
export function showCreatePortfolioModal() {
    console.log("Showing create portfolio modal. Admin:", IS_ADMIN); // Use imported IS_ADMIN

    if(createPortfolioForm) createPortfolioForm.reset();
    if(modalErrorMessage) {
        modalErrorMessage.textContent = '';
        modalErrorMessage.style.display = 'none';
    }
    if(adminCustomerSelect) adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>';

    if (IS_ADMIN) { // Use imported IS_ADMIN
        if(adminCustomerSelectGroup) adminCustomerSelectGroup.classList.remove('hidden');
        api.fetchCustomersForAdminModal(); // Use api.js function
    } else {
        if(adminCustomerSelectGroup) adminCustomerSelectGroup.classList.add('hidden');
    }

    if(createPortfolioModal) createPortfolioModal.classList.add('visible');
}

/** Hides the create portfolio modal. */
export function hideCreatePortfolioModal() {
    if(createPortfolioModal) createPortfolioModal.classList.remove('visible');
}

/** Populates the admin customer select dropdown in the modal. */
export function populateAdminCustomerDropdown(customerList) {
     state.setAvailableCustomers(customerList); // Update state
     if(adminCustomerSelect) {
        adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>';
        state.availableCustomers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        state.availableCustomers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.id;
            option.textContent = `${customer.name || 'Unnamed'} (${customer.customer_number || 'No Number'})`;
            adminCustomerSelect.appendChild(option);
        });
        adminCustomerSelect.disabled = false;
     }
}

/** Updates the state (checked, indeterminate) of the "Select All" checkbox for holdings. */
export function updateSelectAllCheckboxState() {
    if (!selectAllCheckbox || !tableBody) return;

    const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox');
    const totalVisible = visibleCheckboxes.length;
    const totalSelectedOnPage = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;

    if (totalVisible === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (totalSelectedOnPage === totalVisible) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (totalSelectedOnPage > 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
}

/** Clears holding selection state and UI. */
export function clearHoldingSelection() {
    state.clearSelectedHoldingIds(); // Use state function
    if(tableBody) tableBody.querySelectorAll('.holding-checkbox').forEach(cb => cb.checked = false);
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
    if (emailInterestBtn) {
        emailInterestBtn.disabled = true;
    }
    if (emailStatusMessage) {
        emailStatusMessage.textContent = '';
        emailStatusMessage.style.display = 'none';
    }
}

/** Updates the "Select All" checkbox state for muni offerings. */
export function updateSelectAllMunisCheckboxState() {
    if (!selectAllMunisCheckbox || !muniOfferingsTableBody) return;

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
export function clearMuniOfferingSelection() {
    state.clearSelectedMuniOfferingIds(); // Use state function
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

// --- Chart Loading State ---

/** Adds a visual loading indicator to chart containers. */
export function showChartLoadingState() {
    chartContainers.forEach(container => {
        container.classList.add('loading'); // Add a class for styling
        // Optional: Add a spinner element dynamically if needed
        // let spinner = container.querySelector('.spinner');
        // if (!spinner) {
        //     spinner = document.createElement('div');
        //     spinner.className = 'spinner'; // Style this class in CSS
        //     container.appendChild(spinner);
        // }
        // spinner.style.display = 'block';
    });
}

/** Removes the visual loading indicator from chart containers. */
export function hideChartLoadingState() {
    chartContainers.forEach(container => {
        container.classList.remove('loading');
        // Optional: Hide spinner element
        // const spinner = container.querySelector('.spinner');
        // if (spinner) spinner.style.display = 'none';
    });
}


// --- Orchestration Functions (Called by API or Main) ---

/**
 * Processes and displays the fetched holdings *page* data in the table and totals row.
 * NOTE: This function NO LONGER renders charts.
 */
export function processAndDisplayHoldingsPage() {
    // Ensure we are using the paged data from state
    const processedHoldingsPage = processHoldings(state.currentHoldingsData.results);
    renderTable(processedHoldingsPage); // Render table with processed page data
    renderTotals(processedHoldingsPage); // Render totals based on processed page data
    updateSortIndicators(); // Update sort indicators
    // charts.renderCharts(processedHoldings); // *** REMOVED: Charts are now rendered separately with all data ***
}

/** Processes and displays the fetched muni offerings page. */
export function processAndDisplayMuniOfferings() {
    const processedOfferings = processMuniOfferings(state.currentMuniOfferingsData.results); // Process data
    renderMuniOfferingsTable(processedOfferings); // Render table with processed data
    updateMuniSortIndicators(); // Update sort indicators after rendering
}

/**
 * NEW: Fetches ALL filtered holdings and renders the charts based on that full dataset.
 * This is intended to be called after the paged table data is loaded or filters change.
 */
export async function renderChartsWithAllData() {
    const portfolioId = portfolioFilterSelect?.value;
    if (!portfolioId) {
        console.log("renderChartsWithAllData: No portfolio selected, clearing charts.");
        charts.renderCharts([]); // Clear charts if no portfolio
        return;
    }

    console.log(`renderChartsWithAllData: Fetching all holdings for portfolio ID ${portfolioId} to render charts...`);
    showChartLoadingState(); // Show loading state

    try {
        const allHoldingsRaw = await api.fetchAllFilteredHoldings(); // Fetch all data

        if (!allHoldingsRaw || allHoldingsRaw.length === 0) {
            console.log("renderChartsWithAllData: No holdings found for charts.");
            charts.renderCharts([]); // Render empty charts
        } else {
            console.log(`renderChartsWithAllData: Processing ${allHoldingsRaw.length} holdings for charts.`);
            const allHoldingsProcessed = processHoldings(allHoldingsRaw);
            charts.renderCharts(allHoldingsProcessed); // Render charts with the full, processed data
        }
    } catch (error) {
        console.error("Error fetching or rendering charts with all data:", error);
        charts.renderCharts([]); // Clear charts on error
    } finally {
        hideChartLoadingState(); // Hide loading state regardless of success/failure
    }
}


// --- Event Handlers (Triggered by user interaction, often call API functions) ---

/** Handles the selection of a customer from the main dropdown. */
export async function handleCustomerSelection() {
    const previousCustomerId = state.selectedCustomerId;
    const newSelectedCustomerId = customerSelect ? customerSelect.value : null;
    if (!newSelectedCustomerId) return; // Exit if customerSelect doesn't exist or no value selected

    state.setSelectedCustomerId(newSelectedCustomerId); // Update global state

    if (state.selectedCustomerId === previousCustomerId && previousCustomerId !== null) {
        return; // No change
    }

    console.log(`Customer selected: ID ${state.selectedCustomerId}`);
    clearHoldingsUI(); // Clears table, totals, charts, selection, pagination

    if (!state.selectedCustomerId) {
        if(portfolioNameEl) portfolioNameEl.textContent = "Please select a customer.";
        if(portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');
        if(deletePortfolioBtn) deletePortfolioBtn.disabled = true;
        return;
    }

    const selectedCustomer = state.customers.find(c => c.id == state.selectedCustomerId);
    const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || state.selectedCustomerId}`;

    if(portfolioNameEl) portfolioNameEl.textContent = `Loading portfolios for ${customerDisplayName}...`;
    if(portfolioFilterContainer) portfolioFilterContainer.classList.add('hidden');
    if(deletePortfolioBtn) deletePortfolioBtn.disabled = true;

    await api.loadPortfolios(state.selectedCustomerId); // Use api.js function
}

/** Handles the selection of a portfolio from the dropdown. (UI Updates Only) */
export function handlePortfolioSelection() { // Made non-async, only updates UI
    if (!portfolioFilterSelect) return; // Ensure select exists

    const selectedPortfolioId = portfolioFilterSelect.value;
    const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    const isDefaultPortfolio = selectedOption?.dataset?.isDefault === 'true';

    console.log(`Portfolio selected (UI Update): ID '${selectedPortfolioId}' (Default: ${isDefaultPortfolio}), Customer ID: ${state.selectedCustomerId}`);

    clearHoldingsUI(); // Clear table, totals, charts, selection, pagination

    if(deletePortfolioBtn) deletePortfolioBtn.disabled = (!selectedPortfolioId || isDefaultPortfolio);

    const selectedCustomer = state.customers.find(c => c.id == state.selectedCustomerId);
    const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || state.selectedCustomerId}`;

    if (!selectedPortfolioId) {
        console.log("No specific portfolio selected (UI Update).");
        if(portfolioNameEl) portfolioNameEl.textContent = `${customerDisplayName} - Select a Portfolio`;
        return; // Stop here, let main.js trigger fetch if needed
    }

    const selectedPortfolio = state.currentPortfolios.find(p => p.id == selectedPortfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${selectedPortfolioId}`;
    if(portfolioNameEl) portfolioNameEl.textContent = `Loading ${portfolioDisplayName}...`; // Set loading title

    // Fetching is now triggered by the event listener in main.js after this function runs.
}

// Add utility function for status messages if not already present
export function showStatusMessageGeneric(statusElement, message, isError = false, duration = 5000) {
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

