// charts.js
// Handles rendering and management of Chart.js charts.

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
    // Retrieve the chart instance from the application state
    const instance = state.getChartInstance(chartId);
    // Check if the instance exists and has a 'destroy' method
    if (instance?.destroy) {
        try {
            // Attempt to destroy the Chart.js instance
            instance.destroy();
            // console.log(`[destroyChart] Destroyed chart: ${chartId}`); // Less verbose
        } catch (e) {
            // Log any errors during destruction
            console.error(`[destroyChart] Error destroying chart ${chartId}:`, e);
        } finally {
            // Always remove the instance reference and its image data from the state,
            // regardless of whether destruction succeeded or failed.
            state.deleteChartInstance(chartId);
        }
    } else {
        // If instance doesn't exist or lacks 'destroy', ensure state is still cleaned up.
        // console.log(`[destroyChart] Instance not found or already destroyed for ${chartId}`);
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
    // Initial check: Ensure instance and its canvas property exist upon function call
    if (!chartInstance || !chartInstance.canvas) {
        console.warn(`[generateChartImage] Initial check failed: Instance or canvas property missing for ${chartId}.`);
        return null;
    }

    // Add a delay to allow rendering updates to complete before capturing the image
    await delay(200); // 200ms delay

    // Re-check after delay: Get the potentially updated instance from state and verify canvas
    const currentInstance = state.getChartInstance(chartId);
    if (!currentInstance || !currentInstance.canvas) {
        console.warn(`[generateChartImage] Check after delay failed: Instance destroyed or canvas missing for ${chartId}.`);
        return null;
    }

    const canvasEl = currentInstance.canvas;

    // Defensive Check: Ensure canvas has valid dimensions (width and height > 0)
    if (canvasEl.width === 0 || canvasEl.height === 0) {
         console.warn(`[generateChartImage] Canvas for ${chartId} has zero dimensions after delay.`);
         // Attempt to force a resize and re-render as a recovery mechanism
         try {
             currentInstance.resize(); // Trigger chart resize
             await delay(100); // Allow time for resize to potentially take effect
             // Check dimensions again after resize attempt
             if (canvasEl.width === 0 || canvasEl.height === 0) {
                 console.error(`[generateChartImage] Canvas for ${chartId} still has zero dimensions after resize attempt.`);
                 return null; // Give up if resize didn't help
             }
             // console.log(`[generateChartImage] Canvas dimensions for ${chartId} valid after resize.`);
         } catch (resizeError) {
              console.error(`[generateChartImage] Error during chart resize attempt for ${chartId}:`, resizeError);
              return null; // Return null if resize fails
         }
    }

    try {
        // Get the 2D rendering context for the canvas
        const ctx = canvasEl.getContext('2d');
        if (!ctx) {
            console.error(`[generateChartImage] Could not get 2D context for ${chartId} canvas.`);
            return null;
        }

        // Draw a white background behind the chart content for PDF export clarity
        ctx.save(); // Save current context state
        ctx.globalCompositeOperation = 'destination-over'; // Draw behind existing content
        ctx.fillStyle = 'white'; // Set fill color to white
        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height); // Fill the entire canvas
        ctx.restore(); // Restore original context state

        // Generate the base64 image data URL from the chart instance
        const imageDataUrl = currentInstance.toBase64Image('image/png', 1.0); // PNG format, max quality

        // Validate the generated data URL to ensure it's not empty or invalid
        if (!imageDataUrl || imageDataUrl === 'data:,') {
            console.warn(`[generateChartImage] Generated empty or invalid image data for ${chartId}.`);
            return null;
        }
        // console.log(`[generateChartImage] Successfully generated image for ${chartId}.`);
        return imageDataUrl; // Return the valid data URL

    } catch (error) {
        // Catch any errors during canvas operations (getContext, fillRect, toBase64Image)
        console.error(`[generateChartImage] Error during canvas operations for ${chartId}:`, error);
        if (error instanceof TypeError && error.message.includes("reading 'width'")) {
             console.error(`>>> Specific TypeError caught for ${chartId}, canvas element might be invalid or detached.`);
        }
        return null; // Return null on error
    }
}


/**
 * Renders the standard portfolio analysis charts (Yield/Life, Par/Maturity, Coupon Dist).
 * This function NO LONGER renders the Price/Yield chart.
 * @param {Array} holdingsDataForCharts - The array of processed holding objects (full dataset).
 */
