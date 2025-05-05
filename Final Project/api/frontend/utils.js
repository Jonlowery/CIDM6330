// utils.js
// Contains general utility/helper functions.

"use strict";

/**
 * Parses a date string (YYYY-MM-DD) into a Date object.
 * Assumes UTC to avoid timezone issues with date-only strings.
 * Returns null if the string is invalid or empty.
 */
export function parseDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    try {
        // Check if the string matches the expected YYYY-MM-DD format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
             console.warn("Invalid date format encountered:", dateString, "- Expected YYYY-MM-DD");
             return null; // Return null for invalid formats
        }
        // Append time and Z to ensure UTC parsing
        const date = new Date(dateString + 'T00:00:00Z');
        // Check if the resulting date is valid
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        console.error("Error parsing date:", dateString, e);
        return null;
    }
}

/**
 * Safely parses a string value into a float.
 * Handles null, undefined, empty strings, and strings with commas.
 * Returns null if the value cannot be parsed into a valid number.
 */
export function parseFloatSafe(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    // Remove commas and attempt parsing
    const parsed = parseFloat(String(value).replace(/,/g, ''));
    return isNaN(parsed) ? null : parsed;
}

/** Generates an array of distinct HSL colors for charts. */
export function generateDistinctColors(count) {
    const colors = [];
    if (count <= 0) return colors;
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        // Use slightly varied saturation/lightness for better visibility
        const saturation = 70 + (i % 3) * 5; // e.g., 70%, 75%, 80%
        const lightness = 60 + (i % 4) * 5; // e.g., 60%, 65%, 70%, 75%
        colors.push(`hsl(${i * hueStep}, ${saturation}%, ${lightness}%)`);
    }
    return colors;
}

/** Displays a status message (success or error) in a specified status area. */
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
