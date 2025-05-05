// main.js
// Entry point for the application. Sets up event listeners and initializes the app.

"use strict";

import * as api from './api.js';
import * as ui from './ui.js';
import * as filters from './filters.js';
import * as charts from './charts.js';
import * as exports from './export.js';
import * as state from './state.js';
import { IS_ADMIN } from './config.js'; // Import config variables if needed

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
const createPortfolioModal = document.getElementById('create-portfolio-modal');
const createPortfolioForm = document.getElementById('create-portfolio-form');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const tableBody = document.querySelector('#holdings-table tbody');
const selectAllCheckbox = document.getElementById('select-all-holdings');
const emailInterestBtn = document.getElementById('email-interest-btn');
const muniOfferingsTableBody = document.querySelector('#muni-offerings-table tbody');
const selectAllMunisCheckbox = document.getElementById('select-all-munis');
const emailBuyInterestBtn = document.getElementById('email-buy-interest-btn');
const holdingsPaginationControls = document.getElementById('holdings-pagination-controls');
const muniPaginationControls = document.getElementById('muni-pagination-controls');

// --- Event Handlers (delegated or direct) ---

/** Event handler for changes in filter column or operator dropdowns (HOLDINGS). Triggers table and chart refresh. */
function handleFilterDropdownChange(event) {
    const target = event.target;
    if (!target.matches('.filter-column, .filter-operator')) return; // Only handle relevant changes

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !filtersContainer || !filtersContainer.contains(filterRow)) return; // Ensure it's a holdings filter

    if (target.classList.contains('filter-column')) {
        filters.updateOperatorOptionsForRow(filterRow); // Update operators first (this also updates state)
    } else {
        // Operator changed, just update state
        filters.updateFilterState(filterRow);
    }

    // Always refresh table and charts when dropdowns change
    filters.applyHoldingsFiltersAndRefreshAll(1);
}

/** Event handler for changes in the filter value input field (HOLDINGS). Triggers table and chart refresh. */
function handleFilterValueChange(event) {
    const target = event.target;
    if (!target.matches('.filter-value')) return; // Only handle value input changes

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !filtersContainer || !filtersContainer.contains(filterRow)) return; // Ensure it's a holdings filter

    if (filters.updateFilterState(filterRow)) { // Update state first
        filters.applyHoldingsFiltersAndRefreshAll(1); // Then refresh table and charts
    }
}

/** Event handler for removing a filter row (HOLDINGS). Triggers table and chart refresh. */
function handleRemoveFilter(event) {
    const target = event.target;
    if (!target.classList.contains('remove-filter-btn')) return; // Only handle remove button clicks

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !filtersContainer || !filtersContainer.contains(filterRow)) return; // Ensure it's a holdings filter

    const currentFilterRows = filtersContainer.querySelectorAll('.filter-row');
    if (currentFilterRows.length <= 1) {
        console.log("Cannot remove the last holdings filter.");
        return;
    }

    const filterIdToRemove = parseInt(filterRow.dataset.filterId, 10);
    state.removeActiveFilter(filterIdToRemove); // Update state
    filterRow.remove(); // Remove from DOM
    filters.applyHoldingsFiltersAndRefreshAll(1); // Refetch table page 1 and refresh charts
}

/** Clears all active filters and resets the filter UI (HOLDINGS). Triggers table and chart refresh. */
function handleClearAllFilters() {
    state.setActiveFilters([]); // Clear state
    if(filtersContainer) filtersContainer.innerHTML = '';
    filters.addFilterRow(); // Add back one default row (this updates state)
    filters.applyHoldingsFiltersAndRefreshAll(1); // Refetch table page 1 and refresh charts
}


/** Event handler for changes in filter column or operator dropdowns (MUNI). */
function handleMuniFilterDropdownChange(event) {
    const target = event.target;
    if (!target.matches('.muni-filter-column, .muni-filter-operator')) return;

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !muniFiltersContainer || !muniFiltersContainer.contains(filterRow)) return;

    if (target.classList.contains('muni-filter-column')) {
        filters.updateOperatorOptionsForRow(filterRow); // Update operators first (this also updates state)
    } else {
        filters.updateMuniFilterState(filterRow); // Just update state
    }

    // Refresh muni table
    filters.applyMuniFiltersAndFetchPage(1);
}

