const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const YouthMember = require('../models/YouthMember');
// Shared with document category, announcement type and youth educational attainment.
const { normalizeLabel: normalizeCategory } = require('../utils/labels');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { escapeRegex } = require('../utils/regex');
const { pickCreatable, pickWritable, toMutation } = require('../utils/writeFields');
const { CROSS_MUNICIPALITY_READ, CROSS_MUNICIPALITY_WRITE } = require('../constants/roles');
const {
  applyReadScope, writeScopeViolation, readScopeViolation, barangayScopeOf, idOf, objectIdOf,
} = require('../utils/scope');
const { checkBarangay, barangayErrorMessage } = require('../utils/barangay');
const Barangay = require('../models/Barangay');
const { municipalBudgetAvailability, peso } = require('../utils/budgetTotals');
const { withTransaction, sessionOpts, httpError } = require('../utils/transaction');

const MAX_LIMIT = 100;

/*
 * Writes are STRICT for a barangay-bound officer: they may change their own barangay's programmes,
 * and a municipality-wide one only if they created it themselves. A municipality-wide programme is
 * the municipal administrator's to manage — before this, any barangay's chairperson could edit or
 * resubmit it on behalf of every other barangay. Reads stay lenient: municipal programmes are still
 * listed for every barangay, which is how youth find them.
 */
const PROGRAM_WRITE_SCOPE = { strict: true, ownerField: 'createdBy' };

/*
 * The implementation date — the day the activity actually happens — cannot precede the opening of
 * the preparation period it follows. It is deliberately NOT compared with the end date: the panel
 * defined that as the close of requirements submission, which an activity may coincide with.
 */
const implementationDateProblem = (implementationDate, startDate) => {
  if (!implementationDate) return null;
  const when = new Date(implementationDate);
  if (Number.isNaN(when.getTime())) return 'Enter a valid implementation date';
  if (startDate && when < new Date(new Date(startDate).toDateString())) {
    return 'The implementation date cannot be before the start of the preparation period';
  }
  return null;
};

/**
 * A programme's budget must be its own level's: a barangay programme is funded from that barangay's
 * allocation, a municipality-wide one from the municipal budget, and never anything from another
 * municipality. The link was a bare id before — a hand-built request could attach a programme to any
 * budget in the province, and approving it would then commit that budget's money.
 */
const budgetLinkProblem = async (budgetRef, { municipality, barangay }) => {
  if (!budgetRef) return null;
  // Named like errorHandler names a bad field. Querying with it would raise a CastError on `_id`,
  // which reads as "Resource not found" — the misleading 404 this field once produced.
  if (!mongoose.Types.ObjectId.isValid(String(budgetRef))) return 'Invalid value for budgetRef';
  const budget = await Budget.findOne({ _id: budgetRef, deletedAt: null }).select('municipality barangay');
  if (!budget) return 'The linked budget does not exist';
  if (idOf(budget.municipality) !== idOf(municipality)) return 'The linked budget belongs to another municipality';
  if (idOf(budget.barangay) !== idOf(barangay)) {
    return barangay
      ? 'A barangay programme must be funded from that barangay\'s own budget allocation'
      : 'A municipality-wide programme must be funded from the municipal budget';
  }
  return null;
};

/**
 * Search terms also match barangay NAMES, so a municipal administrator can type "Agot" and see
 * Agot's programmes. Limited to barangays the caller could see anyway; the read scope applied after
 * still decides what is returned.
 */
const barangayIdsMatching = async (rx, user) => {
  const filter = { name: rx };
  if (!CROSS_MUNICIPALITY_READ.includes(user.role)) filter.municipality = objectIdOf(user.municipality) || { $in: [] };
  const rows = await Barangay.find(filter).select('_id').limit(200).lean();
  return rows.map((b) => b._id);
};

