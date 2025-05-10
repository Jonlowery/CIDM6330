// main.js
// Entry point for the application. Sets up event listeners and initializes the app.
// VERSION: Corrected calls to showStatusMessageGeneric (imported from utils.js).
// MODIFIED: Added logout button functionality.
// MODIFIED: Updated logout URL to /api-auth/logout/
// MODIFIED: Logout now uses POST with CSRF token.

"use strict";

import * as api from './api.js';
import * as ui from './ui.js';
import * as filters from './filters.js';
import * as charts from './charts.js';
import * as exports from './export.js';
import * as state from './state.js';
import { IS_ADMIN, CSRF_TOKEN } from './config.js'; // *** ADDED CSRF_TOKEN import ***
import { parseFloatSafe, showStatusMessageGeneric } from './utils.js';

// --- DOM Element References (for attaching listeners) ---
const customerSelect = document.getElementById('customer-select');
const portfolioFilterSelect = document.getElementById('portfolio-filter-select');
const deletePortfolioBtn = document.getElementById('delete-portfolio-btn');
const filtersContainer = document.getElementById('filters-container');
const addFilterBtn = document.getElementById('add-filter-btn');
const clearAllFiltersBtn = document.getElementById('clear-all-filters-btn');
const tableHeaders = document.querySelectorAll('#holdings-table th[data-key]');
const muniTableHeaders = document.querySelectorAll('#muni-offerings-table th[data-key]');
const muniFiltersContainer = document.getElementById('muni-filters-container');
const addMuniFilterBtn = document.getElementById('add-muni-filter-btn');
const clearAllMuniFiltersBtn = document.getElementById('clear-all-muni-filters-btn');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const exportExcelBtn = document.getElementById('export-excel-btn');
const createPortfolioBtn = document.getElementById('create-portfolio-btn');
const tableBody = document.querySelector('#holdings-table tbody');
const selectAllCheckbox = document.getElementById('select-all-holdings');
const emailInterestBtn = document.getElementById('email-interest-btn');
const muniOfferingsTableBody = document.querySelector('#muni-offerings-table tbody');
const selectAllMunisCheckbox = document.getElementById('select-all-munis');
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const holdingsPaginationControls = document.getElementById('holdings-pagination-controls');
const muniPaginationControls = document.getElementById('muni-pagination-controls');
const logoutBtn = document.getElementById('logout-btn');

// Create Portfolio Modal Elements
const createPortfolioModal = document.getElementById('create-portfolio-modal');
const createPortfolioForm = document.getElementById('create-portfolio-form');
const modalCloseCreatePortfolioBtn = document.getElementById('modal-close-create-portfolio-btn');
const modalCancelCreatePortfolioBtn = document.getElementById('modal-cancel-create-portfolio-btn');

// Portfolio Swap Simulation Elements
const simulateSwapBtn = document.getElementById('simulate-swap-btn');
const portfolioSwapModal = document.getElementById('portfolio-swap-modal');
const modalCloseSwapBtn = document.getElementById('modal-close-swap-btn');
const modalCancelSwapBtn = document.getElementById('modal-cancel-swap-btn');
const runSimulationBtn = document.getElementById('run-simulation-btn');
const swapSellListContainer = document.getElementById('swap-sell-list');
const swapBuyListContainer = document.getElementById('swap-buy-list');
const modalErrorMessageSwap = document.getElementById('modal-error-message-swap');
const closeSimulationResultsBtn = document.getElementById('close-simulation-results-btn');


// --- Event Handlers (delegated or direct) ---

/** Event handler for changes in filter column or operator dropdowns (HOLDINGS). Triggers table and chart refresh. */
function handleFilterDropdownChange(event) {
    const target = event.target;
    if (!target.matches('.filter-column, .filter-operator')) return;

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !filtersContainer || !filtersContainer.contains(filterRow)) return;

    if (target.classList.contains('filter-column')) {
        filters.updateOperatorOptionsForRow(filterRow);
    } else {
        filters.updateFilterState(filterRow);
    }
    filters.applyHoldingsFiltersAndRefreshAll(1);
}

/** Event handler for changes in the filter value input field (HOLDINGS). Triggers table and chart refresh. */
function handleFilterValueChange(event) {
    const target = event.target;
    if (!target.matches('.filter-value')) return;

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !filtersContainer || !filtersContainer.contains(filterRow)) return;

    if (filters.updateFilterState(filterRow)) {
        filters.applyHoldingsFiltersAndRefreshAll(1);
    }
}

