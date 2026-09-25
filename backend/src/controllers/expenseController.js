const asyncHandler = require('express-async-handler');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const Program = require('../models/Program');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const emailService = require('../services/emailService');
const { uploadToCloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { CROSS_MUNICIPALITY_READ, CROSS_MUNICIPALITY_WRITE } = require('../constants/roles');
const { applyReadScope, writeScopeViolation, createScopeViolation, forceScopeOnCreate, barangayScopeOf, idOf } = require('../utils/scope');
const { checkBarangay, barangayErrorMessage } = require('../utils/barangay');

const MAX_LIMIT = 100;
const { pickCreatable, pickWritable, toMutation } = require('../utils/writeFields');
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
  // Municipality and barangay both come from the account; a supplied barangay can only narrow.
  applyReadScope(filter, req.user, { requestedBarangay: req.query.barangay });

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

  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role)) {
    if (idOf(expense.municipality) !== idOf(req.user.municipality)) {
      return errorResponse(res, 403, 'Not authorized to view this expense');
    }
    const ownBarangay = barangayScopeOf(req.user);
    const expenseBarangay = idOf(expense.barangay);
    if (ownBarangay && expenseBarangay && expenseBarangay !== ownBarangay) {
      return errorResponse(res, 403, 'Not authorized to view this expense');
    }
  }
  successResponse(res, 200, 'Expense', expense);
});

exports.createExpense = asyncHandler(async (req, res) => {
  const ALLOWED_CREATE_FIELDS = ['type', 'title', 'description', 'amount', 'program', 'budget', 'municipality', 'barangay', 'vendor', 'transactionDate'];
  // Blanks dropped: an expense with no programme linked posts `program: ''`, which cannot be cast.
  const expenseData = pickCreatable(Expense, req.body, ALLOWED_CREATE_FIELDS);
  expenseData.createdBy = req.user._id;
  // Form submits a flat `vendorName` field (FormData); map it onto the nested vendor object
  if (req.body.vendorName) expenseData.vendor = { ...(expenseData.vendor || {}), name: req.body.vendorName };
  /*
   * Municipality and barangay are forced from the account for any scoped role — the body value is
   * ignored rather than checked, because a whitelist plus a "use mine if absent" fallback still
   * lets a scoped user file a record somewhere they cannot read.
   */
  const tamper = createScopeViolation(req.body, req.user);
  if (tamper) return errorResponse(res, 403, tamper.replace('records', 'expenses'));
  forceScopeOnCreate(expenseData, req.user);
  if (!expenseData.municipality) {
    return errorResponse(res, 400, 'A municipality is required to record an expense');
  }
  const brgyCheck = await checkBarangay(expenseData.barangay, idOf(expenseData.municipality));
  if (brgyCheck !== 'ok') return errorResponse(res, 400, barangayErrorMessage(brgyCheck));

  /*
   * The linked programme must be one the caller may actually see. Without this the programme is a
   * bare id: the form only offers programmes in scope, but a hand-built request could attach an
   * expense to another municipality's programme and, through it, to another municipality's budget.
   */
  if (expenseData.program) {
    const linked = await Program.findOne({ _id: expenseData.program, deletedAt: null }).select('municipality barangay');
    if (!linked) return errorResponse(res, 404, 'Program not found');
    if (writeScopeViolation(linked, req.user)) {
      return errorResponse(res, 403, 'That program belongs to another municipality or barangay');
    }
    if (idOf(linked.municipality) !== idOf(expenseData.municipality)) {
      return errorResponse(res, 400, 'The expense and its program must belong to the same municipality');
    }
  }

  // Opt-in draft, for a record being assembled before it goes up for review. Anything else keeps
  // the schema default of `pending`, so existing callers are unaffected.
  if (req.body.saveAsDraft === true || req.body.saveAsDraft === 'true') expenseData.status = 'draft';

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
  await AuditLog.create({ user: req.user._id, action: 'CREATE', resource: 'expense', resourceId: expense._id, details: { title: expense.title, amount: expense.amount, type: expense.type }, municipality: expense.municipality, ipAddress: req.ip });
  successResponse(res, 201, 'Expense created', expense);
});

exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense || expense.deletedAt) return errorResponse(res, 404, 'Expense not found');
  if (writeScopeViolation(expense, req.user)) return errorResponse(res, 403, 'Not authorized to update this expense');
  if (['approved', 'liquidated'].includes(expense.status)) {
    return errorResponse(res, 400, 'Approved or liquidated expenses cannot be edited');
  }
  const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'amount', 'vendor', 'transactionDate'];
  /*
   * transactionDate is required, so a blank one is ignored rather than unset — see utils/writeFields.
   * Clearing it would trade a CastError for a ValidationError and fail the edit either way.
   */
  const { set, unset } = pickWritable(Expense, req.body, ALLOWED_UPDATE_FIELDS);
  // Form submits a flat `vendorName` field (FormData); map it onto the nested vendor object
  if (req.body.vendorName) set.vendor = { ...(set.vendor || {}), name: req.body.vendorName };
  const updates = set;
  const cleared = unset;
  const updated = await Expense.findByIdAndUpdate(req.params.id, toMutation({ set, unset }), { new: true, runValidators: true });
  await AuditLog.create({ user: req.user._id, action: 'UPDATE', resource: 'expense', resourceId: expense._id, details: { changes: [...Object.keys(updates), ...cleared] }, municipality: expense.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Expense updated', updated);
});


/*
 * Spending against an approved program converts an encumbrance into an actual disbursement, so
 * the commitment has to shrink by the same amount — otherwise the money is reserved twice and
 * availableBalance under-reports what the municipality can still use for the rest of the year.
 * Releases at most what is still committed, so an overspend cannot drive the figure negative.
 */
const releaseCommitment = async (programId, amount) => {
  if (!programId || !amount) return;
  const prog = await Program.findById(programId).select('committedAmount budgetRef');
  if (!prog?.committedAmount) return;
  const release = Math.min(prog.committedAmount, amount);
  if (release <= 0) return;
  await Program.updateOne({ _id: prog._id }, { $inc: { committedAmount: -release } });
  if (prog.budgetRef) {
    await Budget.updateOne({ _id: prog.budgetRef }, { $inc: { committedAmount: -release } });
  }
};

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

  if (writeScopeViolation(expense, req.user)) {
    return errorResponse(res, 403, 'Not authorized to approve expenses for this municipality');
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
    await releaseCommitment(approved.program, approved.amount);
  }

  await AuditLog.create({ user: req.user._id, action: 'APPROVE', resource: 'expense', resourceId: approved._id, details: { amount: approved.amount, referenceNumber: approved.referenceNumber }, municipality: approved.municipality, ipAddress: req.ip });

  User.findById(approved.createdBy).select('email firstName').then((creator) => {
    if (creator) emailService.sendExpenseApproved(creator, approved).catch(() => {});
  }).catch(() => {});

  successResponse(res, 200, 'Expense approved', approved);
});

/**
 * draft ──▶ pending. The treasurer's own act of sending a prepared record up for review.
 *
 * Separate from approval on purpose: the officer who records money never decides on it.
 */
exports.submitExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, deletedAt: null });
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (writeScopeViolation(expense, req.user)) return errorResponse(res, 403, 'Not authorized to submit this expense');

  // Atomic on the expected state, so two clicks cannot both move it out of draft.
  const submitted = await Expense.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['draft', 'rejected'] } },
    { status: 'pending', submittedAt: new Date(), $unset: { rejectionReason: '', rejectedBy: '', rejectedAt: '' } },
    { new: true }
  );
  if (!submitted) return errorResponse(res, 409, 'Only a draft or returned expense can be submitted for review');

  await AuditLog.create({
    user: req.user._id, action: 'SUBMIT', resource: 'expense', resourceId: submitted._id,
    oldValues: { status: expense.status }, newValues: { status: 'pending' },
    details: { referenceNumber: submitted.referenceNumber, amount: submitted.amount },
    municipality: submitted.municipality, ipAddress: req.ip,
  });

  successResponse(res, 200, 'Expense submitted for review', submitted);
});