exports.getPrograms = asyncHandler(async (req, res) => {
  const { status, approvalStatus, category, municipality, barangay, search, startDate, endDate, sort } = req.query;
  const filter = { deletedAt: null };

  if (status) filter.status = status;
  if (approvalStatus) filter.approvalStatus = approvalStatus;
  if (category) filter.category = normalizeCategory(category);
  /*
   * A substring match, as on every other list page. This was `$text`, which matches only whole
   * indexed words: searching "Lead" or "Youth Lead" returned nothing while "Leadership" worked,
   * so the box looked broken for any partial term — which is how people actually type. The term
   * is escaped because it is data, not a pattern.
   *
   * `location` is an object; the address inside it is what can actually match a term.
   */
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    const or = [{ title: rx }, { description: rx }, { 'location.address': rx }];
    const barangayIds = await barangayIdsMatching(rx, req.user);
    if (barangayIds.length) or.push({ barangay: { $in: barangayIds } });
    filter.$or = or;
  }
  if (startDate || endDate) {
    filter.startDate = {};
    if (startDate) filter.startDate.$gte = new Date(startDate);
    if (endDate) filter.startDate.$lte = new Date(endDate);
  }

  /*
   * Municipality and barangay are both resolved from the account. A chairperson bound to Barangay A
   * gets Barangay A plus the municipality-wide programmes that target no single barangay, and a
   * `?barangay=` pointing anywhere else is discarded rather than obeyed — see utils/scope.js.
   */
  if (CROSS_MUNICIPALITY_READ.includes(req.user?.role) && municipality) {
    filter.municipality = objectIdOf(municipality) || { $in: [] };
  }
  applyReadScope(filter, req.user, { requestedBarangay: barangay });

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const populate = (q) => q
    .populate('municipality', 'name code')
    .populate('barangay', 'name')
    .populate('createdBy', 'firstName lastName');

  /*
   * `?sort=barangay` orders by barangay NAME (municipality-wide programmes last), so a municipal
   * administrator reading many barangays' programmes sees them grouped. A name lives on another
   * collection, so this one ordering goes through an aggregation for the ids and loads them after.
   */
  if (sort === 'barangay') {
    const [ordered, total] = await Promise.all([
      Program.aggregate([
        { $match: filter },
        { $lookup: { from: 'barangays', localField: 'barangay', foreignField: '_id', as: 'b' } },
        { $addFields: { _barangayName: { $ifNull: [{ $arrayElemAt: ['$b.name', 0] }, '￿'] } } },
        { $sort: { _barangayName: 1, title: 1 } },
        { $skip: skip },
        { $limit: safeLimit },
        { $project: { _id: 1 } },
      ]),
      Program.countDocuments(filter),
    ]);
    const ids = ordered.map((o) => o._id);
    const docs = await populate(Program.find({ _id: { $in: ids } }));
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));
    return paginatedResponse(res, ids.map((id) => byId.get(id.toString())).filter(Boolean), safePage, safeLimit, total);
  }

  const order = sort === 'implementationDate' ? { implementationDate: 1, createdAt: -1 } : { createdAt: -1 };
  const [programs, total] = await Promise.all([
    populate(Program.find(filter)).sort(order).skip(skip).limit(safeLimit),
    Program.countDocuments(filter),
  ]);

  paginatedResponse(res, programs, safePage, safeLimit, total);
});

/**
 * Programmes per barangay, for the municipal administrator's grouped view (and DILG's).
 *
 * Every barangay of the municipality is listed — including those with no programme yet, which is
 * itself worth seeing — plus a "municipality-wide" row for programmes that target no barangay.
 * Counts are scoped exactly like the list, so clicking a row and filtering the table by it shows the
 * same number of programmes the row promised. A barangay-bound officer gets their own row only.
 */
