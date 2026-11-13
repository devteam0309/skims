const asyncHandler = require('express-async-handler');
const Budget = require('../models/Budget');
const Barangay = require('../models/Barangay');
const Expense = require('../models/Expense');
const Liquidation = require('../models/Liquidation');
const Program = require('../models/Program');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const emailService = require('../services/emailService');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { CROSS_MUNICIPALITY_READ, ADMINS } = require('../constants/roles');
const {
  applyReadScope, writeScopeViolation, readScopeViolation, forceScopeOnCreate,
  barangayScopeOf, idOf, objectIdOf,
} = require('../utils/scope');
const { checkBarangay, barangayErrorMessage } = require('../utils/barangay');
const { budgetTotalsStages, municipalBudgetAvailability, peso } = require('../utils/budgetTotals');
const { withTransaction, sessionOpts, httpError } = require('../utils/transaction');
const { escapeRegex } = require('../utils/regex');

const MAX_LIMIT = 100;

/*
 * Budgets are allocated per barangay (October 2026 panel round).
 *
 *   municipal budget   barangay: null — the municipality's total SK budget for a fiscal year
 *   barangay budget    barangay: X    — X's allocation, carved out of the municipal budget
 *
 * A barangay officer sees and manages ONLY their own barangay's budget — never the municipal total,
 * never a neighbour's. That is STRICT scope (utils/scope.js), with no creator exception: a municipal
 * budget is never "theirs", whoever happened to type it in.
 *
 * Approving a barangay budget checks that it fits in what the municipal budget has not already
 * given away, spent or committed, so the allocations can never add up to more than the whole.
 */
const BUDGET_SCOPE = { strict: true };

const isDuplicateScope = (err) => err?.code === 11000;
const duplicateMessage = (budget) => (budget.barangay
  ? 'This barangay already has a budget for that fiscal year. Edit the existing one, or restore it from the recycle bin.'
  : 'This municipality already has a municipal budget for that fiscal year. Edit the existing one, or restore it from the recycle bin.');

// A database still carrying the pre-October-2026 index refuses every barangay budget with the same
// duplicate-key error. Saying so turns a mystery into an instruction.
const isLegacyIndex = (err) => err?.code === 11000 && /municipality_1_fiscalYear_1/.test(err.message || '');
const LEGACY_INDEX_MESSAGE = 'Barangay budgets cannot be saved until the database migration has run: node scripts/migrate-barangay-finance.js --apply';

// Shared allocation guard for create + update. Returns an error string, or null when valid.
// `expenseController` resolves a category allocation with a case-insensitive `.find()` and a
// program allocation by program id, so duplicates on either key would silently under-enforce
// the cap (only the first match is ever checked) — reject them here instead.
const validateAllocations = (allocations, totalBudget) => {
  if (!Array.isArray(allocations) || allocations.length === 0) return null;

  const allocTotal = allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  if (allocTotal > parseFloat(totalBudget || 0)) {
    return 'Total allocations cannot exceed the budget amount';
  }

  const seenCategories = new Set();
  const seenPrograms = new Set();
  for (const a of allocations) {
    if (a.program) {
      const key = a.program.toString();
      if (seenPrograms.has(key)) return 'Duplicate program allocation — each program may only be allocated once';
      seenPrograms.add(key);
    } else {
      const key = a.category?.toLowerCase();
      if (!key) return 'Each allocation requires a category';
      if (seenCategories.has(key)) return `Duplicate allocation for category "${a.category}" — combine them into one entry`;
      seenCategories.add(key);
    }
  }
  return null;
};

const audit = (req, budget, action, extra = {}) => AuditLog.create({
  user: req.user._id, action, resource: 'budget', resourceId: budget._id,
  municipality: budget.municipality?._id || budget.municipality, ipAddress: req.ip,
  ...extra,
  details: { title: budget.title, fiscalYear: budget.fiscalYear, barangay: budget.barangay?._id || budget.barangay || null, ...(extra.details || {}) },
});

