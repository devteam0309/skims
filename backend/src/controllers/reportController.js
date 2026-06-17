const asyncHandler = require('express-async-handler');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const Program = require('../models/Program');

const formatPHP = (amount) =>
  `₱${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)}`;
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const Liquidation = require('../models/Liquidation');
const YouthMember = require('../models/YouthMember');
const { successResponse, errorResponse } = require('../utils/apiResponse');

const REPORT_LIMIT = 1000;

const municipalityScope = (req, filter) => {
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  }
};

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
  municipalityScope(req, filter);

  const programs = await Program.find(filter)
    .populate('municipality', 'name')
    .populate('barangay', 'name')
    .populate('createdBy', 'firstName lastName')
    .limit(REPORT_LIMIT);

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=program-report.pdf');
    doc.pipe(res);

    doc.fontSize(20).text('SKIMS — Program Accomplishment Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleDateString('en-PH')}`, { align: 'center' });
    doc.moveDown(2);

    programs.forEach((p, i) => {
      doc.fontSize(14).text(`${i + 1}. ${p.title}`);
      doc.fontSize(10)
        .text(`Municipality: ${p.municipality?.name || 'N/A'}`)
        .text(`Category: ${p.category}`)
        .text(`Status: ${p.status}`)
        .text(`Budget: ${formatPHP(p.budget)}`)
        .text(`Period: ${new Date(p.startDate).toLocaleDateString()} - ${new Date(p.endDate).toLocaleDateString()}`)
        .text(`Completion: ${p.completionRate}%`);
      doc.moveDown();
    });

    doc.end();
    return;
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Programs');

    sheet.columns = [
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Municipality', key: 'municipality', width: 15 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Budget (₱)', key: 'budget', width: 15 },
      { header: 'Start Date', key: 'startDate', width: 12 },
      { header: 'End Date', key: 'endDate', width: 12 },
      { header: 'Completion %', key: 'completionRate', width: 12 },
      { header: 'Participants', key: 'actualParticipants', width: 12 },
    ];

    programs.forEach((p) => {
      const row = sheet.addRow({
        title: p.title,
        municipality: p.municipality?.name,
        category: p.category,
        status: p.status,
        budget: p.budget,
        startDate: new Date(p.startDate).toLocaleDateString(),
        endDate: new Date(p.endDate).toLocaleDateString(),
        completionRate: p.completionRate,
        actualParticipants: p.actualParticipants,
      });
      row.getCell('budget').numFmt = '"₱"#,##0.00';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=program-report.xlsx');
    await workbook.xlsx.write(res);
    return;
  }

  successResponse(res, 200, 'Program report', programs);
});

exports.generateFinancialReport = asyncHandler(async (req, res) => {
  const { municipalityId, fiscalYear, format = 'json' } = req.query;
  const filter = { deletedAt: null };
  if (municipalityId) filter.municipality = municipalityId;
  municipalityScope(req, filter);

  const yr = fiscalYear ? parseInt(fiscalYear) : null;
  const yearStart = yr ? new Date(yr, 0, 1) : null;
  const yearEnd = yr ? new Date(yr, 11, 31, 23, 59, 59) : null;

  const [budgets, expenses, liquidations] = await Promise.all([
    Budget.find({ ...filter, fiscalYear: yr || { $exists: true } }).populate('municipality', 'name').limit(REPORT_LIMIT),
    Expense.find({ ...filter, ...(yearStart ? { transactionDate: { $gte: yearStart, $lte: yearEnd } } : {}) }).populate('program', 'title').populate('municipality', 'name').limit(REPORT_LIMIT),
    Liquidation.find({ ...filter, ...(yearStart ? { createdAt: { $gte: yearStart, $lte: yearEnd } } : {}) }).populate('program', 'title').populate('municipality', 'name').limit(REPORT_LIMIT),
  ]);

  const summary = {
    totalBudget: budgets.reduce((s, b) => s + b.totalBudget, 0),
    totalExpenses: expenses.reduce((s, e) => s + e.amount, 0),
    pendingLiquidation: liquidations.filter((l) => l.status !== 'approved').reduce((s, l) => s + l.totalAmount, 0),
  };

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Financial Report');

    sheet.addRow(['SKIMS Financial Report']);
    sheet.addRow([`Fiscal Year: ${fiscalYear || 'All'}`]);
    sheet.addRow([`Generated: ${new Date().toLocaleDateString('en-PH')}`]);
    sheet.addRow([]);

    const PHP_FMT = '"₱"#,##0.00';

    sheet.addRow(['BUDGET SUMMARY']);
    const budgetHeader = sheet.addRow(['Title', 'Municipality', 'Total Budget (₱)', 'Disbursed (₱)', 'Remaining (₱)', 'Status']);
    budgets.forEach((b) => {
      const row = sheet.addRow([b.title, b.municipality?.name, b.totalBudget, b.disbursedAmount, b.remainingBalance, b.status]);
      [3, 4, 5].forEach((col) => { row.getCell(col).numFmt = PHP_FMT; });
    });

    sheet.addRow([]);
    sheet.addRow(['EXPENSE SUMMARY']);
    const expenseHeader = sheet.addRow(['Reference', 'Title', 'Type', 'Amount (₱)', 'Date', 'Status']);
    expenses.forEach((e) => {
      const row = sheet.addRow([e.referenceNumber, e.title, e.type, e.amount, new Date(e.transactionDate).toLocaleDateString(), e.status]);
      row.getCell(4).numFmt = PHP_FMT;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=financial-report.xlsx');
    await workbook.xlsx.write(res);
    return;
  }

  successResponse(res, 200, 'Financial report', { budgets, expenses, liquidations, summary });
});

exports.generateYouthReport = asyncHandler(async (req, res) => {
  const { municipalityId, fiscalYear } = req.query;
  const filter = { deletedAt: null };
  if (municipalityId) filter.municipality = municipalityId;
  if (fiscalYear) {
    const yr = parseInt(fiscalYear);
    filter.createdAt = { $gte: new Date(yr, 0, 1), $lte: new Date(yr, 11, 31, 23, 59, 59) };
  }
  municipalityScope(req, filter);

  const members = await YouthMember.find(filter)
    .populate('municipality', 'name')
    .populate('barangay', 'name')
    .limit(REPORT_LIMIT);

  const genderBreakdown = { male: 0, female: 0, other: 0 };
  const educationBreakdown = {};
  members.forEach((m) => {
    genderBreakdown[m.gender] = (genderBreakdown[m.gender] || 0) + 1;
    if (m.educationalAttainment) {
      educationBreakdown[m.educationalAttainment] = (educationBreakdown[m.educationalAttainment] || 0) + 1;
    }
  });

  successResponse(res, 200, 'Youth report', { members, total: members.length, genderBreakdown, educationBreakdown });
});

const TEMPLATE_NAMES = ['abyip', 'cbydp', 'sk-accomplishment', 'coa-liquidation'];

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