exports.getProgramBarangaySummary = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };
  if (CROSS_MUNICIPALITY_READ.includes(req.user.role) && req.query.municipality) {
    filter.municipality = objectIdOf(req.query.municipality) || { $in: [] };
  }
  applyReadScope(filter, req.user);

  const counts = await Program.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { municipality: '$municipality', barangay: { $ifNull: ['$barangay', null] } },
        total: { $sum: 1 },
        planned: { $sum: { $cond: [{ $eq: ['$status', 'planned'] }, 1, 0] } },
        ongoing: { $sum: { $cond: [{ $eq: ['$status', 'ongoing'] }, 1, 0] } },
        delayed: { $sum: { $cond: [{ $eq: ['$status', 'delayed'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        awaitingApproval: { $sum: { $cond: [{ $eq: ['$approvalStatus', 'submitted'] }, 1, 0] } },
        totalBudget: { $sum: { $ifNull: ['$budget', 0] } },
        nextImplementation: {
          $min: { $cond: [{ $gte: ['$implementationDate', new Date(new Date().toDateString())] }, '$implementationDate', null] },
        },
      },
    },
  ]);

  // Which barangays to list: the caller's own municipality (or the one picked), every one of them.
  const ownBarangay = barangayScopeOf(req.user);
  // An ObjectId when one municipality is in scope; `{ $in: [] }` (none) or absent (province) otherwise.
  const municipalityId = filter.municipality && !filter.municipality.$in ? filter.municipality : null;
  let barangays = [];
  if (ownBarangay) {
    barangays = await Barangay.find({ _id: ownBarangay }).select('name municipality').lean();
  } else if (municipalityId) {
    barangays = await Barangay.find({ municipality: municipalityId, isActive: true })
      .select('name municipality').collation({ locale: 'en' }).sort({ name: 1 }).lean();
  } else {
    const ids = counts.map((c) => c._id.barangay).filter(Boolean);
    barangays = await Barangay.find({ _id: { $in: ids } }).select('name municipality')
      .populate('municipality', 'name').collation({ locale: 'en' }).sort({ name: 1 }).lean();
  }

  const empty = { total: 0, planned: 0, ongoing: 0, delayed: 0, completed: 0, cancelled: 0, awaitingApproval: 0, totalBudget: 0, nextImplementation: null };
  const countFor = (barangayId) => {
    const rows = counts.filter((c) => idOf(c._id.barangay) === idOf(barangayId));
    if (!rows.length) return { ...empty };
    return rows.reduce((acc, r) => ({
      total: acc.total + r.total,
      planned: acc.planned + r.planned,
      ongoing: acc.ongoing + r.ongoing,
      delayed: acc.delayed + r.delayed,
      completed: acc.completed + r.completed,
      cancelled: acc.cancelled + r.cancelled,
      awaitingApproval: acc.awaitingApproval + r.awaitingApproval,
      totalBudget: acc.totalBudget + r.totalBudget,
      nextImplementation: [acc.nextImplementation, r.nextImplementation].filter(Boolean).sort((a, b) => a - b)[0] || null,
    }), { ...empty });
  };

  const rows = barangays.map((b) => ({ barangay: b, ...countFor(b._id) }));
  const municipalityWide = countFor(null);
  successResponse(res, 200, 'Programs by barangay', {
    barangays: rows,
    // Programmes that target no single barangay. Omitted for a bound officer only if it is empty.
    municipalityWide,
    totals: rows.reduce((t, r) => t + r.total, 0) + municipalityWide.total,
  });
});

exports.getProgram = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id)
    .populate('municipality', 'name code')
    .populate('barangay', 'name')
    .populate('createdBy', 'firstName lastName email')
    .populate('assignedOfficers', 'firstName lastName role email')
    .populate('budgetRef', 'title fiscalYear status totalBudget remainingBalance');

  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');

  /*
   * Re-asserted per record, because the list hiding a programme is not the same as the API refusing
   * it: `userController.getUser` scoped its list correctly and returned a foreign record by id.
   */
  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role)) {
    if (idOf(program.municipality) !== idOf(req.user.municipality)) {
      return errorResponse(res, 403, 'Not authorized to view this program');
    }
    const ownBarangay = barangayScopeOf(req.user);
    const programBarangay = idOf(program.barangay);
    if (ownBarangay && programBarangay && programBarangay !== ownBarangay) {
      return errorResponse(res, 403, 'Not authorized to view this program');
    }
  }

  successResponse(res, 200, 'Program', program);
});

exports.createProgram = asyncHandler(async (req, res) => {
  const ALLOWED_CREATE_FIELDS = ['title', 'description', 'category', 'status', 'municipality', 'barangay', 'budget', 'budgetRef', 'startDate', 'endDate', 'implementationDate', 'targetParticipants', 'objectives', 'assignedOfficers', 'isPublic'];
  /*
   * Blank values are dropped rather than stored. The form posts every field it owns, so a program
   * with no budget linked arrives as `budgetRef: ''` — which Mongoose cannot cast to an ObjectId.
   * It threw a CastError that the global handler reported as 404 "Resource not found", so creating
   * a program without linking a budget failed with a message about the program not existing.
   * Same shape as the fix already carried by routes/youth.js.
   */
  const programData = pickCreatable(Program, req.body, ALLOWED_CREATE_FIELDS);
  if (programData.category) programData.category = normalizeCategory(programData.category);
  programData.createdBy = req.user._id;

  // Only the two genuinely cross-municipality roles may direct a program at another
  // municipality. For everyone else the body value is ignored outright: a `!municipality`
  // fallback still let a scoped user file a program under a municipality they cannot read,
  // which is precisely the isolation the panel asked us to guarantee.
  if (CROSS_MUNICIPALITY_WRITE.includes(req.user.role)) {
    if (!programData.municipality) programData.municipality = req.user.municipality;
  } else {
    programData.municipality = req.user.municipality?._id || req.user.municipality;
  }
  if (!programData.municipality) {
    return errorResponse(res, 400, 'A municipality is required to create a program');
  }

  /*
   * Target barangay. A barangay-bound officer's programme is filed against their own barangay
   * whatever the payload says; an admin tier may target one, and it is checked against the
   * programme's municipality first — Mongoose only validates that a ref is a well-formed
   * ObjectId, never that it belongs to the right parent.
   *
   * Overwritten rather than refused, matching how `municipality` is handled directly above and the
   * suites that pin it. Expenses refuse instead; that difference is pre-existing, and each module's
   * own contract is left as its callers already expect it.
   */
  const ownBarangay = barangayScopeOf(req.user);
  if (ownBarangay) programData.barangay = ownBarangay;
  const brgyCheck = await checkBarangay(programData.barangay, idOf(programData.municipality));
  if (brgyCheck !== 'ok') return errorResponse(res, 400, barangayErrorMessage(brgyCheck));

  if (programData.startDate && programData.endDate && new Date(programData.endDate) <= new Date(programData.startDate)) {
    return errorResponse(res, 400, 'End date must be after start date');
  }
  const dateProblem = implementationDateProblem(programData.implementationDate, programData.startDate);
  if (dateProblem) return errorResponse(res, 400, dateProblem);
  if (programData.status === 'completed' && !programData.implementationDate) {
    return errorResponse(res, 400, 'A completed programme needs the date it was actually implemented');
  }

  const linkProblem = await budgetLinkProblem(programData.budgetRef, programData);
  if (linkProblem) return errorResponse(res, 400, linkProblem);

  const program = await Program.create(programData);

  await Notification.create({
    recipient: req.user._id,
    type: 'system',
    title: 'Program Created',
    message: `Program "${program.title}" has been created successfully.`,
    link: `/programs/${program._id}`,
  });

  successResponse(res, 201, 'Program created successfully', program);
});

