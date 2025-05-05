// export.js
// Handles exporting data to PDF and Excel (XLSX).

"use strict";

import { XLSX } from './config.js';
import * as state from './state.js';
// Removed PAGE_SIZE import as it wasn't used here
import { fetchAllFilteredHoldings } from './api.js'; // Still needed for Excel export
import { processHoldings, showStatusMessageGeneric } from './ui.js'; // Import processing and status functions

// --- DOM Element References ---
const portfolioNameEl = document.getElementById('portfolio-name');
const customerSelect = document.getElementById('customer-select'); // For filename
const portfolioFilterSelect = document.getElementById('portfolio-filter-select'); // For filename

// Helper function for a small delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/** Exports the current view (charts and ALL filtered holdings table) to a PDF document. */
export async function exportToPdf() {
    console.log("Executing exportToPdf function (Charts + All Holdings Table)...");
    showStatusMessageGeneric(document.body, "Preparing PDF generation...", false, 0); // Initial status

    // --- Library Checks ---
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        console.error("jsPDF library base or constructor not found.");
        alert("Error: PDF library (jsPDF) not loaded. Check script URL and network.");
        showStatusMessageGeneric(document.body, "", false, 1); return;
    }
    const jsPDF = window.jspdf.jsPDF;
    const autoTable = jsPDF.autoTable || jsPDF.API?.autoTable; // Check both locations
    if (typeof autoTable !== 'function') {
         console.error("jsPDF-AutoTable plugin function not found.");
         alert("Error: PDF AutoTable plugin not loaded correctly or is incompatible. Check script URL and version.");
         showStatusMessageGeneric(document.body, "", false, 1); return;
    }
    console.log("jsPDF and autoTable libraries seem loaded.");
    // --- End Library Checks ---


    // *** Keep inner setTimeout to defer heavy processing ***
    setTimeout(async () => {
        let pdfGeneratedSuccessfully = false; // Flag to track success before save
        try { // Wrap the entire PDF generation in a try...catch
            showStatusMessageGeneric(document.body, "Generating PDF...", false, 0); // Update status
            const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

            // PDF styles (use light theme for better printing/readability)
            const pdfHeaderBg = '#e9ecef';
            const pdfHeaderText = '#495057';
            const pdfTextColor = '#333333';
            const pdfBorderColor = '#dee2e6';
            const pdfRowBg = '#ffffff';
            const pdfAlternateRowBg = '#f8f9fa';

            const pageHeight = doc.internal.pageSize.getHeight();
            const pageWidth = doc.internal.pageSize.getWidth();
            const margin = 40;
            const usableWidth = pageWidth - (2 * margin);
            const usableHeight = pageHeight - (2 * margin);
            let currentY = margin;

            // --- Title ---
            console.log("Adding PDF Title...");
            doc.setFontSize(18);
            doc.setTextColor(51); // Standard dark text color
            const viewTitle = portfolioNameEl?.textContent || 'Portfolio Analysis';
            doc.text(`${viewTitle} - Analysis`, margin, currentY); // Title for first page (charts)
            currentY += 30;

            // --- Charts (From Current View - should be based on ALL filtered data) ---
            console.log("Attempting to add Charts to PDF from current state...");
            showStatusMessageGeneric(document.body, "Generating charts...", false, 0); // Update status
            doc.setFontSize(14);
            doc.setTextColor(70); // Standard dark text
            doc.text("Charts (Based on Current Filtered View)", margin, currentY);
            currentY += 20;

            const chartGap = 20;
            const chartWidth = (usableWidth - chartGap) / 2;
            // Adjusted height calculation to prevent excessive stretching
            const chartHeight = Math.min(180, (usableHeight - currentY - margin - 30) / 2); // Slightly increased max height
            const chartStartX1 = margin;
            const chartStartX2 = margin + chartWidth + chartGap;
            const chartStartY1 = currentY;
            const chartStartY2 = chartStartY1 + chartHeight + chartGap;

            const chartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart', 'priceVsYieldChart'];
            const chartImages = [];
            let chartBottomY = chartStartY1; // Track bottom of charts
            let chartErrorOccurred = false; // Flag to track if any chart failed

            // Add delay before generating chart images - might still be needed if rendering is slow
            console.log("Waiting briefly before generating chart images...");
            await delay(200); // Slightly increased delay

            for (const chartId of chartIds) {
                const chartInstance = state.getChartInstance(chartId); // Get from state
                let imageData = null; // Initialize imageData for this chart
                try {
                    // *** More Robust Check: Ensure instance, canvas, and context exist ***
                    if (chartInstance?.canvas?.getContext) {
                        const ctx = chartInstance.canvas.getContext('2d');
                        if (!ctx) {
                            throw new Error("Could not get 2D context from canvas.");
                        }
                        // Add white background specifically for PDF export
                        ctx.save();
                        ctx.globalCompositeOperation = 'destination-over';
                        ctx.fillStyle = 'white'; // Ensure background is white for PDF
                        ctx.fillRect(0, 0, chartInstance.width, chartInstance.height);
                        ctx.restore();

                        // Get image data AFTER adding background
                        imageData = chartInstance.toBase64Image('image/png', 1.0); // Use high quality PNG

                        if (!imageData || imageData === 'data:,') { // Check for empty data URL
                            throw new Error("Generated empty image data.");
                        }
                        chartImages.push(imageData);
                        console.log(`Successfully generated image for chart: ${chartId}`);
                    } else {
                        console.warn(`Chart instance or canvas/context not found/ready for ID: ${chartId}. Skipping chart in PDF.`);
                        chartImages.push(null); // Push null if chart isn't ready
                    }
                } catch (e) {
                    console.error(`Error generating base64 image for chart ${chartId}:`, e);
                    chartImages.push(null); // Add null placeholder on error
                    chartErrorOccurred = true; // Mark that an error happened
                }
            }
            console.log("Chart image generation loop complete.");
            if (chartErrorOccurred) {
                 alert("Warning: Could not generate image for one or more charts. PDF will be generated without them.");
            }


            // Add chart images to the PDF in a 2x2 grid, checking if image data exists
            try {
                if (chartImages[0]) { doc.addImage(chartImages[0], 'PNG', chartStartX1, chartStartY1, chartWidth, chartHeight); chartBottomY = Math.max(chartBottomY, chartStartY1 + chartHeight); }
                if (chartImages[1]) { doc.addImage(chartImages[1], 'PNG', chartStartX2, chartStartY1, chartWidth, chartHeight); chartBottomY = Math.max(chartBottomY, chartStartY1 + chartHeight); }
                if (chartImages[2]) { doc.addImage(chartImages[2], 'PNG', chartStartX1, chartStartY2, chartWidth, chartHeight); chartBottomY = Math.max(chartBottomY, chartStartY2 + chartHeight); }
                if (chartImages[3]) { doc.addImage(chartImages[3], 'PNG', chartStartX2, chartStartY2, chartWidth, chartHeight); chartBottomY = Math.max(chartBottomY, chartStartY2 + chartHeight); }
                 console.log("Finished adding available chart images to PDF.");
            } catch(addImageError) {
                console.error("Error during doc.addImage:", addImageError);
                alert(`Error adding chart image to PDF: ${addImageError.message}. PDF generation may be incomplete.`);
                chartErrorOccurred = true; // Mark error if adding fails
            }

            // --- Add Page Break for table ---
            console.log("Adding page break before table.");
            doc.addPage();
            currentY = margin; // Reset Y for new page


            // --- Fetch All Holdings Data (Still needed for the TABLE part of the PDF) ---
            console.log("Fetching all holdings data for PDF table...");
            showStatusMessageGeneric(document.body, "Fetching all holdings...", false, 0); // Update status
            let allHoldingsProcessed = []; // Initialize
            try {
                // *** Keep this fetch: It's for the TABLE data, not the charts ***
                const allHoldingsRaw = await fetchAllFilteredHoldings(); // Fetch all data for the table
                if (!allHoldingsRaw || allHoldingsRaw.length === 0) {
                    // If charts were added but no table data, still proceed but show message later
                    console.warn("No holdings data found matching the current filters for the PDF table.");
                    // Don't alert here yet, allow PDF with just charts if they exist
                } else {
                    // Process the fetched data for the table
                    allHoldingsProcessed = processHoldings(allHoldingsRaw);
                    console.log(`Processing complete for ${allHoldingsProcessed.length} holdings for PDF table.`);
                }
            } catch (fetchError) {
                 console.error("Failed to fetch all holdings for PDF table:", fetchError);
                 alert("Error fetching holdings data for PDF table. Export aborted.");
                 showStatusMessageGeneric(document.body, "Error fetching data for PDF.", true, 5000);
                 return; // Exit if fetch fails
            }
            showStatusMessageGeneric(document.body, "Generating table...", false, 0); // Update status


            // --- Holdings Table (ALL Filtered Holdings) ---
            console.log("Adding Holdings Table (All Filtered) to PDF...");
            // Add table title on the new page
            doc.setFontSize(14);
            doc.setTextColor(70); // Standard dark text
            doc.text("Holdings Table (All Filtered Results)", margin, currentY);
            currentY += 20;


            // Define headers for the table
            const head = [[
                "CUSIP", "Description", "Par", "Book Price", "Market Price", "Coupon",
                "Book Yield", "WAL", "Duration", "Maturity Date", "Call Date", "Intention"
            ]];

            // Map the processed data to the body array format required by autoTable
            const body = allHoldingsProcessed.map(h => [
                h.security_cusip ?? 'N/A',
                h.security_description ?? '',
                (h.par_value_num ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                (h.book_price_num ?? 0).toFixed(6),
                (h.market_price_num ?? 0).toFixed(6),
                (h.coupon_num ?? 0).toFixed(3),
                (h.book_yield_num ?? 0).toFixed(3),
                (h.holding_average_life_num ?? 0).toFixed(2), // WAL
                (h.holding_duration_num ?? 0).toFixed(2),
                h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : 'N/A',
                h.call_date_obj ? h.call_date_obj.toLocaleDateString() : 'N/A',
                h.intention_code ?? 'N/A' // Assuming intention_code is processed correctly in processHoldings
            ]);

            if (body.length === 0) {
                 console.warn("No data rows to add to the PDF table after processing.");
                 // Don't alert if charts might exist, just add text to PDF
                 doc.setFontSize(10);
                 doc.setTextColor(150);
                 doc.text("No holdings data available for the table.", margin, currentY + 15);
            } else {
                // Use the autoTable function directly
                doc.autoTable({
                    head: head,
                    body: body,
                    startY: currentY, // Start table below title on the new page
                    theme: 'grid',
                    styles: {
                        fontSize: 7,
                        cellPadding: 3,
                        overflow: 'linebreak',
                        textColor: pdfTextColor, // Use standard text color
                        lineColor: pdfBorderColor,
                        lineWidth: 0.5
                    },
                    headStyles: {
                        fillColor: pdfHeaderBg, // Use light header bg
                        textColor: pdfHeaderText, // Use standard header text
                        fontStyle: 'bold',
                        halign: 'center',
                        lineColor: pdfBorderColor,
                        lineWidth: 0.5,
                    },
                    bodyStyles: {
                        fillColor: pdfRowBg, // White background
                        textColor: pdfTextColor,
                        lineColor: pdfBorderColor,
                        lineWidth: 0.5,
                    },
                    alternateRowStyles: {
                        fillColor: pdfAlternateRowBg // Light alternate
                    },
                    columnStyles: { // Adjust column indices as needed (0-based)
                        0: { cellWidth: 55, halign: 'left' },    // CUSIP
                        1: { cellWidth: 'auto', halign: 'left'}, // Description
                        2: { cellWidth: 60, halign: 'right' },   // Par
                        3: { cellWidth: 45, halign: 'right' },   // Book Price
                        4: { cellWidth: 45, halign: 'right' },   // Mkt Price
                        5: { cellWidth: 40, halign: 'right' },   // Coupon
                        6: { cellWidth: 40, halign: 'right' },   // Book Yield
                        7: { cellWidth: 40, halign: 'right' },   // WAL
                        8: { cellWidth: 40, halign: 'right' },   // Duration
                        9: { cellWidth: 55, halign: 'center' },  // Maturity Date
                        10: { cellWidth: 55, halign: 'center' }, // Call Date
                        11: { cellWidth: 40, halign: 'center' }  // Intention
                    },
                    margin: { left: margin, right: margin },
                    didDrawPage: function (data) {
                        // Add page numbers in the footer of every page
                        let footerStr = "Page " + doc.internal.getCurrentPageInfo().pageNumber;
                        doc.setFontSize(8);
                        doc.setTextColor(100); // Standard dim text color
                        doc.text(footerStr, data.settings.margin.left, pageHeight - 15, { baseline: 'bottom' });
                    }
                });
                console.log("Holdings table added via autoTable using all filtered data.");
            }
            // Mark PDF as generated if we reached this point without critical errors (like fetch failure)
            pdfGeneratedSuccessfully = true;


            // --- Save the PDF ---
            if (pdfGeneratedSuccessfully) {
                console.log("Saving PDF...");
                showStatusMessageGeneric(document.body, "Saving PDF...", false, 0); // Update status
                // Keep the small delay before save just in case
                await delay(50); // Use await with delay helper
                try {
                    const selectedCustomerOption = customerSelect?.options[customerSelect.selectedIndex];
                    const selectedPortfolioOption = portfolioFilterSelect?.options[portfolioFilterSelect.selectedIndex];
                    let baseFilename = 'export';
                    if (selectedPortfolioOption && selectedPortfolioOption.value !== "") {
                        baseFilename = selectedPortfolioOption.text.split('(')[0].trim();
                    } else if (selectedCustomerOption && selectedCustomerOption.value !== "") {
                         baseFilename = selectedCustomerOption.text.split('(')[0].trim();
                    }
                    const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    // Update filename to reflect all holdings
                    doc.save(`portfolio_${safeFilename}_all_holdings.pdf`);
                    console.log("PDF export process finished.");
                    showStatusMessageGeneric(document.body, "PDF Export Complete!", false, 3000); // Success message
                } catch(saveError) {
                     console.error("Error during PDF save:", saveError);
                     alert("An error occurred while saving the PDF. Check console.");
                     showStatusMessageGeneric(document.body, "PDF Save Failed.", true, 5000); // Error message
                }
            } else {
                 console.warn("Skipping PDF save because generation failed or had issues.");
                 // Don't show a failure message if it might have partially succeeded (e.g., charts failed but table generated)
                 // showStatusMessageGeneric(document.body, "PDF Generation Failed.", true, 5000);
            }


        } catch (error) {
            console.error("Error during PDF export generation:", error);
            alert("An error occurred during PDF export generation. Please check the console.");
            showStatusMessageGeneric(document.body, "PDF Generation Failed.", true, 5000); // Error message
        } finally {
             // Ensure status message is cleared eventually
             setTimeout(() => showStatusMessageGeneric(document.body, "", false, 1), 3500);
        }
    }, 0); // End of main setTimeout(..., 0)
}

