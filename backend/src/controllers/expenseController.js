const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const Program = require('../models/Program');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { CROSS_MUNICIPALITY_READ, ADMINS } = require('../constants/roles');
const {
  applyReadScope, writeScopeViolation, readScopeViolation, createScopeViolation, forceScopeOnCreate, idOf, objectIdOf,
} = require('../utils/scope');
const { checkBarangay, barangayErrorMessage } = require('../utils/barangay');
const { normalizeLabel } = require('../utils/labels');
const { storeFiles, removeFile, sendFile } = require('../services/fileStorage');
const { storageRefOf } = require('../models/schemas/attachment');
const { municipalBudgetAvailability, peso } = require('../utils/budgetTotals');
const { withTransaction, sessionOpts, httpError } = require('../utils/transaction');
const { sendQuietly } = require('../utils/mail');

const MAX_LIMIT = 100;
const { pickCreatable, pickWritable, toMutation } = require('../utils/writeFields');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * Finance is STRICT barangay scope (utils/scope.js): a barangay officer reads and writes only their
 * own barangay's expenses — never a neighbour's and never the municipality's own spending. The
 * creator exception keeps expenses a treasurer recorded before their account had a barangay visible
 * to them until the migration files those under their barangay.
 */
const EXPENSE_SCOPE = { strict: true, ownerField: 'createdBy' };

// Statuses in which the treasurer can still change the record. A rejected expense is final.
const EDITABLE = ['draft', 'pending', 'returned'];

/** Store uploaded proof and describe each file with the type the uploader gave it. */
const storeAttachments = async (req) => {
  const files = req.files || [];
  if (!files.length) return [];
  const types = [].concat(req.body.documentTypes || []);
  const stored = await storeFiles(files, { folder: 'skims/expenses' });
  return stored.map((ref, i) => ({
    ...ref,
    documentType: types[i] ? normalizeLabel(String(types[i])) : undefined,
    uploadedBy: req.user._id,
  }));
};

/**
 * An expense may only be charged to its own level's budget: a barangay's expense to that barangay's
 * allocation, a municipality-level expense to the municipal budget. This is the rule that keeps a
 * barangay from spending the municipality's total — or a neighbour's allocation — as its own.
 */
const budgetLinkProblem = (budget, expense) => {
  if (idOf(budget.municipality) !== idOf(expense.municipality)) return 'That budget belongs to another municipality';
  if (idOf(budget.barangay) !== idOf(expense.barangay)) {
    return expense.barangay
      ? 'A barangay\'s expenses can only be charged to that barangay\'s own budget allocation'
      : 'A municipality-level expense can only be charged to the municipal budget';
  }
  if (budget.status !== 'approved') return 'Expenses can only be charged to an approved budget';
  return null;
};

/**
 * The most an expense may bring a budget's disbursements up to. For a barangay allocation that is
 * the allocation itself. For the municipal budget it is the total less every approved barangay
 * allocation — the municipality's own spending must not eat into money already given to barangays.
 */
const spendingCeiling = async (budget, session = null) => {
  if (budget.barangay) return budget.totalBudget;
  const { allocated } = await municipalBudgetAvailability(budget, { session });
  return budget.totalBudget - allocated;
};

/** Reviewers of a municipality's expenses: its own administrators. */
const notifyReviewers = async (expense, title, message) => {
  const reviewers = await User.find({
    role: 'municipal_admin', municipality: expense.municipality, isActive: true, isApproved: true, deletedAt: null,
  }).select('_id').lean();
  if (!reviewers.length) return;
  await Notification.createWithExpiry(reviewers.map((r) => ({
    recipient: r._id, type: 'approval_request', title, message, link: '/expenses', priority: 'high',
  })));
};

const audit = (req, expense, action, extra = {}) => AuditLog.create({
  user: req.user._id, action, resource: 'expense', resourceId: expense._id,
  municipality: expense.municipality?._id || expense.municipality, ipAddress: req.ip,
  ...extra,
  details: {
    referenceNumber: expense.referenceNumber, amount: expense.amount, barangay: expense.barangay?._id || expense.barangay || null,
    ...(extra.details || {}),
  },
});

