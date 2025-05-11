// state.js
// Manages the shared application state.

"use strict";

// --- State Management ---
export let customers = []; // Holds the list of customers fetched for the main dropdown
export let currentPortfolios = []; // Holds the list of portfolios fetched for the selected customer

// Holdings Data & State
export let currentHoldingsData = { // Store current page data + pagination info from SERVER
    results: [],        // Raw results for the current page from the server
    count: 0,           // Total count of items matching server-side filters
    nextUrl: null,
    previousUrl: null,
    currentPage: 1,
};
export let activeFilters = []; // Array to store active filter objects for HOLDINGS
export let nextFilterId = 0; // Counter for generating unique filter IDs for HOLDINGS UI
export let columnOptionsHtml = ''; // HTML string for filter column dropdown options for HOLDINGS
export let currentSortKey = 'security__cusip'; // Default sort column key for HOLDINGS
export let currentSortDir = 'asc'; // Default sort direction for HOLDINGS

// Muni Offerings Data & State
export let currentMuniOfferingsData = { // Store current page data + pagination info from SERVER
    results: [],        // Raw results for the current page from the server
    count: 0,           // Total count of items matching server-side filters
    nextUrl: null,
    previousUrl: null,
    currentPage: 1,
};
export let activeMuniFilters = []; // Array to store active filter objects for MUNIS
export let nextMuniFilterId = 0; // Counter for generating unique filter IDs for MUNIS UI
export let muniColumnOptionsHtml = ''; // HTML string for filter column dropdown options for MUNIS
export let currentMuniSortKey = 'cusip'; // Default sort column key for munis
export let currentMuniSortDir = 'asc'; // Default sort direction for munis

// General State
export let chartInstances = {}; // Stores active Chart.js instances for later destruction/update
// *** ADDED: State for storing pre-generated chart images ***
export let chartImageDataUrls = {}; // Stores base64 image data URLs for charts { chartId: dataUrl }
// *** END ADDED ***
export let availableCustomers = []; // Stores the full customer list fetched for the admin modal dropdown
export let selectedCustomerId = null; // Store the currently selected customer ID from the MAIN dropdown
export let selectedHoldingIds = new Set(); // Set to store IDs (ticket_id UUID strings) of selected holdings
export let selectedMuniOfferingIds = new Set(); // Set to store IDs (integer PKs) of selected muni offerings

// --- State Update Functions ---
// It's often good practice to have functions modify state rather than direct mutation from outside modules.

export function setCustomers(newCustomers) {
    customers = newCustomers;
}

export function setCurrentPortfolios(newPortfolios) {
    currentPortfolios = newPortfolios;
}

export function setCurrentHoldingsData(newData) {
    currentHoldingsData = { ...currentHoldingsData, ...newData };
}

export function setActiveFilters(newFilters) {
    activeFilters = newFilters;
}

export function addActiveFilter(newFilter) {
    activeFilters.push(newFilter);
}

export function removeActiveFilter(filterId) {
    activeFilters = activeFilters.filter(f => f.id !== filterId);
}

export function updateActiveFilter(filterId, updates) {
     const index = activeFilters.findIndex(f => f.id === filterId);
     if (index !== -1) {
         activeFilters[index] = { ...activeFilters[index], ...updates };
         return true;
     }
     return false;
}

export function incrementNextFilterId() {
    return nextFilterId++;
}

export function setColumnOptionsHtml(html) {
    columnOptionsHtml = html;
}

export function setHoldingsSort(key, dir) {
    currentSortKey = key;
    currentSortDir = dir;
}

export function setCurrentMuniOfferingsData(newData) {
    currentMuniOfferingsData = { ...currentMuniOfferingsData, ...newData };
}

export function setActiveMuniFilters(newFilters) {
    activeMuniFilters = newFilters;
}

export function addActiveMuniFilter(newFilter) {
    activeMuniFilters.push(newFilter);
}

export function removeActiveMuniFilter(filterId) {
    activeMuniFilters = activeMuniFilters.filter(f => f.id !== filterId);
}

export function updateActiveMuniFilter(filterId, updates) {
     const index = activeMuniFilters.findIndex(f => f.id === filterId);
     if (index !== -1) {
         activeMuniFilters[index] = { ...activeMuniFilters[index], ...updates };
         return true;
     }
     return false;
}

export function incrementNextMuniFilterId() {
    return nextMuniFilterId++;
}

export function setMuniColumnOptionsHtml(html) {
    muniColumnOptionsHtml = html;
}

export function setMuniSort(key, dir) {
    currentMuniSortKey = key;
    currentMuniSortDir = dir;
}

export function setChartInstance(id, instance) {
    chartInstances[id] = instance;
}

export function getChartInstance(id) {
    return chartInstances[id];
}

export function deleteChartInstance(id) {
    delete chartInstances[id];
    // Also remove the stored image data if the instance is deleted
    delete chartImageDataUrls[id];
}

export function resetChartInstances() {
    chartInstances = {};
    // Reset image data when instances are reset
    resetChartImageDataUrls();
}

// *** ADDED: Functions for chart image data ***
export function setChartImageDataUrl(chartId, dataUrl) {
    chartImageDataUrls[chartId] = dataUrl;
}

export function getChartImageDataUrl(chartId) {
    return chartImageDataUrls[chartId];
}

export function resetChartImageDataUrls() {
    chartImageDataUrls = {};
}
// *** END ADDED ***


export function setAvailableCustomers(customers) {
    availableCustomers = customers;
}

export function setSelectedCustomerId(id) {
    selectedCustomerId = id;
}

export function addSelectedHoldingId(id) {
    selectedHoldingIds.add(id);
}

export function deleteSelectedHoldingId(id) {
    selectedHoldingIds.delete(id);
}

export function clearSelectedHoldingIds() {
    selectedHoldingIds.clear();
}

export function addSelectedMuniOfferingId(id) {
    selectedMuniOfferingIds.add(id);
}

export function deleteSelectedMuniOfferingId(id) {
    selectedMuniOfferingIds.delete(id);
}

export function clearSelectedMuniOfferingIds() {
    selectedMuniOfferingIds.clear();
}