/** Narrow a budget list by level: `municipal` (no barangay) or `barangay` (any allocation). */
const applyLevel = (filter, level) => {
  if (level === 'municipal' && filter.barangay === undefined) filter.barangay = null;
  if (level === 'barangay' && filter.barangay === undefined) filter.barangay = { $ne: null };
};

exports.getBudgets = asyncHandler(async (req, res) => {
  const { municipality, fiscalYear, status, search, barangay, level } = req.query;
  const filter = { deletedAt: null };
  if (municipality && CROSS_MUNICIPALITY_READ.includes(req.user.role)) filter.municipality = municipality;
  if (fiscalYear) filter.fiscalYear = parseInt(fiscalYear);
  if (status) filter.status = status;
  /*
   * Title, notes, the fiscal year when the term is a year, and the barangay's NAME — so a municipal
   * administrator can type "Agot" and find Agot's budget.
   *
   * Title alone was too narrow: budget titles are formulaic ("SK Boac Annual Budget 2026"), so the
   * distinguishing part a user actually types is usually the year. fiscalYear is a Number, which a
   * regex cannot match, so a digits-only term is compared numerically alongside the text match.
   */
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    const or = [{ title: rx }, { notes: rx }];
    if (/^\d{4}$/.test(search.trim())) or.push({ fiscalYear: Number(search.trim()) });
    const brgyFilter = { name: rx };
    if (!CROSS_MUNICIPALITY_READ.includes(req.user.role)) brgyFilter.municipality = objectIdOf(req.user.municipality) || { $in: [] };
    const matching = await Barangay.find(brgyFilter).select('_id').limit(200).lean();
    if (matching.length) or.push({ barangay: { $in: matching.map((b) => b._id) } });
    filter.$or = or;
  }
  applyReadScope(filter, req.user, { ...BUDGET_SCOPE, requestedBarangay: barangay });
  applyLevel(filter, level);

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [budgets, total] = await Promise.all([
    Budget.find(filter)
      .populate('municipality', 'name code')
      .populate('barangay', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .sort({ fiscalYear: -1, barangay: 1, createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Budget.countDocuments(filter),
  ]);
  paginatedResponse(res, budgets, safePage, safeLimit, total);
});

exports.getBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id)
    .populate('municipality', 'name code')
    .populate('barangay', 'name')
    .populate('createdBy', 'firstName lastName')
    .populate('approvedBy', 'firstName lastName');
  if (!budget || budget.deletedAt) return errorResponse(res, 404, 'Budget not found');
  if (readScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to view this budget');
  successResponse(res, 200, 'Budget', budget);
});

exports.createBudget = asyncHandler(async (req, res) => {
  const ALLOWED_CREATE_FIELDS = ['title', 'fiscalYear', 'totalBudget', 'allocations', 'notes', 'municipality', 'barangay', 'attachments'];
  const budgetData = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED_CREATE_FIELDS.includes(k) && req.body[k] !== '')
  );
  budgetData.createdBy = req.user._id;

  /*
   * Municipality and barangay come from the account for every scoped role — overwritten rather than
   * refused, the contract budgetScopeAudit.test.js pins. A treasurer's budget is always their own
   * barangay's (they cannot create the municipal budget or another barangay's), and a municipal
   * administrator may create either level for their own municipality only.
   */
  forceScopeOnCreate(budgetData, req.user);
  if (!budgetData.municipality) return errorResponse(res, 400, 'Municipality is required');
  if (budgetData.barangay) {
    const check = await checkBarangay(budgetData.barangay, idOf(budgetData.municipality));
    if (check !== 'ok') return errorResponse(res, 400, barangayErrorMessage(check));
  } else {
    budgetData.barangay = null;
  }

  const allocError = validateAllocations(budgetData.allocations, budgetData.totalBudget);
  if (allocError) return errorResponse(res, 400, allocError);

  let budget;
  try {
    budget = await Budget.create(budgetData);
  } catch (err) {
    if (isLegacyIndex(err)) return errorResponse(res, 409, LEGACY_INDEX_MESSAGE);
    if (isDuplicateScope(err)) return errorResponse(res, 409, duplicateMessage(budgetData));
    throw err;
  }
  await audit(req, budget, 'CREATE', { newValues: { totalBudget: budget.totalBudget }, details: { totalBudget: budget.totalBudget } });
  successResponse(res, 201, 'Budget created', budget);
});