exports.getExpenses = asyncHandler(async (req, res) => {
  const { municipality, program, type, status, startDate, endDate, search, budget } = req.query;
  const filter = { deletedAt: null };
  if (municipality && CROSS_MUNICIPALITY_READ.includes(req.user.role)) filter.municipality = municipality;
  if (program) filter.program = program;
  if (budget) filter.budget = budget;
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
  applyReadScope(filter, req.user, { ...EXPENSE_SCOPE, requestedBarangay: req.query.barangay });

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate('program', 'title')
      .populate('budget', 'title fiscalYear barangay')
      .populate('barangay', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .sort({ transactionDate: -1 })
      .skip(skip)
      .limit(safeLimit),
    Expense.countDocuments(filter),
  ]);
  paginatedResponse(res, expenses, safePage, safeLimit, total);
});

/**
 * Everything a reviewer needs on one record: amount, date, purpose, the programme and barangay it
 * belongs to, the budget it is charged to, who recorded and who decided it — and the list of
 * attached proof, each openable through GET /:id/attachments/:attachmentId.
 */
exports.getExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id)
    .populate('program', 'title category')
    .populate('budget', 'title fiscalYear barangay totalBudget disbursedAmount remainingBalance status')
    .populate('municipality', 'name')
    .populate('barangay', 'name')
    .populate('createdBy', 'firstName lastName role')
    .populate('approvedBy', 'firstName lastName')
    .populate('rejectedBy', 'firstName lastName')
    .populate('returnedBy', 'firstName lastName')
    .populate('attachments.uploadedBy', 'firstName lastName');
  if (!expense || expense.deletedAt) return errorResponse(res, 404, 'Expense not found');
  if (readScopeViolation(expense, req.user, EXPENSE_SCOPE)) return errorResponse(res, 403, 'Not authorized to view this expense');
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
  const asDraft = req.body.saveAsDraft === true || req.body.saveAsDraft === 'true';
  if (asDraft) expenseData.status = 'draft';

  if (expenseData.budget) {
    const budget = await Budget.findOne({ _id: expenseData.budget, deletedAt: null });
    if (!budget) return errorResponse(res, 404, 'Budget not found');
    const linkProblem = budgetLinkProblem(budget, expenseData);
    if (linkProblem) return errorResponse(res, 400, linkProblem);

    const ceiling = await spendingCeiling(budget);
    const left = ceiling - (budget.disbursedAmount || 0);
    if (parseFloat(expenseData.amount) > left) {
      return errorResponse(res, 400, `Expense amount exceeds the remaining budget balance (${peso(Math.max(0, left))})`);
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
          return errorResponse(
            res, 400,
            `Expense exceeds program allocation of ${peso(programAlloc.amount)}. Already spent: ${peso(alreadySpent)}, remaining: ${peso(programAlloc.amount - alreadySpent)}`
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
            return errorResponse(
              res, 400,
              `Expense exceeds the ${linkedProgram.category} category allocation of ${peso(categoryAlloc.amount)}. Already spent: ${peso(catAlreadySpent)}, remaining: ${peso(categoryAlloc.amount - catAlreadySpent)}`
            );
          }
        }
      }
    }
  }

  /*
   * Proof is required to send an expense for review. A draft may be saved without it — it is by
   * definition unfinished — but it cannot be submitted, and nothing can be approved, until a
   * receipt, invoice or voucher is attached. Checked after the budget rules, so an expense that
   * could never be charged says why rather than asking for paperwork first.
   */
  if (!asDraft && !(req.files?.length > 0)) {
    return errorResponse(res, 400, 'Attach at least one supporting document (official receipt, invoice, voucher or other proof) before submitting an expense for review. You can save it as a draft meanwhile.');
  }

  const attachments = await storeAttachments(req);
  expenseData.attachments = attachments;
  if (!asDraft) expenseData.submittedAt = new Date();

  let expense;
  try {
    expense = await Expense.create(expenseData);
  } catch (err) {
    attachments.forEach(removeFile);
    throw err;
  }
  await audit(req, expense, 'CREATE', {
    newValues: { status: expense.status },
    details: { title: expense.title, type: expense.type, attachments: attachments.length },
  });
  if (expense.status === 'pending') {
    await notifyReviewers(expense, 'Expense Awaiting Review', `Expense "${expense.title}" (${expense.referenceNumber}) for ${peso(expense.amount)} was submitted for review.`);
  }
  successResponse(res, 201, 'Expense created', expense);
});

exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense || expense.deletedAt) return errorResponse(res, 404, 'Expense not found');
  if (writeScopeViolation(expense, req.user, EXPENSE_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this expense');
  if (!EDITABLE.includes(expense.status)) {
    return errorResponse(res, 400, expense.status === 'rejected'
      ? 'A rejected expense is final and cannot be edited'
      : 'Approved or liquidated expenses cannot be edited');
  }
  const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'amount', 'vendor', 'transactionDate'];
  /*
   * transactionDate is required, so a blank one is ignored rather than unset — see utils/writeFields.
   * Clearing it would trade a CastError for a ValidationError and fail the edit either way.
   */
  const { set, unset } = pickWritable(Expense, req.body, ALLOWED_UPDATE_FIELDS);
  // Form submits a flat `vendorName` field (FormData); map it onto the nested vendor object
  if (req.body.vendorName) set.vendor = { ...(set.vendor || {}), name: req.body.vendorName };

  // A higher amount must still fit the budget it is charged to.
  if (set.amount !== undefined && expense.budget) {
    const budget = await Budget.findById(expense.budget);
    if (budget) {
      const left = (await spendingCeiling(budget)) - (budget.disbursedAmount || 0);
      if (parseFloat(set.amount) > left) {
        return errorResponse(res, 400, `Expense amount exceeds the remaining budget balance (${peso(Math.max(0, left))})`);
      }
    }
  }

  const updated = await Expense.findByIdAndUpdate(req.params.id, toMutation({ set, unset }), { new: true, runValidators: true });
  await audit(req, expense, 'UPDATE', {
    oldValues: { amount: expense.amount, title: expense.title },
    newValues: { amount: updated.amount, title: updated.title },
    details: { changes: [...Object.keys(set), ...unset] },
  });
  successResponse(res, 200, 'Expense updated', updated);
});

/**
 * Add proof to an expense that is still with its author — a draft, one awaiting review, or one
 * returned for "additional supporting documents".
 */
exports.addAttachments = asyncHandler(async (req, res) => {
  if (!(req.files?.length > 0)) return errorResponse(res, 400, 'Choose at least one file to attach');
  const expense = await Expense.findOne({ _id: req.params.id, deletedAt: null });
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (writeScopeViolation(expense, req.user, EXPENSE_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this expense');
  if (!EDITABLE.includes(expense.status)) return errorResponse(res, 400, 'Attachments can only be added before an expense is approved');
  if ((expense.attachments?.length || 0) + req.files.length > 10) {
    return errorResponse(res, 400, 'An expense can carry at most 10 attachments');
  }

  const attachments = await storeAttachments(req);
  const updated = await Expense.findOneAndUpdate(
    { _id: expense._id, status: { $in: EDITABLE }, deletedAt: null },
    { $push: { attachments: { $each: attachments } } },
    { new: true }
  );
  if (!updated) {
    attachments.forEach(removeFile);
    return errorResponse(res, 409, 'The expense was decided while you were attaching files; reload it');
  }
  await audit(req, expense, 'UPLOAD', { details: { attachmentsAdded: attachments.length } });
  successResponse(res, 200, 'Attachments added', updated);
});

/**
 * Open one attachment — inline for preview with `?inline=1`, otherwise as a download. Readable by
 * whoever can read the expense: its barangay's officers, and the municipality's reviewers.
 */
exports.serveAttachment = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id).select('municipality barangay createdBy attachments deletedAt referenceNumber');
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (expense.deletedAt && !ADMINS.includes(req.user.role)) return errorResponse(res, 404, 'Expense not found');
  if (readScopeViolation(expense, req.user, EXPENSE_SCOPE)) return errorResponse(res, 403, 'Not authorized to view this expense');
  const attachment = expense.attachments.id(req.params.attachmentId);
  if (!attachment) return errorResponse(res, 404, 'Attachment not found');
  const inline = req.query.inline === '1' || req.query.inline === 'true';
  return sendFile(res, storageRefOf(attachment), { disposition: inline ? 'inline' : 'attachment' });
});