/** Event handler for removing a filter row (HOLDINGS). Triggers table and chart refresh. */
function handleRemoveFilter(event) {
    const target = event.target;
    if (!target.classList.contains('remove-filter-btn')) return;

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !filtersContainer || !filtersContainer.contains(filterRow)) return;

    const currentFilterRows = filtersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) {
        console.log("Cannot remove the last holdings filter.");
        return;
    }

    const filterIdToRemove = parseInt(filterRow.dataset.filterId, 10);
    state.removeActiveFilter(filterIdToRemove);
    filterRow.remove();
    filters.applyHoldingsFiltersAndRefreshAll(1);
}

/** Clears all active filters and resets the filter UI (HOLDINGS). Triggers table and chart refresh. */
function handleClearAllFilters() {
    state.setActiveFilters([]);
    if(filtersContainer) filtersContainer.innerHTML = '';
    filters.addFilterRow();
    filters.applyHoldingsFiltersAndRefreshAll(1);
}


/** Event handler for changes in filter column or operator dropdowns (MUNI). */
function handleMuniFilterDropdownChange(event) {
    const target = event.target;
    if (!target.matches('.muni-filter-column, .muni-filter-operator')) return;

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !muniFiltersContainer || !muniFiltersContainer.contains(filterRow)) return;

    if (target.classList.contains('muni-filter-column')) {
        filters.updateOperatorOptionsForRow(filterRow);
    } else {
        filters.updateMuniFilterState(filterRow);
    }
    filters.applyMuniFiltersAndFetchPage(1);
}

/** Event handler for changes in the filter value input field (MUNI). */
function handleMuniFilterValueChange(event) {
    const target = event.target;
     if (!target.matches('.muni-filter-value')) return;

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !muniFiltersContainer || !muniFiltersContainer.contains(filterRow)) return;

    if (filters.updateMuniFilterState(filterRow)) {
        filters.applyMuniFiltersAndFetchPage(1);
    }
}

/** Event handler for removing a filter row (MUNI). */
function handleRemoveMuniFilter(event) {
     const target = event.target;
    if (!target.classList.contains('remove-muni-filter-btn')) return;

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !muniFiltersContainer || !muniFiltersContainer.contains(filterRow)) return;

    const currentFilterRows = muniFiltersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) {
         console.log("Cannot remove the last muni filter.");
        return;
    }

    const filterIdToRemove = parseInt(filterRow.dataset.muniFilterId, 10);
    state.removeActiveMuniFilter(filterIdToRemove);
    filterRow.remove();
    filters.applyMuniFiltersAndFetchPage(1);
}

/** Clears all active filters and resets the filter UI (MUNI). */
function handleClearAllMuniFilters() {
    state.setActiveMuniFilters([]);
    if (muniFiltersContainer) {
        muniFiltersContainer.innerHTML = '';
        filters.addMuniFilterRow();
        filters.applyMuniFiltersAndFetchPage(1);
    }
}

/** Handles checkbox changes for individual holdings and the "Select All" checkbox. */
function handleCheckboxChange(event) {
    const target = event.target;

    if (target === selectAllCheckbox) {
        const isChecked = target.checked;
        const visibleCheckboxes = tableBody ? tableBody.querySelectorAll('.holding-checkbox') : [];
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const holdingId = checkbox.dataset.holdingId; // UUID for state
            if (holdingId) {
                if (isChecked) state.addSelectedHoldingId(holdingId);
                else state.deleteSelectedHoldingId(holdingId);
            }
        });
    } else if (target.classList.contains('holding-checkbox')) {
        const holdingId = target.dataset.holdingId; // UUID for state
        if (holdingId) {
            if (target.checked) state.addSelectedHoldingId(holdingId);
            else state.deleteSelectedHoldingId(holdingId);
            ui.updateSelectAllCheckboxState();
        }
    }

    if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0;
}

