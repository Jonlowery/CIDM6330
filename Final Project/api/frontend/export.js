// export.js
// Handles exporting data to PDF and Excel (XLSX).
// VERSION: Corrected import path for showStatusMessageGeneric and added parseFloatSafe import.

"use strict";

import { XLSX } from './config.js';
import * as state from './state.js';
import { fetchAllFilteredHoldings } from './api.js';
import { processHoldings } from './ui.js';
// *** FIX: Import showStatusMessageGeneric and parseFloatSafe from utils.js ***
import { showStatusMessageGeneric, parseFloatSafe } from './utils.js'; // Corrected import path & added parseFloatSafe

// --- DOM Element References ---
const portfolioNameEl = document.getElementById('portfolio-name');
const customerSelect = document.getElementById('customer-select');
const portfolioFilterSelect = document.getElementById('portfolio-filter-select');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const exportExcelBtn = document.getElementById('export-excel-btn');
// Optional: Add a dedicated status element reference if needed
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
    console.log(`Export Status: ${message} (Error: ${isError})`);

    if (exportPdfBtn) exportPdfBtn.disabled = disableButtons;
    if (exportExcelBtn) exportExcelBtn.disabled = disableButtons;

    // --- Optional: Update a dedicated status element ---
    // const exportStatusElement = document.getElementById('export-status');
    // if (exportStatusElement) {
    //     showStatusMessageGeneric(exportStatusElement, message, isError, 0); // Use generic message display (0 duration)
    //     if (!message) { // Hide if message is empty
    //          exportStatusElement.style.display = 'none';
    //     }
    // }
    // --- End Optional ---
}