exports.updateProgram = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id);
  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');
  if (writeScopeViolation(program, req.user, PROGRAM_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this program');

  const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'objectives', 'category', 'status', 'barangay', 'budget', 'budgetRef', 'startDate', 'endDate', 'implementationDate', 'targetParticipants', 'actualParticipants', 'assignedOfficers', 'milestones', 'accomplishmentReport', 'isPublic', 'tags', 'location', 'attachments'];
  /*
   * Same CastError as on create, plus the ability to clear a field. The form submits its whole
   * shape, so unlinking a budget arrives as `budgetRef: ''`: sent to $set it fails the entire
   * update with a 404, sent to $unset it does what the user asked. Blank scalars are unset too,
   * so a field can be emptied rather than only ever overwritten.
   */
  const { set: updates, unset: cleared } = pickWritable(Program, req.body, ALLOWED_UPDATE_FIELDS);

  if (updates.category) updates.category = normalizeCategory(updates.category);

  /*
   * Re-targeting a programme at another barangay would move it out of the editor's own scope — it
   * would vanish from their list the moment they saved. A bound officer's edit is pinned to their
   * barangay; an admin tier may change it, checked against the municipality as on create.
   */
  const editorBarangay = barangayScopeOf(req.user);
  if (editorBarangay && (Object.prototype.hasOwnProperty.call(updates, 'barangay') || cleared.includes('barangay'))) {
    const keep = cleared.indexOf('barangay');
    if (keep !== -1) cleared.splice(keep, 1);
    updates.barangay = editorBarangay;
  }
  if (updates.barangay) {
    const brgyCheck = await checkBarangay(updates.barangay, idOf(program.municipality));
    if (brgyCheck !== 'ok') return errorResponse(res, 400, barangayErrorMessage(brgyCheck));
  }

  const start = updates.startDate || program.startDate;
  const end = updates.endDate || program.endDate;
  if (start && end && new Date(end) <= new Date(start)) {
    return errorResponse(res, 400, 'End date must be after start date');
  }

  const implementation = cleared.includes('implementationDate')
    ? null
    : (updates.implementationDate || program.implementationDate);
  const dateProblem = implementationDateProblem(implementation, start);
  if (dateProblem) return errorResponse(res, 400, dateProblem);
  // Checked on the move INTO completed, so an older completed programme without the date can still
  // be edited — the rule is that a programme is not marked done without saying when it happened.
  const nextStatus = updates.status || program.status;
  if (nextStatus === 'completed' && program.status !== 'completed' && !implementation) {
    return errorResponse(res, 400, 'A completed programme needs the date it was actually implemented');
  }

  // Validated only when the link changes: programmes linked before per-barangay budgets existed keep
  // the municipal budget they were approved against, and an unrelated edit must not be refused for it.
  if (updates.budgetRef && idOf(updates.budgetRef) !== idOf(program.budgetRef)) {
    const linkProblem = await budgetLinkProblem(updates.budgetRef, {
      municipality: program.municipality,
      barangay: Object.prototype.hasOwnProperty.call(updates, 'barangay') ? updates.barangay
        : (cleared.includes('barangay') ? null : program.barangay),
    });
    if (linkProblem) return errorResponse(res, 400, linkProblem);
  }

  const updated = await Program.findByIdAndUpdate(req.params.id, toMutation({ set: updates, unset: cleared }), { new: true, runValidators: true });
  // Cleared fields are changes too — omitting them under-reports the edit in the audit trail.
  await AuditLog.create({ user: req.user._id, action: 'UPDATE', resource: 'program', resourceId: program._id, details: { changes: [...Object.keys(updates), ...cleared] }, municipality: program.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Program updated', updated);
});


/* ------------------------------------------------------------------------------------------- *
 * Program approval workflow
 *
 * draft ──submit──▶ submitted ──approve──▶ approved
 *                        └────reject────▶ rejected ──(resubmit)──▶ submitted
 *
 * Approval is what encumbers money. A program may be created and submitted with no budget at all
 * and still be approved — the absence of funding is not a reason to block the decision. Where a
 * budget IS linked, approving commits the amount against it so it cannot be promised twice.
 * ------------------------------------------------------------------------------------------- */

// Shared ownership guard. Returns an error message, or null when the caller may act.
const denyIfForeign = (req, program, verb) =>
  (writeScopeViolation(program, req.user, PROGRAM_WRITE_SCOPE) ? `Not authorized to ${verb} this program` : null);

/**
 * How much of `budget` a programme approval may still commit. For a barangay allocation that is its
 * own uncommitted balance; for the MUNICIPAL budget it is also net of every approved barangay
 * allocation, because that money has already been given to the barangays.
 */
const committableBalance = async (budget, session) => {
  if (budget.barangay) return budget.availableBalance;
  const { available } = await municipalBudgetAvailability(budget, { session });
  return available;
};

exports.submitProgram = asyncHandler(async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, deletedAt: null });
  if (!program) return errorResponse(res, 404, 'Program not found');
  const denied = denyIfForeign(req, program, 'submit');
  if (denied) return errorResponse(res, 403, denied);

  // Atomic, so two clicks cannot both move it out of draft.
  const submitted = await Program.findOneAndUpdate(
    { _id: req.params.id, approvalStatus: { $in: ['draft', 'rejected'] } },
    { approvalStatus: 'submitted', submittedAt: new Date(), rejectionReason: undefined },
    { new: true }
  );
  if (!submitted) return errorResponse(res, 409, 'Only draft or rejected programs can be submitted for approval');

  await AuditLog.create({
    user: req.user._id, action: 'UPDATE', resource: 'program', resourceId: program._id,
    details: { approvalStatus: 'submitted' }, municipality: program.municipality, ipAddress: req.ip,
  });

  successResponse(res, 200, 'Program submitted for approval', submitted);
});

