// export.js
// Handles exporting data to PDF and Excel (XLSX).

"use strict";

import { XLSX } from './config.js';
import * as state from './state.js';
import { fetchAllFilteredHoldings } from './api.js'; // Still needed for Excel export
import { processHoldings, showStatusMessageGeneric } from './ui.js'; // Import processing and status functions

// --- DOM Element References ---
const portfolioNameEl = document.getElementById('portfolio-name');
const customerSelect = document.getElementById('customer-select'); // For filename
const portfolioFilterSelect = document.getElementById('portfolio-filter-select'); // For filename
const exportPdfBtn = document.getElementById('export-pdf-btn');
const exportExcelBtn = document.getElementById('export-excel-btn');
// *** REMOVED: statusArea = document.body ***
// We will use a more targeted approach or rely on console/button state.
// If a dedicated status element exists (e.g., <div id="export-status"></div>), use it:
// const exportStatusElement = document.getElementById('export-status');

// Helper function for a small delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Updates the export status (console log, button state).
 * Optionally updates a dedicated status element if available.
 * @param {string} message - The message to display/log.
 * @param {boolean} isError - Whether the message indicates an error.
 * @param {boolean} disableButtons - Whether to disable export buttons.
 */
function updateExportStatus(message, isError, disableButtons) {
    // Log status to console
    console.log(`Export Status: ${message} (Error: ${isError})`);

    // Update button state
    if (exportPdfBtn) exportPdfBtn.disabled = disableButtons;
    if (exportExcelBtn) exportExcelBtn.disabled = disableButtons;

    // --- Optional: Update a dedicated status element ---
    // Uncomment and adapt if you have an element like <div id="export-status"></div> in index.html
    /*
    const exportStatusElement = document.getElementById('export-status');
    if (exportStatusElement) {
        exportStatusElement.textContent = message;
        exportStatusElement.className = 'export-status-message'; // Base class
        if (message) {
            exportStatusElement.classList.add(isError ? 'error' : 'success');
            exportStatusElement.style.display = 'block';
        } else {
            exportStatusElement.style.display = 'none'; // Hide if message is empty
        }
    }
    */
   // --- End Optional ---

   // If showing a final success/error message briefly, use alert or a temporary overlay
   // For now, we rely on console logs and button state changes primarily.
   // A final alert can be added for completion if desired.

}

