// config.js
// Contains constants and potentially configuration settings used across modules.

"use strict";

// Base URL for API calls
export const API_ROOT = '/api';

// Default page size from backend (used for display calculations)
export const PAGE_SIZE = 25;

// Export jsPDF and XLSX (if needed by other modules directly, though export functions encapsulate usage)
export const { jsPDF } = window.jspdf;
export const XLSX = window.XLSX; // SheetJS is usually global

// Retrieve CSRF token (needed for POST/DELETE requests in api.js)
/** Retrieves a cookie value by name. Essential for CSRF protection. */
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
export const CSRF_TOKEN = getCookie('csrftoken');

if (!CSRF_TOKEN) {
    console.error("CRITICAL: CSRF token not found. POST/DELETE requests will fail.");
    // Consider displaying an error to the user or preventing actions.
} else {
    // console.log("CSRF Token found:", CSRF_TOKEN); // Keep commented unless debugging
}

// Check IS_ADMIN_USER (set globally in index.html)
export const IS_ADMIN = window.IS_ADMIN_USER === true; // Convert to boolean just in case
if (typeof window.IS_ADMIN_USER === 'undefined') {
    console.error("CRITICAL: window.IS_ADMIN_USER is not defined. Ensure it's set in the HTML.");
} else {
    console.log("Admin status (from config.js):", IS_ADMIN);
}