exports.updateBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id);
  if (!budget || budget.deletedAt) return errorResponse(res, 404, 'Budget not found');
  if (writeScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this budget');
  if (budget.status === 'approved') return errorResponse(res, 400, 'Approved budgets cannot be edited');
  // The level and the barangay a budget belongs to are fixed at creation; moving one would move its
  // money between barangays. Delete it and create the right one instead.
  const ALLOWED_UPDATE_FIELDS = ['title', 'fiscalYear', 'totalBudget', 'allocations', 'notes', 'attachments'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k) && req.body[k] !== '')
  );

  // Validate the RESULTING state, not just the incoming fields: lowering totalBudget on its own
  // can strand already-saved allocations above the new cap.
  const effectiveAllocations = updates.allocations ?? budget.allocations;
  const effectiveTotal = updates.totalBudget ?? budget.totalBudget;
  const allocError = validateAllocations(effectiveAllocations, effectiveTotal);
  if (allocError) return errorResponse(res, 400, allocError);

  let updated;
  try {
    // Aggregation pipeline keeps remainingBalance in sync when totalBudget changes.
    updated = await Budget.findByIdAndUpdate(
      req.params.id,
      [{ $set: { ...updates, remainingBalance: { $subtract: [updates.totalBudget ?? '$totalBudget', '$disbursedAmount'] } } }],
      { new: true, runValidators: true }
    );
  } catch (err) {
    if (isDuplicateScope(err)) return errorResponse(res, 409, duplicateMessage(budget));
    throw err;
  }
  await audit(req, budget, 'UPDATE', {
    oldValues: { totalBudget: budget.totalBudget },
    newValues: { totalBudget: updated.totalBudget },
    details: { changes: Object.keys(updates) },
  });
  successResponse(res, 200, 'Budget updated', updated);
});

exports.submitBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, deletedAt: null });
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (writeScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to submit this budget');

  // Atomic on the expected state, so two clicks cannot both submit it.
  const submitted = await Budget.findOneAndUpdate(
    { _id: req.params.id, status: 'draft', deletedAt: null },
    { status: 'pending_approval' },
    { new: true }
  );
  if (!submitted) return errorResponse(res, 400, 'Only draft budgets can be submitted');
  await audit(req, budget, 'SUBMIT', { oldValues: { status: 'draft' }, newValues: { status: 'pending_approval' } });
  successResponse(res, 200, 'Budget submitted for approval', submitted);
});

exports.approveBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, deletedAt: null });
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (writeScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to approve this budget');

  /*
   * A barangay budget is approved only if it fits: the municipal budget for the same year must be
   * approved, and what it has not already allocated, spent or committed must cover this allocation.
   *
   * Inside a transaction, and it WRITES the municipal budget (`allocationRevision`) as well as
   * reading it. Two allocations approved at the same instant would otherwise each read the same
   * free balance, both fit, and together overdraw it; with the write, the second transaction
   * conflicts, is retried, and re-reads a balance that already includes the first.
   */
  let approved;
  try {
    approved = await withTransaction(async (session) => {
      const opts = sessionOpts(session);
      if (budget.barangay) {
        const municipal = await Budget.findOne({
          municipality: budget.municipality, fiscalYear: budget.fiscalYear, barangay: null, deletedAt: null,
        }, null, opts);
        if (!municipal || municipal.status !== 'approved') {
          throw httpError(400, `Approve the municipality's ${budget.fiscalYear} municipal budget before allocating it to barangays`);
        }
        const { available } = await municipalBudgetAvailability(municipal, { session, excludeBudgetId: budget._id });
        if (budget.totalBudget > available) {
          throw httpError(400, `This allocation of ${peso(budget.totalBudget)} exceeds what the municipal budget has left to allocate (${peso(Math.max(0, available))})`);
        }
        await Budget.updateOne({ _id: municipal._id }, { $inc: { allocationRevision: 1 } }, opts);
      }

      // Atomic conditional update prevents double approval.
      const claimed = await Budget.findOneAndUpdate(
        { _id: req.params.id, status: 'pending_approval', deletedAt: null },
        { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), approvedAmount: budget.totalBudget },
        { new: true, ...opts }
      );
      if (!claimed) throw httpError(409, 'Budget was already processed or is not pending approval');
      return claimed;
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.statusCode, err.message);
    throw err;
  }

  await audit(req, budget, 'APPROVE', {
    oldValues: { status: 'pending_approval' },
    newValues: { status: 'approved', approvedAmount: budget.totalBudget },
    details: { approvedAmount: budget.totalBudget },
  });

  User.findById(budget.createdBy).select('email firstName').then((creator) => {
    if (creator) emailService.sendBudgetApproved(creator, approved).catch(() => {});
  }).catch(() => {});

  successResponse(res, 200, 'Budget approved', approved);
});

