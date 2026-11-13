const asyncHandler = require('express-async-handler');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const Program = require('../models/Program');

const formatPHP = (amount) =>
  `₱${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)}`;
/*
 * Amounts inside a PDF are written "PHP 1,234.00", not with the peso sign.
 *
 * PDFKit's built-in fonts use WinAnsi encoding, which has no ₱: the sign was written as the two
 * bytes 0x20 0xB1 and every programme report printed its budgets as " ±150,000.00". No TrueType font
 * with the glyph ships with the backend, and embedding one would add a binary asset for a single
 * character, so the PDF uses the ISO code. Spreadsheets and the web UI keep ₱, which they render.
 */
const pdfPHP = (amount) =>
  `PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)}`;
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const Liquidation = require('../models/Liquidation');
const YouthMember = require('../models/YouthMember');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { summarizeBudgets } = require('../utils/budgetTotals');

const REPORT_LIMIT = 1000;
const { applyReadScope } = require('../utils/scope');

/**
 * Scope a report filter, mutating it.
 *
 * `strict` for finance: a barangay officer's report covers their own barangay's budget, expenses and
 * liquidations, never the municipality's — the same rule as the Fund Management pages. Programmes and
 * youth keep the lenient read, so municipality-wide programmes still appear in a barangay's report.
 *
 * A report is the output most likely to be printed, attached to a submission, or read months later
 * by someone who was not there when it was generated, so a figure covering more than the person who
 * produced it is the worst place for the scope to be wrong.
 */
const reportScope = (req, filter, options = {}) => {
  applyReadScope(filter, req.user, { requestedBarangay: req.query.barangay, ...options });
};

const dateText = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const label = (v) => (typeof v === 'string' ? v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : (v ?? ''));
const ascii = (v) => String(v ?? '').replace(/[—–]/g, '-').replace(/[^\x20-\x7e]/g, (c) => (c === 'ñ' ? 'n' : c === 'Ñ' ? 'N' : '?'));

/* ----------------------------------------------------------------------------------------------- *
 * PDF helpers — one table renderer for every report, so they look like one system and page alike.
 * ----------------------------------------------------------------------------------------------- */

const startPdf = (res, filename, title, subtitle) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape', bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(16).text(ascii(title), { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor('#555555')
    .text(ascii(subtitle), { align: 'center' })
    .text(`Generated ${ascii(dateText(new Date()))}`, { align: 'center' });
  doc.fillColor('#000000').moveDown(1);
  return doc;
};

const sectionHeading = (doc, text) => {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).fillColor('#1e3a5f').text(ascii(text), doc.page.margins.left);
  doc.fillColor('#000000').moveDown(0.3);
};

/**
 * Draw a table. `columns` = [{ header, width (fraction of the page), align, value(row) }]. Rows wrap
 * and break across pages, repeating the header.
 */
const drawTable = (doc, columns, rows, { emptyText = 'No records.' } = {}) => {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = columns.map((c) => c.width * usable);
  const padding = 3;

  const drawRow = (cells, { bold = false, fill = null } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const heights = cells.map((text, i) => doc.heightOfString(ascii(text), { width: widths[i] - padding * 2 }));
    const height = Math.max(...heights, 10) + padding * 2;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      if (!bold) drawRow(columns.map((c) => c.header), { bold: true, fill: '#e8eef5' });
    }
    const top = doc.y;
    let x = left;
    if (fill) doc.rect(left, top, usable, height).fill(fill).fillColor('#000000');
    cells.forEach((text, i) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
        .text(ascii(text), x + padding, top + padding, { width: widths[i] - padding * 2, align: columns[i].align || 'left' });
      x += widths[i];
    });
    doc.moveTo(left, top + height).lineTo(left + usable, top + height).strokeColor('#d0d7e0').lineWidth(0.5).stroke();
    doc.y = top + height;
    doc.x = left;
  };

  drawRow(columns.map((c) => c.header), { bold: true, fill: '#e8eef5' });
  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(8).text(emptyText, left + padding, doc.y + padding);
    doc.moveDown(0.5);
    return;
  }
  rows.forEach((row) => drawRow(columns.map((c) => String(c.value(row) ?? ''))));
};

const keyValues = (doc, pairs) => {
  pairs.forEach(([k, v]) => {
    doc.font('Helvetica-Bold').fontSize(9).text(`${ascii(k)}: `, { continued: true });
    doc.font('Helvetica').text(ascii(v));
  });
};