/** Handles checkbox changes for muni offerings. */
function handleMuniCheckboxChange(event) {
    const target = event.target;

    if (target === selectAllMunisCheckbox) {
        const isChecked = target.checked;
        const visibleCheckboxes = muniOfferingsTableBody ? muniOfferingsTableBody.querySelectorAll('.muni-checkbox') : [];
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const offeringId = parseInt(checkbox.dataset.offeringId, 10); // ID for state
            if (!isNaN(offeringId)) {
                if (isChecked) state.addSelectedMuniOfferingId(offeringId);
                else state.deleteSelectedMuniOfferingId(offeringId);
            }
        });
    } else if (target.classList.contains('muni-checkbox')) {
        const offeringId = parseInt(target.dataset.offeringId, 10); // ID for state
        if (!isNaN(offeringId)) {
            if (target.checked) state.addSelectedMuniOfferingId(offeringId);
            else state.deleteSelectedMuniOfferingId(offeringId);
            ui.updateSelectAllMunisCheckboxState();
        }
    }

    if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0;
}

/** Handles clicks on pagination buttons (using delegation). Fetches only the relevant page. */
function handlePaginationClick(event) {
    const button = event.target.closest('button');
    if (!button || !button.dataset.page || !button.dataset.type) return;

    const page = button.dataset.page;
    const type = button.dataset.type;
    const pageNum = parseInt(page, 10);
    if (isNaN(pageNum) || pageNum < 1) return;

    console.log(`Pagination click: Type=${type}, Page=${pageNum}`);

    if (type === 'holdings') {
        filters.applyHoldingsFiltersAndFetchPageOnly(pageNum); // Only fetch page
    } else if (type === 'munis') {
        filters.applyMuniFiltersAndFetchPage(pageNum);
    }
}

/** Toggles the theme between light and dark. */
function toggleTheme() {
    const currentTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    try {
        localStorage.setItem('portfolioTheme', currentTheme);
        console.log("Theme preference saved:", currentTheme);
    } catch (e) {
        console.warn("Could not save theme preference to localStorage:", e);
    }
    ui.applyTheme(currentTheme); // Apply theme via ui.js (handles chart re-rendering)
}

/** Handles the click on the "Run Simulation" button inside the swap modal. */
async function handleRunSimulation() {
    console.log("Run Simulation button clicked.");
    const portfolioId = portfolioFilterSelect?.value;
    if (!portfolioId) {
        showStatusMessageGeneric(modalErrorMessageSwap, "Error: No portfolio selected.", true, 0);
        return;
    }

    const holdingsToRemove = [];
    if (swapSellListContainer) {
        swapSellListContainer.querySelectorAll('.simulation-list-item').forEach(item => {
            const ticket = parseInt(item.dataset.externalTicket, 10);
            if (!isNaN(ticket)) {
                holdingsToRemove.push({ external_ticket: ticket });
            }
        });
    }

    const offeringsToBuy = [];
    let validationError = false;
    if (swapBuyListContainer) {
        swapBuyListContainer.querySelectorAll('.simulation-list-item').forEach(item => {
            const cusip = item.dataset.offeringCusip;
            const parInput = item.querySelector('.par-input');
            const parValue = parseFloatSafe(parInput?.value);

            if (!cusip) {
                validationError = true;
                showStatusMessageGeneric(modalErrorMessageSwap, `Error: Missing CUSIP for an offering to buy.`, true, 0);
                return;
            }
            if (parValue === null || parValue <= 0) {
                validationError = true;
                showStatusMessageGeneric(modalErrorMessageSwap, `Error: Invalid or zero par amount for CUSIP ${cusip}.`, true, 0);
                if (parInput) parInput.style.borderColor = 'red';
                return;
            }
            if (parInput) parInput.style.borderColor = '';
            offeringsToBuy.push({ offering_cusip: cusip, par_to_buy: parValue.toFixed(8) });
        });
    }
    if (validationError) return;

    if (holdingsToRemove.length === 0 && offeringsToBuy.length === 0) {
         showStatusMessageGeneric(modalErrorMessageSwap, "Please select holdings to sell or offerings to buy.", true, 0);
         return;
    }

    if (runSimulationBtn) runSimulationBtn.disabled = true;
    showStatusMessageGeneric(modalErrorMessageSwap, "Running simulation...", false, 0);

    try {
        const results = await api.runPortfolioSwapSimulation(portfolioId, holdingsToRemove, offeringsToBuy);
        ui.hidePortfolioSwapModal();
        ui.displaySimulationResults(results);
    } catch (error) {
        console.error("Simulation failed:", error);
        showStatusMessageGeneric(modalErrorMessageSwap, `Simulation failed: ${error.message}`, true, 0);
    } finally {
        if (runSimulationBtn) runSimulationBtn.disabled = false;
    }
}

