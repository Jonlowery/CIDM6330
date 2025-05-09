// ui.js
// Handles DOM manipulation and rendering UI components (tables, totals, pagination, modals, etc.),
// EXCLUDING filter UI and charts which are in their own modules.
// VERSION: Added Portfolio Swap Simulation UI logic. Consolidated status message logic (uses utils.js).

"use strict";

// Import utility functions (including the consolidated showStatusMessageGeneric)
import { parseDate, parseFloatSafe, showStatusMessageGeneric } from './utils.js';
import * as state from './state.js';
import * as api from './api.js'; // Needed for selection handlers and simulation triggers
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
const darkModeToggle = document.getElementById('dark-mode-toggle');
const portfolioFilterContainer = document.getElementById('portfolio-filter-container');
// References for Totals Row
const totalsParEl = document.getElementById('totals-par');
const totalsYieldEl = document.getElementById('totals-yield');
const totalsWalEl = document.getElementById('totals-wal');
const totalsDurationEl = document.getElementById('totals-duration');
// References for Chart Containers
const chartContainers = document.querySelectorAll('.chart-container');
// Email Status Messages
const emailInterestBtn = document.getElementById('email-interest-btn');
const emailStatusMessage = document.getElementById('email-status-message');
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const emailBuyStatusMessage = document.getElementById('email-buy-status-message');

// Create Portfolio Modal Elements
const createPortfolioModal = document.getElementById('create-portfolio-modal');
const createPortfolioForm = document.getElementById('create-portfolio-form');
const newPortfolioNameInput = document.getElementById('new-portfolio-name');
const adminCustomerSelectGroup = document.getElementById('admin-customer-select-group');
const adminCustomerSelect = document.getElementById('admin-customer-select');
const modalErrorMessageCreatePortfolio = document.getElementById('modal-error-message-create-portfolio');
// Create Portfolio Modal Buttons (using specific IDs from updated HTML)
const modalCloseCreatePortfolioBtn = document.getElementById('modal-close-create-portfolio-btn');
const modalCancelCreatePortfolioBtn = document.getElementById('modal-cancel-create-portfolio-btn');

// --- NEW: Portfolio Swap Simulation Elements ---
const portfolioSwapModal = document.getElementById('portfolio-swap-modal');
const swapSellListContainer = document.getElementById('swap-sell-list');
const swapBuyListContainer = document.getElementById('swap-buy-list');
const modalErrorMessageSwap = document.getElementById('modal-error-message-swap');
const runSimulationBtn = document.getElementById('run-simulation-btn');
// Swap Modal Buttons (using specific IDs from updated HTML)
const modalCloseSwapBtn = document.getElementById('modal-close-swap-btn');
const modalCancelSwapBtn = document.getElementById('modal-cancel-swap-btn');
// Simulation Results Area
const simulationResultsSection = document.getElementById('simulation-results-section');
const simulationResultsContent = document.getElementById('simulation-results-content');
const closeSimulationResultsBtn = document.getElementById('close-simulation-results-btn');


// --- Data Processing ---

/** Processes raw holding data for display. */
export function processHoldings(holdingsPage) {
    // console.log("Processing holdings data (raw):", JSON.stringify(holdingsPage)); // Log raw data string
    if (!holdingsPage || !Array.isArray(holdingsPage)) {
        console.warn("processHoldings: Input is not an array or is null/undefined.", holdingsPage);
        return []; // Return empty array if input is invalid
    }
    holdingsPage.forEach((h, index) => {
        // console.log(`Processing holding ${index}:`, h); // Log each raw holding

        // Basic fields
        h.par_value_num = parseFloatSafe(h.par_value); // Use par_value from serializer if available, else calculate
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
        h.market_date_obj = parseDate(h.market_date);

        // ISO date strings (for export)
        h.maturity_date_str_iso = h.maturity_date_obj ? h.maturity_date_obj.toISOString().split('T')[0] : (h.security?.maturity_date || '');
        h.call_date_str_iso = h.call_date_obj ? h.call_date_obj.toISOString().split('T')[0] : (h.security?.call_date || '');
        h.settlement_date_str_iso = h.settlement_date_obj ? h.settlement_date_obj.toISOString().split('T')[0] : (h.settlement_date || '');

        // Ensure external_ticket is present (important for simulation)
        h.external_ticket = h.external_ticket ?? null; // Use null if missing

    });
    return holdingsPage; // Return processed data
}