/** Exports the current view (charts and ALL filtered holdings table) to a PDF document. */
export async function exportToPdf(event) {
    if (event) event.preventDefault();
    console.log("Initiating exportToPdf function...");

    // Disable buttons immediately and show initial status
    updateExportStatus("Preparing PDF generation...", false, true);

    // Minimal delay to allow UI update (button disabling)
    await delay(50);

    let pdfGeneratedSuccessfully = false;
    let chartErrorOccurred = false;

    try {
        // --- Library Checks ---
        updateExportStatus("Checking PDF libraries...", false, true);
        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            throw new Error("PDF library (jsPDF) not loaded.");
        }
        const jsPDF = window.jspdf.jsPDF;
        const docForCheck = new jsPDF();
        if (typeof docForCheck.autoTable !== 'function') {
            throw new Error("PDF AutoTable plugin not loaded correctly.");
        }
        console.log("jsPDF and autoTable libraries loaded.");
        // --- End Library Checks ---

        updateExportStatus("Initializing PDF document...", false, true);
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

        // PDF styles
        const pdfHeaderBg = '#e9ecef'; const pdfHeaderText = '#495057';
        const pdfTextColor = '#333333'; const pdfBorderColor = '#dee2e6';
        const pdfRowBg = '#ffffff'; const pdfAlternateRowBg = '#f8f9fa';

        const pageHeight = doc.internal.pageSize.getHeight();
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 40;
        const usableWidth = pageWidth - (2 * margin);
        let currentY = margin;

        // --- Title ---
        console.log("Adding PDF Title...");
        doc.setFontSize(18); doc.setTextColor(51);
        const viewTitle = portfolioNameEl?.textContent || 'Portfolio Analysis';
        doc.text(`${viewTitle} - Analysis`, margin, currentY);
        currentY += 30;

        // --- Charts ---
        updateExportStatus("Adding charts to PDF...", false, true);
        console.log("Attempting to add Charts from stored state...");
        doc.setFontSize(14); doc.setTextColor(70);
        doc.text("Charts (Based on Current Filtered View)", margin, currentY);
        currentY += 20;

        const chartGap = 20;
        const chartWidth = (usableWidth - chartGap) / 2;
        const chartHeight = Math.max(100, Math.min(180, (pageHeight - currentY - margin - 30) / 2));
        const chartStartX1 = margin;
        const chartStartX2 = margin + chartWidth + chartGap;
        const chartStartY1 = currentY;
        const chartStartY2 = chartStartY1 + chartHeight + chartGap;
        const chartIds = ['yieldVsMaturityChart', 'parByMaturityYearChart', 'couponPieChart', 'priceVsYieldChart'];
        let chartBottomY = chartStartY1;

        console.log("Adding stored chart images to PDF...");
        for (let i = 0; i < chartIds.length; i++) {
            const chartId = chartIds[i];
            const imgDataUrl = state.getChartImageDataUrl(chartId);
            let x, y;
            if (i === 0) { x = chartStartX1; y = chartStartY1; }
            else if (i === 1) { x = chartStartX2; y = chartStartY1; }
            else if (i === 2) { x = chartStartX1; y = chartStartY2; }
            else { x = chartStartX2; y = chartStartY2; }

            if (imgDataUrl && imgDataUrl.startsWith('data:image/png')) {
                try {
                    console.log(`Adding chart ${i + 1} (${chartId})...`);
                    doc.addImage(imgDataUrl, 'PNG', x, y, chartWidth, chartHeight);
                    chartBottomY = Math.max(chartBottomY, y + chartHeight);
                } catch (addImageError) {
                    console.error(`Error adding image for chart ${chartId}:`, addImageError);
                    chartErrorOccurred = true;
                }
            } else {
                console.warn(`Skipping chart ${chartId} (no valid image data found).`);
                chartErrorOccurred = true;
                doc.setDrawColor(200); doc.setLineWidth(0.5);
                doc.rect(x, y, chartWidth, chartHeight);
                doc.setFontSize(9); doc.setTextColor(150);
                doc.text(`Chart data unavailable`, x + chartWidth / 2, y + chartHeight / 2, { align: 'center', baseline: 'middle' });
                chartBottomY = Math.max(chartBottomY, y + chartHeight);
            }
        }
        console.log("Finished adding available chart images to PDF.");
        currentY = chartBottomY + 30;

        // --- Add Page Break for table ---
        console.log("Adding page break before table.");
        doc.addPage();
        currentY = margin;

        // --- Fetch All Holdings Data for Table ---
        updateExportStatus("Fetching all holdings data...", false, true);
        let allHoldingsProcessed = [];
        let allHoldingsRaw = [];
        try {
            allHoldingsRaw = await fetchAllFilteredHoldings();
        } catch (fetchError) {
            console.error("Failed to fetch all holdings for PDF:", fetchError);
            throw new Error("Could not retrieve holdings data for the PDF table.");
        }

        if (!allHoldingsRaw || allHoldingsRaw.length === 0) {
            console.warn("No holdings data found for the PDF table.");
        } else {
            updateExportStatus("Processing holdings data...", false, true);
            allHoldingsProcessed = processHoldings(allHoldingsRaw);
            console.log(`Processing complete for ${allHoldingsProcessed.length} holdings.`);
        }

        // --- Holdings Table ---
        updateExportStatus("Generating table...", false, true);
        console.log("Adding Holdings Table to PDF...");
        doc.setFontSize(14); doc.setTextColor(70);
        doc.text("Holdings Table (All Filtered Results)", margin, currentY);
        currentY += 20;

        const head = [[
            "CUSIP", "Description", "Par", "Book Price", "Market Price", "Coupon",
            "Book Yield", "WAL", "Duration", "Maturity Date", "Call Date", "Intention"
        ]];
        const body = allHoldingsProcessed.map(h => [
            h.security_cusip ?? 'N/A', h.security_description ?? '',
            (h.par_value_num ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (h.book_price_num ?? 0).toFixed(6), (h.market_price_num ?? 0).toFixed(6),
            (h.coupon_num ?? 0).toFixed(3), (h.book_yield_num ?? 0).toFixed(3),
            (h.holding_average_life_num ?? 0).toFixed(2), (h.holding_duration_num ?? 0).toFixed(2),
            h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : 'N/A',
            h.call_date_obj ? h.call_date_obj.toLocaleDateString() : 'N/A',
            h.intention_code ?? 'N/A'
        ]);

        if (body.length === 0) {
            console.warn("No data rows to add to the PDF table.");
            doc.setFontSize(10); doc.setTextColor(150);
            doc.text("No holdings data available for the table.", margin, currentY + 15);
        } else {
            console.log("Calling doc.autoTable...");
            doc.autoTable({
                head: head, body: body, startY: currentY, theme: 'grid',
                styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak', textColor: pdfTextColor, lineColor: pdfBorderColor, lineWidth: 0.5 },
                headStyles: { fillColor: pdfHeaderBg, textColor: pdfHeaderText, fontStyle: 'bold', halign: 'center', lineColor: pdfBorderColor, lineWidth: 0.5 },
                bodyStyles: { fillColor: pdfRowBg, textColor: pdfTextColor, lineColor: pdfBorderColor, lineWidth: 0.5 },
                alternateRowStyles: { fillColor: pdfAlternateRowBg },
                columnStyles: {
                    0: { cellWidth: 55, halign: 'left' }, 1: { cellWidth: 'auto', halign: 'left' },
                    2: { cellWidth: 60, halign: 'right' }, 3: { cellWidth: 45, halign: 'right' },
                    4: { cellWidth: 45, halign: 'right' }, 5: { cellWidth: 40, halign: 'right' },
                    6: { cellWidth: 40, halign: 'right' }, 7: { cellWidth: 40, halign: 'right' },
                    8: { cellWidth: 40, halign: 'right' }, 9: { cellWidth: 55, halign: 'center' },
                    10: { cellWidth: 55, halign: 'center' }, 11: { cellWidth: 40, halign: 'center' }
                },
                margin: { left: margin, right: margin },
                didDrawPage: function (data) {
                    let footerStr = "Page " + doc.internal.getCurrentPageInfo().pageNumber;
                    doc.setFontSize(8); doc.setTextColor(100);
                    doc.text(footerStr, data.settings.margin.left, pageHeight - 15, { baseline: 'bottom' });
                }
            });
            console.log("Holdings table added via doc.autoTable.");
        }
        pdfGeneratedSuccessfully = true;

        // --- Save the PDF ---
        if (pdfGeneratedSuccessfully) {
            updateExportStatus("Saving PDF...", false, true); // Keep buttons disabled until after save
            await delay(50);
            const selectedCustomerOption = customerSelect?.options[customerSelect.selectedIndex];
            const selectedPortfolioOption = portfolioFilterSelect?.options[portfolioFilterSelect.selectedIndex];
            let baseFilename = 'export';
            if (selectedPortfolioOption?.value) {
                baseFilename = selectedPortfolioOption.text.split('(')[0].trim();
            } else if (selectedCustomerOption?.value) {
                baseFilename = selectedCustomerOption.text.split('(')[0].trim();
            }
            const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            doc.save(`portfolio_${safeFilename}_analysis.pdf`);
            console.log("PDF export process finished successfully.");

            // Use alert for final confirmation, as status messages might be cleared too quickly or missed
             const finalMessage = chartErrorOccurred
                ? "PDF Export Complete (Warning: Some charts missing)."
                : "PDF Export Complete!";
             alert(finalMessage); // Use alert for clear user feedback

        } else {
            throw new Error("PDF generation failed before saving.");
        }

    } catch (error) {
        console.error("Error during PDF export process:", error);
        const errorMessage = error.message || "An unknown error occurred during PDF export.";
        alert(`PDF Export Failed: ${errorMessage}`); // Use alert for errors too
        // Log status to console as well
        updateExportStatus(`PDF Export Failed: ${errorMessage}`, true, false); // Keep buttons enabled after error alert

    } finally {
        // Ensure buttons are re-enabled in all cases (success or caught error)
        console.log("Re-enabling export buttons.");
        updateExportStatus("", false, false); // Clear status message (if using dedicated element) and enable buttons
    }
}