/*
 * Spending against an approved program converts an encumbrance into an actual disbursement, so
 * the commitment has to shrink by the same amount — otherwise the money is reserved twice and
 * availableBalance under-reports what the municipality can still use for the rest of the year.
 * Releases at most what is still committed, so an overspend cannot drive the figure negative.
 * Returns how much was released, which the expense records so a reversal can put it back.
 */
const releaseCommitment = async (programId, amount, session = null) => {
  if (!programId || !amount) return 0;
  const opts = sessionOpts(session);
  const prog = await Program.findById(programId, 'committedAmount budgetRef', opts);
  if (!prog?.committedAmount) return 0;
  const release = Math.min(prog.committedAmount, amount);
  if (release <= 0) return 0;
  await Program.updateOne({ _id: prog._id }, { $inc: { committedAmount: -release } }, opts);
  if (prog.budgetRef) {
    await Budget.updateOne({ _id: prog.budgetRef }, { $inc: { committedAmount: -release } }, opts);
  }
  return release;
};

/** The budget an approved expense is charged to: its own link, or its programme's when it has none. */
const budgetToCharge = async (expense, session) => {
  if (expense.budget) return expense.budget;
  if (!expense.program) return null;
  const prog = await Program.findById(expense.program, 'budgetRef barangay', sessionOpts(session));
  // Only a programme budget at the expense's own level — never a barangay expense into the municipal total.
  if (prog?.budgetRef && idOf(prog.barangay) === idOf(expense.barangay)) return prog.budgetRef;
  return null;
};

/**
 * Approve ONE expense: the status change, the deduction and the programme figures as one unit.
 *
 * The claim is atomic on `pending` (and on the expense carrying proof, and not being the approver's
 * own), so a second approval — a double click, a second reviewer, a bulk run overlapping a single
 * one — finds nothing to claim and deducts nothing. The deduction is conditional on the budget
 * still having room, so concurrent approvals cannot overdraw it between them.
 *
 * With a transaction (replica set) a refused deduction rolls the claim back automatically. Without
 * one, the claim is undone by hand — see utils/transaction.js.
 */
const approveOne = async (expenseId, approver, session) => {
  const opts = sessionOpts(session);
  const claimed = await Expense.findOneAndUpdate(
    {
      _id: expenseId, status: 'pending', deletedAt: null,
      createdBy: { $ne: approver._id },
      'attachments.0': { $exists: true },
    },
    { status: 'approved', approvedBy: approver._id, approvedAt: new Date() },
    { new: true, ...opts }
  );
  if (!claimed) throw httpError(409, 'Expense was already processed by another user');

  try {
    const budgetId = await budgetToCharge(claimed, session);
    if (budgetId) {
      const budget = await Budget.findById(budgetId, null, opts);
      if (!budget || budget.deletedAt) throw httpError(400, 'The budget this expense is charged to no longer exists');
      const ceiling = await spendingCeiling(budget, session);
      const charged = await Budget.findOneAndUpdate(
        {
          _id: budgetId, status: 'approved', deletedAt: null,
          $expr: { $lte: [{ $add: ['$disbursedAmount', claimed.amount] }, ceiling] },
        },
        [
          { $set: { disbursedAmount: { $add: ['$disbursedAmount', claimed.amount] } } },
          { $set: { remainingBalance: { $subtract: ['$totalBudget', '$disbursedAmount'] } } },
        ],
        { new: true, ...opts }
      );
      if (!charged) {
        throw httpError(400, `Approving this expense would overdraw its budget: only ${peso(Math.max(0, ceiling - (budget.disbursedAmount || 0)))} remains`);
      }
    }

    let released = 0;
    if (claimed.program) {
      await Program.updateOne({ _id: claimed.program }, { $inc: { actualExpenses: claimed.amount } }, opts);
      released = await releaseCommitment(claimed.program, claimed.amount, session);
    }
    await Expense.updateOne({ _id: claimed._id }, { chargedBudget: budgetId || null, commitmentReleased: released }, opts);
    claimed.chargedBudget = budgetId || null;
    claimed.commitmentReleased = released;
    return claimed;
  } catch (err) {
    if (!session) {
      await Expense.updateOne(
        { _id: claimed._id, status: 'approved', approvedBy: approver._id },
        { status: 'pending', $unset: { approvedBy: '', approvedAt: '' } }
      );
    }
    throw err;
  }
};