/** Event handler for changes in the filter value input field (MUNI). */
function handleMuniFilterValueChange(event) {
    const target = event.target;
     if (!target.matches('.muni-filter-value')) return;

    const filterRow = target.closest('.filter-row');
    if (!filterRow || !muniFiltersContainer || !muniFiltersContainer.contains(filterRow)) return;

    if (filters.updateMuniFilterState(filterRow)) { // Update state
        filters.applyMuniFiltersAndFetchPage(1); // Refresh muni table
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
    state.removeActiveMuniFilter(filterIdToRemove); // Update state
    filterRow.remove();
    filters.applyMuniFiltersAndFetchPage(1); // Refresh muni table
}

/** Clears all active filters and resets the filter UI (MUNI). */
function handleClearAllMuniFilters() {
    state.setActiveMuniFilters([]); // Clear state
    if (muniFiltersContainer) {
        muniFiltersContainer.innerHTML = '';
        filters.addMuniFilterRow(); // Add back default row (updates state)
        filters.applyMuniFiltersAndFetchPage(1); // Refresh muni table
    }
}

/** Handles checkbox changes for individual holdings and the "Select All" checkbox. */
function handleCheckboxChange(event) {
    const target = event.target;

    if (target === selectAllCheckbox) {
        const isChecked = target.checked;
        // Ensure tableBody exists before querying
        const visibleCheckboxes = tableBody ? tableBody.querySelectorAll('.holding-checkbox') : [];
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const holdingId = checkbox.dataset.holdingId;
            if (holdingId) {
                if (isChecked) state.addSelectedHoldingId(holdingId);
                else state.deleteSelectedHoldingId(holdingId);
            }
        });
    } else if (target.classList.contains('holding-checkbox')) {
        const holdingId = target.dataset.holdingId;
        if (holdingId) {
            if (target.checked) state.addSelectedHoldingId(holdingId);
            else state.deleteSelectedHoldingId(holdingId);
            ui.updateSelectAllCheckboxState(); // Update main checkbox
        }
    }

    // Enable/disable the email button
    if(emailInterestBtn) emailInterestBtn.disabled = state.selectedHoldingIds.size === 0;
    // console.log("Selected Holdings (ticket_ids):", state.selectedHoldingIds);
}

/** Handles checkbox changes for muni offerings. */
function handleMuniCheckboxChange(event) {
    const target = event.target;

    if (target === selectAllMunisCheckbox) {
        const isChecked = target.checked;
        // Ensure muniOfferingsTableBody exists before querying
        const visibleCheckboxes = muniOfferingsTableBody ? muniOfferingsTableBody.querySelectorAll('.muni-checkbox') : [];
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const offeringId = parseInt(checkbox.dataset.offeringId, 10);
            if (!isNaN(offeringId)) {
                if (isChecked) state.addSelectedMuniOfferingId(offeringId);
                else state.deleteSelectedMuniOfferingId(offeringId);
            }
        });
    } else if (target.classList.contains('muni-checkbox')) {
        const offeringId = parseInt(target.dataset.offeringId, 10);
        if (!isNaN(offeringId)) {
            if (target.checked) state.addSelectedMuniOfferingId(offeringId);
            else state.deleteSelectedMuniOfferingId(offeringId);
            ui.updateSelectAllMunisCheckboxState();
        }
    }

    if(emailBuyInterestBtn) emailBuyInterestBtn.disabled = state.selectedMuniOfferingIds.size === 0;
    // console.log("Selected Muni Offerings (IDs):", state.selectedMuniOfferingIds);
}

/** Handles clicks on pagination buttons (using delegation). Fetches only the relevant page. */
function handlePaginationClick(event) {
    const button = event.target.closest('button'); // Find the clicked button
    if (!button || !button.dataset.page || !button.dataset.type) return; // Ignore clicks outside buttons or buttons without data

    const page = button.dataset.page;
    const type = button.dataset.type;

    const pageNum = parseInt(page, 10);
    if (isNaN(pageNum) || pageNum < 1) {
         console.error("Invalid page number on pagination button:", page);
         return;
    }

    console.log(`Pagination click: Type=${type}, Page=${pageNum}`);

    if (type === 'holdings') {
        // *** Use the function that ONLY fetches the page ***
        filters.applyHoldingsFiltersAndFetchPageOnly(pageNum); // Corrected function name
    } else if (type === 'munis') {
        filters.applyMuniFiltersAndFetchPage(pageNum);
    }
}

