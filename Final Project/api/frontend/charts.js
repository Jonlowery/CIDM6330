// charts.js
// Handles rendering and management of Chart.js charts.

"use strict";

import { generateDistinctColors } from './utils.js';
import * as state from './state.js';

// --- DOM Element References ---
// Assuming Chart.js and plugins are loaded globally via index.html <script> tags
const Chart = window.Chart;

// Helper function for delay (if needed, e.g., after rendering before capture)
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Destroys an existing Chart.js instance if it exists. */
export function destroyChart(chartId) {
    const instance = state.getChartInstance(chartId);
    if (instance?.destroy) { // Check if instance exists and has destroy method
        instance.destroy();
        state.deleteChartInstance(chartId); // Remove from tracking object (also clears image data via state)
    }
}

/**
 * Generates a base64 image URL for a given chart instance.
 * Adds a background suitable for PDF export, respecting the original theme.
 * @param {Chart} chartInstance - The Chart.js instance.
 * @param {string} chartId - The ID of the chart (for logging).
 * @param {boolean} isDarkTheme - Indicates if the chart was rendered with a dark theme.
 * @returns {Promise<string|null>} - A promise resolving to the data URL or null on error.
 */
// *** MODIFIED: Added isDarkTheme parameter ***
async function generateChartImage(chartInstance, chartId, isDarkTheme) {
    if (!chartInstance || !chartInstance.canvas) {
        console.warn(`[generateChartImage] Instance or canvas not found for ${chartId}.`);
        return null;
    }
    // Add a small delay to ensure rendering is complete before capture
    await delay(150); // 150ms delay

    try {
        const canvasEl = chartInstance.canvas;
        // Check dimensions *after* delay
        if (canvasEl.width === 0 || canvasEl.height === 0) {
             console.warn(`[generateChartImage] Canvas for ${chartId} has zero dimensions after delay.`);
             return null;
        }

        const ctx = canvasEl.getContext('2d');
        if (!ctx) {
            console.warn(`[generateChartImage] Could not get 2D context for ${chartId}.`);
            return null;
        }

        // *** MODIFIED: Set background based on theme ***
        // Use the actual background color of your dark/light mode body or chart container if known,
        // otherwise use generic dark/light colors.
        const backgroundColor = isDarkTheme ? '#222222' : '#ffffff'; // Example dark/light colors
        console.log(`[generateChartImage] Setting background for ${chartId} to ${backgroundColor} (isDark: ${isDarkTheme})`);

        // Add background
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = backgroundColor; // Use theme-appropriate background
        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.restore();
        // *** END MODIFICATION ***

        // Generate image
        const imageDataUrl = chartInstance.toBase64Image('image/png', 1.0);

        if (!imageDataUrl || imageDataUrl === 'data:,') {
            console.warn(`[generateChartImage] Generated empty image data for ${chartId}.`);
            return null;
        }
        console.log(`[generateChartImage] Successfully generated image for ${chartId}.`);
        return imageDataUrl;

    } catch (error) {
        console.error(`[generateChartImage] Error generating image for ${chartId}:`, error);
        return null;
    }
}


/**
 * Renders all the charts based on the provided holdings data.
 * Expects the FULL filtered dataset for accurate representation.
 * Clears existing charts before rendering. Handles empty data gracefully.
 * Also generates and stores base64 images for each chart in the state.
 * @param {Array} holdingsDataForCharts - The array of processed holding objects (full dataset).
 */