/** Why `approver` may not approve `expense` right now, for a precise message before trying. */
const approvalDenial = (expense, approver) => {
  if (expense.status !== 'pending') return { status: 400, message: 'Only pending expenses can be approved' };
  if (idOf(expense.createdBy) === idOf(approver._id)) return { status: 403, message: 'You cannot approve an expense you created' };
  if (writeScopeViolation(expense, approver)) return { status: 403, message: 'Not authorized to approve expenses for this municipality' };
  if (!(expense.attachments?.length > 0)) {
    return { status: 400, message: 'This expense has no supporting document attached and cannot be approved. Return it for the missing proof.' };
  }
  return null;
};

exports.approveExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, deletedAt: null });
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  const denied = approvalDenial(expense, req.user);
  if (denied) return errorResponse(res, denied.status, denied.message);

  let approved;
  try {
    approved = await withTransaction((session) => approveOne(expense._id, req.user, session));
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.statusCode, err.message);
    throw err;
  }

  await audit(req, approved, 'APPROVE', {
    oldValues: { status: 'pending' },
    newValues: { status: 'approved' },
    details: { approvedAt: approved.approvedAt },
  });

  User.findById(approved.createdBy).select('email firstName').then((creator) => {
    if (creator) sendQuietly('sendExpenseApproved', creator, approved);
  }).catch(() => {});

  successResponse(res, 200, 'Expense approved', approved);
});

/**
 * Undo an approval that should not have been given — the deduction is refunded in the same
 * transaction that moves the expense back to `returned`, along with the programme's spend and any
 * commitment the approval released. That is what makes re-approving it later safe: there is never a
 * moment at which the money has been deducted twice. Not possible once a liquidation has closed it.
 */