/** Exports ALL filtered holdings data to an XLSX file. */
export async function exportToXlsx(event) {
    if (event) event.preventDefault();
    console.log("Initiating exportToXlsx function...");

    updateExportStatus("Preparing Excel export...", false, true);
    await delay(50);

    try {
        updateExportStatus("Checking Excel library...", false, true);
        const XLSX = window.XLSX;
        if (typeof XLSX === 'undefined') {
            throw new Error("Excel library (SheetJS XLSX) not loaded.");
        }
        console.log("SheetJS library loaded.");

        updateExportStatus("Fetching all holdings data...", false, true);
        let holdingsToExport = [];
        try {
            holdingsToExport = await fetchAllFilteredHoldings();
        } catch (fetchError) {
            console.error("Failed to fetch all holdings for Excel:", fetchError);
            throw new Error("Could not retrieve holdings data for the Excel file.");
        }

        if (!holdingsToExport || holdingsToExport.length === 0) {
            console.warn("No holdings data found to export.");
            alert("No holdings data found matching the current filters to export."); // Alert user
            updateExportStatus("No holdings data found for export.", true, false); // Log and enable buttons
            return;
        }

        updateExportStatus(`Processing ${holdingsToExport.length} holdings...`, false, true);
        const processedHoldings = processHoldings(holdingsToExport);
        console.log(`Processing complete for Excel export.`);

        updateExportStatus("Building Excel sheet...", false, true);
        const headers = [
            "CUSIP", "Description", "Par", "Book Price", "Market Price", "Coupon",
            "Book Yield", "WAL", "Duration", "Maturity Date", "Call Date", "Intention"
        ];
        const data = processedHoldings.map(h => [
            h.security_cusip || '', h.security_description || '',
            h.par_value_num ?? null, h.book_price_num ?? null, h.market_price_num ?? null,
            h.coupon_num ?? null, h.book_yield_num ?? null, h.holding_average_life_num ?? null,
            h.holding_duration_num ?? null,
            h.maturity_date_str_iso || (h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : ''),
            h.call_date_str_iso || (h.call_date_obj ? h.call_date_obj.toLocaleDateString() : ''),
            h.intention_code || ''
        ]);

        const sheetData = [headers, ...data];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);

        ws['!cols'] = [
            { wch: 12 }, { wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
            { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }
        ];

        const numberCols = [2, 3, 4, 5, 6, 7, 8];
        const precision6Cols = [3, 4]; const precision3Cols = [5, 6]; const precision2Cols = [2, 7, 8];
        const dateCols = [9, 10];

        for (let R = 1; R < sheetData.length; ++R) {
            numberCols.forEach(C => {
                const cell_address = { c: C, r: R }; const cell_ref = XLSX.utils.encode_cell(cell_address);
                if (ws[cell_ref] && typeof ws[cell_ref].v === 'number') {
                    ws[cell_ref].t = 'n';
                    if (precision6Cols.includes(C)) ws[cell_ref].z = '#,##0.000000';
                    else if (precision3Cols.includes(C)) ws[cell_ref].z = '#,##0.000';
                    else if (precision2Cols.includes(C)) ws[cell_ref].z = '#,##0.00';
                    else ws[cell_ref].z = '#,##0.######';
                }
            });
            dateCols.forEach(C => {
                const cell_address = { c: C, r: R }; const cell_ref = XLSX.utils.encode_cell(cell_address);
                if (ws[cell_ref]?.v) {
                    let dateVal = ws[cell_ref].v; let dateObj = null;
                    if (dateVal instanceof Date && !isNaN(dateVal)) { dateObj = dateVal; }
                    else if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) { dateObj = new Date(dateVal + 'T00:00:00Z'); }
                    if (dateObj && !isNaN(dateObj.getTime())) { ws[cell_ref].v = dateObj; ws[cell_ref].t = 'd'; ws[cell_ref].z = 'yyyy-mm-dd'; }
                    else { ws[cell_ref].t = 's'; delete ws[cell_ref].z; }
                }
            });
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Holdings (Filtered)");

        const selectedCustomerOption = customerSelect?.options[customerSelect.selectedIndex];
        const selectedPortfolioOption = portfolioFilterSelect?.options[portfolioFilterSelect.selectedIndex];
        let baseFilename = 'holdings_export';
        if (selectedPortfolioOption?.value) { baseFilename = selectedPortfolioOption.text.split('(')[0].trim(); }
        else if (selectedCustomerOption?.value) { baseFilename = selectedCustomerOption.text.split('(')[0].trim(); }
        const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `portfolio_${safeFilename}_all_filtered.xlsx`;

        updateExportStatus("Generating Excel file...", false, true); // Keep buttons disabled
        await delay(50);

        XLSX.writeFile(wb, filename);
        console.log(`XLSX export triggered: ${filename}`);
        alert("Excel Export Complete!"); // Use alert for confirmation

    } catch (error) {
        console.error("Error exporting to XLSX:", error);
        const errorMessage = error.message || "An unknown error occurred during Excel export.";
        alert(`Excel Export Failed: ${errorMessage}`); // Use alert for errors
        updateExportStatus(`Excel Export Failed: ${errorMessage}`, true, false); // Log and enable buttons

    } finally {
        // Ensure buttons are re-enabled
        console.log("Re-enabling export buttons.");
        updateExportStatus("", false, false); // Clear status (if using element) and enable buttons
    }
}