export async function renderCharts(holdingsDataForCharts) {
    console.log(`Rendering standard charts with ${holdingsDataForCharts?.length ?? 0} holdings.`);

    // Define the IDs for the standard charts this function handles
    const standardChartIds = [
        'yieldVsMaturityChart',
        'parByMaturityYearChart',
        'couponPieChart'
    ];

    // Destroy only the standard charts managed by this function
    standardChartIds.forEach(destroyChart);

    // Check if Chart.js library is loaded
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js library not loaded. Skipping chart rendering.");
        return;
    }

    // Get canvas contexts for the remaining standard charts
    const contexts = {
        yieldVsMaturityChart: document.getElementById('yieldVsMaturityChart')?.getContext('2d'),
        parByMaturityYearChart: document.getElementById('parByMaturityYearChart')?.getContext('2d'),
        couponPieChart: document.getElementById('couponPieChart')?.getContext('2d'),
    };

    // Check if all required contexts are available
    const allContextsValid = Object.values(contexts).every(ctx => ctx);
    if (!allContextsValid) {
        console.error("One or more standard chart canvas elements or contexts not found.");
        standardChartIds.forEach(id => state.deleteChartInstance(id)); // Clean state
        return;
    }

    // If no data provided, exit early
    if (!holdingsDataForCharts || holdingsDataForCharts.length === 0) {
        console.log("No data provided to renderCharts. Standard charts will be empty.");
        return;
    }

    // Determine theme-based colors
    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
    const labelColor = isDark ? '#aaa' : '#666';
    const titleColor = isDark ? '#4dabf7' : '#0056b3'; // Blue title
    const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)';
    const tooltipColor = isDark ? '#f1f1f1' : '#fff';
    // *** CSS Note: Chart background color should be handled by CSS rules ***
    // Example:
    // .chart-container { background-color: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    // body.dark-mode .chart-container { background-color: #2d3748; box-shadow: 0 2px 4px rgba(0,0,0,0.4); }

    // Base configuration options (shared across charts)
    const baseChartOptionsStatic = {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
            legend: { labels: { color: labelColor } },
            title: { color: titleColor, display: true, font: { size: 14 } },
            tooltip: { backgroundColor: tooltipBgColor, titleColor: tooltipColor, bodyColor: tooltipColor, footerColor: tooltipColor }
        },
        scales: {
            x: { ticks: { color: labelColor }, grid: { color: gridColor, borderColor: gridColor }, title: { color: labelColor, display: true } },
            y: { ticks: { color: labelColor }, grid: { color: gridColor, borderColor: gridColor }, title: { color: labelColor, display: true } }
        },
    };

    // Array to hold promises for image generation
    const imageGenerationPromises = [];
    // Array to track successfully created instances in this run
    const chartInstancesToGenerate = [];

    try {
        // --- 1. Book Yield vs. Holding Average Life (Scatter Plot) ---
        const yieldLifePoints = holdingsDataForCharts
            .filter(h => h.holding_average_life_num !== null && h.book_yield_num !== null)
            .map(h => ({ x: h.holding_average_life_num, y: h.book_yield_num }));

        if (yieldLifePoints.length > 0 && contexts.yieldVsMaturityChart) {
            const chartId = 'yieldVsMaturityChart';
            const options1 = structuredClone(baseChartOptionsStatic);
            options1.plugins.title.text = 'Book Yield vs. Holding Avg Life (All Filtered)';
            options1.scales.x.type = 'linear'; options1.scales.x.position = 'bottom';
            options1.scales.x.title.text = 'Holding Average Life (Years)';
            options1.scales.y.beginAtZero = false; options1.scales.y.title.text = 'Book Yield (%)';
            options1.plugins.tooltip.callbacks = { label: ctx => `Avg Life: ${ctx.parsed.x.toFixed(2)}, Yield: ${ctx.parsed.y.toFixed(3)}` };
            const dataset1 = { label: 'Book Yield vs Avg Life', data: yieldLifePoints, backgroundColor: isDark ? 'rgba(66, 135, 245, 0.7)' : 'rgba(0, 123, 255, 0.5)', borderColor: isDark ? 'rgba(86, 155, 255, 1)' : 'rgba(0, 123, 255, 1)', pointRadius: 5, pointHoverRadius: 7, showLine: false };
            if (window.pluginTrendlineLinear && Chart.registry.plugins.get('pluginTrendlineLinear')) {
                dataset1.trendlineLinear = { style: isDark ? "rgba(255, 80, 80, 0.9)" : "rgba(255, 50, 50, 0.8)", lineStyle: "solid", width: 2, projection: false };
            } else { console.warn("Trendline plugin not registered, skipping trendline for yieldVsMaturityChart."); }
            const chartInstance = new Chart(contexts.yieldVsMaturityChart, { type: 'scatter', data: { datasets: [dataset1] }, options: options1 });
            state.setChartInstance(chartId, chartInstance);
            chartInstancesToGenerate.push({ id: chartId, instance: chartInstance });
        }

        // --- 2. Total Par by Maturity Year (Bar Chart) ---
        const maturityBuckets = {};
        holdingsDataForCharts.forEach(h => {
            const year = h.maturity_date_obj ? h.maturity_date_obj.getFullYear() : 'Unknown';
            if (year !== 'Unknown' && !isNaN(year)) { maturityBuckets[year] = (maturityBuckets[year] || 0) + (h.par_value_num ?? 0); }
        });
        const sortedYears = Object.keys(maturityBuckets).map(Number).sort((a, b) => a - b);
        if (sortedYears.length > 0 && contexts.parByMaturityYearChart) {
            const chartId = 'parByMaturityYearChart';
            const options2 = structuredClone(baseChartOptionsStatic);
            options2.plugins.title.text = 'Total Par by Maturity Year (All Filtered)';
            options2.scales.x.title.text = 'Maturity Year';
            options2.scales.y.beginAtZero = true; options2.scales.y.title.text = 'Total Par Value';
            options2.scales.y.ticks = { ...options2.scales.y.ticks, callback: value => value.toLocaleString() };
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
            const pieColors = generateDistinctColors(sortedCoupons.length);
            const options3 = structuredClone(baseChartOptionsStatic);
            delete options3.scales; options3.plugins.title.text = 'Par Distribution by Coupon Rate (All Filtered)';
            options3.plugins.title.align = 'center'; options3.plugins.legend.position = 'bottom';
            options3.plugins.tooltip.callbacks = { label: ctx => { const label = ctx.label || ''; const value = ctx.parsed || 0; const total = ctx.dataset.data.reduce((acc, val) => acc + val, 0); const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0; return `${label}: ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`; } };
            const chartInstance = new Chart(contexts.couponPieChart, { type: 'pie', data: { labels: sortedCoupons.map(c => `${c}% Coupon`), datasets: [{ label: 'Par by Coupon Rate', data: sortedCoupons.map(c => couponBuckets[c]), backgroundColor: pieColors, hoverOffset: 4 }] }, options: options3, });
            state.setChartInstance(chartId, chartInstance);
            chartInstancesToGenerate.push({ id: chartId, instance: chartInstance });
        }

        // --- Generate Images for Created Charts ---
        console.log(`Starting image generation for ${chartInstancesToGenerate.length} standard charts...`);
        for (const chartInfo of chartInstancesToGenerate) {
            const promise = generateChartImage(chartInfo.instance, chartInfo.id)
                .then(url => { state.setChartImageDataUrl(chartInfo.id, url || null); if (!url) console.warn(`Failed to generate image for ${chartInfo.id}.`); })
                .catch(err => { console.error(`Unhandled error in generateChartImage promise for ${chartInfo.id}:`, err); state.setChartImageDataUrl(chartInfo.id, null); });
            imageGenerationPromises.push(promise);
        }
        await Promise.allSettled(imageGenerationPromises);
        console.log("Finished attempting to generate and store standard chart images.");

    } catch (chartCreationError) {
        console.error("Error during standard chart creation phase:", chartCreationError);
        chartInstancesToGenerate.forEach(info => destroyChart(info.id)); // Cleanup
    }
}