export async function renderCharts(holdingsDataForCharts) { // Made async
    console.log(`Rendering charts with ${holdingsDataForCharts?.length ?? 0} holdings (full dataset expected).`);

    // Destroy existing charts and clear stored images before creating new ones
    Object.keys(state.chartInstances).forEach(destroyChart);
    state.resetChartInstances(); // Resets both instances and image data URLs

    // Check if Chart.js library is loaded
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js library not loaded. Skipping chart rendering.");
        return;
    }

    // Get canvas contexts
    const contexts = {
        yieldVsMaturityChart: document.getElementById('yieldVsMaturityChart')?.getContext('2d'),
        parByMaturityYearChart: document.getElementById('parByMaturityYearChart')?.getContext('2d'),
        couponPieChart: document.getElementById('couponPieChart')?.getContext('2d'),
        priceVsYieldChart: document.getElementById('priceVsYieldChart')?.getContext('2d'),
    };

    // Check if all contexts are available
    const allContextsValid = Object.values(contexts).every(ctx => ctx);
    if (!allContextsValid) {
        console.error("One or more chart canvas elements not found. Cannot render charts.");
        return;
    }

    // If no data provided, ensure charts are cleared and exit
    if (!holdingsDataForCharts || holdingsDataForCharts.length === 0) {
        console.log("No data provided to renderCharts. Charts will be empty.");
        return;
    }

    // Determine colors based on current theme
    // *** This flag is now used for image generation too ***
    const isDark = document.body.classList.contains('dark-mode');
    console.log(`[renderCharts] Current theme isDark: ${isDark}`); // Log theme status
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
    const labelColor = isDark ? '#aaa' : '#666';
    const titleColor = isDark ? '#4dabf7' : '#0056b3';
    const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)';
    const tooltipColor = isDark ? '#f1f1f1' : '#fff';

    // Base configuration options for all charts
    const baseChartOptionsStatic = {
        responsive: true,
        maintainAspectRatio: false, // Important for container sizing
        animation: false, // Keep animation disabled for reliable image capture
        plugins: {
            legend: { labels: { color: labelColor } },
            title: { color: titleColor, display: true, font: { size: 14 } },
            tooltip: {
                backgroundColor: tooltipBgColor,
                titleColor: tooltipColor,
                bodyColor: tooltipColor,
                footerColor: tooltipColor
            }
        },
        scales: {
            x: {
                ticks: { color: labelColor },
                grid: { color: gridColor, borderColor: gridColor },
                title: { color: labelColor, display: true }
            },
            y: {
                ticks: { color: labelColor },
                grid: { color: gridColor, borderColor: gridColor },
                title: { color: labelColor, display: true }
            }
        },
    };

    // --- Render each chart and generate its image ---
    // Use an array to manage promises for image generation
    const imageGenerationPromises = [];

    // --- 1. Book Yield vs. Holding Average Life (Scatter Plot) ---
    const yieldLifePoints = holdingsDataForCharts
        .filter(h => h.holding_average_life_num !== null && h.book_yield_num !== null)
        .map(h => ({ x: h.holding_average_life_num, y: h.book_yield_num }));

    if (yieldLifePoints.length > 0 && contexts.yieldVsMaturityChart) {
        const chartId = 'yieldVsMaturityChart';
        const options1 = structuredClone(baseChartOptionsStatic);
        options1.plugins.title.text = 'Book Yield vs. Holding Avg Life (All Filtered)';
        options1.scales.x.type = 'linear';
        options1.scales.x.position = 'bottom';
        options1.scales.x.title.text = 'Holding Average Life (Years)';
        options1.scales.y.beginAtZero = false;
        options1.scales.y.title.text = 'Book Yield (%)';
        options1.plugins.tooltip.callbacks = { label: ctx => `Avg Life: ${ctx.parsed.x.toFixed(2)}, Yield: ${ctx.parsed.y.toFixed(3)}` };

        const dataset1 = {
            label: 'Book Yield vs Avg Life', data: yieldLifePoints,
            backgroundColor: isDark ? 'rgba(66, 135, 245, 0.7)' : 'rgba(0, 123, 255, 0.5)',
            borderColor: isDark ? 'rgba(86, 155, 255, 1)' : 'rgba(0, 123, 255, 1)',
            pointRadius: 5, pointHoverRadius: 7, showLine: false
        };
        if (window.pluginTrendlineLinear && Chart.registry.plugins.get('pluginTrendlineLinear')) {
            dataset1.trendlineLinear = { style: isDark ? "rgba(255, 80, 80, 0.9)" : "rgba(255, 50, 50, 0.8)", lineStyle: "solid", width: 2, projection: false };
        }

        const chartInstance = new Chart(contexts.yieldVsMaturityChart, { type: 'scatter', data: { datasets: [dataset1] }, options: options1 });
        state.setChartInstance(chartId, chartInstance);
        // *** MODIFIED: Pass isDark flag to image generator ***
        imageGenerationPromises.push(generateChartImage(chartInstance, chartId, isDark).then(url => state.setChartImageDataUrl(chartId, url)));
    }

    // --- 2. Total Par by Maturity Year (Bar Chart) ---
    const maturityBuckets = {};
    holdingsDataForCharts.forEach(h => {
        const year = h.maturity_date_obj ? h.maturity_date_obj.getFullYear() : 'Unknown';
        if (year !== 'Unknown' && !isNaN(year)) {
            maturityBuckets[year] = (maturityBuckets[year] || 0) + (h.par_value_num ?? 0);
        }
    });
    const sortedYears = Object.keys(maturityBuckets).map(Number).sort((a, b) => a - b);

    if (sortedYears.length > 0 && contexts.parByMaturityYearChart) {
        const chartId = 'parByMaturityYearChart';
        const options2 = structuredClone(baseChartOptionsStatic);
        options2.plugins.title.text = 'Total Par by Maturity Year (All Filtered)';
        options2.scales.x.title.text = 'Maturity Year';
        options2.scales.y.beginAtZero = true;
        options2.scales.y.title.text = 'Total Par Value';
        options2.scales.y.ticks = { ...options2.scales.y.ticks, callback: value => value.toLocaleString() };
        options2.plugins.tooltip.callbacks = { label: ctx => `Year: ${ctx.label}, Par: ${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` };

        const chartInstance = new Chart(contexts.parByMaturityYearChart, {
            type: 'bar',
            data: { labels: sortedYears, datasets: [{ label: 'Total Par by Maturity Year', data: sortedYears.map(year => maturityBuckets[year]), backgroundColor: isDark ? 'rgba(40, 167, 69, 0.85)' : 'rgba(40, 167, 69, 0.7)', borderColor: isDark ? 'rgba(60, 187, 89, 1)' : 'rgba(40, 167, 69, 1)', borderWidth: 1 }] },
            options: options2,
        });
        state.setChartInstance(chartId, chartInstance);
        // *** MODIFIED: Pass isDark flag to image generator ***
        imageGenerationPromises.push(generateChartImage(chartInstance, chartId, isDark).then(url => state.setChartImageDataUrl(chartId, url)));
    }

    // --- 3. Portfolio Par Distribution by Coupon Rate (Pie Chart) ---
    const couponBuckets = {};
    holdingsDataForCharts.forEach(h => {
        const couponRate = (h.coupon_num ?? 0).toFixed(3);
        couponBuckets[couponRate] = (couponBuckets[couponRate] || 0) + (h.par_value_num ?? 0);
    });
    const sortedCoupons = Object.keys(couponBuckets).sort((a, b) => parseFloat(a) - parseFloat(b));

    if (sortedCoupons.length > 0 && contexts.couponPieChart) {
        const chartId = 'couponPieChart';
        const pieColors = generateDistinctColors(sortedCoupons.length);
        const options3 = structuredClone(baseChartOptionsStatic);
        delete options3.scales; // No scales for pie charts
        options3.plugins.title.text = 'Par Distribution by Coupon Rate (All Filtered)';
        options3.plugins.title.align = 'center';
        options3.plugins.legend.position = 'bottom';
        options3.plugins.tooltip.callbacks = {
            label: ctx => {
                const label = ctx.label || ''; const value = ctx.parsed || 0;
                const total = ctx.dataset.data.reduce((acc, val) => acc + val, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return `${label}: ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`;
            }
        };

        const chartInstance = new Chart(contexts.couponPieChart, {
            type: 'pie',
            data: { labels: sortedCoupons.map(c => `${c}% Coupon`), datasets: [{ label: 'Par by Coupon Rate', data: sortedCoupons.map(c => couponBuckets[c]), backgroundColor: pieColors, hoverOffset: 4 }] },
            options: options3,
        });
        state.setChartInstance(chartId, chartInstance);
        // *** MODIFIED: Pass isDark flag to image generator ***
        imageGenerationPromises.push(generateChartImage(chartInstance, chartId, isDark).then(url => state.setChartImageDataUrl(chartId, url)));
    }

    // --- 4. Book Price vs. Book Yield (Scatter Plot) ---
    const priceYieldPoints = holdingsDataForCharts
        .filter(h => h.book_price_num !== null && h.book_price_num > 0 && h.book_yield_num !== null)
        .map(h => ({ x: h.book_price_num, y: h.book_yield_num }));

    if (priceYieldPoints.length > 0 && contexts.priceVsYieldChart) {
        const chartId = 'priceVsYieldChart';
        const options4 = structuredClone(baseChartOptionsStatic);
        options4.plugins.title.text = 'Book Price vs. Book Yield (All Filtered)';
        options4.scales.x.beginAtZero = false;
        options4.scales.x.title.text = 'Book Price';
        options4.scales.y.beginAtZero = false;
        options4.scales.y.title.text = 'Book Yield (%)';
        options4.plugins.tooltip.callbacks = { label: ctx => `Price: ${ctx.parsed.x.toFixed(6)}, Yield: ${ctx.parsed.y.toFixed(3)}` };

        const chartInstance = new Chart(contexts.priceVsYieldChart, {
            type: 'scatter',
            data: { datasets: [{ label: 'Book Price vs Yield', data: priceYieldPoints, backgroundColor: isDark ? 'rgba(255, 200, 50, 0.7)' : 'rgba(255, 193, 7, 0.6)', borderColor: isDark ? 'rgba(255, 210, 70, 1)' : 'rgba(255, 193, 7, 1)', pointRadius: 5, pointHoverRadius: 7, showLine: false }] },
            options: options4,
        });
        state.setChartInstance(chartId, chartInstance);
        // *** MODIFIED: Pass isDark flag to image generator ***
        imageGenerationPromises.push(generateChartImage(chartInstance, chartId, isDark).then(url => state.setChartImageDataUrl(chartId, url)));
    }

    // Wait for all image generation promises to settle (resolve or reject)
    await Promise.allSettled(imageGenerationPromises);
    console.log("Finished attempting to generate and store all chart images.");
}
