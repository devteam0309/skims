const asyncHandler = require('express-async-handler');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const Program = require('../models/Program');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const emailService = require('../services/emailService');
const { uploadToCloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.getExpenses = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, program, type, status, startDate, endDate, search } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (program) filter.program = program;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (search) filter.$or = [
    { title: { $regex: escapeRegex(search), $options: 'i' } },
    { referenceNumber: { $regex: escapeRegex(search), $options: 'i' } },
  ];
  if (startDate || endDate) {
    filter.transactionDate = {};
    if (startDate) filter.transactionDate.$gte = new Date(startDate);
    if (endDate) filter.transactionDate.$lte = new Date(endDate);
  }
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  }

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate('program', 'title')
      .populate('budget', 'title fiscalYear')
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .sort({ transactionDate: -1 })
      .skip(skip)
      .limit(safeLimit),
    Expense.countDocuments(filter),
  ]);
  paginatedResponse(res, expenses, safePage, safeLimit, total);
});

exports.getExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id)
    .populate('program', 'title category')
    .populate('budget', 'title fiscalYear')
    .populate('municipality', 'name')
    .populate('createdBy', 'firstName lastName');
  if (!expense || expense.deletedAt) return errorResponse(res, 404, 'Expense not found');

  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (expense.municipality?._id?.toString() !== userMunId && expense.municipality?.toString() !== userMunId) {
      return errorResponse(res, 403, 'Not authorized to view this expense');
    }
  }
  successResponse(res, 200, 'Expense', expense);
});

exports.createExpense = asyncHandler(async (req, res) => {
  const ALLOWED_CREATE_FIELDS = ['type', 'title', 'description', 'amount', 'program', 'budget', 'municipality', 'barangay', 'vendor', 'transactionDate'];
  const expenseData = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED_CREATE_FIELDS.includes(k))
  );
  expenseData.createdBy = req.user._id;
  // Form submits a flat `vendorName` field (FormData); map it onto the nested vendor object
  if (req.body.vendorName) expenseData.vendor = { ...(expenseData.vendor || {}), name: req.body.vendorName };
  if (!expenseData.municipality) expenseData.municipality = req.user.municipality?._id || req.user.municipality;

  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (expenseData.municipality?.toString() !== userMunId) {
      return errorResponse(res, 403, 'Cannot create expenses for another municipality');
    }
  }

  if (expenseData.budget) {
    const budget = await Budget.findById(expenseData.budget);
    if (!budget) return errorResponse(res, 404, 'Budget not found');
    if (budget.status !== 'approved') return errorResponse(res, 400, 'Expenses can only be charged to an approved budget');
    if (expenseData.amount > budget.remainingBalance) {
      const bal = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(budget.remainingBalance);
      return errorResponse(res, 400, `Expense amount exceeds remaining budget balance (₱${bal})`);
    }

    // Enforce per-program allocation limit when budget has program-linked allocations
    if (expenseData.program) {
      const programAlloc = budget.allocations.find(
        (a) => a.program?.toString() === expenseData.program.toString()
      );
      if (programAlloc) {
        const [spentResult] = await Expense.aggregate([
          {
            $match: {
              budget: budget._id,
              program: new mongoose.Types.ObjectId(expenseData.program),
              status: { $in: ['pending', 'approved'] },
              deletedAt: null,
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        const alreadySpent = spentResult?.total || 0;
        if (alreadySpent + parseFloat(expenseData.amount) > programAlloc.amount) {
          const fmt = (n) => new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
          return errorResponse(
            res, 400,
            `Expense exceeds program allocation of ₱${fmt(programAlloc.amount)}. Already spent: ₱${fmt(alreadySpent)}, remaining: ₱${fmt(programAlloc.amount - alreadySpent)}`
          );
        }
      }

      // Enforce category-level allocation: derive category from linked program
      const linkedProgram = await Program.findById(expenseData.program).select('category');
      if (linkedProgram?.category) {
        const categoryAlloc = budget.allocations.find(
          (a) => a.category?.toLowerCase() === linkedProgram.category?.toLowerCase() && !a.program
        );
        if (categoryAlloc) {
          // Sum all expenses for programs of this category against this budget
          const categoryPrograms = await Program.find({ category: linkedProgram.category, municipality: budget.municipality }).select('_id');
          const categoryProgramIds = categoryPrograms.map((p) => p._id);
          const [catSpentResult] = await Expense.aggregate([
            {
              $match: {
                budget: budget._id,
                program: { $in: categoryProgramIds },
                status: { $in: ['pending', 'approved'] },
                deletedAt: null,
              },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]);
          const catAlreadySpent = catSpentResult?.total || 0;
          if (catAlreadySpent + parseFloat(expenseData.amount) > categoryAlloc.amount) {
            const fmt = (n) => new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
            return errorResponse(
              res, 400,
              `Expense exceeds the ${linkedProgram.category} category allocation of ₱${fmt(categoryAlloc.amount)}. Already spent: ₱${fmt(catAlreadySpent)}, remaining: ₱${fmt(categoryAlloc.amount - catAlreadySpent)}`
            );
          }
        }
      }
    }
  }

  // Upload attachments to Cloudinary (memoryStorage — f.buffer is available, f.filename is not)
  if (req.files && req.files.length > 0) {
    const uploaded = await Promise.all(
      req.files.map((f) =>
        uploadToCloudinary(f.buffer, { folder: 'skims/documents', resource_type: 'raw', public_id: randomUUID() })
          .then((r) => ({ fileName: f.originalname, fileUrl: r.secure_url, fileType: f.mimetype }))
      )
    );
    expenseData.attachments = uploaded;
  }

  const expense = await Expense.create(expenseData);
  await AuditLog.create({ user: req.user._id, action: 'CREATE', resource: 'expense', resourceId: expense._id, details: { title: expense.title, amount: expense.amount, type: expense.type }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 201, 'Expense created', expense);
});

exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense || expense.deletedAt) return errorResponse(res, 404, 'Expense not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (expense.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to update this expense');
  }
  if (['approved', 'liquidated'].includes(expense.status)) {
    return errorResponse(res, 400, 'Approved or liquidated expenses cannot be edited');
  }
  const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'amount', 'vendor', 'transactionDate'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k))
  );
  // Form submits a flat `vendorName` field (FormData); map it onto the nested vendor object
  if (req.body.vendorName) updates.vendor = { ...(updates.vendor || {}), name: req.body.vendorName };
  const updated = await Expense.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  await AuditLog.create({ user: req.user._id, action: 'UPDATE', resource: 'expense', resourceId: expense._id, details: { changes: Object.keys(updates) }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Expense updated', updated);
});