exports.approveProgram = asyncHandler(async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, deletedAt: null });
  if (!program) return errorResponse(res, 404, 'Program not found');
  const denied = denyIfForeign(req, program, 'approve');
  if (denied) return errorResponse(res, 403, denied);
  if (program.createdBy?.toString() === req.user._id.toString()) {
    return errorResponse(res, 403, 'You cannot approve a program you created');
  }

  const amount = program.budget || 0;

  /*
   * The state change and the commitment happen together, in one transaction: the programme cannot
   * end up approved with nothing reserved for it, nor the money reserved for a programme whose
   * approval lost a race. The balance is re-read inside the transaction, so two approvals against
   * the same budget cannot both see the same uncommitted money.
   */
  let approved;
  let budget = null;
  try {
    approved = await withTransaction(async (session) => {
      const opts = sessionOpts(session);
      budget = program.budgetRef ? await Budget.findOne({ _id: program.budgetRef, deletedAt: null }, null, opts) : null;
      if (budget && amount > 0) {
        if (budget.status !== 'approved') throw httpError(400, 'The linked budget is not approved yet');
        const available = await committableBalance(budget, session);
        if (amount > available) throw httpError(400, `Only ${peso(Math.max(0, available))} is uncommitted in the linked budget`);
      }

      const claimed = await Program.findOneAndUpdate(
        { _id: req.params.id, approvalStatus: 'submitted' },
        {
          approvalStatus: 'approved',
          approvedBy: req.user._id,
          approvedAt: new Date(),
          committedAmount: budget ? amount : 0,
          rejectionReason: undefined,
        },
        { new: true, ...opts }
      );
      if (!claimed) throw httpError(409, 'Program was already processed or is not awaiting approval');

      // $inc, not a read-modify-write, so concurrent approvals cannot lose one another's commitment.
      if (budget && amount > 0) {
        await Budget.updateOne({ _id: budget._id }, { $inc: { committedAmount: amount } }, opts);
      }
      return claimed;
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.statusCode, err.message);
    throw err;
  }

  await AuditLog.create({
    user: req.user._id, action: 'APPROVE', resource: 'program', resourceId: program._id,
    details: { committedAmount: budget ? amount : 0, budget: budget?._id || null },
    municipality: program.municipality, ipAddress: req.ip,
  });

  Notification.create({
    recipient: program.createdBy,
    type: 'system',
    title: 'Program Approved',
    message: `Program "${program.title}" has been approved.`,
    link: `/programs/${program._id}`,
  }).catch(() => {});

  successResponse(res, 200, 'Program approved', approved);
});

