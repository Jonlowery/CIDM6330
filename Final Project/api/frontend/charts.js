// charts.js
// Handles rendering and management of Chart.js charts.
// MODIFIED: Added chart.update() after image generation to fix dark mode background.
// MODIFIED: Ensured portfolioCashFlowChart also generates an image for PDF export.

"use strict";

// Import utility functions for parsing and color generation
import { generateDistinctColors, parseFloatSafe, parseDate } from './utils.js';
// Import state management for chart instances and image data
import * as state from './state.js';

// --- DOM Element References ---
// Assuming Chart.js and plugins are loaded globally via index.html <script> tags
const Chart = window.Chart;

// Helper function for introducing small delays, useful for ensuring DOM updates before canvas operations
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Destroys an existing Chart.js instance and cleans up related state.
 * @param {string} chartId - The ID of the chart instance to destroy.
 */
export function destroyChart(chartId) {
    const instance = state.getChartInstance(chartId);
    if (instance?.destroy) {
        try {
            instance.destroy();
        } catch (e) {
            console.error(`[destroyChart] Error destroying chart ${chartId}:`, e);
        } finally {
            state.deleteChartInstance(chartId);
        }
    } else {
        // If instance.destroy doesn't exist, still ensure it's removed from state
        state.deleteChartInstance(chartId);
    }
}

/**
 * Generates a base64 encoded PNG image URL for a given chart instance.
 * Adds a white background suitable for PDF export. Includes defensive checks.
 * @param {Chart} chartInstance - The Chart.js instance.
 * @param {string} chartId - The ID of the chart (for logging and state retrieval).
 * @returns {Promise<string|null>} - A promise resolving to the data URL string or null on error/invalid state.
 */
async function generateChartImage(chartInstance, chartId) {
    // Initial check for instance and canvas
    if (!chartInstance || !chartInstance.canvas) {
        console.warn(`[generateChartImage] Initial check failed: Instance or canvas property missing for ${chartId}.`);
        return null;
    }

    // Wait a brief moment to allow any pending rendering or DOM updates to complete.
    // This can be crucial if the chart was just created or updated.
    await delay(200); // 200ms delay

    // Re-check the instance from state, as it might have been destroyed during the delay
    const currentInstance = state.getChartInstance(chartId);
    if (!currentInstance || !currentInstance.canvas) {
        console.warn(`[generateChartImage] Check after delay failed: Instance destroyed or canvas missing for ${chartId}.`);
        return null;
    }

    const canvasEl = currentInstance.canvas;

    // Check if canvas has valid dimensions. If not, try to resize.
    if (canvasEl.width === 0 || canvasEl.height === 0) {
         console.warn(`[generateChartImage] Canvas for ${chartId} has zero dimensions after delay.`);
         try {
             // Attempt to force a resize, Chart.js might re-calculate dimensions
             currentInstance.resize();
             await delay(100); // Short delay after resize
             if (canvasEl.width === 0 || canvasEl.height === 0) {
                 console.error(`[generateChartImage] Canvas for ${chartId} still has zero dimensions after resize attempt.`);
                 return null; // Still zero, cannot proceed
             }
         } catch (resizeError) {
              console.error(`[generateChartImage] Error during chart resize attempt for ${chartId}:`, resizeError);
              return null; // Resize failed
         }
    }

    try {
        const ctx = canvasEl.getContext('2d');
        if (!ctx) {
            console.error(`[generateChartImage] Could not get 2D context for ${chartId} canvas.`);
            return null;
        }

        // Save current state, draw white background, then restore
        // This ensures charts have a non-transparent background for PDF
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over'; // Draw behind existing content
        ctx.fillStyle = 'white'; // PDF-friendly background
        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.restore();

        // Generate the image
        const imageDataUrl = currentInstance.toBase64Image('image/png', 1.0); // PNG format, full quality

        // Validate the generated data URL
        if (!imageDataUrl || imageDataUrl === 'data:,') { // 'data:,' is an empty data URL
            console.warn(`[generateChartImage] Generated empty or invalid image data for ${chartId}.`);
            return null;
        }
        return imageDataUrl;
    } catch (error) {
        console.error(`[generateChartImage] Error during canvas operations for ${chartId}:`, error);
        // Check for a specific TypeError that sometimes occurs if the canvas element becomes invalid
        if (error instanceof TypeError && error.message.includes("reading 'width'")) {
             console.error(`>>> Specific TypeError caught for ${chartId}, canvas element might be invalid or detached.`);
        }
        return null;
    }
}