exports.reverseExpense = asyncHandler(async (req, res) => {
  const reason = (req.body.reason || req.body.returnReason || req.body.rejectionReason || '').trim();
  if (!reason) return errorResponse(res, 400, 'A reason is required to reverse an approval');
  const expense = await Expense.findOne({ _id: req.params.id, deletedAt: null });
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (writeScopeViolation(expense, req.user)) return errorResponse(res, 403, 'Not authorized to review expenses for this municipality');
  if (expense.status !== 'approved') {
    return errorResponse(res, 400, expense.status === 'liquidated'
      ? 'A liquidated expense cannot be reversed'
      : 'Only an approved expense can be reversed');
  }

  let reversed;
  try {
    reversed = await withTransaction(async (session) => {
      const opts = sessionOpts(session);
      const claimed = await Expense.findOneAndUpdate(
        { _id: expense._id, status: 'approved', deletedAt: null },
        {
          status: 'returned', returnReason: reason, returnedBy: req.user._id, returnedAt: new Date(),
          chargedBudget: null, commitmentReleased: 0,
          $unset: { approvedBy: '', approvedAt: '' },
        },
        { new: true, ...opts }
      );
      if (!claimed) throw httpError(409, 'Expense was already processed by another user');

      // Expenses approved before October 2026 did not record the budget charged; the same rule that
      // chose it then (own link, else the programme's) finds it again.
      const charged = expense.chargedBudget || await budgetToCharge(expense, session);
      if (charged) {
        await Budget.updateOne({ _id: charged }, [
          { $set: { disbursedAmount: { $max: [0, { $subtract: ['$disbursedAmount', expense.amount] }] } } },
          { $set: { remainingBalance: { $subtract: ['$totalBudget', '$disbursedAmount'] } } },
        ], opts);
      }
      if (expense.program) {
        await Program.updateOne({ _id: expense.program }, { $inc: { actualExpenses: -expense.amount } }, opts);
        const released = expense.commitmentReleased || 0;
        if (released > 0) {
          const prog = await Program.findById(expense.program, 'budgetRef', opts);
          await Program.updateOne({ _id: expense.program }, { $inc: { committedAmount: released } }, opts);
          if (prog?.budgetRef) await Budget.updateOne({ _id: prog.budgetRef }, { $inc: { committedAmount: released } }, opts);
        }
      }
      return claimed;
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.statusCode, err.message);
    throw err;
  }

  await audit(req, reversed, 'REVERSE', {
    oldValues: { status: 'approved' },
    newValues: { status: 'returned', returnReason: reason },
    details: { refunded: expense.amount, reason },
  });
  await Notification.create({
    recipient: reversed.createdBy, type: 'approval_rejected', title: 'Expense Approval Reversed',
    message: `The approval of "${reversed.title}" (${reversed.referenceNumber}) was reversed and the amount returned to the budget: ${reason}`,
    link: '/expenses', priority: 'high',
  });
  successResponse(res, 200, 'Expense approval reversed', reversed);
});

/**
 * draft / returned ──▶ pending. The treasurer's own act of sending a record up for review.
 *
 * Separate from approval on purpose: the officer who records money never decides on it. Refused
 * without proof attached — the reviewer must have something to inspect.
 */
exports.submitExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, deletedAt: null });
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (writeScopeViolation(expense, req.user, EXPENSE_SCOPE)) return errorResponse(res, 403, 'Not authorized to submit this expense');
  if (!(expense.attachments?.length > 0)) {
    return errorResponse(res, 400, 'Attach at least one supporting document before submitting this expense for review');
  }

  // Atomic on the expected state, so two clicks cannot both move it out of draft.
  const submitted = await Expense.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['draft', 'returned'] }, deletedAt: null },
    { status: 'pending', submittedAt: new Date(), $unset: { returnReason: '', returnedBy: '', returnedAt: '' } },
    { new: true }
  );
  if (!submitted) return errorResponse(res, 409, 'Only a draft or returned expense can be submitted for review');

  await audit(req, submitted, 'SUBMIT', {
    oldValues: { status: expense.status }, newValues: { status: 'pending' },
  });
  await notifyReviewers(submitted, expense.status === 'returned' ? 'Expense Resubmitted' : 'Expense Awaiting Review',
    `Expense "${submitted.title}" (${submitted.referenceNumber}) for ${peso(submitted.amount)} was ${expense.status === 'returned' ? 'corrected and resubmitted' : 'submitted'} for review.`);

  successResponse(res, 200, 'Expense submitted for review', submitted);
});

/**
 * pending ──▶ returned (for correction or more proof) or rejected (final), always with remarks.
 *
 * A decision with no reason tells the treasurer nothing about what to change and leaves the audit
 * trail unable to show the basis for it. Atomic on `pending`: approval, return and rejection race
 * through the same screen, and whichever lands second is told so rather than overwriting the first.
 * No budget figure moves — nothing was deducted.
 */