/** Processes raw muni offering data for display. */
export function processMuniOfferings(offeringsPage) {
    if (!offeringsPage || !Array.isArray(offeringsPage)) {
        console.warn("processMuniOfferings: Input is not an array or is null/undefined.", offeringsPage);
        return []; // Return empty array if input is invalid
    }
    // console.log("Processing muni offerings data:", offeringsPage); // Log raw data
    offeringsPage.forEach(offering => {
        // Amount is already a number from serializer, but ensure it's not null
        const rawAmount = parseFloatSafe(offering.amount);
        // Multiply by 1000 as per requirement
        offering.amount_num = rawAmount !== null ? rawAmount * 1000 : null;

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

        // Ensure ID is present (important for simulation)
        offering.id = offering.id ?? null;

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

    const intentionMap = { 'A': 'AFS', 'M': 'HTM', 'T': 'HFT' }; // Added HFT

    holdingsPage.forEach((h) => {
        const row = document.createElement('tr');
        // Store both ticket_id (UUID for selection STATE) and external_ticket (int for API calls/simulation)
        row.dataset.holdingTicketId = h.ticket_id;
        row.dataset.holdingExternalTicket = h.external_ticket; // Make sure external_ticket is available

        const cusipDisplay = h.security_cusip ?? 'N/A';
        const descriptionDisplay = h.security_description ?? '';
        const couponDisplay = (h.coupon_num ?? 0).toFixed(3);
        const maturityDisplay = h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : 'N/A';
        const callDisplay = h.call_date_obj ? h.call_date_obj.toLocaleDateString() : 'N/A';
        // Use the calculated par_value from the serializer if available, otherwise calculate
        const parValue = h.par_value ? parseFloatSafe(h.par_value) : (h.par_value_num ?? 0);
        const parDisplay = parValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const bookPriceDisplay = (h.book_price_num ?? 0).toFixed(6);
        const marketPriceDisplay = (h.market_price_num ?? 0).toFixed(6);
        const bookYieldDisplay = (h.book_yield_num ?? 0).toFixed(3);
        const walDisplay = (h.holding_average_life_num ?? 0).toFixed(2); // WAL
        const durationDisplay = (h.holding_duration_num ?? 0).toFixed(2);
        const intentionCodeRaw = h.intention_code?.toUpperCase() ?? 'N/A';
        const intentionDisplay = intentionMap[intentionCodeRaw] || intentionCodeRaw;
        const isChecked = state.selectedHoldingIds.has(h.ticket_id); // Selection uses UUID

        row.innerHTML = `
            <td class="checkbox-column">
                <input type="checkbox" class="holding-checkbox"
                       data-holding-id="${h.ticket_id}"
                       data-external-ticket="${h.external_ticket}"
                       data-cusip="${cusipDisplay}"
                       data-description="${descriptionDisplay}"
                       data-par="${parValue.toFixed(2)}"
                       ${isChecked ? 'checked' : ''}
                       aria-label="Select holding ${cusipDisplay}">
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

        // Use the backend key directly from state for comparison
        const backendKey = state.currentSortKey; // This is already the backend key
        const frontendKey = th.dataset.key; // Get the key associated with THIS header

        // Map the backend key back to a potential frontend key for matching
        let keyToMatch = backendKey;
        if (backendKey === 'holding_average_life') keyToMatch = 'wal';
        if (backendKey === 'security__cusip') keyToMatch = 'security_cusip';
        if (backendKey === 'security__description') keyToMatch = 'security_description';
        if (backendKey === 'security__coupon') keyToMatch = 'coupon';
        if (backendKey === 'security__maturity_date') keyToMatch = 'maturity_date';
        if (backendKey === 'security__call_date') keyToMatch = 'call_date';
        // Add other necessary reverse mappings if needed

        // Update arrow based on whether THIS header's key matches the current sort key
        if (frontendKey === keyToMatch) {
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
    // Use the calculated par_value from the serializer if available, otherwise calculate
    const getRowPar = (h) => h.par_value ? parseFloatSafe(h.par_value) : (h.par_value_num ?? 0);

    const totalPar = holdingsPage.reduce((sum, h) => sum + getRowPar(h), 0);
    const weightedYieldSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + (getRowPar(h) * (h.book_yield_num ?? 0)), 0) : 0;
    const totalYield = totalPar > 0 ? weightedYieldSum / totalPar : 0;
    const weightedWalSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + (getRowPar(h) * (h.holding_average_life_num ?? 0)), 0) : 0;
    const totalWal = totalPar > 0 ? weightedWalSum / totalPar : 0;
    const weightedDurationSum = totalPar > 0 ? holdingsPage.reduce((sum, h) => sum + (getRowPar(h) * (h.holding_duration_num ?? 0)), 0) : 0;
    const totalDuration = totalPar > 0 ? weightedDurationSum / totalPar : 0;

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
    const colSpan = (muniTableHeaders?.length || 14); // Calculate colspan based on headers

    if (!offeringsData || offeringsData.length === 0) {
        const hasActiveFilters = state.activeMuniFilters.some(f => f.value !== '');
        const message = state.currentMuniOfferingsData.count === -1 ? 'Loading offerings...' : (hasActiveFilters ? 'No offerings match filter criteria.' : (state.currentMuniOfferingsData.count === 0 ? 'No municipal offerings available.' : 'No offerings on this page.'));
        muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpan}">${message}</td></tr>`;
        if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
        if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; }
        return;
    }

    offeringsData.forEach(o => {
        const row = document.createElement('tr');
        row.dataset.offeringId = o.id; // Use integer PK for identification
        const isChecked = state.selectedMuniOfferingIds.has(o.id); // Check if selected
        const cusipDisplay = o.cusip ?? 'N/A';
        const descriptionDisplay = o.description ?? '';
        const amountDisplay = (o.amount_num ?? 0); // Use processed amount_num

        row.innerHTML = `
            <td class="checkbox-column">
                <input type="checkbox" class="muni-checkbox"
                       data-offering-id="${o.id}"
                       data-cusip="${cusipDisplay}"
                       data-description="${descriptionDisplay}"
                       data-amount="${amountDisplay.toFixed(2)}"
                       ${isChecked ? 'checked' : ''}
                       aria-label="Select offering ${cusipDisplay}">
            </td>
            <td style="text-align: left;">${cusipDisplay}</td>
            <td style="text-align: right;">${amountDisplay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="text-align: left;">${descriptionDisplay}</td>
            <td style="text-align: right;">${(o.coupon_num ?? 0).toFixed(3)}</td>
            <td style="text-align: center;">${o.maturity_date_obj ? o.maturity_date_obj.toLocaleDateString() : 'N/A'}</td>
            <td style="text-align: right;">${(o.yield_rate_num ?? 0).toFixed(3)}</td>
            <td style="text-align: right;">${(o.price_num ?? 0).toFixed(6)}</td>
            <td style="text-align: left;">${o.moody_rating ?? 'N/A'}</td>
            <td style="text-align: left;">${o.sp_rating ?? 'N/A'}</td>
            <td style="text-align: center;">${o.call_date_obj ? o.call_date_obj.toLocaleDateString() : 'N/A'}</td>
            <td style="text-align: right;">${(o.call_price_num ?? 0).toFixed(6)}</td>
            <td style="text-align: left;">${o.state ?? 'N/A'}</td>
            <td style="text-align: left;">${o.insurance ?? 'N/A'}</td>
        `;
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
        if (key === state.currentMuniSortKey) {
            th.classList.add('sorted');
            arrowSpan.textContent = state.currentMuniSortDir === 'asc' ? ' ▲' : ' ▼';
        } else {
            th.classList.remove('sorted');
            arrowSpan.textContent = '';
        }
    });
}

/** Renders pagination controls. */
export function renderPaginationControls(containerElement, paginationData, dataType) {
    if (!containerElement) return;
    containerElement.innerHTML = '';

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
        } else if (!pageNum && url) {
             try {
                const absoluteUrl = new URL(url, window.location.origin);
                const pageParam = absoluteUrl.searchParams.get('page');
                if (pageParam) { button.dataset.page = pageParam; button.dataset.type = dataType; }
                else { console.warn(`Could not extract page number from URL: ${url}`); button.disabled = true; }
            } catch (e) { console.error("Error parsing pagination URL:", url, e); button.disabled = true; }
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

/** Clears ONLY the holdings-related UI elements. */
export function clearHoldingsUI() {
    console.log("Clearing Holdings UI (Table, Totals, Charts, Selection, Pagination)...");
    const colSpanHoldings = (tableHeaders?.length || 13) + 1;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="${colSpanHoldings}">Select customer/portfolio...</td></tr>`;
    renderTotals([]);
    const holdingsChartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart', 'portfolioCashFlowChart'];
    holdingsChartIds.forEach(charts.destroyChart);
    clearHoldingSelection();
    renderPaginationControls(holdingsPaginationControls, null);
    // Also hide simulation results when holdings are cleared
    hideSimulationResults();
}

/** Clears the entire table/chart area (Holdings AND Munis). */
export function clearTableAndCharts() {
    console.log("Clearing BOTH Holdings and Muni UI...");
    clearHoldingsUI();
    const colSpanMunis = (muniTableHeaders?.length || 14);
     if (muniOfferingsTableBody) muniOfferingsTableBody.innerHTML = `<tr><td colspan="${colSpanMunis}">Offerings will load here...</td></tr>`;
     clearMuniOfferingSelection();
     renderPaginationControls(muniPaginationControls, null);
}

/** Applies the specified theme and re-renders charts if data exists. */
export function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    if(darkModeToggle) darkModeToggle.textContent = isDark ? 'Toggle Light Mode' : 'Toggle Dark Mode';

    try {
        localStorage.setItem('themeCheck', '1'); localStorage.removeItem('themeCheck');
        const portfolioId = portfolioFilterSelect?.value;
        if (portfolioId && Object.keys(state.chartInstances).length > 0) {
            console.log("Theme changed, re-rendering all charts...");
            renderChartsWithAllData(); // This fetches data and renders charts
        } else {
             console.log("Theme changed, but no portfolio selected or no charts rendered yet.");
        }
    } catch (e) {
        console.warn("localStorage not accessible, cannot persist theme. Charts may not update theme.");
         const portfolioId = portfolioFilterSelect?.value;
         if (portfolioId && Object.keys(state.chartInstances).length > 0) renderChartsWithAllData();
    }
}

/** Shows the create portfolio modal. */
export function showCreatePortfolioModal() {
    console.log("Showing create portfolio modal. Admin:", IS_ADMIN);
    if(createPortfolioForm) createPortfolioForm.reset();
    if(modalErrorMessageCreatePortfolio) { modalErrorMessageCreatePortfolio.textContent = ''; modalErrorMessageCreatePortfolio.style.display = 'none'; }
    if(adminCustomerSelect) adminCustomerSelect.innerHTML = '<option value="">-- Select Customer --</option>';

    if (IS_ADMIN) {
        if(adminCustomerSelectGroup) adminCustomerSelectGroup.classList.remove('hidden');
        api.fetchCustomersForAdminModal();
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
     state.setAvailableCustomers(customerList);
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

/** Updates the state of the "Select All" checkbox for holdings. */
export function updateSelectAllCheckboxState() {
    if (!selectAllCheckbox || !tableBody) return;
    const visibleCheckboxes = tableBody.querySelectorAll('.holding-checkbox');
    const totalVisible = visibleCheckboxes.length;
    const totalSelectedOnPage = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;

    if (totalVisible === 0) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
    else if (totalSelectedOnPage === totalVisible) { selectAllCheckbox.checked = true; selectAllCheckbox.indeterminate = false; }
    else if (totalSelectedOnPage > 0) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = true; }
    else { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
}

/** Clears holding selection state and UI. */
export function clearHoldingSelection() {
    state.clearSelectedHoldingIds();
    if(tableBody) tableBody.querySelectorAll('.holding-checkbox').forEach(cb => cb.checked = false);
    if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
    if (emailInterestBtn) { emailInterestBtn.disabled = true; }
    if (emailStatusMessage) { emailStatusMessage.textContent = ''; emailStatusMessage.style.display = 'none'; }
}

/** Updates the "Select All" checkbox state for muni offerings. */
export function updateSelectAllMunisCheckboxState() {
    if (!selectAllMunisCheckbox || !muniOfferingsTableBody) return;
    const visibleCheckboxes = muniOfferingsTableBody.querySelectorAll('.muni-checkbox');
    const totalVisible = visibleCheckboxes.length;
    const totalSelectedOnPage = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;

    if (totalVisible === 0) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
    else if (totalSelectedOnPage === totalVisible) { selectAllMunisCheckbox.checked = true; selectAllMunisCheckbox.indeterminate = false; }
    else if (totalSelectedOnPage > 0) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = true; }
    else { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
}

/** Clears muni offering selection state and UI. */
export function clearMuniOfferingSelection() {
    state.clearSelectedMuniOfferingIds();
    if(muniOfferingsTableBody) muniOfferingsTableBody.querySelectorAll('.muni-checkbox').forEach(cb => cb.checked = false);
    if (selectAllMunisCheckbox) { selectAllMunisCheckbox.checked = false; selectAllMunisCheckbox.indeterminate = false; }
    if (emailBuyInterestBtn) { emailBuyInterestBtn.disabled = true; }
    if (emailBuyStatusMessage) { emailBuyStatusMessage.textContent = ''; emailBuyStatusMessage.style.display = 'none'; }
}

/** Adds a visual loading indicator to all chart containers. */
export function showChartLoadingState() {
    chartContainers.forEach(container => container.classList.add('loading'));
}

/** Removes the visual loading indicator from all chart containers. */
export function hideChartLoadingState() {
    chartContainers.forEach(container => container.classList.remove('loading'));
}

// --- Orchestration Functions ---

/** Processes and displays the fetched holdings *page* data. */
export function processAndDisplayHoldingsPage() {
    const holdingsToProcess = state.currentHoldingsData.results || [];
    const processedHoldingsPage = processHoldings(holdingsToProcess);
    renderTable(processedHoldingsPage);
    renderTotals(processedHoldingsPage);
    updateSortIndicators();
}

/** Processes and displays the fetched muni offerings page. */
export function processAndDisplayMuniOfferings() {
    const offeringsToProcess = state.currentMuniOfferingsData.results || [];
    const processedOfferings = processMuniOfferings(offeringsToProcess);
    renderMuniOfferingsTable(processedOfferings);
    updateMuniSortIndicators();
}

/** Fetches ALL filtered holdings AND cash flows, then renders ALL charts. */
export async function renderChartsWithAllData() {
    const portfolioId = portfolioFilterSelect?.value;
    if (!portfolioId) {
        console.log("renderChartsWithAllData: No portfolio selected, clearing charts.");
        charts.renderCharts([]);
        charts.renderPortfolioCashFlowChart('portfolioCashFlowChart', []);
        return;
    }

    console.log(`renderChartsWithAllData: Fetching data for portfolio ID ${portfolioId}...`);
    showChartLoadingState();

    try {
        const [allHoldingsRaw, portfolioCashFlows] = await Promise.all([
            api.fetchAllFilteredHoldings(portfolioId),
            api.fetchPortfolioCashFlows(portfolioId)
        ]);

        if (!allHoldingsRaw || allHoldingsRaw.length === 0) {
            console.log("renderChartsWithAllData: No holdings data found for standard charts.");
            charts.renderCharts([]);
        } else {
            console.log(`renderChartsWithAllData: Processing ${allHoldingsRaw.length} holdings for standard charts.`);
            const allHoldingsProcessed = processHoldings(allHoldingsRaw);
            await charts.renderCharts(allHoldingsProcessed); // Renders standard charts
        }

        const cashFlowChartId = 'portfolioCashFlowChart';
        if (!portfolioCashFlows || portfolioCashFlows.length === 0) {
            console.log("renderChartsWithAllData: No cash flow data found.");
            charts.renderPortfolioCashFlowChart(cashFlowChartId, []);
        } else {
             console.log(`renderChartsWithAllData: Rendering cash flow chart with ${portfolioCashFlows.length} data points.`);
            charts.renderPortfolioCashFlowChart(cashFlowChartId, portfolioCashFlows);
        }

    } catch (error) {
        console.error("Error fetching or rendering charts with all data:", error);
        charts.renderCharts([]);
        charts.renderPortfolioCashFlowChart('portfolioCashFlowChart', []);
    } finally {
        hideChartLoadingState();
    }
}


// --- Event Handlers (Triggered by user interaction) ---

/** Handles the selection of a customer from the main dropdown. */
export async function handleCustomerSelection() {
    const newSelectedCustomerId = customerSelect ? customerSelect.value : null;
    if (!newSelectedCustomerId || state.selectedCustomerId === newSelectedCustomerId) return;

    state.setSelectedCustomerId(newSelectedCustomerId);
    console.log(`Customer selected: ID ${state.selectedCustomerId}`);
    clearHoldingsUI(); // Clear previous holdings UI

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

    await api.loadPortfolios(state.selectedCustomerId);
}

/** Handles the selection of a portfolio from the dropdown (UI Updates Only). */
export function handlePortfolioSelection() {
    if (!portfolioFilterSelect) return;
    const selectedPortfolioId = portfolioFilterSelect.value;
    const selectedOption = portfolioFilterSelect.options[portfolioFilterSelect.selectedIndex];
    const isDefaultPortfolio = selectedOption?.dataset?.isDefault === 'true';

    console.log(`Portfolio selected (UI Update): ID '${selectedPortfolioId}' (Default: ${isDefaultPortfolio})`);
    clearHoldingsUI(); // Clear previous holdings UI

    if(deletePortfolioBtn) deletePortfolioBtn.disabled = (!selectedPortfolioId || isDefaultPortfolio);

    const selectedCustomer = state.customers.find(c => c.id == state.selectedCustomerId);
    const customerDisplayName = selectedCustomer?.name || `Customer ${selectedCustomer?.customer_number || state.selectedCustomerId}`;

    if (!selectedPortfolioId) {
        console.log("No specific portfolio selected (UI Update).");
        if(portfolioNameEl) portfolioNameEl.textContent = `${customerDisplayName} - Select a Portfolio`;
        return;
    }

    const selectedPortfolio = state.currentPortfolios.find(p => p.id == selectedPortfolioId);
    const portfolioDisplayName = selectedPortfolio?.name || `Portfolio ${selectedPortfolioId}`;
    if(portfolioNameEl) portfolioNameEl.textContent = `Loading ${portfolioDisplayName}...`;
}

// --- NEW: Portfolio Swap Simulation UI Functions ---

/** Shows the portfolio swap simulation modal and populates its lists. */
export function showPortfolioSwapModal() {
    if (!portfolioSwapModal || !swapSellListContainer || !swapBuyListContainer) {
        console.error("Swap modal elements not found.");
        return;
    }
    console.log("Showing Portfolio Swap Modal...");
    // Clear any previous error messages
    if (modalErrorMessageSwap) {
        modalErrorMessageSwap.textContent = '';
        modalErrorMessageSwap.style.display = 'none';
    }
    // Populate the lists based on current selections
    populateSwapModalLists();
    // Make the modal visible
    portfolioSwapModal.classList.add('visible');
}

/** Hides the portfolio swap simulation modal. */
export function hidePortfolioSwapModal() {
    if (portfolioSwapModal) {
        portfolioSwapModal.classList.remove('visible');
        console.log("Hiding Portfolio Swap Modal.");
    }
}

/** Populates the Sell and Buy lists in the swap modal based on current table selections. */
function populateSwapModalLists() {
    if (!swapSellListContainer || !swapBuyListContainer) return;

    // --- Populate "Holdings to Sell" List ---
    swapSellListContainer.innerHTML = ''; // Clear previous items
    const holdingsToSell = [];
    // Find selected holdings from the current page data using ticket_id from state
    const currentHoldingsForSwap = state.currentHoldingsData.results || []; // Ensure it's an array
    currentHoldingsForSwap.forEach(holding => {
        if (state.selectedHoldingIds.has(holding.ticket_id) && holding.external_ticket !== null) {
            holdingsToSell.push({
                external_ticket: holding.external_ticket,
                cusip: holding.security_cusip ?? 'N/A',
                description: holding.security_description ?? 'No Description'
            });
        }
    });

    if (holdingsToSell.length === 0) {
        swapSellListContainer.innerHTML = '<p class="empty-list-message">Select holdings from the main table to "sell".</p>';
    } else {
        holdingsToSell.forEach(item => {
            const listItem = document.createElement('div');
            listItem.className = 'simulation-list-item';
            listItem.dataset.externalTicket = item.external_ticket;
            listItem.innerHTML = `
                <div class="item-details">
                    <span class="item-cusip">${item.cusip}</span>
                    <span class="item-desc">${item.description}</span>
                </div>
                <div class="item-actions">
                    <button type="button" class="remove-item-btn" title="Remove from simulation">X</button>
                </div>
            `;
            // Add event listener to the remove button
            listItem.querySelector('.remove-item-btn').addEventListener('click', (e) => {
                const ticketToRemove = e.target.closest('.simulation-list-item').dataset.externalTicket;
                // Remove from modal list
                e.target.closest('.simulation-list-item').remove();
                // Uncheck the corresponding checkbox in the main table
                const mainTableCheckbox = tableBody?.querySelector(`.holding-checkbox[data-external-ticket="${ticketToRemove}"]`);
                if (mainTableCheckbox) mainTableCheckbox.checked = false;
                // Update state
                const holdingIdToRemoveFromState = mainTableCheckbox?.dataset.holdingId; // Get ticket_id for state
                if (holdingIdToRemoveFromState) state.deleteSelectedHoldingId(holdingIdToRemoveFromState);
                updateSelectAllCheckboxState(); // Update main select-all checkbox
                // Check if list is now empty
                if (swapSellListContainer.children.length === 0) {
                     swapSellListContainer.innerHTML = '<p class="empty-list-message">Select holdings from the main table to "sell".</p>';
                }
            });
            swapSellListContainer.appendChild(listItem);
        });
    }

    // --- Populate "Offerings to Buy" List ---
    swapBuyListContainer.innerHTML = ''; // Clear previous items
    const offeringsToBuy = [];
    // Find selected offerings from the current page data using ID from state
    const currentOfferingsForSwap = state.currentMuniOfferingsData.results || []; // Ensure it's an array
    currentOfferingsForSwap.forEach(offering => {
        if (state.selectedMuniOfferingIds.has(offering.id) && offering.id !== null) {
            offeringsToBuy.push({
                id: offering.id, // Keep internal ID for removal logic
                cusip: offering.cusip ?? 'N/A',
                description: offering.description ?? 'No Description',
                // Use the processed amount_num (already * 1000) as default par
                default_par: offering.amount_num ?? 0
            });
        }
    });

    if (offeringsToBuy.length === 0) {
        swapBuyListContainer.innerHTML = '<p class="empty-list-message">Select offerings from the muni table to "buy".</p>';
    } else {
        offeringsToBuy.forEach(item => {
            const listItem = document.createElement('div');
            listItem.className = 'simulation-list-item';
            listItem.dataset.offeringId = item.id; // Use internal ID for removal
            listItem.dataset.offeringCusip = item.cusip; // Store CUSIP for API payload
            const defaultParFormatted = item.default_par.toFixed(2); // Format default par

            listItem.innerHTML = `
                <div class="item-details">
                    <span class="item-cusip">${item.cusip}</span>
                    <span class="item-desc">${item.description}</span>
                </div>
                <div class="item-actions">
                    <label for="par-buy-${item.id}" class="sr-only">Par to Buy</label>
                    <input type="number" id="par-buy-${item.id}" class="par-input"
                           value="${defaultParFormatted}"
                           min="0.01" step="any" required
                           title="Enter Par Amount to Buy">
                    <button type="button" class="remove-item-btn" title="Remove from simulation">X</button>
                </div>
            `;
            // Add event listener to the remove button
            listItem.querySelector('.remove-item-btn').addEventListener('click', (e) => {
                const offeringIdToRemove = e.target.closest('.simulation-list-item').dataset.offeringId;
                // Remove from modal list
                e.target.closest('.simulation-list-item').remove();
                // Uncheck the corresponding checkbox in the muni table
                const muniTableCheckbox = muniOfferingsTableBody?.querySelector(`.muni-checkbox[data-offering-id="${offeringIdToRemove}"]`);
                if (muniTableCheckbox) muniTableCheckbox.checked = false;
                // Update state
                if (offeringIdToRemove) state.deleteSelectedMuniOfferingId(parseInt(offeringIdToRemove, 10));
                updateSelectAllMunisCheckboxState(); // Update muni select-all checkbox
                 // Check if list is now empty
                if (swapBuyListContainer.children.length === 0) {
                     swapBuyListContainer.innerHTML = '<p class="empty-list-message">Select offerings from the muni table to "buy".</p>';
                }
            });
            swapBuyListContainer.appendChild(listItem);
        });
    }
}

/**
 * Displays the results of the portfolio swap simulation.
 * @param {object} apiResponse - The full response object from the simulation API.
 */
export function displaySimulationResults(apiResponse) {
    if (!simulationResultsSection || !simulationResultsContent) {
        console.error("Simulation results section or content area not found.");
        simulationResultsContent.innerHTML = '<p class="text-red-500">Error: UI elements for results are missing.</p>';
        if (simulationResultsSection) simulationResultsSection.classList.remove('hidden');
        return;
    }
    console.log("[UI] Displaying simulation results:", JSON.parse(JSON.stringify(apiResponse))); // Log the full response
    simulationResultsContent.innerHTML = ''; // Clear previous results

    // --- Correctly access nested metric objects ---
    const currentMetrics = apiResponse.current_portfolio_metrics;
    const simulatedMetrics = apiResponse.simulated_portfolio_metrics;
    const deltaMetrics = apiResponse.delta_metrics;
    // const swapAnalysis = apiResponse.swap_analysis; // Removed as per request

    /**
     * Helper function to process concentration data:
     * Groups "Municipal Offering" and any types containing "MUNI" into a single "MUNI" category.
     * @param {object} concentrationData - The original concentration_by_sec_type object.
     * @returns {object} - Processed concentration data.
     */
    const processConcentration = (concentrationData) => {
        if (!concentrationData || typeof concentrationData !== 'object') {
            return {};
        }
        const processed = {};
        let muniTotal = 0;
        let muniTotalExists = false;

        for (const [type, valueStr] of Object.entries(concentrationData)) {
            // Values are strings like "10.00%" or "+5.00%"
            const value = parseFloat(String(valueStr).replace('%', '')) || 0;
            if (type.toUpperCase().includes("MUNI") || type === "Municipal Offering") {
                muniTotal += value;
                muniTotalExists = true;
            } else {
                // If the type already exists, sum it up (should not happen with backend data, but good practice)
                processed[type] = (processed[type] || 0) + value;
            }
        }

        if (muniTotalExists) {
            processed["MUNI"] = muniTotal;
        }
        
        // Convert back to string percentages for display
        for (const key in processed) {
            // For delta, we need to preserve the sign if it's already there
            const originalValueStr = concentrationData[key] || (key === "MUNI" ? (Object.values(concentrationData).find(v => String(v).startsWith('+') || String(v).startsWith('-')) || "0%") : "0%");
            const sign = String(originalValueStr).startsWith('+') ? '+' : (String(originalValueStr).startsWith('-') ? '-' : '');
            
            if (key === "MUNI" && String(Object.values(concentrationData).find(v => String(v).startsWith('+') || String(v).startsWith('-')) || "").includes('%')) {
                 // If any original MUNI type in delta had a sign, apply it to the sum
                 const firstSignedMuniValue = Object.entries(concentrationData).find(
                    ([type, valStr]) => (type.toUpperCase().includes("MUNI") || type === "Municipal Offering") && (String(valStr).startsWith('+') || String(valStr).startsWith('-'))
                 );
                 const deltaSign = firstSignedMuniValue && (String(firstSignedMuniValue[1]).startsWith('+') || String(firstSignedMuniValue[1]).startsWith('-')) ? (String(firstSignedMuniValue[1]).startsWith('+') ? '+' : '-') : '';
                 processed[key] = `${deltaSign}${Math.abs(processed[key]).toFixed(2)}%`;

            } else if (String(originalValueStr).includes('%') && (String(originalValueStr).startsWith('+') || String(originalValueStr).startsWith('-'))) {
                 processed[key] = `${sign}${Math.abs(processed[key]).toFixed(2)}%`; // Preserve sign for delta
            }
            else {
                 processed[key] = `${processed[key].toFixed(2)}%`;
            }
        }
        return processed;
    };


    // --- Helper to format metrics object into HTML ---
    const formatMetricsToHtml = (metrics, title) => {
        if (!metrics || typeof metrics !== 'object' || Object.keys(metrics).length === 0) {
            console.warn(`[UI] No data or empty object for ${title.toLowerCase()}`);
            return `<p>No ${title.toLowerCase()} data available.</p>`;
        }
        console.log(`[UI] Formatting metrics for ${title}:`, JSON.parse(JSON.stringify(metrics)));

        const processedConcentration = processConcentration(metrics.concentration_by_sec_type);
        let concentrationHtml = '';
        if (Object.keys(processedConcentration).length > 0) {
            concentrationHtml = `
                <h4>Concentration by Security Type</h4>
                <table class="concentration-table">
                    <thead><tr><th>Type</th><th>Percentage</th></tr></thead>
                    <tbody>
                        ${Object.entries(processedConcentration)
                            .map(([type, value]) => `<tr><td>${type}</td><td>${value}</td></tr>`)
                            .join('')}
                    </tbody>
                </table>`;
        } else {
            console.log(`[UI] No concentration data for ${title} after processing.`);
        }

        return `
            <h3>${title}</h3>
            <div class="simulation-metrics-grid">
                <div class="metric-item"><strong>Total Par Value</strong><span>${metrics.total_par_value || 'N/A'}</span></div>
                <div class="metric-item"><strong>Total Market Value</strong><span>${metrics.total_market_value || 'N/A'}</span></div>
                <div class="metric-item"><strong>Total Book Value</strong><span>${metrics.total_book_value || 'N/A'}</span></div>
                <div class="metric-item"><strong>Gain/Loss</strong><span>${metrics.gain_loss || 'N/A'}</span></div>
                <div class="metric-item"><strong>Holding Count</strong><span>${metrics.holding_count ?? 'N/A'}</span></div>
                ${metrics.wal ? `<div class="metric-item"><strong>WAL</strong><span>${metrics.wal}</span></div>` : ''}
                ${metrics.duration ? `<div class="metric-item"><strong>Duration</strong><span>${metrics.duration}</span></div>` : ''}
                ${metrics.yield ? `<div class="metric-item"><strong>Yield</strong><span>${metrics.yield}</span></div>` : ''}
            </div>
            ${concentrationHtml}
        `;
    };

     // --- Helper to format delta metrics object into HTML ---
     const formatDeltaToHtml = (delta, title) => {
        if (!delta || typeof delta !== 'object' || Object.keys(delta).length === 0) {
            console.warn(`[UI] No data or empty object for ${title.toLowerCase()}`);
            return `<p>No ${title.toLowerCase()} data available.</p>`;
        }
        console.log(`[UI] Formatting delta for ${title}:`, JSON.parse(JSON.stringify(delta)));

        const processedConcentration = processConcentration(delta.concentration_by_sec_type);
        let concentrationHtml = '';
        if (Object.keys(processedConcentration).length > 0) {
            concentrationHtml = `
                <h4>Concentration Change by Security Type</h4>
                <table class="concentration-table">
                     <thead><tr><th>Type</th><th>Change</th></tr></thead>
                    <tbody>
                        ${Object.entries(processedConcentration)
                            .map(([type, value]) => `<tr><td>${type}</td><td>${value}</td></tr>`) // Value is already string with % and +/-
                            .join('')}
                    </tbody>
                </table>`;
        } else {
            console.log(`[UI] No delta concentration data for ${title} after processing.`);
        }

        return `
            <h3>${title}</h3>
            <div class="simulation-metrics-grid">
                <div class="metric-item"><strong>Total Par Value Change</strong><span>${delta.total_par_value || 'N/A'}</span></div>
                <div class="metric-item"><strong>Total Market Value Change</strong><span>${delta.total_market_value || 'N/A'}</span></div>
                <div class="metric-item"><strong>Total Book Value Change</strong><span>${delta.total_book_value || 'N/A'}</span></div>
                <div class="metric-item"><strong>Gain/Loss Change</strong><span>${delta.gain_loss || 'N/A'}</span></div>
                <div class="metric-item"><strong>Holding Count Change</strong><span>${delta.holding_count ?? 'N/A'}</span></div>
                 ${delta.wal ? `<div class="metric-item"><strong>WAL Change</strong><span>${delta.wal}</span></div>` : ''}
                ${delta.duration ? `<div class="metric-item"><strong>Duration Change</strong><span>${delta.duration}</span></div>` : ''}
                ${delta.yield ? `<div class="metric-item"><strong>Yield Change</strong><span>${delta.yield}</span></div>` : ''}
            </div>
            ${concentrationHtml}
        `;
    };

    // --- Build Results HTML ---
    let resultsHtml = '';
    // Use the correctly accessed metric objects
    resultsHtml += formatMetricsToHtml(currentMetrics, 'Current Portfolio Metrics');
    resultsHtml += formatMetricsToHtml(simulatedMetrics, 'Simulated Portfolio Metrics');
    resultsHtml += formatDeltaToHtml(deltaMetrics, 'Change (Delta) Metrics');

    // Add Analysis section if present - REMOVED as per request
    // if (swapAnalysis && typeof swapAnalysis === 'object' && Object.keys(swapAnalysis).length > 0) {
    //     console.log("[UI] Formatting swap analysis:", JSON.parse(JSON.stringify(swapAnalysis)));
    //     resultsHtml += `
    //         <h3>Swap Analysis</h3>
    //         <div class="simulation-metrics-grid">
    //             ${Object.entries(swapAnalysis)
    //                 .map(([key, value]) => `<div class="metric-item"><strong>${key.replace(/_/g, ' ')}</strong><span>${value}</span></div>`)
    //                 .join('')}
    //         </div>
    //     `;
    // } else {
    //     console.log("[UI] No swap analysis data to display or section removed.");
    // }

    simulationResultsContent.innerHTML = resultsHtml;
    simulationResultsSection.classList.remove('hidden'); // Show the results section
    // Scroll to the results section
    simulationResultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    console.log("[UI] Finished displaying simulation results.");
}


/** Hides the simulation results section. */
export function hideSimulationResults() {
    if (simulationResultsSection) {
        simulationResultsSection.classList.add('hidden');
        simulationResultsContent.innerHTML = '<p>Run a simulation to see results here.</p>'; // Reset content
        console.log("[UI] Hid simulation results.");
    }
}