exports.rejectBudget = asyncHandler(async (req, res) => {
  const reason = (req.body.reason || '').trim();
  if (!reason) return errorResponse(res, 400, 'A reason is required when rejecting a budget');
  const budget = await Budget.findOne({ _id: req.params.id, deletedAt: null });
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (writeScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to reject this budget');

  const rejected = await Budget.findOneAndUpdate(
    { _id: req.params.id, status: 'pending_approval', deletedAt: null },
    { status: 'rejected', rejectionReason: reason, notes: reason },
    { new: true }
  );
  if (!rejected) return errorResponse(res, 400, 'Only pending budgets can be rejected');
  await audit(req, budget, 'REJECT', { newValues: { status: 'rejected' }, details: { reason } });

  User.findById(budget.createdBy).select('email firstName').then((creator) => {
    if (creator) emailService.sendBudgetRejected(creator, budget, reason).catch(() => {});
  }).catch(() => {});

  successResponse(res, 200, 'Budget rejected', rejected);
});

exports.reopenBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, deletedAt: null });
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (writeScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to reopen this budget');
  const reopened = await Budget.findOneAndUpdate(
    { _id: req.params.id, status: 'rejected', deletedAt: null },
    { status: 'draft', notes: '' },
    { new: true }
  );
  if (!reopened) return errorResponse(res, 400, 'Only rejected budgets can be reopened');
  await audit(req, budget, 'REOPEN', { oldValues: { status: 'rejected' }, newValues: { status: 'draft' } });
  successResponse(res, 200, 'Budget reopened for revision', reopened);
});

/**
 * Move a budget to the recycle bin. Approved budgets are not deletable — money has been, or may yet
 * be, charged against them, and their history is the audit trail of that.
 */
exports.deleteBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id);
  if (!budget || budget.deletedAt) return errorResponse(res, 404, 'Budget not found');
  if (writeScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to delete this budget');
  if (budget.status === 'approved') return errorResponse(res, 400, 'Approved budgets cannot be deleted — they have linked expenses');

  const moved = await Budget.findOneAndUpdate(
    { _id: budget._id, deletedAt: null, status: { $ne: 'approved' } },
    { deletedAt: new Date(), deletedBy: req.user._id },
    { new: true }
  );
  if (!moved) return errorResponse(res, 409, 'The budget changed while you were deleting it; reload and try again');
  await audit(req, budget, 'DELETE', { details: { status: budget.status, totalBudget: budget.totalBudget, recoverable: true } });
  successResponse(res, 200, 'Budget moved to the recycle bin');
});