exports.rejectProgram = asyncHandler(async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, deletedAt: null });
  if (!program) return errorResponse(res, 404, 'Program not found');
  const denied = denyIfForeign(req, program, 'reject');
  if (denied) return errorResponse(res, 403, denied);

  const rejected = await Program.findOneAndUpdate(
    { _id: req.params.id, approvalStatus: 'submitted' },
    { approvalStatus: 'rejected', rejectionReason: req.body.reason, committedAmount: 0 },
    { new: true }
  );
  if (!rejected) return errorResponse(res, 409, 'Only programs awaiting approval can be rejected');

  await AuditLog.create({
    user: req.user._id, action: 'REJECT', resource: 'program', resourceId: program._id,
    details: { reason: req.body.reason }, municipality: program.municipality, ipAddress: req.ip,
  });

  Notification.create({
    recipient: program.createdBy,
    type: 'system',
    title: 'Program Rejected',
    message: `Program "${program.title}" was rejected${req.body.reason ? `: ${req.body.reason}` : ''}.`,
    link: `/programs/${program._id}`,
  }).catch(() => {});

  successResponse(res, 200, 'Program rejected', rejected);
});

/* ------------------------------------------------------------------------------------------- *
 * Programme participation
 *
 * A youth asks to join; SK staff confirm or decline. Only confirmed participants count toward
 * `targetParticipants` — a request is not a slot — and requests are refused once a programme is
 * full, so nobody queues for a place that cannot exist.
 * ------------------------------------------------------------------------------------------- */

// Confirmed participants for a programme. Counted from the registry rather than read from
// Program.actualParticipants, so the cap cannot drift away from the records behind it.
const confirmedCount = (programId) => YouthMember.countDocuments({
  deletedAt: null,
  programParticipations: { $elemMatch: { program: programId, status: 'confirmed' } },
});

exports.requestToJoin = asyncHandler(async (req, res) => {
  const member = await YouthMember.findOne({ user: req.user._id, deletedAt: null });
  if (!member) return errorResponse(res, 404, 'No youth registry record is linked to your account');

  const program = await Program.findOne({ _id: req.params.id, deletedAt: null });
  if (!program) return errorResponse(res, 404, 'Program not found');

  const memberMunId = (member.municipality?._id || member.municipality)?.toString();
  if (program.municipality?.toString() !== memberMunId) {
    return errorResponse(res, 403, 'This program belongs to a different municipality');
  }
  if (program.approvalStatus !== 'approved') {
    return errorResponse(res, 400, 'This program has not been approved yet');
  }
  if (['completed', 'cancelled'].includes(program.status)) {
    return errorResponse(res, 400, `This program is ${program.status}`);
  }

  const already = member.programParticipations.find((p) => p.program?.toString() === program._id.toString());
  if (already && already.status !== 'declined') {
    return errorResponse(res, 409, already.status === 'confirmed'
      ? 'You are already a participant in this program'
      : 'You have already asked to join this program');
  }

  if (program.targetParticipants > 0 && (await confirmedCount(program._id)) >= program.targetParticipants) {
    return errorResponse(res, 409, 'This program is already full');
  }

  if (already) {
    // A previously declined request may be made again — circumstances change, and the alternative
    // is a youth permanently locked out of one programme by a single past decision.
    already.status = 'pending';
    already.requestedAt = new Date();
    already.decidedAt = undefined;
    already.decidedBy = undefined;
    already.declineReason = undefined;
  } else {
    member.programParticipations.push({ program: program._id, status: 'pending' });
  }
  await member.save();

  successResponse(res, 200, 'Request to join submitted', { program: program._id, status: 'pending' });
});