/** Exports the current view (charts and ALL filtered holdings table) to a PDF document. */
export async function exportToPdf(event) {
    if (event) event.preventDefault();
    console.log("Initiating exportToPdf function...");
    updateExportStatus("Preparing PDF generation...", false, true);
    await delay(50);

    let pdfGeneratedSuccessfully = false;
    let chartErrorOccurred = false;

    try {
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

        updateExportStatus("Initializing PDF document...", false, true);
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

        const pdfHeaderBg = '#e9ecef'; const pdfHeaderText = '#495057';
        const pdfTextColor = '#333333'; const pdfBorderColor = '#dee2e6';
        const pdfRowBg = '#ffffff'; const pdfAlternateRowBg = '#f8f9fa';

        const pageHeight = doc.internal.pageSize.getHeight();
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 40;
        const usableWidth = pageWidth - (2 * margin);
        let currentY = margin;

        console.log("Adding PDF Title...");
        doc.setFontSize(18); doc.setTextColor(51);
        const viewTitle = portfolioNameEl?.textContent || 'Portfolio Analysis';
        doc.text(`${viewTitle} - Analysis`, margin, currentY);
        currentY += 30;

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
        const chartIds = [
            'yieldVsMaturityChart',
            'parByMaturityYearChart',
            'couponPieChart',
            'portfolioCashFlowChart'
        ];
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
                    doc.setDrawColor(200); doc.setLineWidth(0.5); doc.rect(x, y, chartWidth, chartHeight);
                    doc.setFontSize(9); doc.setTextColor(150); doc.text(`Error adding chart`, x + chartWidth / 2, y + chartHeight / 2, { align: 'center', baseline: 'middle' });
                    chartBottomY = Math.max(chartBottomY, y + chartHeight);
                }
            } else {
                console.warn(`Skipping chart ${chartId} (no valid image data found).`);
                chartErrorOccurred = true;
                doc.setDrawColor(200); doc.setLineWidth(0.5); doc.rect(x, y, chartWidth, chartHeight);
                doc.setFontSize(9); doc.setTextColor(150); doc.text(`Chart data unavailable`, x + chartWidth / 2, y + chartHeight / 2, { align: 'center', baseline: 'middle' });
                chartBottomY = Math.max(chartBottomY, y + chartHeight);
            }
        }
        console.log("Finished adding available chart images to PDF.");
        currentY = chartBottomY + 30;

        console.log("Adding page break before table.");
        doc.addPage();
        currentY = margin;

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

        updateExportStatus("Generating table...", false, true);
        console.log("Adding Holdings Table to PDF...");
        doc.setFontSize(14); doc.setTextColor(70);
        doc.text("Holdings Table (All Filtered Results)", margin, currentY);
        currentY += 20;

        const head = [[
            "CUSIP", "Description", "Par", "Book Price", "Market Price", "Coupon",
            "Book Yield", "WAL", "Duration", "Maturity Date", "Call Date", "Intention"
        ]];
        const body = allHoldingsProcessed.map(h => {
            // Ensure parseFloatSafe is used for par_value which might be a string from serializer
            const parValue = h.par_value ? parseFloatSafe(h.par_value) : (h.par_value_num ?? 0);
            return [
                h.security_cusip ?? 'N/A', h.security_description ?? '',
                parValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                (h.book_price_num ?? 0).toFixed(6), (h.market_price_num ?? 0).toFixed(6),
                (h.coupon_num ?? 0).toFixed(3), (h.book_yield_num ?? 0).toFixed(3),
                (h.holding_average_life_num ?? 0).toFixed(2), (h.holding_duration_num ?? 0).toFixed(2),
                h.maturity_date_obj ? h.maturity_date_obj.toLocaleDateString() : 'N/A',
                h.call_date_obj ? h.call_date_obj.toLocaleDateString() : 'N/A',
                h.intention_code ?? 'N/A'
            ];
        });

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

        if (pdfGeneratedSuccessfully) {
            updateExportStatus("Saving PDF...", false, true);
            await delay(50);
            const selectedCustomerOption = customerSelect?.options[customerSelect.selectedIndex];
            const selectedPortfolioOption = portfolioFilterSelect?.options[portfolioFilterSelect.selectedIndex];
            let baseFilename = 'portfolio_analysis';
            if (selectedPortfolioOption?.value) {
                baseFilename = selectedPortfolioOption.text.split('(')[0].trim();
            } else if (selectedCustomerOption?.value) {
                baseFilename = selectedCustomerOption.text.split('(')[0].trim();
            }
            const safeFilename = baseFilename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            doc.save(`${safeFilename}.pdf`);
            console.log("PDF export process finished successfully.");

            const finalMessage = chartErrorOccurred
               ? "PDF Export Complete (Warning: Some charts missing)."
               : "PDF Export Complete!";
            console.log(finalMessage);

        } else {
            throw new Error("PDF generation failed before saving.");
        }

    } catch (error) {
        console.error("Error during PDF export process:", error);
        const errorMessage = `PDF Export Failed: ${error.message || "An unknown error occurred."}`;
        console.error(errorMessage);
        alert(errorMessage);

    } finally {
        console.log("Re-enabling export buttons.");
        updateExportStatus("", false, false);
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
            alert("No holdings data found matching the current filters to export.");
            updateExportStatus("No holdings data found for export.", true, false);
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
        const data = processedHoldings.map(h => {
            const parValue = h.par_value ? parseFloatSafe(h.par_value) : (h.par_value_num ?? null);
            return [
                h.security_cusip || '', h.security_description || '',
                parValue,
                h.book_price_num ?? null, h.market_price_num ?? null,
                h.coupon_num ?? null, h.book_yield_num ?? null,
                h.holding_average_life_num ?? null, h.holding_duration_num ?? null,
                h.maturity_date_obj || (h.security?.maturity_date || ''),
                h.call_date_obj || (h.security?.call_date || ''),
                h.intention_code || ''
            ];
        });

        const sheetData = [headers, ...data];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);

        ws['!cols'] = [
            { wch: 12 }, { wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
            { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }
        ];

        const numberCols = [2, 3, 4, 5, 6, 7, 8];
        const precision6Cols = [3, 4];
        const precision3Cols = [5, 6];
        const precision2Cols = [2, 7, 8];
        const dateCols = [9, 10];

        for (let R = 1; R < sheetData.length; ++R) {
            numberCols.forEach(C => {
                const cell_address = { c: C, r: R };
                const cell_ref = XLSX.utils.encode_cell(cell_address);
                if (ws[cell_ref] && typeof ws[cell_ref].v === 'number') {
                    ws[cell_ref].t = 'n';
                    if (precision6Cols.includes(C)) ws[cell_ref].z = '#,##0.000000';
                    else if (precision3Cols.includes(C)) ws[cell_ref].z = '#,##0.000';
                    else if (precision2Cols.includes(C)) ws[cell_ref].z = '#,##0.00';
                    else ws[cell_ref].z = '#,##0.######';
                } else if (ws[cell_ref] && ws[cell_ref].v === null) {
                    ws[cell_ref].v = undefined;
                    ws[cell_ref].t = 'z';
                }
            });
            dateCols.forEach(C => {
                const cell_address = { c: C, r: R };
                const cell_ref = XLSX.utils.encode_cell(cell_address);
                if (ws[cell_ref]?.v) {
                    if (ws[cell_ref].v instanceof Date && !isNaN(ws[cell_ref].v)) {
                         ws[cell_ref].t = 'd';
                         ws[cell_ref].z = 'yyyy-mm-dd';
                    } else {
                        ws[cell_ref].t = 's';
                        delete ws[cell_ref].z;
                    }
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
        const filename = `${safeFilename}_filtered.xlsx`;

        updateExportStatus("Generating Excel file...", false, true);
        await delay(50);

        XLSX.writeFile(wb, filename);
        console.log(`XLSX export triggered: ${filename}`);
        console.log("Excel Export Complete!");
        alert("Excel Export Complete!");

    } catch (error) {
        console.error("Error exporting to XLSX:", error);
        const errorMessage = `Excel Export Failed: ${error.message || "An unknown error occurred."}`;
        console.error(errorMessage);
        alert(errorMessage);

    } finally {
        console.log("Re-enabling export buttons.");
        updateExportStatus("", false, false);
    }
}