/** Deleted budgets, scoped exactly like the live list — a barangay officer sees only their own. */
exports.getDeletedBudgets = asyncHandler(async (req, res) => {
  const filter = { deletedAt: { $ne: null } };
  applyReadScope(filter, req.user, { ...BUDGET_SCOPE, requestedBarangay: req.query.barangay });
  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [budgets, total] = await Promise.all([
    Budget.find(filter)
      .populate('municipality', 'name')
      .populate('barangay', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('deletedBy', 'firstName lastName')
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Budget.countDocuments(filter),
  ]);
  const canPurge = ADMINS.includes(req.user.role);
  paginatedResponse(res, budgets.map((b) => ({ ...b.toJSON(), canPermanentlyDelete: canPurge })), safePage, safeLimit, total);
});

/**
 * Restore a budget from the recycle bin, with its allocations, figures and history unchanged.
 * Refused if a live budget has since taken its place for the same barangay (or municipality) and
 * year — two would break the one-per-scope rule the unique index enforces.
 */
exports.restoreBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id);
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (!budget.deletedAt) return errorResponse(res, 400, 'This budget is not in the recycle bin');
  if (writeScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to restore this budget');

  let restored;
  try {
    restored = await Budget.findOneAndUpdate(
      { _id: budget._id, deletedAt: { $ne: null } },
      { deletedAt: null, $unset: { deletedBy: '' } },
      { new: true }
    );
  } catch (err) {
    if (isDuplicateScope(err)) {
      return errorResponse(res, 409, 'A live budget already exists for the same barangay (or municipality) and fiscal year. Delete or adjust it before restoring this one.');
    }
    throw err;
  }
  if (!restored) return errorResponse(res, 409, 'This budget was already restored');
  await audit(req, budget, 'RESTORE', { details: { status: budget.status } });
  successResponse(res, 200, 'Budget restored', restored);
});

/**
 * Destroy a budget for good. Only from the recycle bin, only by an administrator, and only when
 * nothing still points at it: an expense, programme or liquidation that names a budget which no
 * longer exists is a financial record with its source cut off. The full record is copied into the
 * audit log first, because afterwards that entry is all that remains of it.
 */
exports.permanentlyDeleteBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id);
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (!budget.deletedAt) return errorResponse(res, 400, 'Move the budget to the recycle bin before deleting it permanently');
  if (writeScopeViolation(budget, req.user, BUDGET_SCOPE)) return errorResponse(res, 403, 'Not authorized to delete this budget');

  const [expenses, programs, liquidations] = await Promise.all([
    Expense.countDocuments({ budget: budget._id }),
    Program.countDocuments({ budgetRef: budget._id }),
    Liquidation.countDocuments({ budget: budget._id }),
  ]);
  if (expenses + programs + liquidations > 0) {
    return errorResponse(res, 409, `This budget is still referenced by ${expenses} expense(s), ${programs} programme(s) and ${liquidations} liquidation(s), and cannot be destroyed. It can stay in the recycle bin.`);
  }

  await audit(req, budget, 'PERMANENT_DELETE', {
    oldValues: budget.toObject(),
    details: { irreversible: true, totalBudget: budget.totalBudget, status: budget.status },
  });
  await Budget.deleteOne({ _id: budget._id });
  successResponse(res, 200, 'Budget permanently deleted');
});

/**
 * Totals for the budgets the caller can see — municipal total, allocated to barangays, disbursed,
 * remaining — counted without the double counting a plain sum would do (utils/budgetTotals.js).
 */
exports.getBudgetSummary = asyncHandler(async (req, res) => {
  const { municipalityId, fiscalYear } = req.query;
  const filter = { deletedAt: null, status: 'approved' };
  if (CROSS_MUNICIPALITY_READ.includes(req.user.role) && municipalityId) {
    filter.municipality = objectIdOf(municipalityId) || { $in: [] };
  }
  if (fiscalYear) filter.fiscalYear = parseInt(fiscalYear);
  applyReadScope(filter, req.user, { ...BUDGET_SCOPE, requestedBarangay: req.query.barangay });

  const [row] = await Budget.aggregate([{ $match: filter }, ...budgetTotalsStages()]);
  successResponse(res, 200, 'Budget summary', row ? {
    totalBudget: row.total,
    allocatedToBarangays: row.allocatedToBarangays,
    totalDisbursed: row.disbursed,
    totalCommitted: row.committed,
    totalRemaining: row.remaining,
    count: row.count,
  } : {});
});