/**
 * Renders the standard portfolio analysis charts (Yield/Life, Par/Maturity, Coupon Dist).
 * @param {Array} holdingsDataForCharts - The array of processed holding objects (full dataset).
 */
export async function renderCharts(holdingsDataForCharts) {
    console.log(`Rendering standard charts with ${holdingsDataForCharts?.length ?? 0} holdings.`);
    const standardChartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart'];
    standardChartIds.forEach(destroyChart); // Destroy existing instances

    // Ensure Chart.js is loaded
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js library not loaded. Skipping chart rendering.");
        return;
    }

    // Get canvas contexts
    const contexts = {
        yieldVsMaturityChart: document.getElementById('yieldVsMaturityChart')?.getContext('2d'),
        parByMaturityYearChart: document.getElementById('parByMaturityYearChart')?.getContext('2d'),
        couponPieChart: document.getElementById('couponPieChart')?.getContext('2d'),
    };

    // Validate all contexts
    const allContextsValid = Object.values(contexts).every(ctx => ctx);
    if (!allContextsValid) {
        console.error("One or more standard chart canvas elements or contexts not found.");
        // Ensure any potentially half-created instances are cleared from state
        standardChartIds.forEach(id => state.deleteChartInstance(id));
        return;
    }

    // Handle empty data
    if (!holdingsDataForCharts || holdingsDataForCharts.length === 0) {
        console.log("No data provided to renderCharts. Standard charts will be empty.");
        // Optionally, display "No data" messages on canvases here
        return;
    }

    // Theme-dependent styling
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
    const labelColor = isDark ? '#aaa' : '#666';
    const titleColor = isDark ? '#4dabf7' : '#0056b3'; // Example: blueish title
    const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)';
    const tooltipColor = isDark ? '#f1f1f1' : '#fff';

    // Base chart options (static part, deep cloned for each chart)
    const baseChartOptionsStatic = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Disable animations for faster rendering, esp. for PDF
        plugins: {
            legend: { labels: { color: labelColor } },
            title: { color: titleColor, display: true, font: { size: 14 } },
            tooltip: { backgroundColor: tooltipBgColor, titleColor: tooltipColor, bodyColor: tooltipColor, footerColor: tooltipColor }
        },
        scales: { // Common scale settings, specific types (linear, category) set per chart
            x: { ticks: { color: labelColor }, grid: { color: gridColor, borderColor: gridColor }, title: { color: labelColor, display: true } },
            y: { ticks: { color: labelColor }, grid: { color: gridColor, borderColor: gridColor }, title: { color: labelColor, display: true } }
        },
    };

    const imageGenerationPromises = [];
    const chartInstancesToGenerate = []; // To store successfully created instances for image generation

    try {
        // --- 1. Book Yield vs. Holding Average Life (Scatter Plot) ---
        const yieldLifePoints = holdingsDataForCharts
            .filter(h => h.holding_average_life_num !== null && h.book_yield_num !== null)
            .map(h => ({ x: h.holding_average_life_num, y: h.book_yield_num }));

        if (yieldLifePoints.length > 0 && contexts.yieldVsMaturityChart) {
            const chartId = 'yieldVsMaturityChart';
            const options1 = structuredClone(baseChartOptionsStatic); // Deep clone
            options1.plugins.title.text = 'Book Yield vs. Holding Avg Life (All Filtered)';
            options1.scales.x.type = 'linear'; options1.scales.x.position = 'bottom';
            options1.scales.x.title.text = 'Holding Average Life (Years)';
            options1.scales.y.beginAtZero = false; options1.scales.y.title.text = 'Book Yield (%)';
            options1.plugins.tooltip.callbacks = { label: ctx => `Avg Life: ${ctx.parsed.x.toFixed(2)}, Yield: ${ctx.parsed.y.toFixed(3)}` };
            const dataset1 = { label: 'Book Yield vs Avg Life', data: yieldLifePoints, backgroundColor: isDark ? 'rgba(66, 135, 245, 0.7)' : 'rgba(0, 123, 255, 0.5)', borderColor: isDark ? 'rgba(86, 155, 255, 1)' : 'rgba(0, 123, 255, 1)', pointRadius: 5, pointHoverRadius: 7, showLine: false };
            if (window.pluginTrendlineLinear && Chart.registry.plugins.get('pluginTrendlineLinear')) { // Check if trendline plugin is registered
                dataset1.trendlineLinear = { style: isDark ? "rgba(255, 80, 80, 0.9)" : "rgba(255, 50, 50, 0.8)", lineStyle: "solid", width: 2, projection: false };
            } else { console.warn("Trendline plugin not registered, skipping trendline for yieldVsMaturityChart."); }
            const chartInstance = new Chart(contexts.yieldVsMaturityChart, { type: 'scatter', data: { datasets: [dataset1] }, options: options1 });
            state.setChartInstance(chartId, chartInstance);
            chartInstancesToGenerate.push({ id: chartId, instance: chartInstance });
        }

        // --- 2. Total Par by Maturity Year (Bar Chart) ---
        const maturityBuckets = {};
        holdingsDataForCharts.forEach(h => { const year = h.maturity_date_obj ? h.maturity_date_obj.getFullYear() : 'Unknown'; if (year !== 'Unknown' && !isNaN(year)) { maturityBuckets[year] = (maturityBuckets[year] || 0) + (h.par_value_num ?? 0); } });
        const sortedYears = Object.keys(maturityBuckets).map(Number).sort((a, b) => a - b);
        if (sortedYears.length > 0 && contexts.parByMaturityYearChart) {
            const chartId = 'parByMaturityYearChart';
            const options2 = structuredClone(baseChartOptionsStatic);
            options2.plugins.title.text = 'Total Par by Maturity Year (All Filtered)';
            options2.scales.x.title.text = 'Maturity Year';
            options2.scales.y.beginAtZero = true; options2.scales.y.title.text = 'Total Par Value';
            options2.scales.y.ticks = { ...options2.scales.y.ticks, callback: value => value.toLocaleString() }; // Format Y-axis ticks
            options2.plugins.tooltip.callbacks = { label: ctx => `Year: ${ctx.label}, Par: ${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` };
            const chartInstance = new Chart(contexts.parByMaturityYearChart, { type: 'bar', data: { labels: sortedYears, datasets: [{ label: 'Total Par by Maturity Year', data: sortedYears.map(year => maturityBuckets[year]), backgroundColor: isDark ? 'rgba(40, 167, 69, 0.85)' : 'rgba(40, 167, 69, 0.7)', borderColor: isDark ? 'rgba(60, 187, 89, 1)' : 'rgba(40, 167, 69, 1)', borderWidth: 1 }] }, options: options2, });
            state.setChartInstance(chartId, chartInstance);
            chartInstancesToGenerate.push({ id: chartId, instance: chartInstance });
        }

        // --- 3. Portfolio Par Distribution by Coupon Rate (Pie Chart) ---
        const couponBuckets = {};
        holdingsDataForCharts.forEach(h => { const couponRate = (h.coupon_num ?? 0).toFixed(3); couponBuckets[couponRate] = (couponBuckets[couponRate] || 0) + (h.par_value_num ?? 0); });
        const sortedCoupons = Object.keys(couponBuckets).sort((a, b) => parseFloat(a) - parseFloat(b));
        if (sortedCoupons.length > 0 && contexts.couponPieChart) {
            const chartId = 'couponPieChart';
            const pieColors = generateDistinctColors(sortedCoupons.length); // Generate distinct colors
            const options3 = structuredClone(baseChartOptionsStatic);
            delete options3.scales; // Pie charts don't have scales
            options3.plugins.title.text = 'Par Distribution by Coupon Rate (All Filtered)';
            options3.plugins.title.align = 'center'; options3.plugins.legend.position = 'bottom';
            options3.plugins.tooltip.callbacks = { label: ctx => { const label = ctx.label || ''; const value = ctx.parsed || 0; const total = ctx.dataset.data.reduce((acc, val) => acc + val, 0); const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0; return `${label}: ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`; } };
            const chartInstance = new Chart(contexts.couponPieChart, { type: 'pie', data: { labels: sortedCoupons.map(c => `${c}% Coupon`), datasets: [{ label: 'Par by Coupon Rate', data: sortedCoupons.map(c => couponBuckets[c]), backgroundColor: pieColors, hoverOffset: 4 }] }, options: options3, });
            state.setChartInstance(chartId, chartInstance);
            chartInstancesToGenerate.push({ id: chartId, instance: chartInstance });
        }

        // --- Generate Images for Created Charts ---
        console.log(`Starting image generation for ${chartInstancesToGenerate.length} standard charts...`);
        for (const chartInfo of chartInstancesToGenerate) {
            // Create a promise for each image generation
            const promise = generateChartImage(chartInfo.instance, chartInfo.id)
                .then(url => {
                    state.setChartImageDataUrl(chartInfo.id, url || null); // Store URL or null if failed
                    if (!url) console.warn(`Failed to generate image for ${chartInfo.id}.`);
                })
                .catch(err => { // Catch any unhandled errors from generateChartImage promise itself
                    console.error(`Unhandled error in generateChartImage promise for ${chartInfo.id}:`, err);
                    state.setChartImageDataUrl(chartInfo.id, null);
                });
            imageGenerationPromises.push(promise);
        }
        // Wait for all image generation attempts to settle (complete or fail)
        await Promise.allSettled(imageGenerationPromises);
        console.log("Finished attempting to generate and store standard chart images.");

        // Force an update on all newly created chart instances AFTER image generation.
        // This is to ensure they render correctly over any temporary background fills
        // that might have been applied by generateChartImage for PDF export.
        console.log("Forcing update on live charts after image generation...");
        chartInstancesToGenerate.forEach(chartInfo => {
            if (chartInfo.instance && typeof chartInfo.instance.update === 'function') {
                try {
                    chartInfo.instance.update('none'); // 'none' prevents re-animation
                    console.log(`Forced update on chart: ${chartInfo.id}`);
                } catch (e) {
                    console.error(`Error forcing update on chart ${chartInfo.id}:`, e);
                }
            }
        });

    } catch (chartCreationError) {
        console.error("Error during standard chart creation phase:", chartCreationError);
        // Cleanup any instances that might have been created before the error
        chartInstancesToGenerate.forEach(info => destroyChart(info.id));
    }
}