/**
 * pending ──▶ rejected, with a reason.
 *
 * The status existed in the schema from the beginning and nothing ever wrote it: an administrator
 * reviewing an expense could only approve it, so the only way to refuse one was to leave it pending
 * for ever — indistinguishable, on screen, from one nobody had looked at yet.
 *
 * The reason is required. A returned record with no explanation tells the treasurer nothing about
 * what to change, and leaves the audit trail unable to show the basis for the decision.
 */
exports.rejectExpense = asyncHandler(async (req, res) => {
  const reason = (req.body.rejectionReason || req.body.reason || '').trim();
  if (!reason) return errorResponse(res, 400, 'A reason is required when returning an expense');

  const expense = await Expense.findOne({ _id: req.params.id, deletedAt: null });
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (expense.status !== 'pending') {
    return errorResponse(res, 400, 'Only a pending expense can be returned');
  }
  if (writeScopeViolation(expense, req.user)) {
    return errorResponse(res, 403, 'Not authorized to review expenses for this municipality');
  }

  /*
   * Atomic on the expected state. Approval and rejection race each other through the same screen,
   * and whichever lands second must be told so rather than overwriting the first silently.
   */
  const rejected = await Expense.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status: 'rejected', rejectionReason: reason, rejectedBy: req.user._id, rejectedAt: new Date() },
    { new: true }
  );
  if (!rejected) return errorResponse(res, 409, 'Expense was already processed by another user');

  /*
   * No budget or programme figures move. A rejection disburses nothing, so there is nothing to
   * reverse — which is exactly why it must not be reachable once an expense has been approved.
   */
  await AuditLog.create({
    user: req.user._id, action: 'REJECT', resource: 'expense', resourceId: rejected._id,
    oldValues: { status: 'pending' }, newValues: { status: 'rejected', rejectionReason: reason },
    details: { referenceNumber: rejected.referenceNumber, amount: rejected.amount, rejectionReason: reason },
    municipality: rejected.municipality, ipAddress: req.ip,
  });

  const creator = await User.findById(rejected.createdBy).select('email firstName');
  if (creator) {
    await Notification.create({
      recipient: creator._id,
      type: 'approval_rejected',
      title: 'Expense Returned',
      message: `Expense "${rejected.title}" (${rejected.referenceNumber}) was returned: ${reason}`,
      link: '/expenses',
      priority: 'high',
    });
    emailService.sendExpenseRejected(creator, rejected).catch(() => {});
  }

  successResponse(res, 200, 'Expense returned', rejected);
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
  /*
   * Scoped with the same helper as everything else, so a bulk call cannot reach further than the
   * single-record route it batches. `{ $in: [] }` for an account with no municipality.
   */
  if (!CROSS_MUNICIPALITY_WRITE.includes(req.user.role)) {
    filter.municipality = idOf(req.user.municipality) || { $in: [] };
    const ownBarangay = barangayScopeOf(req.user);
    if (ownBarangay) filter.barangay = { $in: [ownBarangay, null] };
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

  // Mirrors the single-approve path: bulk approval must release encumbrances too, or the same
  // pesos stay both committed and disbursed.
  for (const [programId, amount] of Object.entries(programIncrements)) {
    await releaseCommitment(programId, amount);
  }

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
  /*
   * This route is open to ADMINS, which includes municipal_admin — a scoped role. Without a check a
   * Boac administrator could delete a Santa Cruz expense: the handler had none at all, while every
   * other expense mutation guarded it.
   */
  if (writeScopeViolation(expense, req.user)) return errorResponse(res, 403, 'Not authorized to delete this expense');
  if (['approved', 'liquidated'].includes(expense.status)) {
    return errorResponse(res, 400, 'Approved or liquidated expenses cannot be deleted');
  }
  expense.deletedAt = new Date();
  await expense.save();
  await AuditLog.create({ user: req.user._id, action: 'DELETE', resource: 'expense', resourceId: expense._id, details: { title: expense.title, amount: expense.amount, referenceNumber: expense.referenceNumber }, municipality: expense.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Expense deleted');
});

exports.getExpenseSummary = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };

  if (CROSS_MUNICIPALITY_READ.includes(req.user.role) && req.query.municipality) {
    filter.municipality = req.query.municipality;
  }
  applyReadScope(filter, req.user, { requestedBarangay: req.query.barangay });

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