const finishPdf = (doc) => {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7).fillColor('#888888')
      .text(`SKIMS - page ${i + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 30, { align: 'right', width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
  }
  doc.end();
};

/* Excel: a bold, filled header row like the templates below use. */
const headerRow = (sheet, values) => {
  const row = sheet.addRow(values);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  return row;
};
const PHP_FMT = '"₱"#,##0.00';

const sendWorkbook = async (res, workbook, filename) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  await workbook.xlsx.write(res);
};

const scopeLine = (req) => {
  const where = req.user.barangay?.name && ['sk_chairperson', 'sk_treasurer', 'sk_secretary'].includes(req.user.role)
    ? `Barangay ${req.user.barangay.name}, ${req.user.municipality?.name || ''}`
    : (req.user.municipality?.name || 'Province of Marinduque');
  return where;
};

/* ----------------------------------------------------------------------------------------------- */

exports.generateProgramReport = asyncHandler(async (req, res) => {
  const { municipalityId, startDate, endDate, fiscalYear, format = 'json' } = req.query;
  const filter = { deletedAt: null };
  if (municipalityId) filter.municipality = municipalityId;
  if (fiscalYear) {
    const yr = parseInt(fiscalYear);
    filter.startDate = { $gte: new Date(yr, 0, 1), $lte: new Date(yr, 11, 31, 23, 59, 59) };
  } else if (startDate || endDate) {
    filter.startDate = {};
    if (startDate) filter.startDate.$gte = new Date(startDate);
    if (endDate) filter.startDate.$lte = new Date(endDate);
  }
  reportScope(req, filter);

  const programs = await Program.find(filter)
    .populate('municipality', 'name')
    .populate('barangay', 'name')
    .populate('createdBy', 'firstName lastName')
    .limit(REPORT_LIMIT);

  // Grouped by barangay (municipality-wide programmes last), so a municipal reviewer reads one
  // barangay's work together.
  const barangayName = (p) => p.barangay?.name || '';
  programs.sort((a, b) => (barangayName(a) || '￿').localeCompare(barangayName(b) || '￿') || a.title.localeCompare(b.title));

  if (format === 'pdf') {
    const doc = startPdf(res, 'program-report.pdf', 'SKIMS - Program Accomplishment Report',
      `${scopeLine(req)}${fiscalYear ? ` - Fiscal Year ${fiscalYear}` : ''}`);
    keyValues(doc, [
      ['Programs', String(programs.length)],
      ['Completed', String(programs.filter((p) => p.status === 'completed').length)],
      ['Total programme budget', pdfPHP(programs.reduce((s, p) => s + (p.budget || 0), 0))],
    ]);
    sectionHeading(doc, 'Programs by barangay');
    drawTable(doc, [
      { header: 'Program', width: 0.2, value: (p) => p.title },
      { header: 'Barangay', width: 0.1, value: (p) => p.barangay?.name || 'Municipality-wide' },
      { header: 'Municipality', width: 0.08, value: (p) => p.municipality?.name || '' },
      { header: 'Category', width: 0.09, value: (p) => label(p.category) },
      { header: 'Status', width: 0.07, value: (p) => label(p.status) },
      { header: 'Preparation start', width: 0.09, value: (p) => dateText(p.startDate) },
      { header: 'Preparation end', width: 0.09, value: (p) => dateText(p.endDate) },
      { header: 'Implemented on', width: 0.09, value: (p) => (p.implementationDate ? dateText(p.implementationDate) : 'Not yet set') },
      { header: 'Budget', width: 0.1, align: 'right', value: (p) => pdfPHP(p.budget) },
      { header: 'Done', width: 0.04, align: 'right', value: (p) => `${p.completionRate || 0}%` },
      { header: 'Particip.', width: 0.05, align: 'right', value: (p) => p.actualParticipants || 0 },
    ], programs, { emptyText: 'No programs in this period.' });
    finishPdf(doc);
    return;
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Programs');

    sheet.columns = [
      { header: 'Title', key: 'title', width: 34 },
      { header: 'Barangay', key: 'barangay', width: 20 },
      { header: 'Municipality', key: 'municipality', width: 15 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Budget (₱)', key: 'budget', width: 15 },
      { header: 'Preparation Start', key: 'startDate', width: 16 },
      { header: 'Preparation End', key: 'endDate', width: 16 },
      { header: 'Implementation Date', key: 'implementationDate', width: 18 },
      { header: 'Completion %', key: 'completionRate', width: 12 },
      { header: 'Participants', key: 'actualParticipants', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };

    programs.forEach((p) => {
      const row = sheet.addRow({
        title: p.title,
        barangay: p.barangay?.name || 'Municipality-wide',
        municipality: p.municipality?.name,
        category: label(p.category),
        status: label(p.status),
        budget: p.budget,
        startDate: p.startDate ? new Date(p.startDate) : null,
        endDate: p.endDate ? new Date(p.endDate) : null,
        implementationDate: p.implementationDate ? new Date(p.implementationDate) : 'Not yet set',
        completionRate: p.completionRate,
        actualParticipants: p.actualParticipants,
      });
      row.getCell('budget').numFmt = PHP_FMT;
      ['startDate', 'endDate', 'implementationDate'].forEach((k) => {
        if (row.getCell(k).value instanceof Date) row.getCell(k).numFmt = 'yyyy-mm-dd';
      });
    });

    await sendWorkbook(res, workbook, 'program-report.xlsx');
    return;
  }

  // In-app data only. The Reports page offers PDF and Excel downloads; there is no JSON export.
  successResponse(res, 200, 'Program report', programs);
});

exports.generateFinancialReport = asyncHandler(async (req, res) => {
  const { municipalityId, fiscalYear, format = 'json' } = req.query;
  /*
   * Finance is strict: a barangay officer's report covers their barangay's budget, expenses and
   * liquidations only. Budgets are totalled without double counting (utils/budgetTotals.js) — a
   * barangay allocation is part of the municipal budget, not on top of it.
   */
  const yr = fiscalYear ? parseInt(fiscalYear) : null;
  const yearStart = yr ? new Date(yr, 0, 1) : null;
  const yearEnd = yr ? new Date(yr, 11, 31, 23, 59, 59) : null;

  const budgetFilter = { deletedAt: null };
  const expenseFilter = { deletedAt: null };
  const liquidationFilter = { deletedAt: null };
  if (municipalityId) [budgetFilter, expenseFilter, liquidationFilter].forEach((f) => { f.municipality = municipalityId; });
  reportScope(req, budgetFilter, { strict: true });
  reportScope(req, expenseFilter, { strict: true, ownerField: 'createdBy' });
  reportScope(req, liquidationFilter, { strict: true, ownerField: 'submittedBy' });

  const [budgets, expenses, liquidations] = await Promise.all([
    Budget.find({ ...budgetFilter, ...(yr ? { fiscalYear: yr } : {}) }).populate('municipality', 'name').populate('barangay', 'name').limit(REPORT_LIMIT),
    Expense.find({ ...expenseFilter, ...(yearStart ? { transactionDate: { $gte: yearStart, $lte: yearEnd } } : {}) }).populate('program', 'title').populate('municipality', 'name').populate('barangay', 'name').limit(REPORT_LIMIT),
    Liquidation.find({ ...liquidationFilter, ...(yearStart ? { createdAt: { $gte: yearStart, $lte: yearEnd } } : {}) }).populate('program', 'title').populate('municipality', 'name').populate('barangay', 'name').limit(REPORT_LIMIT),
  ]);

  const approvedBudgets = budgets.filter((b) => b.status === 'approved');
  const totals = summarizeBudgets(approvedBudgets);
  const spent = expenses.filter((e) => ['approved', 'liquidated'].includes(e.status));
  const summary = {
    totalBudget: totals.total,
    allocatedToBarangays: totals.allocatedToBarangays,
    totalDisbursed: totals.disbursed,
    remaining: totals.remaining,
    // Approved and liquidated only: pending, returned and rejected expenses are not spending.
    totalExpenses: spent.reduce((s, e) => s + e.amount, 0),
    pendingExpenses: expenses.filter((e) => e.status === 'pending').reduce((s, e) => s + e.amount, 0),
    pendingLiquidation: liquidations.filter((l) => l.status !== 'approved').reduce((s, l) => s + l.totalAmount, 0),
  };

  // Per-barangay roll-up of the expense lines, the municipal reviewer's view of who spent what.
  const byBarangay = new Map();
  for (const e of expenses) {
    const key = e.barangay?.name || 'Municipality level';
    const row = byBarangay.get(key) || { barangay: key, approved: 0, pending: 0, count: 0 };
    row.count += 1;
    if (['approved', 'liquidated'].includes(e.status)) row.approved += e.amount;
    if (e.status === 'pending') row.pending += e.amount;
    byBarangay.set(key, row);
  }
  const barangayRows = [...byBarangay.values()].sort((a, b) => a.barangay.localeCompare(b.barangay));

  if (format === 'pdf') {
    const doc = startPdf(res, 'financial-report.pdf', 'SKIMS - Financial Report',
      `${scopeLine(req)} - Fiscal Year ${fiscalYear || 'All'}`);
    keyValues(doc, [
      ['Total SK budget (approved)', pdfPHP(summary.totalBudget)],
      ['Allocated to barangays', pdfPHP(summary.allocatedToBarangays)],
      ['Disbursed (approved expenses charged)', pdfPHP(summary.totalDisbursed)],
      ['Remaining', pdfPHP(summary.remaining)],
      ['Approved expenditure', pdfPHP(summary.totalExpenses)],
      ['Awaiting review', pdfPHP(summary.pendingExpenses)],
    ]);

    sectionHeading(doc, 'Budgets');
    drawTable(doc, [
      { header: 'Budget', width: 0.26, value: (b) => b.title },
      { header: 'Level', width: 0.16, value: (b) => (b.barangay ? `Barangay ${b.barangay.name}` : `Municipal - ${b.municipality?.name || ''}`) },
      { header: 'FY', width: 0.06, value: (b) => b.fiscalYear },
      { header: 'Status', width: 0.1, value: (b) => label(b.status) },
      { header: 'Total', width: 0.14, align: 'right', value: (b) => pdfPHP(b.totalBudget) },
      { header: 'Disbursed', width: 0.14, align: 'right', value: (b) => pdfPHP(b.disbursedAmount) },
      { header: 'Remaining', width: 0.14, align: 'right', value: (b) => pdfPHP((b.totalBudget || 0) - (b.disbursedAmount || 0)) },
    ], budgets, { emptyText: 'No budgets for this period.' });

    sectionHeading(doc, 'Spending by barangay');
    drawTable(doc, [
      { header: 'Barangay', width: 0.4, value: (r) => r.barangay },
      { header: 'Expenses', width: 0.12, align: 'right', value: (r) => r.count },
      { header: 'Approved', width: 0.24, align: 'right', value: (r) => pdfPHP(r.approved) },
      { header: 'Awaiting review', width: 0.24, align: 'right', value: (r) => pdfPHP(r.pending) },
    ], barangayRows, { emptyText: 'No expenses recorded.' });

    sectionHeading(doc, 'Expenses');
    drawTable(doc, [
      { header: 'Reference', width: 0.12, value: (e) => e.referenceNumber },
      { header: 'Title', width: 0.24, value: (e) => e.title },
      { header: 'Barangay', width: 0.13, value: (e) => e.barangay?.name || 'Municipality level' },
      { header: 'Type', width: 0.13, value: (e) => label(e.type) },
      { header: 'Date', width: 0.1, value: (e) => dateText(e.transactionDate) },
      { header: 'Status', width: 0.09, value: (e) => label(e.status) },
      { header: 'Proof', width: 0.05, align: 'right', value: (e) => e.attachments?.length || 0 },
      { header: 'Amount', width: 0.14, align: 'right', value: (e) => pdfPHP(e.amount) },
    ], expenses, { emptyText: 'No expenses recorded.' });

    sectionHeading(doc, 'Liquidation reports');
    drawTable(doc, [
      { header: 'Reference', width: 0.13, value: (l) => l.referenceNumber },
      { header: 'Title', width: 0.27, value: (l) => l.title },
      { header: 'Barangay', width: 0.14, value: (l) => l.barangay?.name || 'Municipality level' },
      { header: 'Status', width: 0.1, value: (l) => label(l.status) },
      { header: 'Total', width: 0.12, align: 'right', value: (l) => pdfPHP(l.totalAmount) },
      { header: 'Liquidated', width: 0.12, align: 'right', value: (l) => pdfPHP(l.liquidatedAmount) },
      { header: 'Unliquidated', width: 0.12, align: 'right', value: (l) => pdfPHP(l.variance) },
    ], liquidations, { emptyText: 'No liquidation reports.' });
    finishPdf(doc);
    return;
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Financial Report');

    sheet.addRow(['SKIMS Financial Report']).font = { bold: true, size: 14 };
    sheet.addRow([`Scope: ${scopeLine(req)}`]);
    sheet.addRow([`Fiscal Year: ${fiscalYear || 'All'}`]);
    sheet.addRow([`Generated: ${new Date().toLocaleDateString('en-PH')}`]);
    sheet.addRow([]);

    sheet.addRow(['SUMMARY']).font = { bold: true };
    [
      ['Total SK budget (approved)', summary.totalBudget],
      ['Allocated to barangays', summary.allocatedToBarangays],
      ['Disbursed', summary.totalDisbursed],
      ['Remaining', summary.remaining],
      ['Approved expenditure', summary.totalExpenses],
      ['Awaiting review', summary.pendingExpenses],
    ].forEach(([k, v]) => { sheet.addRow([k, v]).getCell(2).numFmt = PHP_FMT; });
    sheet.addRow([]);

    sheet.addRow(['BUDGET SUMMARY']).font = { bold: true };
    headerRow(sheet, ['Title', 'Level', 'Municipality', 'Fiscal Year', 'Total Budget (₱)', 'Disbursed (₱)', 'Remaining (₱)', 'Status']);
    budgets.forEach((b) => {
      const row = sheet.addRow([b.title, b.barangay ? `Barangay ${b.barangay.name}` : 'Municipal', b.municipality?.name, b.fiscalYear, b.totalBudget, b.disbursedAmount, (b.totalBudget || 0) - (b.disbursedAmount || 0), label(b.status)]);
      [5, 6, 7].forEach((col) => { row.getCell(col).numFmt = PHP_FMT; });
    });

    sheet.addRow([]);
    sheet.addRow(['SPENDING BY BARANGAY']).font = { bold: true };
    headerRow(sheet, ['Barangay', 'Expenses', 'Approved (₱)', 'Awaiting review (₱)']);
    barangayRows.forEach((r) => {
      const row = sheet.addRow([r.barangay, r.count, r.approved, r.pending]);
      [3, 4].forEach((col) => { row.getCell(col).numFmt = PHP_FMT; });
    });

    sheet.addRow([]);
    sheet.addRow(['EXPENSE SUMMARY']).font = { bold: true };
    headerRow(sheet, ['Reference', 'Title', 'Barangay', 'Type', 'Amount (₱)', 'Date', 'Status', 'Attachments']);
    expenses.forEach((e) => {
      const row = sheet.addRow([e.referenceNumber, e.title, e.barangay?.name || 'Municipality level', label(e.type), e.amount, new Date(e.transactionDate), label(e.status), e.attachments?.length || 0]);
      row.getCell(5).numFmt = PHP_FMT;
      row.getCell(6).numFmt = 'yyyy-mm-dd';
    });

    sheet.addRow([]);
    sheet.addRow(['LIQUIDATION REPORTS']).font = { bold: true };
    headerRow(sheet, ['Reference', 'Title', 'Barangay', 'Status', 'Total (₱)', 'Liquidated (₱)', 'Unliquidated (₱)']);
    liquidations.forEach((l) => {
      const row = sheet.addRow([l.referenceNumber, l.title, l.barangay?.name || 'Municipality level', label(l.status), l.totalAmount, l.liquidatedAmount, l.variance]);
      [5, 6, 7].forEach((col) => { row.getCell(col).numFmt = PHP_FMT; });
    });
    sheet.columns.forEach((c, i) => { c.width = [16, 36, 22, 16, 16, 16, 16, 12][i] || 14; });

    await sendWorkbook(res, workbook, 'financial-report.xlsx');
    return;
  }

  successResponse(res, 200, 'Financial report', { budgets, expenses, liquidations, summary, byBarangay: barangayRows });
});

exports.generateYouthReport = asyncHandler(async (req, res) => {
  const { municipalityId, fiscalYear, format = 'json' } = req.query;
  const filter = { deletedAt: null };
  if (municipalityId) filter.municipality = municipalityId;
  if (fiscalYear) {
    const yr = parseInt(fiscalYear);
    filter.createdAt = { $gte: new Date(yr, 0, 1), $lte: new Date(yr, 11, 31, 23, 59, 59) };
  }
  reportScope(req, filter);

  const members = await YouthMember.find(filter)
    .populate('municipality', 'name')
    .populate('barangay', 'name')
    .limit(REPORT_LIMIT);

  /*
   * Built from the data alone, with no seeded keys.
   *
   * This started as `{ male: 0, female: 0, other: 0 }` — the three values gender used to be an enum
   * of. Gender is free text now and stored as typed, so real counts landed in new capitalised keys
   * while those three sat permanently at zero, and a report on a registry full of members read as
   * though it contained no male or female ones.
   *
   * Grouping folds case so "Male" and "male" are one line, while the first spelling seen is kept
   * for display — matching the youth list filter, which already compares case-insensitively.
   */
  const genderBreakdown = {};
  const genderKeyFor = new Map();
  const educationBreakdown = {};
  const barangayBreakdown = {};
  members.forEach((m) => {
    if (m.gender) {
      const fold = String(m.gender).trim().toLowerCase();
      if (!genderKeyFor.has(fold)) genderKeyFor.set(fold, String(m.gender).trim());
      const key = genderKeyFor.get(fold);
      genderBreakdown[key] = (genderBreakdown[key] || 0) + 1;
    }
    if (m.educationalAttainment) {
      educationBreakdown[m.educationalAttainment] = (educationBreakdown[m.educationalAttainment] || 0) + 1;
    }
    const b = m.barangay?.name || 'No barangay recorded';
    barangayBreakdown[b] = (barangayBreakdown[b] || 0) + 1;
  });
  const asRows = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k: label(k), n }));

  if (format === 'pdf') {
    const doc = startPdf(res, 'youth-report.pdf', 'SKIMS - Youth Engagement Report',
      `${scopeLine(req)}${fiscalYear ? ` - registered in ${fiscalYear}` : ''}`);
    keyValues(doc, [
      ['Registered youth', String(members.length)],
      ['Active', String(members.filter((m) => m.isActive !== false).length)],
    ]);
    sectionHeading(doc, 'By gender');
    drawTable(doc, [{ header: 'Gender', width: 0.5, value: (r) => r.k }, { header: 'Members', width: 0.2, align: 'right', value: (r) => r.n }], asRows(genderBreakdown));
    sectionHeading(doc, 'By educational attainment');
    drawTable(doc, [{ header: 'Educational attainment', width: 0.5, value: (r) => r.k }, { header: 'Members', width: 0.2, align: 'right', value: (r) => r.n }], asRows(educationBreakdown));
    sectionHeading(doc, 'By barangay');
    drawTable(doc, [{ header: 'Barangay', width: 0.5, value: (r) => r.k }, { header: 'Members', width: 0.2, align: 'right', value: (r) => r.n }], asRows(barangayBreakdown));
    finishPdf(doc);
    return;
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const summary = workbook.addWorksheet('Summary');
    summary.addRow(['SKIMS Youth Engagement Report']).font = { bold: true, size: 14 };
    summary.addRow([`Scope: ${scopeLine(req)}`]);
    summary.addRow([`Generated: ${new Date().toLocaleDateString('en-PH')}`]);
    summary.addRow(['Registered youth', members.length]);
    summary.addRow([]);
    [['GENDER', genderBreakdown], ['EDUCATIONAL ATTAINMENT', educationBreakdown], ['BARANGAY', barangayBreakdown]].forEach(([title, obj]) => {
      summary.addRow([title]).font = { bold: true };
      asRows(obj).forEach((r) => summary.addRow([r.k, r.n]));
      summary.addRow([]);
    });
    summary.getColumn(1).width = 34;

    /*
     * The member list carries what a youth report needs and no more: no contact number, address or
     * email. A report is the document most likely to be printed and passed around, and most of these
     * people are minors.
     */
    const list = workbook.addWorksheet('Members');
    headerRow(list, ['Name', 'Age', 'Gender', 'Barangay', 'Municipality', 'Educational Attainment', 'Status']);
    members.forEach((m) => list.addRow([
      `${m.firstName} ${m.lastName}`, m.age ?? '', m.gender || '', m.barangay?.name || '', m.municipality?.name || '',
      label(m.educationalAttainment || ''), m.isActive === false ? 'Inactive' : 'Active',
    ]));
    list.columns.forEach((c, i) => { c.width = [28, 6, 12, 20, 14, 24, 10][i]; });

    await sendWorkbook(res, workbook, 'youth-report.xlsx');
    return;
  }

  successResponse(res, 200, 'Youth report', { members, total: members.length, genderBreakdown, educationBreakdown, barangayBreakdown });
});

/*
 * `youth-roster` is the import counterpart of the four report templates: a sheet whose headers are
 * exactly the ones POST /api/youth/import recognises. The most likely reason an import is rejected is
 * a header row the parser cannot read, and handing over a correctly shaped file removes that failure
 * rather than explaining it afterwards.
 */
const TEMPLATE_NAMES = ['abyip', 'cbydp', 'sk-accomplishment', 'coa-liquidation', 'youth-roster'];

const styleHeader = (row) => {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  });
};

const styleMeta = (sheet, row, label, col = 1) => {
  const r = sheet.addRow([label, '']);
  r.getCell(col).font = { bold: true };
  r.getCell(col + 1).border = { bottom: { style: 'thin' } };
  return r;
};

exports.generateTemplate = asyncHandler(async (req, res) => {
  const { name } = req.params;
  if (!TEMPLATE_NAMES.includes(name)) {
    return errorResponse(res, 404, 'Template not found');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SKIMS';
  workbook.created = new Date();

  if (name === 'abyip') {
    const sheet = workbook.addWorksheet('ABYIP');
    sheet.mergeCells('A1:H1');
    const title = sheet.getCell('A1');
    title.value = 'ANNUAL BARANGAY YOUTH INVESTMENT PROGRAM (ABYIP)';
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 30;

    sheet.mergeCells('A2:H2');
    sheet.getCell('A2').value = 'Republic of the Philippines — Sangguniang Kabataan';
    sheet.getCell('A2').alignment = { horizontal: 'center' };

    sheet.addRow([]);
    styleMeta(sheet, null, 'Municipality/Barangay:');
    styleMeta(sheet, null, 'Fiscal Year:');
    styleMeta(sheet, null, 'SK Chairperson:');
    styleMeta(sheet, null, 'Date Prepared:');
    sheet.addRow([]);

    const headerRow = sheet.addRow([
      'No.', 'Program/Project/Activity', 'Objectives', 'Target Beneficiaries',
      'Budget (₱)', 'Start Date', 'End Date', 'Lead Officer',
    ]);
    styleHeader(headerRow);

    sheet.columns = [
      { key: 'no', width: 5 },
      { key: 'title', width: 35 },
      { key: 'objectives', width: 30 },
      { key: 'beneficiaries', width: 20 },
      { key: 'budget', width: 14 },
      { key: 'start', width: 12 },
      { key: 'end', width: 12 },
      { key: 'officer', width: 20 },
    ];

    for (let i = 1; i <= 15; i++) {
      const r = sheet.addRow([i, '', '', '', '', '', '', '']);
      r.getCell(5).numFmt = '"₱"#,##0.00';
      r.eachCell((cell) => { cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    }

    const totalRow = sheet.addRow(['', 'TOTAL', '', '', { formula: `SUM(E${headerRow.number + 1}:E${headerRow.number + 15})` }, '', '', '']);
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(5).numFmt = '"₱"#,##0.00';
    totalRow.getCell(5).font = { bold: true };
    styleHeader(totalRow);

  } else if (name === 'cbydp') {
    const sheet = workbook.addWorksheet('CBYDP');
    sheet.mergeCells('A1:G1');
    const title = sheet.getCell('A1');
    title.value = 'COMPREHENSIVE BARANGAY YOUTH DEVELOPMENT PROGRAM (CBYDP)';
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 30;

    sheet.mergeCells('A2:G2');
    sheet.getCell('A2').value = 'Republic of the Philippines — Sangguniang Kabataan';
    sheet.getCell('A2').alignment = { horizontal: 'center' };

    sheet.addRow([]);
    styleMeta(sheet, null, 'Municipality/Barangay:');
    styleMeta(sheet, null, 'Planning Period:');
    styleMeta(sheet, null, 'SK Chairperson:');
    sheet.addRow([]);

    // Section 1 — Youth Profile
    const s1 = sheet.addRow(['PART I: YOUTH PROFILE ASSESSMENT']);
    s1.getCell(1).font = { bold: true, size: 12 };
    sheet.mergeCells(`A${s1.number}:G${s1.number}`);
    s1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    sheet.addRow([]);

    const profileHeader = sheet.addRow(['Category', 'Total Count', 'Male', 'Female', 'PWD', 'Indigenous', 'Remarks']);
    styleHeader(profileHeader);
    ['15-17 years old', '18-21 years old', '22-24 years old', 'In-school', 'Out-of-school', 'Working Youth', 'OSY'].forEach((cat) => {
      const r = sheet.addRow([cat, '', '', '', '', '', '']);
      r.eachCell((cell) => { cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    });

    sheet.addRow([]);

    // Section 2 — Priority Programs
    const s2 = sheet.addRow(['PART II: PRIORITY PROGRAMS AND PROJECTS']);
    s2.getCell(1).font = { bold: true, size: 12 };
    sheet.mergeCells(`A${s2.number}:G${s2.number}`);
    s2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    sheet.addRow([]);

    const progHeader = sheet.addRow(['No.', 'Program/Project', 'Thrust/Priority Area', 'Budget (₱)', 'Target Beneficiaries', 'Implementation Period', 'Expected Output']);
    styleHeader(progHeader);

    for (let i = 1; i <= 10; i++) {
      const r = sheet.addRow([i, '', '', '', '', '', '']);
      r.getCell(4).numFmt = '"₱"#,##0.00';
      r.eachCell((cell) => { cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    }

    sheet.columns = [
      { width: 5 }, { width: 30 }, { width: 20 }, { width: 14 },
      { width: 18 }, { width: 22 }, { width: 25 },
    ];

  } else if (name === 'sk-accomplishment') {
    const sheet = workbook.addWorksheet('SK Accomplishment');
    sheet.mergeCells('A1:G1');
    const title = sheet.getCell('A1');
    title.value = 'SANGGUNIANG KABATAAN ACCOMPLISHMENT REPORT';
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 30;

    sheet.mergeCells('A2:G2');
    sheet.getCell('A2').value = 'Pursuant to DILG Memorandum Circular on SK Accountability';
    sheet.getCell('A2').alignment = { horizontal: 'center' };
    sheet.addRow([]);

    styleMeta(sheet, null, 'Municipality/Barangay:');
    styleMeta(sheet, null, 'Period Covered:');
    styleMeta(sheet, null, 'Submitted By (SK Chairperson):');
    styleMeta(sheet, null, 'Date Submitted:');
    sheet.addRow([]);

    // SK Officials
    const offTitle = sheet.addRow(['SK OFFICIALS']);
    offTitle.getCell(1).font = { bold: true, size: 11 };
    sheet.mergeCells(`A${offTitle.number}:G${offTitle.number}`);
    offTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };

    const offHeader = sheet.addRow(['Position', 'Name', 'Contact No.', 'Email', '', '', '']);
    styleHeader(offHeader);
    ['SK Chairperson', 'SK Secretary', 'SK Treasurer', 'SK Kagawad 1', 'SK Kagawad 2', 'SK Kagawad 3', 'SK Kagawad 4'].forEach((pos) => {
      const r = sheet.addRow([pos, '', '', '', '', '', '']);
      r.eachCell((cell) => { cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    });

    sheet.addRow([]);

    // Accomplishments
    const accTitle = sheet.addRow(['ACTIVITIES/PROGRAMS IMPLEMENTED']);
    accTitle.getCell(1).font = { bold: true, size: 11 };
    sheet.mergeCells(`A${accTitle.number}:G${accTitle.number}`);
    accTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };

    const accHeader = sheet.addRow(['No.', 'Activity/Program', 'Date Conducted', 'Venue', 'No. of Participants', 'Budget Utilized (₱)', 'Accomplishment/Output']);
    styleHeader(accHeader);

    for (let i = 1; i <= 15; i++) {
      const r = sheet.addRow([i, '', '', '', '', '', '']);
      r.getCell(6).numFmt = '"₱"#,##0.00';
      r.eachCell((cell) => { cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    }

    sheet.columns = [
      { width: 5 }, { width: 30 }, { width: 14 }, { width: 20 },
      { width: 14 }, { width: 16 }, { width: 30 },
    ];

  } else if (name === 'youth-roster') {
    const sheet = workbook.addWorksheet('Youth Roster');

    /*
     * Row 1 IS the header row — no merged title above it.
     *
     * The parser looks for the headers within the first ten rows, so a decorative banner would not
     * break it, but a template whose first row is the header is also a template a user can paste an
     * existing roster straight into.
     */
    const headerRow = sheet.addRow([
      'First Name', 'Last Name', 'Birth Date', 'Gender', 'Email',
      'Contact Number', 'Address', 'Educational Attainment', 'Occupation', 'Registered Voter',
    ]);
    styleHeader(headerRow);

    sheet.columns = [
      { key: 'firstName', width: 18 },
      { key: 'lastName', width: 18 },
      { key: 'birthDate', width: 14 },
      { key: 'gender', width: 14 },
      { key: 'email', width: 26 },
      { key: 'contactNumber', width: 18 },
      { key: 'address', width: 28 },
      { key: 'education', width: 24 },
      { key: 'occupation', width: 18 },
      { key: 'voter', width: 16 },
    ];

    /*
     * One example row, marked as such and removable.
     *
     * A blank template leaves the date format to guesswork, and a mis-typed date silently shifts
     * someone's SK eligibility — so the expected shape is shown rather than described.
     */
    const example = sheet.addRow([
      'Juan', 'dela Cruz', '2006-04-05', 'Male', 'juan.delacruz@example.com',
      '09171234567', 'Purok 1', 'High School', 'Student', 'Yes',
    ]);
    example.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: 'FF888888' } };
    });
    // Text, not a date cell: the point is to show the format that will be read back.
    example.getCell(3).numFmt = '@';

    for (let i = 0; i < 30; i += 1) {
      const row = sheet.addRow(['', '', '', '', '', '', '', '', '', '']);
      row.getCell(3).numFmt = '@';
    }

    /*
     * The instructions go on a SECOND worksheet, not below the data.
     *
     * The importer reads the first sheet and treats any row with content as a row of data, so notes
     * underneath the table would come back as seven invalid rows in the preview of an untouched
     * template — the file's own help text reported as errors in the user's roster.
     */
    const notes = workbook.addWorksheet('How to fill this in');
    notes.columns = [{ width: 110 }];
    const notesTitle = notes.addRow(['HOW TO FILL IN THE YOUTH ROSTER']);
    notesTitle.font = { bold: true, size: 12 };
    [
      '',
      'First Name, Last Name, Birth Date and Gender are required. Everything else is optional.',
      'Birth Date: use YYYY-MM-DD (for example 2006-04-05). Members must be aged 15 to 30.',
      'Gender is recorded exactly as typed — write what the member tells you, not a fixed option.',
      'Contact Number: 09XXXXXXXXX or +639XXXXXXXXX.',
      'Registered Voter: Yes or No.',
      'Educational Attainment is free text; typed values are grouped with the existing ones.',
      '',
      'Delete the grey example row on the first sheet before importing.',
      'Municipality and barangay come from your account, not from this file — there is no column for them.',
      'The import shows you every row and what will happen to it before anything is saved.',
    ].forEach((line) => notes.addRow([line]));

  } else if (name === 'coa-liquidation') {
    const sheet = workbook.addWorksheet('Liquidation Report');
    sheet.mergeCells('A1:F1');
    const title = sheet.getCell('A1');
    title.value = 'LIQUIDATION REPORT';
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 30;

    sheet.mergeCells('A2:F2');
    sheet.getCell('A2').value = 'Commission on Audit Standard Form';
    sheet.getCell('A2').alignment = { horizontal: 'center' };
    sheet.addRow([]);

    styleMeta(sheet, null, 'Municipality:');
    styleMeta(sheet, null, 'Reference No.:');
    styleMeta(sheet, null, 'Date:');
    styleMeta(sheet, null, 'Fund Source:');
    styleMeta(sheet, null, 'Payee:');
    styleMeta(sheet, null, 'TIN:');
    sheet.addRow([]);

    const headerRow = sheet.addRow(['No.', 'Particulars', 'Reference No.', 'Gross Amount (₱)', 'Tax Withheld (₱)', 'Net Amount (₱)']);
    styleHeader(headerRow);

    for (let i = 1; i <= 15; i++) {
      const r = sheet.addRow([i, '', '', '', '', '']);
      r.getCell(4).numFmt = '"₱"#,##0.00';
      r.getCell(5).numFmt = '"₱"#,##0.00';
      r.getCell(6).numFmt = '"₱"#,##0.00';
      r.eachCell((cell) => { cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    }

    const lastData = headerRow.number + 15;
    const totals = sheet.addRow(['', 'TOTAL', '', { formula: `SUM(D${headerRow.number + 1}:D${lastData})` }, { formula: `SUM(E${headerRow.number + 1}:E${lastData})` }, { formula: `SUM(F${headerRow.number + 1}:F${lastData})` }]);
    totals.getCell(2).font = { bold: true };
    [4, 5, 6].forEach((c) => { totals.getCell(c).numFmt = '"₱"#,##0.00'; totals.getCell(c).font = { bold: true }; });
    styleHeader(totals);

    sheet.addRow([]);
    sheet.addRow(['CERTIFICATION:']);
    sheet.addRow(['I hereby certify that the above expenses were incurred in connection with official SK functions and are supported by valid receipts/documents.']);
    sheet.addRow([]);
    sheet.addRow(['Prepared by:', '', '', '', 'Approved by:', '']);
    sheet.addRow([]);
    sheet.addRow(['SK Treasurer', '', '', '', 'SK Chairperson', '']);

    sheet.columns = [
      { width: 5 }, { width: 35 }, { width: 16 },
      { width: 16 }, { width: 16 }, { width: 16 },
    ];
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=skims-template-${name}.xlsx`);
  await workbook.xlsx.write(res);
});