/**
 * Renders the aggregated portfolio cash flow chart, aggregated by YEAR.
 * @param {string} chartId - The canvas element ID ('portfolioCashFlowChart').
 * @param {Array} cashFlowData - Array of aggregated cash flow objects (per date) from the API.
 */
export async function renderPortfolioCashFlowChart(chartId, cashFlowData) { // Made async
    console.log(`Rendering yearly aggregated cash flow chart (${chartId}) from ${cashFlowData?.length ?? 0} data points.`);
    destroyChart(chartId); // Destroy existing instance first

    const ctx = document.getElementById(chartId)?.getContext('2d');
    if (!ctx) {
        console.error(`Canvas context not found for chart ID: ${chartId}`);
        return;
    }

    // Ensure Chart.js is available
    if (typeof Chart === 'undefined') {
         console.error("Chart.js library not loaded. Cannot render cash flow chart.");
         // Display an error message on the canvas itself
         ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); // Clear canvas
         ctx.font = "12px Arial"; ctx.fillStyle = "#dc3545"; ctx.textAlign = "center";
         ctx.fillText("Chart.js library missing.", ctx.canvas.width / 2, ctx.canvas.height / 2);
         return;
    }

    // Handle empty or invalid data
    if (!cashFlowData || cashFlowData.length === 0) {
        console.log("No data provided for cash flow chart.");
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = "12px Arial";
        ctx.fillStyle = document.body.classList.contains('dark-mode') ? '#aaa' : '#666'; // Theme-aware text color
        ctx.textAlign = "center";
        ctx.fillText("No cash flow data available for this portfolio.", ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }

    // Aggregate cash flows by year
    const yearlyFlows = {};
    try {
        cashFlowData.forEach(cf => {
            const dateObj = parseDate(cf.date); // Use robust date parsing
            if (!dateObj) {
                console.warn(`Could not parse date: ${cf.date}`);
                return; // Skip invalid date entries
            }
            const year = dateObj.getFullYear();
            if (!yearlyFlows[year]) {
                yearlyFlows[year] = { total_interest: 0, total_principal: 0 };
            }
            yearlyFlows[year].total_interest += parseFloatSafe(cf.total_interest) ?? 0;
            yearlyFlows[year].total_principal += parseFloatSafe(cf.total_principal) ?? 0;
        });

        const sortedYears = Object.keys(yearlyFlows).map(Number).sort((a, b) => a - b);

        if (sortedYears.length === 0) {
             console.log("No valid yearly cash flow data after aggregation.");
             ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
             ctx.font = "12px Arial"; ctx.fillStyle = document.body.classList.contains('dark-mode') ? '#aaa' : '#666';
             ctx.textAlign = "center";
             ctx.fillText("No yearly cash flow data to display.", ctx.canvas.width / 2, ctx.canvas.height / 2);
             return;
        }

        const labels = sortedYears.map(String);
        const interestData = sortedYears.map(year => yearlyFlows[year].total_interest);
        const principalData = sortedYears.map(year => yearlyFlows[year].total_principal);

        // Theme-dependent styling
        const isDark = document.body.classList.contains('dark-mode');
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
        const labelColor = isDark ? '#aaa' : '#666';
        const titleColor = isDark ? '#20c997' : '#17a2b8'; // Example: teal/cyan title
        const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)';
        const tooltipColor = isDark ? '#f1f1f1' : '#fff';
        const interestColor = isDark ? 'rgba(40, 167, 69, 0.85)' : 'rgba(40, 167, 69, 0.7)'; // Green for interest
        const principalColor = isDark ? 'rgba(66, 135, 245, 0.85)' : 'rgba(0, 123, 255, 0.7)'; // Blue for principal

        // Chart configuration
        const options = {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: {
                title: { display: true, text: 'Aggregated Yearly Cash Flow (Interest & Principal)', color: titleColor, font: { size: 14 } },
                legend: { position: 'top', labels: { color: labelColor } },
                tooltip: {
                    backgroundColor: tooltipBgColor, titleColor: tooltipColor, bodyColor: tooltipColor, footerColor: tooltipColor,
                    mode: 'index', intersect: false,
                    callbacks: {
                        label: function(context) { // Custom tooltip label for currency formatting
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) { label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y); }
                            return label;
                        }
                    }
                },
            },
            scales: {
                x: {
                    type: 'category', // Years are categories
                    title: { display: true, text: 'Year', color: labelColor },
                    ticks: { color: labelColor },
                    grid: { display: false }, // Often cleaner for bar charts
                    stacked: true, // Stack interest and principal
                },
                y: {
                    title: { display: true, text: 'Total Amount ($)', color: labelColor },
                    ticks: {
                        color: labelColor,
                        callback: function(value) { // Format Y-axis labels as compact currency
                            if (value === 0) return '$0';
                            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', compactDisplay: 'short' }).format(value);
                        }
                    },
                    grid: { color: gridColor, borderColor: gridColor },
                    stacked: true, // Stack interest and principal
                    beginAtZero: true
                }
            }
        };

        // Create the chart instance
        const chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Interest', data: interestData, backgroundColor: interestColor },
                    { label: 'Principal', data: principalData, backgroundColor: principalColor }
                ]
            },
            options: options,
        });
        state.setChartInstance(chartId, chartInstance); // Store instance in state
        console.log(`Successfully rendered yearly aggregated cash flow chart: ${chartId}`);

        // *** ADDED: Generate and store image for PDF export for this cash flow chart ***
        if (chartInstance) {
            // The generateChartImage function is async, so we use .then() or await
            // No need to await here if we don't need the result immediately for other operations in this function.
            generateChartImage(chartInstance, chartId)
                .then(url => {
                    state.setChartImageDataUrl(chartId, url || null); // Store URL or null if failed
                    if (!url) {
                        console.warn(`Failed to generate image for cash flow chart ${chartId}.`);
                    } else {
                        console.log(`Image generated and stored for cash flow chart ${chartId}.`);
                    }
                    // Force an update on the live chart after image generation to ensure
                    // it displays correctly if the background was temporarily changed.
                    try {
                        chartInstance.update('none'); // 'none' prevents re-animation
                        console.log(`Forced update on cash flow chart: ${chartId} after image generation.`);
                    } catch (e) {
                        console.error(`Error forcing update on cash flow chart ${chartId} after image generation:`, e);
                    }
                })
                .catch(err => {
                    console.error(`Unhandled error in generateChartImage promise for cash flow chart ${chartId}:`, err);
                    state.setChartImageDataUrl(chartId, null); // Ensure state reflects failure
                });
        }
        // *** END ADDED ***

    } catch (error) {
        console.error(`Error creating or processing data for cash flow chart (${chartId}):`, error);
        // Display error on canvas
        try {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.font = "12px Arial"; ctx.fillStyle = "#dc3545"; ctx.textAlign = "center";
            ctx.fillText("Error rendering cash flow chart.", ctx.canvas.width / 2, ctx.canvas.height / 2);
        } catch (e) { /* Ignore canvas errors during error display itself */ }
        destroyChart(chartId); // Clean up if instance creation failed partially
    }
}