exports.withdrawJoinRequest = asyncHandler(async (req, res) => {
  const member = await YouthMember.findOne({ user: req.user._id, deletedAt: null });
  if (!member) return errorResponse(res, 404, 'No youth registry record is linked to your account');

  const entry = member.programParticipations.find((p) => p.program?.toString() === req.params.id);
  if (!entry || entry.status === 'declined') {
    return errorResponse(res, 404, 'You have no active request for this program');
  }

  member.programParticipations.pull({ _id: entry._id });
  await member.save();

  // A withdrawal by a confirmed participant frees their slot.
  await Program.updateOne({ _id: req.params.id }, { actualParticipants: await confirmedCount(req.params.id) });
  successResponse(res, 200, 'Request withdrawn');
});

exports.getParticipants = asyncHandler(async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, deletedAt: null });
  if (!program) return errorResponse(res, 404, 'Program not found');
  // Reading the list follows the programme's read scope; deciding on a request is a write (below).
  if (readScopeViolation(program, req.user)) return errorResponse(res, 403, 'Not authorized to view participants for this program');

  const members = await YouthMember.find({
    deletedAt: null,
    'programParticipations.program': program._id,
  })
    .select('firstName lastName birthDate gender barangay contactNumber programParticipations verificationStatus')
    .populate('barangay', 'name');

  const participants = members.map((m) => {
    const entry = m.programParticipations.find((p) => p.program?.toString() === program._id.toString());
    return {
      _id: m._id,
      firstName: m.firstName,
      lastName: m.lastName,
      age: m.age,
      gender: m.gender,
      barangay: m.barangay,
      contactNumber: m.contactNumber,
      verificationStatus: m.verificationStatus,
      status: entry?.status,
      requestedAt: entry?.requestedAt,
      decidedAt: entry?.decidedAt,
      declineReason: entry?.declineReason,
    };
  });

  successResponse(res, 200, 'Program participants', {
    targetParticipants: program.targetParticipants,
    confirmed: participants.filter((p) => p.status === 'confirmed').length,
    pending: participants.filter((p) => p.status === 'pending').length,
    participants,
  });
});

exports.decideParticipant = asyncHandler(async (req, res) => {
  const { decision, reason } = req.body;
  if (!['confirmed', 'declined'].includes(decision)) {
    return errorResponse(res, 400, 'Decision must be confirmed or declined');
  }

  const program = await Program.findOne({ _id: req.params.id, deletedAt: null });
  if (!program) return errorResponse(res, 404, 'Program not found');
  const denied = denyIfForeign(req, program, 'manage participants for');
  if (denied) return errorResponse(res, 403, denied);

  // The cap is checked here, at the moment a place is actually taken, not when it was requested.
  if (decision === 'confirmed' && program.targetParticipants > 0) {
    if ((await confirmedCount(program._id)) >= program.targetParticipants) {
      return errorResponse(res, 409, `This program has reached its target of ${program.targetParticipants} participants`);
    }
  }

  // Atomic on the pending state, so two officers deciding at once cannot both take the last slot.
  const updated = await YouthMember.findOneAndUpdate(
    {
      _id: req.params.youthId,
      deletedAt: null,
      programParticipations: { $elemMatch: { program: program._id, status: 'pending' } },
    },
    {
      $set: {
        'programParticipations.$[entry].status': decision,
        'programParticipations.$[entry].decidedAt': new Date(),
        'programParticipations.$[entry].decidedBy': req.user._id,
        'programParticipations.$[entry].declineReason': decision === 'declined' ? reason : undefined,
      },
    },
    { new: true, arrayFilters: [{ 'entry.program': program._id, 'entry.status': 'pending' }] }
  );
  if (!updated) return errorResponse(res, 409, 'That request was already decided, or does not exist');

  // Kept in step with the registry so the programme page and reports agree.
  await Program.updateOne({ _id: program._id }, { actualParticipants: await confirmedCount(program._id) });

  await AuditLog.create({
    user: req.user._id, action: 'UPDATE', resource: 'program', resourceId: program._id,
    details: { participant: updated._id, decision }, municipality: program.municipality, ipAddress: req.ip,
  });

  if (updated.user) {
    Notification.create({
      recipient: updated.user,
      type: 'system',
      title: decision === 'confirmed' ? 'Program Request Approved' : 'Program Request Declined',
      message: decision === 'confirmed'
        ? `You are confirmed for "${program.title}".`
        : `Your request to join "${program.title}" was declined${reason ? `: ${reason}` : ''}.`,
      link: '/my/programs',
    }).catch(() => {});
  }

  successResponse(res, 200, `Participant ${decision}`, { youth: updated._id, status: decision });
});