/**
 * Renders the aggregated portfolio cash flow chart, aggregated by YEAR.
 * @param {string} chartId - The canvas element ID ('portfolioCashFlowChart').
 * @param {Array} cashFlowData - Array of aggregated cash flow objects (per date) from the API.
 */
export function renderPortfolioCashFlowChart(chartId, cashFlowData) {
    console.log(`Rendering yearly aggregated cash flow chart (${chartId}) from ${cashFlowData?.length ?? 0} data points.`);

    // Destroy existing chart instance first
    destroyChart(chartId);

    const ctx = document.getElementById(chartId)?.getContext('2d');
    if (!ctx) {
        console.error(`Canvas context not found for chart ID: ${chartId}`);
        return;
    }

    // Check Chart.js library dependency
    if (typeof Chart === 'undefined') {
         console.error("Chart.js library not loaded. Cannot render cash flow chart.");
         ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
         ctx.font = "12px Arial"; ctx.fillStyle = "#dc3545"; ctx.textAlign = "center";
         ctx.fillText("Chart.js library missing.", ctx.canvas.width / 2, ctx.canvas.height / 2);
         return;
    }

    // Handle empty data case
    if (!cashFlowData || cashFlowData.length === 0) {
        console.log("No data provided for cash flow chart.");
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = "12px Arial";
        ctx.fillStyle = document.body.classList.contains('dark-mode') ? '#aaa' : '#666';
        ctx.textAlign = "center";
        ctx.fillText("No cash flow data available for this portfolio.", ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }

    // --- Process and Aggregate Data by Year ---
    const yearlyFlows = {}; // Object to store aggregated flows { 'year': { interest: x, principal: y } }
    try {
        cashFlowData.forEach(cf => {
            const dateObj = parseDate(cf.date); // Use utility function to parse date string
            if (!dateObj) {
                console.warn(`Could not parse date: ${cf.date}`);
                return; // Skip this entry if date is invalid
            }
            const year = dateObj.getFullYear();

            // Initialize year if it doesn't exist
            if (!yearlyFlows[year]) {
                yearlyFlows[year] = { total_interest: 0, total_principal: 0 };
            }

            // Add amounts (safely parse strings)
            yearlyFlows[year].total_interest += parseFloatSafe(cf.total_interest) ?? 0;
            yearlyFlows[year].total_principal += parseFloatSafe(cf.total_principal) ?? 0;
        });

        // Get sorted years (as strings or numbers)
        const sortedYears = Object.keys(yearlyFlows).map(Number).sort((a, b) => a - b);

        if (sortedYears.length === 0) {
             console.log("No valid yearly cash flow data after aggregation.");
             // Display message if aggregation results in no data
             ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
             ctx.font = "12px Arial"; ctx.fillStyle = document.body.classList.contains('dark-mode') ? '#aaa' : '#666';
             ctx.textAlign = "center";
             ctx.fillText("No yearly cash flow data to display.", ctx.canvas.width / 2, ctx.canvas.height / 2);
             return;
        }

        // Prepare data arrays for the chart
        const labels = sortedYears.map(String); // Use years as labels
        const interestData = sortedYears.map(year => yearlyFlows[year].total_interest);
        const principalData = sortedYears.map(year => yearlyFlows[year].total_principal);

        // --- Configure Chart ---
        const isDark = document.body.classList.contains('dark-mode');
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
        const labelColor = isDark ? '#aaa' : '#666';
        const titleColor = isDark ? '#20c997' : '#17a2b8'; // Teal/Cyan title
        const tooltipBgColor = isDark ? 'rgba(50, 50, 50, 0.9)' : 'rgba(0, 0, 0, 0.8)';
        const tooltipColor = isDark ? '#f1f1f1' : '#fff';
        const interestColor = isDark ? 'rgba(40, 167, 69, 0.85)' : 'rgba(40, 167, 69, 0.7)'; // Green
        const principalColor = isDark ? 'rgba(66, 135, 245, 0.85)' : 'rgba(0, 123, 255, 0.7)'; // Blue
        // *** CSS Note: Chart background color should be handled by CSS ***

        const options = {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: {
                title: { display: true, text: 'Aggregated Yearly Cash Flow (Interest & Principal)', color: titleColor, font: { size: 14 } }, // Updated Title
                legend: { position: 'top', labels: { color: labelColor } },
                tooltip: {
                    backgroundColor: tooltipBgColor, titleColor: tooltipColor, bodyColor: tooltipColor, footerColor: tooltipColor,
                    mode: 'index', intersect: false,
                    callbacks: {
                        label: function(context) {
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
                    // *** MODIFIED: Use 'category' scale for years ***
                    type: 'category',
                    title: { display: true, text: 'Year', color: labelColor },
                    ticks: { color: labelColor },
                    grid: { display: false },
                    stacked: true,
                },
                y: {
                    title: { display: true, text: 'Total Amount ($)', color: labelColor }, // Updated Title
                    ticks: {
                        color: labelColor,
                        callback: function(value) {
                            if (value === 0) return '$0';
                            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', compactDisplay: 'short' }).format(value);
                        }
                    },
                    grid: { color: gridColor, borderColor: gridColor },
                    stacked: true,
                    beginAtZero: true
                }
            }
        };

        // --- Create Chart Instance ---
        const chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels, // Years
                datasets: [
                    { label: 'Interest', data: interestData, backgroundColor: interestColor },
                    { label: 'Principal', data: principalData, backgroundColor: principalColor }
                ]
            },
            options: options,
        });

        // Store the new chart instance in the application state
        state.setChartInstance(chartId, chartInstance);
        console.log(`Successfully rendered yearly aggregated cash flow chart: ${chartId}`);

    } catch (error) {
        console.error(`Error creating or processing data for cash flow chart (${chartId}):`, error);
        // Attempt to display an error message on the canvas
        try {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.font = "12px Arial"; ctx.fillStyle = "#dc3545"; ctx.textAlign = "center";
            ctx.fillText("Error rendering cash flow chart.", ctx.canvas.width / 2, ctx.canvas.height / 2);
        } catch (e) { /* Ignore canvas errors during error display */ }
        // Ensure state is clean even if rendering failed
        destroyChart(chartId);
    }
}