const decide = (decision) => asyncHandler(async (req, res) => {
  const reason = (req.body.rejectionReason || req.body.returnReason || req.body.reason || '').trim();
  const verb = decision === 'returned' ? 'returning' : 'rejecting';
  if (!reason) return errorResponse(res, 400, `A reason is required when ${verb} an expense`);

  const expense = await Expense.findOne({ _id: req.params.id, deletedAt: null });
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (expense.status !== 'pending') {
    return errorResponse(res, 400, `Only a pending expense can be ${decision}`);
  }
  if (writeScopeViolation(expense, req.user)) {
    return errorResponse(res, 403, 'Not authorized to review expenses for this municipality');
  }

  const update = decision === 'returned'
    ? { status: 'returned', returnReason: reason, returnedBy: req.user._id, returnedAt: new Date() }
    : { status: 'rejected', rejectionReason: reason, rejectedBy: req.user._id, rejectedAt: new Date() };
  const decided = await Expense.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, update, { new: true });
  if (!decided) return errorResponse(res, 409, 'Expense was already processed by another user');

  await audit(req, decided, decision === 'returned' ? 'RETURN' : 'REJECT', {
    oldValues: { status: 'pending' },
    newValues: { status: decision, reason },
    details: { reason, ...(decision === 'rejected' ? { rejectionReason: reason } : {}) },
  });

  const creator = await User.findById(decided.createdBy).select('email firstName');
  if (creator) {
    await Notification.create({
      recipient: creator._id,
      type: 'approval_rejected',
      title: decision === 'returned' ? 'Expense Returned for Correction' : 'Expense Rejected',
      message: `Expense "${decided.title}" (${decided.referenceNumber}) was ${decision}: ${reason}`,
      link: '/expenses',
      priority: 'high',
    });
    sendQuietly(decision === 'returned' ? 'sendExpenseReturned' : 'sendExpenseRejected', creator, decided);
  }

  successResponse(res, 200, decision === 'returned' ? 'Expense returned' : 'Expense rejected', decided);
});

exports.returnExpense = decide('returned');
exports.rejectExpense = decide('rejected');

/**
 * Approve several expenses. Each one goes through exactly the single-expense path, in its own
 * transaction, so a batch can never reach further — or deduct more — than the individual approvals
 * it stands for. What could not be approved is reported with its reason instead of silently
 * dropped.
 */
exports.bulkApproveExpenses = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse(res, 400, 'No expense IDs provided');
  if (ids.length > 50) return errorResponse(res, 400, 'Cannot bulk approve more than 50 expenses at once');

  const validIds = [...new Set(ids.map(String))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const candidates = await Expense.find({ _id: { $in: validIds }, deletedAt: null });
  const approved = [];
  const skipped = [];
  for (const expense of candidates) {
    const denied = approvalDenial(expense, req.user);
    if (denied) { skipped.push({ id: expense._id, reason: denied.message }); continue; }
    try {
      approved.push(await withTransaction((session) => approveOne(expense._id, req.user, session)));
    } catch (err) {
      if (!err.statusCode) throw err;
      skipped.push({ id: expense._id, reason: err.message });
    }
  }

  if (approved.length === 0) {
    return errorResponse(res, 400, 'No eligible expenses found. Expenses may already be approved, self-created, missing proof, or outside your municipality.', skipped);
  }

  await Promise.all(approved.map((e) => audit(req, e, 'APPROVE', {
    oldValues: { status: 'pending' }, newValues: { status: 'approved' }, details: { bulk: true },
  })));
  await AuditLog.create({
    user: req.user._id, action: 'BULK_APPROVE', resource: 'expense',
    details: { approved: approved.length, requestedCount: ids.length, skipped: skipped.length },
    municipality: req.user.municipality, ipAddress: req.ip,
  });

  // Notify each creator their expense was approved (fire-and-forget, mirrors single approveExpense)
  const creatorIds = [...new Set(approved.map((e) => e.createdBy?.toString()).filter(Boolean))];
  User.find({ _id: { $in: creatorIds } }).select('email firstName').then((creators) => {
    const byId = Object.fromEntries(creators.map((c) => [c._id.toString(), c]));
    for (const e of approved) {
      const creator = byId[e.createdBy?.toString()];
      if (creator) sendQuietly('sendExpenseApproved', creator, e);
    }
  }).catch(() => {});

  successResponse(res, 200, `${approved.length} expense(s) approved`, {
    approved: approved.length,
    skipped: ids.length - approved.length,
    skippedReasons: skipped,
  });
});