// *** MODIFIED: Logout Handler to use POST with CSRF token ***
async function handleLogout() {
    console.log("Attempting to logout via POST...");
    const logoutUrl = '/api-auth/logout/';

    if (!CSRF_TOKEN) {
        console.error("CSRF Token not found. Cannot logout securely via POST.");
        // Fallback or error message
        alert("Logout failed: CSRF token missing. Please ensure you're properly connected.");
        return;
    }

    try {
        const response = await fetch(logoutUrl, {
            method: 'POST',
            headers: {
                'X-CSRFToken': CSRF_TOKEN,
                'Content-Type': 'application/json' // Optional, but good practice if sending any body
            },
            // body: JSON.stringify({}) // Django's LogoutView doesn't require a body for POST
        });

        // Django's LogoutView usually redirects upon successful logout.
        // The fetch API, by default, will follow redirects.
        // If the final response URL is different from the logout URL, a redirect happened.
        // Or, if it returns a 200/204 and the page content is the "Logged out" page.
        if (response.ok) { // Status 200-299
            console.log("Logout POST request successful. Status:", response.status);
            // The browser should have followed any redirect from Django's LogoutView.
            // Typically, this redirect goes to the login page or LOGOUT_REDIRECT_URL.
            // To ensure the UI reflects the logged-out state, we can redirect to home or login page.
            // If the logout view itself renders a "You are logged out" page, this might not be strictly necessary
            // but redirecting ensures a clean state.
            alert("You have been logged out."); // Optional: notify user
            window.location.href = '/'; // Redirect to homepage, or your login page e.g., '/accounts/login/'
        } else {
            // Handle cases where the logout URL itself returns an error (e.g., 403, 405, 500)
            console.error("Logout POST request failed. Status:", response.status);
            const errorData = await response.text(); // Get error text for debugging
            console.error("Logout error details:", errorData);
            alert(`Logout failed: Server responded with status ${response.status}. Please try again or contact support.`);
        }
    } catch (error) {
        console.error("Network error during logout:", error);
        alert("Logout failed: A network error occurred. Please check your connection and try again.");
    }
}
// ************************************************************


// --- Event Listener Setup ---