exports.approveExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, deletedAt: null });
  if (!expense) return errorResponse(res, 404, 'Expense not found');

  if (expense.status !== 'pending') {
    return errorResponse(res, 400, 'Only pending expenses can be approved');
  }

  // Block self-approval
  if (expense.createdBy?.toString() === req.user._id.toString()) {
    return errorResponse(res, 403, 'You cannot approve an expense you created');
  }

  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (expense.municipality?.toString() !== userMunId) {
      return errorResponse(res, 403, 'Not authorized to approve expenses for this municipality');
    }
  }

  const approved = await Expense.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status: 'approved', approvedBy: req.user._id, approvedAt: new Date() },
    { new: true }
  );
  if (!approved) return errorResponse(res, 409, 'Expense was already processed by another user');

  // Update Budget disbursedAmount — prefer direct link, fall back to program's budgetRef
  let budgetIdToUpdate = approved.budget;
  if (!budgetIdToUpdate && approved.program) {
    const prog = await Program.findById(approved.program).select('budgetRef');
    if (prog?.budgetRef) budgetIdToUpdate = prog.budgetRef;
  }
  if (budgetIdToUpdate) {
    await Budget.findByIdAndUpdate(budgetIdToUpdate, [
      { $set: { disbursedAmount: { $add: ['$disbursedAmount', approved.amount] } } },
      { $set: { remainingBalance: { $subtract: ['$totalBudget', '$disbursedAmount'] } } },
    ]);
  }

  if (approved.program) {
    await Program.findByIdAndUpdate(approved.program, { $inc: { actualExpenses: approved.amount } });
  }

  await AuditLog.create({ user: req.user._id, action: 'APPROVE', resource: 'expense', resourceId: approved._id, details: { amount: approved.amount, referenceNumber: approved.referenceNumber }, ipAddress: req.ip });

  User.findById(approved.createdBy).select('email firstName').then((creator) => {
    if (creator) emailService.sendExpenseApproved(creator, approved).catch(() => {});
  }).catch(() => {});

  successResponse(res, 200, 'Expense approved', approved);
});