/** Move an expense to the recycle bin. Approved and liquidated ones moved money and stay put. */
exports.deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense || expense.deletedAt) return errorResponse(res, 404, 'Expense not found');
  /*
   * Scoped like every other expense write — strictly, so a treasurer removes only their own
   * barangay's records. It once had no check at all on a route open to municipal_admin.
   */
  if (writeScopeViolation(expense, req.user, EXPENSE_SCOPE)) return errorResponse(res, 403, 'Not authorized to delete this expense');
  if (['approved', 'liquidated'].includes(expense.status)) {
    return errorResponse(res, 400, 'Approved or liquidated expenses cannot be deleted');
  }
  const moved = await Expense.findOneAndUpdate(
    { _id: expense._id, deletedAt: null, status: { $nin: ['approved', 'liquidated'] } },
    { deletedAt: new Date(), deletedBy: req.user._id },
    { new: true }
  );
  if (!moved) return errorResponse(res, 409, 'The expense was approved while you were deleting it');
  await audit(req, expense, 'DELETE', { details: { title: expense.title, status: expense.status, recoverable: true } });
  successResponse(res, 200, 'Expense moved to the recycle bin');
});

/** Deleted expenses, scoped exactly like the live list. */
exports.getDeletedExpenses = asyncHandler(async (req, res) => {
  const filter = { deletedAt: { $ne: null } };
  applyReadScope(filter, req.user, { ...EXPENSE_SCOPE, requestedBarangay: req.query.barangay });
  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate('barangay', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('deletedBy', 'firstName lastName')
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Expense.countDocuments(filter),
  ]);
  const canPurge = ADMINS.includes(req.user.role);
  paginatedResponse(res, expenses.map((e) => ({ ...e.toJSON(), canPermanentlyDelete: canPurge })), safePage, safeLimit, total);
});

/** Restore from the recycle bin, in the status it was deleted in, with its attachments intact. */
exports.restoreExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (!expense.deletedAt) return errorResponse(res, 400, 'This expense is not in the recycle bin');
  if (writeScopeViolation(expense, req.user, EXPENSE_SCOPE)) return errorResponse(res, 403, 'Not authorized to restore this expense');
  const restored = await Expense.findOneAndUpdate(
    { _id: expense._id, deletedAt: { $ne: null } },
    { deletedAt: null, $unset: { deletedBy: '' } },
    { new: true }
  );
  if (!restored) return errorResponse(res, 409, 'This expense was already restored');
  await audit(req, expense, 'RESTORE', { details: { status: expense.status } });
  successResponse(res, 200, 'Expense restored', restored);
});

/**
 * Destroy an expense and its attachments. Only from the recycle bin, only by an administrator, and
 * never one named by a liquidation report. The record is copied into the audit log first.
 */
exports.permanentlyDeleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return errorResponse(res, 404, 'Expense not found');
  if (!expense.deletedAt) return errorResponse(res, 400, 'Move the expense to the recycle bin before deleting it permanently');
  if (writeScopeViolation(expense, req.user, EXPENSE_SCOPE)) return errorResponse(res, 403, 'Not authorized to delete this expense');
  const Liquidation = mongoose.model('Liquidation');
  if (await Liquidation.exists({ expenses: expense._id })) {
    return errorResponse(res, 409, 'A liquidation report names this expense, so it cannot be destroyed. It can stay in the recycle bin.');
  }

  await audit(req, expense, 'PERMANENT_DELETE', { oldValues: expense.toObject(), details: { irreversible: true } });
  (expense.attachments || []).forEach((a) => removeFile(storageRefOf(a)));
  await Expense.deleteOne({ _id: expense._id });
  successResponse(res, 200, 'Expense permanently deleted');
});

exports.getExpenseSummary = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };

  if (CROSS_MUNICIPALITY_READ.includes(req.user.role) && req.query.municipality) {
    filter.municipality = objectIdOf(req.query.municipality) || { $in: [] };
  }
  applyReadScope(filter, req.user, { ...EXPENSE_SCOPE, requestedBarangay: req.query.barangay });

  if (req.query.program) filter.program = objectIdOf(req.query.program) || { $in: [] };

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