/** Attaches all necessary event listeners on DOMContentLoaded. */
function setupEventListeners() {
    // Customer/Portfolio Dropdowns & Delete Button
    if(customerSelect) customerSelect.addEventListener('change', ui.handleCustomerSelection);
    if(portfolioFilterSelect) {
        portfolioFilterSelect.addEventListener('change', async () => {
            ui.handlePortfolioSelection();
            if (portfolioFilterSelect.value) {
                await filters.applyHoldingsFiltersAndRefreshAll(1);
            }
        });
    }
    if(deletePortfolioBtn) deletePortfolioBtn.addEventListener('click', api.handleDeletePortfolio);

    // Holdings Filters
    if(addFilterBtn) addFilterBtn.addEventListener('click', () => filters.addFilterRow());
    if(clearAllFiltersBtn) clearAllFiltersBtn.addEventListener('click', handleClearAllFilters);
    if (filtersContainer) {
        filtersContainer.addEventListener('change', handleFilterDropdownChange);
        filtersContainer.addEventListener('input', handleFilterValueChange);
        filtersContainer.addEventListener('click', handleRemoveFilter);
    }

    // Holdings Table Sorting
    tableHeaders?.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return;
            const backendKey = api.mapFrontendKeyToBackend(key);
            const newDir = (backendKey === state.currentSortKey && state.currentSortDir === 'asc') ? 'desc' : 'asc';
            state.setHoldingsSort(backendKey, newDir);
            filters.applyHoldingsFiltersAndFetchPageOnly(1);
        });
    });

    // Muni Offerings Table Sorting
    muniTableHeaders?.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return;
            const newDir = (key === state.currentMuniSortKey && state.currentMuniSortDir === 'asc') ? 'desc' : 'asc';
            state.setMuniSort(key, newDir);
            filters.applyMuniFiltersAndFetchPage(1);
        });
    });

    // Muni Offerings Filters
    if(addMuniFilterBtn) addMuniFilterBtn.addEventListener('click', () => filters.addMuniFilterRow());
    if(clearAllMuniFiltersBtn) clearAllMuniFiltersBtn.addEventListener('click', handleClearAllMuniFilters);
    if (muniFiltersContainer) {
        muniFiltersContainer.addEventListener('change', handleMuniFilterDropdownChange);
        muniFiltersContainer.addEventListener('input', handleMuniFilterValueChange);
        muniFiltersContainer.addEventListener('click', handleRemoveMuniFilter);
    }

    // Theme Toggle & Export Buttons
    if(darkModeToggle) darkModeToggle.addEventListener('click', toggleTheme);
    if(exportPdfBtn) exportPdfBtn.addEventListener('click', exports.exportToPdf);
    if(exportExcelBtn) exportExcelBtn.addEventListener('click', exports.exportToXlsx);

    // Create Portfolio Modal
    if(createPortfolioBtn) createPortfolioBtn.addEventListener('click', ui.showCreatePortfolioModal);
    if(modalCloseCreatePortfolioBtn) modalCloseCreatePortfolioBtn.addEventListener('click', ui.hideCreatePortfolioModal);
    if(modalCancelCreatePortfolioBtn) modalCancelCreatePortfolioBtn.addEventListener('click', ui.hideCreatePortfolioModal);
    if(createPortfolioForm) createPortfolioForm.addEventListener('submit', api.handleCreatePortfolioSubmit);
    if(createPortfolioModal) createPortfolioModal.addEventListener('click', (event) => {
        if (event.target === createPortfolioModal) ui.hideCreatePortfolioModal();
    });

    // Holdings Table Checkboxes & Email Button
    if (tableBody) tableBody.addEventListener('change', handleCheckboxChange);
    if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', handleCheckboxChange);
    if (emailInterestBtn) emailInterestBtn.addEventListener('click', api.handleEmailInterestClick);

    // Muni Offerings Table Checkboxes & Email Button
    if (muniOfferingsTableBody) muniOfferingsTableBody.addEventListener('change', handleMuniCheckboxChange);
    if (selectAllMunisCheckbox) selectAllMunisCheckbox.addEventListener('change', handleMuniCheckboxChange);
    if (emailBuyInterestBtn) emailBuyInterestBtn.addEventListener('click', api.handleEmailBuyInterestClick);

    // Pagination Controls
    if (holdingsPaginationControls) holdingsPaginationControls.addEventListener('click', handlePaginationClick);
    if (muniPaginationControls) muniPaginationControls.addEventListener('click', handlePaginationClick);

    // Portfolio Swap Simulation Listeners
    if (simulateSwapBtn) simulateSwapBtn.addEventListener('click', ui.showPortfolioSwapModal);
    if (modalCloseSwapBtn) modalCloseSwapBtn.addEventListener('click', ui.hidePortfolioSwapModal);
    if (modalCancelSwapBtn) modalCancelSwapBtn.addEventListener('click', ui.hidePortfolioSwapModal);
    if (runSimulationBtn) runSimulationBtn.addEventListener('click', handleRunSimulation);
    if (portfolioSwapModal) portfolioSwapModal.addEventListener('click', (event) => {
        if (event.target === portfolioSwapModal) ui.hidePortfolioSwapModal();
    });
    if (closeSimulationResultsBtn) closeSimulationResultsBtn.addEventListener('click', ui.hideSimulationResults);

    // Logout Button Listener
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. Initializing Portfolio Analyzer Modules.");

    filters.generateColumnOptions();
    filters.addFilterRow();
    filters.generateMuniColumnOptions();
    filters.addMuniFilterRow();

    const ChartJS = window.Chart;
    if (typeof ChartJS !== 'undefined') {
        if (window.pluginTrendlineLinear && typeof window.pluginTrendlineLinear.id === 'string') {
             try {
                if (!ChartJS.registry.plugins.get(window.pluginTrendlineLinear.id)) {
                    ChartJS.register(window.pluginTrendlineLinear);
                    console.log("Trendline plugin registered.");
                } else {
                    console.log("Trendline plugin already registered.");
                }
            } catch (e) { console.error("Error registering Trendline plugin:", e); }
        } else { console.warn("Trendline plugin (pluginTrendlineLinear) not found or invalid."); }
    } else { console.warn("Chart.js library not loaded."); }

    let preferredTheme = 'light';
    try {
        localStorage.setItem('themeCheck', '1'); localStorage.removeItem('themeCheck');
        preferredTheme = localStorage.getItem('portfolioTheme') || 'light';
    } catch (e) { console.warn("Could not access localStorage for theme preference:", e); }
    ui.applyTheme(preferredTheme);

    setupEventListeners();

    api.loadCustomers();
    api.loadMuniOfferings();

    console.log("Portfolio Analyzer Initialized.");
});