/** Toggles the theme between light and dark. */
function toggleTheme() {
    const currentTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    // Wrap localStorage access in try...catch
    try {
        localStorage.setItem('portfolioTheme', currentTheme);
        console.log("Theme preference saved:", currentTheme);
    } catch (e) {
        console.warn("Could not save theme preference to localStorage:", e);
    }
    ui.applyTheme(currentTheme); // Apply theme via ui.js (this now handles chart re-rendering via renderChartsWithAllData)
}


// --- Event Listener Setup ---

/** Attaches all necessary event listeners on DOMContentLoaded. */
function setupEventListeners() {
    // Customer/Portfolio Dropdowns & Delete Button
    if(customerSelect) customerSelect.addEventListener('change', ui.handleCustomerSelection);
    // MODIFIED: Portfolio selection listener triggers UI update and THEN fetches data + refreshes charts
    if(portfolioFilterSelect) {
        portfolioFilterSelect.addEventListener('change', async () => {
            ui.handlePortfolioSelection(); // Update UI first (non-async)
            // Only fetch if a portfolio is actually selected (value is not empty)
            if (portfolioFilterSelect.value) {
                console.log(`Portfolio selection changed by user to ID: ${portfolioFilterSelect.value}, fetching holdings and refreshing charts...`); // Log fetch trigger
                // *** Use the function that fetches page 1 AND refreshes charts ***
                await filters.applyHoldingsFiltersAndRefreshAll(1);
            } else {
                 console.log("Portfolio selection changed to '-- Select Portfolio --', clearing holdings."); // Log clearing action
                 // ui.handlePortfolioSelection() already calls clearHoldingsUI() in this case
            }
        });
    }
    if(deletePortfolioBtn) deletePortfolioBtn.addEventListener('click', api.handleDeletePortfolio);

    // Holdings Filters (Delegation for dynamic rows) - Use handlers that refresh charts
    if(addFilterBtn) addFilterBtn.addEventListener('click', () => filters.addFilterRow()); // addFilterRow handles initial fetch if needed
    if(clearAllFiltersBtn) clearAllFiltersBtn.addEventListener('click', handleClearAllFilters); // Refreshes charts
    if (filtersContainer) {
        filtersContainer.addEventListener('change', handleFilterDropdownChange); // Refreshes charts
        filtersContainer.addEventListener('input', handleFilterValueChange);   // Refreshes charts
        filtersContainer.addEventListener('click', handleRemoveFilter);      // Refreshes charts
    }

    // Holdings Table Sorting - Should ONLY refresh the table page
    tableHeaders?.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return; // Ignore non-sortable headers
            // No need to map here, state uses frontend key, api.js maps it
            // Determine new sort direction
            const newDir = (key === state.currentSortKey && state.currentSortDir === 'asc') ? 'desc' : 'asc';
            console.log(`Holdings sort clicked: Key=${key}, Direction=${newDir}`); // Log sort action
            state.setHoldingsSort(key, newDir); // Update state with FRONTEND key

            // *** FIX: Use the correct function name from filters.js ***
            filters.applyHoldingsFiltersAndFetchPageOnly(1); // Refetch page 1 with new sort, NO chart refresh
        });
    });

    // Muni Offerings Table Sorting
    muniTableHeaders?.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (!key) return; // Ignore non-sortable headers

            // Determine new sort direction
            const newDir = (key === state.currentMuniSortKey && state.currentMuniSortDir === 'asc') ? 'desc' : 'asc';
            console.log(`Muni sort clicked: Key=${key}, Direction=${newDir}`); // Log sort action
            state.setMuniSort(key, newDir); // Update state
            filters.applyMuniFiltersAndFetchPage(1); // Refetch page 1 with new sort
        });
    });

    // Muni Offerings Filters (Delegation) - These only refresh the muni table
    if(addMuniFilterBtn) addMuniFilterBtn.addEventListener('click', () => filters.addMuniFilterRow());
    if(clearAllMuniFiltersBtn) clearAllMuniFiltersBtn.addEventListener('click', handleClearAllMuniFilters);
    if (muniFiltersContainer) {
        muniFiltersContainer.addEventListener('change', handleMuniFilterDropdownChange);
        muniFiltersContainer.addEventListener('input', handleMuniFilterValueChange);
        muniFiltersContainer.addEventListener('click', handleRemoveMuniFilter);
    }

    // Theme Toggle & Export Buttons
    if(darkModeToggle) darkModeToggle.addEventListener('click', toggleTheme); // Theme toggle now refreshes charts
    if(exportPdfBtn) {
        exportPdfBtn.addEventListener('click', () => {
            console.log("Export PDF button clicked, calling export function...");
            exports.exportToPdf(); // Call directly
        });
    }
    if(exportExcelBtn) exportExcelBtn.addEventListener('click', exports.exportToXlsx);

    // Create Portfolio Modal
    if(createPortfolioBtn) createPortfolioBtn.addEventListener('click', ui.showCreatePortfolioModal);
    if(modalCloseBtn) modalCloseBtn.addEventListener('click', ui.hideCreatePortfolioModal);
    if(modalCancelBtn) modalCancelBtn.addEventListener('click', ui.hideCreatePortfolioModal);
    if(createPortfolioForm) createPortfolioForm.addEventListener('submit', api.handleCreatePortfolioSubmit);
    if(createPortfolioModal) createPortfolioModal.addEventListener('click', (event) => {
        // Close modal only if the overlay itself (not content) is clicked
        if (event.target === createPortfolioModal) ui.hideCreatePortfolioModal();
    });

    // Holdings Table Checkboxes & Email Button (Delegation)
    if (tableBody) tableBody.addEventListener('change', handleCheckboxChange);
    if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', handleCheckboxChange);
    if (emailInterestBtn) emailInterestBtn.addEventListener('click', api.handleEmailInterestClick);

    // Muni Offerings Table Checkboxes & Email Button (Delegation)
    if (muniOfferingsTableBody) muniOfferingsTableBody.addEventListener('change', handleMuniCheckboxChange);
    if (selectAllMunisCheckbox) selectAllMunisCheckbox.addEventListener('change', handleMuniCheckboxChange);
    if (emailBuyInterestBtn) emailBuyInterestBtn.addEventListener('click', api.handleEmailBuyInterestClick);

    // Pagination Controls (Delegation) - Uses handler that only fetches the page
    if (holdingsPaginationControls) holdingsPaginationControls.addEventListener('click', handlePaginationClick);
    if (muniPaginationControls) muniPaginationControls.addEventListener('click', handlePaginationClick);
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. Initializing Portfolio Analyzer Modules.");

    // Initial setup for filters
    filters.generateColumnOptions();
    filters.addFilterRow(); // This adds the row but doesn't fetch unless initial value is set
    filters.generateMuniColumnOptions();
    filters.addMuniFilterRow(); // This adds the row but doesn't fetch unless initial value is set

    // Register Chart.js plugins (if loaded globally)
    const Chart = window.Chart;
    if (typeof Chart !== 'undefined') {
        // Check for the specific plugin object expected by Chart.js v3+ registration
        // Assuming the trendline plugin object is accessible via window.pluginTrendlineLinear
        if (window.pluginTrendlineLinear && typeof window.pluginTrendlineLinear.id === 'string') {
             try {
                // Check if already registered
                if (!Chart.registry.plugins.get(window.pluginTrendlineLinear.id)) {
                    Chart.register(window.pluginTrendlineLinear);
                    console.log("Trendline plugin registered.");
                } else {
                    console.log("Trendline plugin already registered.");
                }
            } catch (e) {
                console.error("Error registering Trendline plugin:", e);
            }
        } else {
            console.warn("Trendline plugin (pluginTrendlineLinear) not found or invalid.");
        }
    } else {
        console.warn("Chart.js library not loaded.");
    }


    // Apply preferred theme (wrapped in try...catch for localStorage access)
    let preferredTheme = 'light';
    try {
        // Check if localStorage is accessible and get saved theme
        localStorage.setItem('themeCheck', '1');
        localStorage.removeItem('themeCheck'); // Check accessibility
        preferredTheme = localStorage.getItem('portfolioTheme') || 'light';
        console.log("Theme preference loaded:", preferredTheme);
    } catch (e) {
        console.warn("Could not access localStorage for theme preference:", e);
        // Error already logged, proceed with default theme
    }
    // Apply the determined theme (handles charts internally via renderChartsWithAllData)
    ui.applyTheme(preferredTheme);

    // Setup all event listeners
    setupEventListeners();

    // Start loading initial data
    api.loadCustomers(); // Triggers portfolio/holdings load cascade via loadPortfolios
    api.loadMuniOfferings(); // Load munis in parallel

    console.log("Portfolio Analyzer Initialized.");
});