exports.bulkApproveExpenses = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse(res, 400, 'No expense IDs provided');
  if (ids.length > 50) return errorResponse(res, 400, 'Cannot bulk approve more than 50 expenses at once');

  const filter = {
    _id: { $in: ids },
    status: 'pending',
    createdBy: { $ne: req.user._id },
    deletedAt: null,
  };
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    filter.municipality = req.user.municipality?._id || req.user.municipality;
  }

  const toApprove = await Expense.find(filter).select('_id amount budget program createdBy title referenceNumber');
  if (toApprove.length === 0) {
    return errorResponse(res, 400, 'No eligible expenses found. Expenses may already be approved, self-created, or outside your municipality.');
  }

  const approveIds = toApprove.map((e) => e._id);
  await Expense.updateMany(
    { _id: { $in: approveIds } },
    { $set: { status: 'approved', approvedBy: req.user._id, approvedAt: new Date() } }
  );

  // Group budget and program increments
  const budgetIncrements = {};
  const programIncrements = {};
  const needsFallback = [];
  for (const e of toApprove) {
    if (e.budget) {
      budgetIncrements[e.budget] = (budgetIncrements[e.budget] || 0) + e.amount;
    } else if (e.program) {
      needsFallback.push({ programId: e.program, amount: e.amount });
    }
    if (e.program) {
      programIncrements[e.program] = (programIncrements[e.program] || 0) + e.amount;
    }
  }

  // Resolve program → budgetRef for expenses without a direct budget link
  if (needsFallback.length > 0) {
    const uniqueProgIds = [...new Set(needsFallback.map((p) => p.programId.toString()))];
    const progs = await Program.find({ _id: { $in: uniqueProgIds } }).select('_id budgetRef');
    const progBudgetMap = Object.fromEntries(progs.filter((p) => p.budgetRef).map((p) => [p._id.toString(), p.budgetRef]));
    for (const { programId, amount } of needsFallback) {
      const budgetId = progBudgetMap[programId.toString()];
      if (budgetId) budgetIncrements[budgetId] = (budgetIncrements[budgetId] || 0) + amount;
    }
  }

  await Promise.all([
    ...Object.entries(budgetIncrements).map(([budgetId, amount]) =>
      Budget.findByIdAndUpdate(budgetId, [
        { $set: { disbursedAmount: { $add: ['$disbursedAmount', amount] } } },
        { $set: { remainingBalance: { $subtract: ['$totalBudget', '$disbursedAmount'] } } },
      ])
    ),
    ...Object.entries(programIncrements).map(([programId, amount]) =>
      Program.findByIdAndUpdate(programId, { $inc: { actualExpenses: amount } })
    ),
  ]);

  await AuditLog.create({
    user: req.user._id, action: 'BULK_APPROVE', resource: 'expense',
    details: { approved: toApprove.length, requestedCount: ids.length },
    municipality: req.user.municipality, ipAddress: req.ip,
  });

  // Notify each creator their expense was approved (fire-and-forget, mirrors single approveExpense)
  const creatorIds = [...new Set(toApprove.map((e) => e.createdBy?.toString()).filter(Boolean))];
  User.find({ _id: { $in: creatorIds } }).select('email firstName').then((creators) => {
    const byId = Object.fromEntries(creators.map((c) => [c._id.toString(), c]));
    for (const e of toApprove) {
      const creator = byId[e.createdBy?.toString()];
      if (creator) emailService.sendExpenseApproved(creator, e).catch(() => {});
    }
  }).catch(() => {});

  successResponse(res, 200, `${toApprove.length} expense(s) approved`, {
    approved: toApprove.length,
    skipped: ids.length - toApprove.length,
  });
});

exports.deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense || expense.deletedAt) return errorResponse(res, 404, 'Expense not found');
  if (['approved', 'liquidated'].includes(expense.status)) {
    return errorResponse(res, 400, 'Approved or liquidated expenses cannot be deleted');
  }
  expense.deletedAt = new Date();
  await expense.save();
  successResponse(res, 200, 'Expense deleted');
});

exports.getExpenseSummary = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };

  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  } else if (req.query.municipality) {
    filter.municipality = req.query.municipality;
  }

  if (req.query.program) filter.program = req.query.program;

  const [byType, monthly, total] = await Promise.all([
    Expense.aggregate([
      { $match: filter },
      { $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { year: { $year: '$transactionDate' }, month: { $month: '$transactionDate' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Expense.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);

  successResponse(res, 200, 'Expense summary', { byType, monthly, total: total[0]?.total || 0 });
});