exports.deleteProgram = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id);
  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');
  // This route is open to ADMINS, which includes municipal_admin — without a scope check a Boac
  // admin could delete a Sta. Cruz program. Every other program mutation already guards this.
  const denied = denyIfForeign(req, program, 'delete');
  if (denied) return errorResponse(res, 403, denied);

  // Deleting and giving the money back are one act: a deleted programme cannot keep an encumbrance
  // on a live budget, and a release must not happen for a delete that did not.
  await withTransaction(async (session) => {
    const opts = sessionOpts(session);
    await Program.updateOne({ _id: program._id }, { deletedAt: new Date(), committedAmount: 0 }, opts);
    if (program.committedAmount > 0 && program.budgetRef) {
      await Budget.updateOne({ _id: program.budgetRef }, { $inc: { committedAmount: -program.committedAmount } }, opts);
    }
  });

  await AuditLog.create({
    user: req.user._id, action: 'DELETE', resource: 'program', resourceId: program._id,
    details: { title: program.title, releasedCommitment: program.committedAmount || 0 },
    municipality: program.municipality, ipAddress: req.ip,
  });

  successResponse(res, 200, 'Program deleted');
});

exports.updateProgramStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const VALID_STATUSES = ['planned', 'ongoing', 'completed', 'cancelled', 'delayed'];
  if (!VALID_STATUSES.includes(status)) return errorResponse(res, 400, 'Invalid program status');

  const program = await Program.findById(req.params.id);
  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');
  if (writeScopeViolation(program, req.user, PROGRAM_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this program');
  if (status === 'completed' && program.status !== 'completed' && !program.implementationDate) {
    return errorResponse(res, 400, 'Record the date the programme was actually implemented before marking it completed');
  }
  const updated = await Program.findByIdAndUpdate(req.params.id, { status }, { new: true });

  // Notify the program creator and assigned officers of the status change
  const recipients = [program.createdBy, ...(program.assignedOfficers || [])].filter(Boolean);
  const uniqueRecipients = [...new Set(recipients.map((r) => r.toString()))].filter((r) => r !== req.user._id.toString());
  if (uniqueRecipients.length > 0) {
    await Notification.insertMany(uniqueRecipients.map((r) => ({
      recipient: r,
      type: 'system',
      title: 'Program Status Updated',
      message: `"${program.title}" status changed to ${status.replace(/_/g, ' ')}.`,
      link: `/programs/${program._id}`,
      priority: status === 'delayed' || status === 'cancelled' ? 'high' : 'medium',
    })));
  }

  successResponse(res, 200, 'Program status updated', updated);
});

exports.addMilestone = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id);
  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');
  if (writeScopeViolation(program, req.user, PROGRAM_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this program');
  const ALLOWED_MILESTONE_FIELDS = ['title', 'description', 'targetDate', 'completedAt', 'status', 'completionRate'];
  const milestoneData = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_MILESTONE_FIELDS.includes(k)));
  program.milestones.push(milestoneData);
  await program.save();
  successResponse(res, 200, 'Milestone added', program);
});

exports.updateMilestone = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id);
  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');
  if (writeScopeViolation(program, req.user, PROGRAM_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this program');
  const milestone = program.milestones.id(req.params.milestoneId);
  if (!milestone) return errorResponse(res, 404, 'Milestone not found');
  const ALLOWED_MILESTONE_FIELDS = ['title', 'description', 'targetDate', 'completedAt', 'status', 'completionRate'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_MILESTONE_FIELDS.includes(k)));
  Object.assign(milestone, updates);
  await program.save();
  successResponse(res, 200, 'Milestone updated', program);
});

exports.getProgramStats = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };
  // Scoped exactly like the list it sits above, or the headline counts describe a different set of
  // programmes than the rows underneath them.
  if (CROSS_MUNICIPALITY_READ.includes(req.user.role) && req.query.municipality) {
    filter.municipality = req.query.municipality;
  }
  applyReadScope(filter, req.user, { requestedBarangay: req.query.barangay });

  const stats = await Program.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalBudget: { $sum: '$budget' },
        avgCompletionRate: { $avg: '$completionRate' },
      },
    },
  ]);

  const byCategory = await Program.aggregate([
    { $match: filter },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const byApproval = await Program.aggregate([
    { $match: filter },
    { $group: { _id: '$approvalStatus', count: { $sum: 1 } } },
  ]);

  // The panel could not tell how many programs had actually been completed. `byStatus` carries it,
  // but only as one entry among five — `completed` and `total` are surfaced explicitly so the
  // headline figures need no arithmetic from the reader.
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  const completed = stats.find((s) => s._id === 'completed')?.count || 0;

  successResponse(res, 200, 'Program statistics', { byStatus: stats, byCategory, byApproval, total, completed });
});