/** Exports ALL filtered holdings data to an XLSX file. */
export async function exportToXlsx() {
    console.log("Executing exportToXlsx for ALL filtered holdings...");
    showStatusMessageGeneric(document.body, "Preparing Excel export...", false, 0);

    const XLSX = window.XLSX; // Access from global scope
    if (typeof XLSX === 'undefined') {
        console.error("SheetJS library (XLSX) not loaded.");
        alert("Error: Excel export library not loaded. Please check the console.");
        showStatusMessageGeneric(document.body, "", false, 1); // Clear status
        return;
    }

    let holdingsToExport = [];
    try {
        showStatusMessageGeneric(document.body, "Fetching all holdings for Excel...", false, 0);
        holdingsToExport = await fetchAllFilteredHoldings(); // Fetch all data
    } catch (error) {
        console.error("Failed to fetch all holdings for Excel export:", error);
        alert("Error fetching data for Excel export. Please check the console.");
        showStatusMessageGeneric(document.body, "Error fetching data for Excel.", true, 5000);
        return; // Exit if fetch fails
    }


    if (!holdingsToExport || holdingsToExport.length === 0) {
        alert("No holdings data found matching the current filters to export.");
        showStatusMessageGeneric(document.body, "", false, 1); // Clear status
        return;
    }

    showStatusMessageGeneric(document.body, "Processing data for Excel...", false, 0);
    // Process the fetched data
    const processedHoldings = processHoldings(holdingsToExport);
    console.log(`Processing complete for ${processedHoldings.length} holdings for Excel export.`);

    const headers = [
        "CUSIP", "Description", "Par", "Book Price", "Market Price", "Coupon",
        "Book Yield", "WAL", "Duration", "Maturity Date", "Call Date", "Intention"
    ];

    // Map processed data for Excel
    const data = processedHoldings.map(h => [
        h.security_cusip || '', h.security_description || '',
        h.par_value_num ?? null, h.book_price_num ?? null, h.market_price_num ?? null,
        h.coupon_num ?? null, h.book_yield_num ?? null, h.holding_average_life_num ?? null, // WAL
        h.holding_duration_num ?? null, h.maturity_date_str_iso || '', h.call_date_str_iso || '',
        h.intention_code || '' // Use processed intention code
    ]);

    const sheetData = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Define column widths (adjust as needed)
    ws['!cols'] = [
        { wch: 12 }, { wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }
    ];

    // Apply number formatting
    const numberCols = [2, 3, 4, 5, 6, 7, 8]; // 0-based indices: Par, Book Price, Mkt Price, Coupon, Book Yield, WAL, Duration
    const precision6Cols = [3, 4]; // Book Price, Mkt Price
    const precision3Cols = [5, 6]; // Coupon, Book Yield
    const precision2Cols = [2, 7, 8]; // Par, WAL, Duration

    for (let R = 1; R < sheetData.length; ++R) { // Start from row 1 (data rows)
        numberCols.forEach(C => {
            const cell_address = { c: C, r: R };
            const cell_ref = XLSX.utils.encode_cell(cell_address);
            if (ws[cell_ref] && typeof ws[cell_ref].v === 'number') {
                ws[cell_ref].t = 'n'; // Ensure type is number
                // Apply specific formatting based on column index
                if (precision6Cols.includes(C)) ws[cell_ref].z = '#,##0.000000';
                else if (precision3Cols.includes(C)) ws[cell_ref].z = '#,##0.000';
                else if (precision2Cols.includes(C)) ws[cell_ref].z = '#,##0.00';
                else ws[cell_ref].z = '#,##0.######'; // Default for other numbers
            }
        });
        // Format date columns (Maturity Date, Call Date)
        [9, 10].forEach(C => {
             const cell_address = { c: C, r: R };
             const cell_ref = XLSX.utils.encode_cell(cell_address);
             if (ws[cell_ref] && ws[cell_ref].v) {
                 // Check if it's a string that looks like YYYY-MM-DD
                 if (typeof ws[cell_ref].v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ws[cell_ref].v)) {
                     // Convert string to Date object for Excel if needed, or just set type 'd' and format 'yyyy-mm-dd'
                     // Let's try converting to date object for better Excel compatibility
                     const dateObj = new Date(ws[cell_ref].v + 'T00:00:00Z'); // Parse as UTC
                     if (!isNaN(dateObj.getTime())) {
                         ws[cell_ref].v = dateObj; // Replace string with Date object
                         ws[cell_ref].t = 'd'; // Mark as date type
                         ws[cell_ref].z = 'yyyy-mm-dd'; // Apply format
                     } else {
                         // If conversion fails, keep as string
                         ws[cell_ref].t = 's';
                     }
                 } else if (ws[cell_ref].v instanceof Date) {
                     ws[cell_ref].t = 'd'; // Mark as date type
                     ws[cell_ref].z = 'yyyy-mm-dd';
                 }
             }
        });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Holdings (Filtered)"); // Update sheet name

    // Generate filename
    const selectedCustomerOption = customerSelect?.options[customerSelect.selectedIndex];
    const selectedPortfolioOption = portfolioFilterSelect?.options[portfolioFilterSelect.selectedIndex];
    let baseFilename = 'holdings_export';
    if (selectedPortfolioOption && selectedPortfolioOption.value !== "") {
        baseFilename = selectedPortfolioOption.text.split('(')[0].trim();
    } else if (selectedCustomerOption && selectedCustomerOption.value !== "") {
         baseFilename = selectedCustomerOption.text.split('(')[0].trim();
    }
    const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    // Update filename to reflect all filtered data
    const filename = `portfolio_${safeFilename}_all_filtered.xlsx`;

    try {
        showStatusMessageGeneric(document.body, "Generating Excel file...", false, 0);
        await delay(50); // Brief delay before write/save
        XLSX.writeFile(wb, filename);
        console.log(`XLSX export triggered: ${filename}`);
        showStatusMessageGeneric(document.body, "Excel Export Complete!", false, 3000);
    } catch (error) {
        console.error("Error exporting to XLSX:", error);
        alert("An error occurred while exporting to Excel. Please check the console.");
        showStatusMessageGeneric(document.body, "Excel Export Failed.", true, 5000);
    } finally {
        // Ensure status message is cleared eventually
        setTimeout(() => showStatusMessageGeneric(document.body, "", false, 1), 3500);
    }
}