/**
 * Financial performance of every barangay in a municipality, for the officers who review barangay
 * money (FINANCE_MONITORS): what each was allocated, what was approved, what has actually been spent
 * and deducted, what is left, what is still waiting for review, and which liquidations are done.
 *
 * Every figure comes from recorded transactions in their CURRENT state:
 *
 *   - "approved expenses" counts only approved and liquidated expenses — pending, returned and
 *     rejected ones are reported separately and never treated as spent;
 *   - "utilized" is what was actually deducted from the barangay's budget on approval;
 *   - where the two differ, approved spending was never charged to the barangay's budget (it was
 *     recorded unlinked) — surfaced as `unchargedApproved` because it is exactly the inconsistency a
 *     reviewer wants to find;
 *   - `withoutProof` counts pending or approved expenses that carry no attachment.
 *
 * A municipal administrator always sees their own municipality; DILG and the provincial tiers pick
 * one with `?municipality=`.
 */
exports.getBarangayPerformance = asyncHandler(async (req, res) => {
  const fiscalYear = parseInt(req.query.fiscalYear, 10) || new Date().getFullYear();
  let municipalityId;
  if (CROSS_MUNICIPALITY_READ.includes(req.user.role)) {
    municipalityId = objectIdOf(req.query.municipality);
    if (!municipalityId) return errorResponse(res, 400, 'Choose a municipality');
  } else {
    if (barangayScopeOf(req.user)) return errorResponse(res, 403, 'This view compares every barangay in the municipality and is for municipal reviewers');
    municipalityId = objectIdOf(req.user.municipality);
    if (!municipalityId) return errorResponse(res, 403, 'Your account has no municipality');
  }

  const yearStart = new Date(fiscalYear, 0, 1);
  const yearEnd = new Date(fiscalYear, 11, 31, 23, 59, 59, 999);

  const [municipal, allocations, barangays, expenseRows, liquidationRows] = await Promise.all([
    Budget.findOne({ municipality: municipalityId, fiscalYear, barangay: null, deletedAt: null }).lean(),
    Budget.find({ municipality: municipalityId, fiscalYear, barangay: { $ne: null }, deletedAt: null }).lean(),
    Barangay.find({ municipality: municipalityId, isActive: true }).select('name').collation({ locale: 'en' }).sort({ name: 1 }).lean(),
    Expense.aggregate([
      { $match: { municipality: municipalityId, deletedAt: null, transactionDate: { $gte: yearStart, $lte: yearEnd } } },
      {
        $group: {
          _id: { barangay: { $ifNull: ['$barangay', null] }, status: '$status' },
          count: { $sum: 1 },
          amount: { $sum: '$amount' },
          withoutProof: { $sum: { $cond: [{ $eq: [{ $size: { $ifNull: ['$attachments', []] } }, 0] }, 1, 0] } },
        },
      },
    ]),
    Liquidation.aggregate([
      { $match: { municipality: municipalityId, deletedAt: null, createdAt: { $gte: yearStart, $lte: yearEnd } } },
      {
        $group: {
          _id: { barangay: { $ifNull: ['$barangay', null] }, status: '$status' },
          count: { $sum: 1 },
          total: { $sum: '$totalAmount' },
          liquidated: { $sum: '$liquidatedAmount' },
        },
      },
    ]),
  ]);

  const sumWhere = (rows, barangayId, statuses, field) => rows
    .filter((r) => idOf(r._id.barangay) === idOf(barangayId) && statuses.includes(r._id.status))
    .reduce((s, r) => s + (r[field] || 0), 0);

  const figuresFor = (barangayId, budget) => {
    const allocated = budget && budget.status !== 'rejected' ? budget.totalBudget : 0;
    const approvedAllocation = budget && budget.status === 'approved' ? budget.totalBudget : 0;
    const utilized = budget ? (budget.disbursedAmount || 0) : 0;
    const approvedExpenses = sumWhere(expenseRows, barangayId, ['approved', 'liquidated'], 'amount');
    return {
      budget: budget ? {
        _id: budget._id, title: budget.title, status: budget.status, totalBudget: budget.totalBudget,
        disbursedAmount: budget.disbursedAmount || 0, committedAmount: budget.committedAmount || 0,
      } : null,
      allocated,
      approvedAllocation,
      approvedExpenses: { count: sumWhere(expenseRows, barangayId, ['approved', 'liquidated'], 'count'), amount: approvedExpenses },
      utilized,
      remaining: approvedAllocation - utilized,
      utilizationRate: approvedAllocation > 0 ? Math.round((utilized / approvedAllocation) * 1000) / 10 : 0,
      unchargedApproved: Math.max(0, approvedExpenses - utilized),
      pendingExpenses: {
        count: sumWhere(expenseRows, barangayId, ['pending'], 'count'),
        amount: sumWhere(expenseRows, barangayId, ['pending'], 'amount'),
      },
      draftExpenses: sumWhere(expenseRows, barangayId, ['draft'], 'count'),
      returnedExpenses: sumWhere(expenseRows, barangayId, ['returned'], 'count'),
      rejectedExpenses: sumWhere(expenseRows, barangayId, ['rejected'], 'count'),
      withoutProof: sumWhere(expenseRows, barangayId, ['pending', 'approved'], 'withoutProof'),
      liquidations: {
        approved: { count: sumWhere(liquidationRows, barangayId, ['approved'], 'count'), amount: sumWhere(liquidationRows, barangayId, ['approved'], 'liquidated') },
        awaitingReview: { count: sumWhere(liquidationRows, barangayId, ['submitted', 'under_review'], 'count'), amount: sumWhere(liquidationRows, barangayId, ['submitted', 'under_review'], 'total') },
        returned: sumWhere(liquidationRows, barangayId, ['returned'], 'count'),
        rejected: sumWhere(liquidationRows, barangayId, ['rejected'], 'count'),
      },
    };
  };

  const allocationFor = new Map(allocations.map((a) => [idOf(a.barangay), a]));
  const rows = barangays.map((b) => ({ barangay: { _id: b._id, name: b.name }, ...figuresFor(b._id, allocationFor.get(idOf(b._id))) }));

  const allocatedToBarangays = allocations.filter((a) => a.status === 'approved').reduce((s, a) => s + a.totalBudget, 0);
  const municipalLevel = figuresFor(null, municipal);
  const totalDisbursed = rows.reduce((s, r) => s + r.utilized, 0) + municipalLevel.utilized;

  successResponse(res, 200, 'Barangay financial performance', {
    fiscalYear,
    municipality: municipalityId,
    municipalBudget: municipal ? {
      _id: municipal._id,
      title: municipal.title,
      status: municipal.status,
      totalBudget: municipal.totalBudget,
      allocatedToBarangays,
      unallocated: municipal.totalBudget - allocatedToBarangays,
      spentDirectly: municipal.disbursedAmount || 0,
      committed: municipal.committedAmount || 0,
    } : null,
    municipalLevel,
    barangays: rows,
    totals: {
      municipalBudget: municipal?.status === 'approved' ? municipal.totalBudget : 0,
      allocatedToBarangays,
      approvedExpenses: rows.reduce((s, r) => s + r.approvedExpenses.amount, 0) + municipalLevel.approvedExpenses.amount,
      utilized: totalDisbursed,
      remaining: (municipal?.status === 'approved' ? municipal.totalBudget : 0) - totalDisbursed,
      pendingExpenses: {
        count: rows.reduce((s, r) => s + r.pendingExpenses.count, 0) + municipalLevel.pendingExpenses.count,
        amount: rows.reduce((s, r) => s + r.pendingExpenses.amount, 0) + municipalLevel.pendingExpenses.amount,
      },
      approvedLiquidations: rows.reduce((s, r) => s + r.liquidations.approved.count, 0) + municipalLevel.liquidations.approved.count,
      barangaysWithBudget: rows.filter((r) => r.budget).length,
      barangaysWithoutBudget: rows.filter((r) => !r.budget).length,
    },
  });
});
