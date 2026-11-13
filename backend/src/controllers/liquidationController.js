const asyncHandler = require('express-async-handler');
const Liquidation = require('../models/Liquidation');
const Document = require('../models/Document');
const Expense = require('../models/Expense');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { normalizeLabel } = require('../utils/labels');
const { CROSS_MUNICIPALITY_READ, ADMINS } = require('../constants/roles');
const {
  applyReadScope, writeScopeViolation, readScopeViolation, forceScopeOnCreate, idOf,
} = require('../utils/scope');
const { checkBarangay, barangayErrorMessage } = require('../utils/barangay');
const { storeFiles, removeFile, sendFile } = require('../services/fileStorage');
const { storageRefOf } = require('../models/schemas/attachment');
const { withTransaction, sessionOpts, httpError } = require('../utils/transaction');
const { sendQuietly } = require('../utils/mail');

const MAX_LIMIT = 100;
const { pickCreatable } = require('../utils/writeFields');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * Liquidation reports carry a barangay now, and are scoped STRICTLY like the rest of finance: a
 * barangay's officers read their own barangay's reports, the municipality's reviewers read them
 * all. Reports from before October 2026 have no barangay and stay with the officer who submitted
 * them (`ownerField`) until the migration files them properly.
 */
const LIQ_SCOPE = { strict: true, ownerField: 'submittedBy' };

// Reports still in the treasurer's hands, which they may change, add proof to, or bin.
const WITH_AUTHOR = ['draft', 'returned'];
// Statuses in which a report still "claims" the expenses it names.
const ACTIVE = ['draft', 'submitted', 'under_review', 'returned', 'approved'];

const evidenceCount = (liq) => (liq.documents?.length || 0) + (liq.supportingDocuments?.length || 0);
const NO_EVIDENCE = 'Attach at least one supporting document — official receipt, sales invoice, acknowledgment receipt, disbursement voucher or similar — or link one from Document Management.';

const asList = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return [].concat(value).map(String).filter(Boolean);
};

/** Store uploaded proof, describing each file with the type the uploader gave it. */
const storeEvidence = async (req) => {
  const files = req.files || [];
  if (!files.length) return [];
  const types = asList(req.body.documentTypes);
  const stored = await storeFiles(files, { folder: 'skims/liquidations' });
  return stored.map((ref, i) => ({
    ...ref,
    /*
     * Left unset when the client sends no type, rather than silently labelled 'other'. The old
     * default recorded every unrecognised attachment as the same thing and threw away what it
     * actually was — the caller's word for it is the only record there is.
     */
    documentType: types[i] ? normalizeLabel(types[i]) : undefined,
    uploadedBy: req.user._id,
  }));
};

const audit = (req, liq, action, extra = {}) => AuditLog.create({
  user: req.user._id, action, resource: 'liquidation', resourceId: liq._id,
  // The report's own municipality: these entries used to carry none, which hid every liquidation
  // decision from the municipality's audit view.
  municipality: liq.municipality?._id || liq.municipality, ipAddress: req.ip,
  ...extra,
  details: {
    referenceNumber: liq.referenceNumber, totalAmount: liq.totalAmount, barangay: liq.barangay?._id || liq.barangay || null,
    ...(extra.details || {}),
  },
});

exports.getLiquidations = asyncHandler(async (req, res) => {
  const { municipality, status, program, search } = req.query;
  const filter = { deletedAt: null };
  if (municipality && CROSS_MUNICIPALITY_READ.includes(req.user.role)) filter.municipality = municipality;
  if (status) filter.status = status;
  if (program) filter.program = program;
  if (search) filter.$or = [
    { title: { $regex: escapeRegex(search), $options: 'i' } },
    { referenceNumber: { $regex: escapeRegex(search), $options: 'i' } },
  ];
  applyReadScope(filter, req.user, { ...LIQ_SCOPE, requestedBarangay: req.query.barangay });

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [liquidations, total] = await Promise.all([
    Liquidation.find(filter)
      .populate('program', 'title category')
      .populate('municipality', 'name code')
      .populate('barangay', 'name')
      .populate('submittedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Liquidation.countDocuments(filter),
  ]);
  paginatedResponse(res, liquidations, safePage, safeLimit, total);
});

/**
 * The full report for review: programme, barangay, the expenses it accounts for (with their own
 * proof), the attachments uploaded with it, the registered documents linked to it, and every
 * decision so far with who made it and why.
 */
exports.getLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findById(req.params.id)
    .populate('program', 'title category budget implementationDate')
    .populate({ path: 'expenses', select: 'referenceNumber title amount status transactionDate type attachments barangay' })
    // Which registered documents back this report — the whole point of the link.
    .populate('supportingDocuments', 'title category originalName fileType isArchived')
    .populate('budget', 'title fiscalYear barangay')
    .populate('municipality', 'name')
    .populate('barangay', 'name')
    .populate('submittedBy', 'firstName lastName email')
    .populate('approvedBy', 'firstName lastName')
    .populate('rejectedBy', 'firstName lastName')
    .populate('returnedBy', 'firstName lastName')
    .populate('reviewedBy', 'firstName lastName');
  if (!liq || liq.deletedAt) return errorResponse(res, 404, 'Liquidation not found');
  if (readScopeViolation(liq, req.user, LIQ_SCOPE)) return errorResponse(res, 403, 'Not authorized to view this liquidation');
  successResponse(res, 200, 'Liquidation', liq);
});

exports.createLiquidation = asyncHandler(async (req, res) => {
  const ALLOWED_CREATE_FIELDS = ['title', 'program', 'budget', 'expenses', 'totalAmount', 'liquidatedAmount', 'dueDate', 'remarks', 'supportingDocuments', 'barangay'];
  // Blanks dropped — an absent due date or remark posts '' and cannot be cast. `program` is
  // required by the schema, so an unlinked one is rejected by validation rather than silently kept.
  const liqData = pickCreatable(Liquidation, req.body, ALLOWED_CREATE_FIELDS);
  liqData.submittedBy = req.user._id;

  // Filed under the treasurer's own barangay and municipality, whatever the request says —
  // overwritten rather than refused, the contract liquidation.test.js pins.
  forceScopeOnCreate(liqData, req.user);
  if (!liqData.municipality) return errorResponse(res, 400, 'A municipality is required to file a liquidation report');
  const brgyCheck = await checkBarangay(liqData.barangay, idOf(liqData.municipality));
  if (brgyCheck !== 'ok') return errorResponse(res, 400, barangayErrorMessage(brgyCheck));

  /*
   * Everything the report names must belong to the same place it does. These were bare ids: a
   * report could name another municipality's programme, and — worse — another municipality's
   * expenses, which approving the report would then have marked as liquidated.
   */
  if (liqData.program) {
    const program = await Program.findOne({ _id: liqData.program, deletedAt: null }).select('municipality barangay');
    if (!program) return errorResponse(res, 404, 'Program not found');
    if (idOf(program.municipality) !== idOf(liqData.municipality) || readScopeViolation(program, req.user)) {
      return errorResponse(res, 403, 'That program belongs to another municipality or barangay');
    }
    if (program.barangay && idOf(program.barangay) !== idOf(liqData.barangay)) {
      return errorResponse(res, 400, 'The program belongs to a different barangay from this report');
    }
  }

  if (liqData.budget) {
    const budget = await Budget.findOne({ _id: liqData.budget, deletedAt: null }).select('municipality barangay');
    if (!budget) return errorResponse(res, 404, 'Budget not found');
    if (idOf(budget.municipality) !== idOf(liqData.municipality) || idOf(budget.barangay) !== idOf(liqData.barangay)) {
      return errorResponse(res, 400, 'A liquidation report can only reference its own barangay\'s (or, at municipal level, the municipal) budget');
    }
  }

  /*
   * The expenses a report accounts for must be APPROVED (money actually released), in the same
   * barangay, and not already claimed by another live report. Approving a report marks its
   * expenses liquidated; letting it name pending ones would have skipped expense approval — and the
   * budget deduction that comes with it — entirely.
   */
  const expenseIds = [...new Set(asList(liqData.expenses))];
  if (expenseIds.length) {
    if (expenseIds.length > 100) return errorResponse(res, 400, 'A liquidation can name at most 100 expenses');
    const expenses = await Expense.find({ _id: { $in: expenseIds }, deletedAt: null }).select('municipality barangay status createdBy');
    if (expenses.length !== expenseIds.length) return errorResponse(res, 404, 'One or more expenses could not be found');
    if (expenses.some((e) => idOf(e.municipality) !== idOf(liqData.municipality) || idOf(e.barangay) !== idOf(liqData.barangay))) {
      return errorResponse(res, 403, 'Every expense in a report must belong to the report\'s own barangay');
    }
    if (expenses.some((e) => e.status !== 'approved')) {
      return errorResponse(res, 400, 'Only approved expenses can be liquidated');
    }
    if (await Liquidation.exists({ expenses: { $in: expenseIds }, status: { $in: ACTIVE }, deletedAt: null })) {
      return errorResponse(res, 409, 'One or more of these expenses already belong to another liquidation report');
    }
    liqData.expenses = expenseIds;
  }

  /*
   * Linked supporting documents must be documents the caller can actually see. Without the check a
   * report could name another municipality's document by id and publish its title and category to
   * everyone who opens the report — a read across the boundary, arriving through a write.
   *
   * Normalised before it is used: a multipart body carrying one linked document arrives as a bare
   * string rather than an array of one — multer only produces an array when the field repeats.
   */
  const documentIds = [...new Set(asList(liqData.supportingDocuments))];
  if (documentIds.length) {
    if (documentIds.length > 20) return errorResponse(res, 400, 'A liquidation can link at most 20 supporting documents');
    const docs = await Document.find({ _id: { $in: documentIds }, deletedAt: null }).select('municipality barangay uploadedBy');
    if (docs.length !== documentIds.length) return errorResponse(res, 404, 'One or more supporting documents could not be found');
    const foreign = docs.find((d) => readScopeViolation(d, req.user));
    if (foreign) return errorResponse(res, 403, 'One or more supporting documents belong to another municipality or barangay');
    liqData.supportingDocuments = documentIds;
  } else {
    delete liqData.supportingDocuments;
  }

  // Proof is required from the start: a liquidation report is the evidence that money was spent.
  if (!(req.files?.length > 0) && documentIds.length === 0) return errorResponse(res, 400, NO_EVIDENCE);

  const evidence = await storeEvidence(req);
  liqData.documents = evidence;

  let liq;
  try {
    liq = await Liquidation.create(liqData);
  } catch (err) {
    evidence.forEach(removeFile);
    throw err;
  }
  await audit(req, liq, 'CREATE', {
    newValues: { status: liq.status },
    details: { title: liq.title, attachments: evidence.length, supportingDocuments: liq.supportingDocuments?.length || 0, expenses: liq.expenses?.length || 0 },
  });
  successResponse(res, 201, 'Liquidation created', liq);
});

/** Add proof to a report still with its author — a draft, or one returned for more documents. */
exports.addAttachments = asyncHandler(async (req, res) => {
  if (!(req.files?.length > 0)) return errorResponse(res, 400, 'Choose at least one file to attach');
  const liq = await Liquidation.findOne({ _id: req.params.id, deletedAt: null });
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (writeScopeViolation(liq, req.user, LIQ_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this liquidation');
  if (!WITH_AUTHOR.includes(liq.status)) return errorResponse(res, 400, 'Documents can be added only to a draft or returned report');
  if ((liq.documents?.length || 0) + req.files.length > 20) return errorResponse(res, 400, 'A liquidation can carry at most 20 attachments');

  const evidence = await storeEvidence(req);
  const updated = await Liquidation.findOneAndUpdate(
    { _id: liq._id, status: { $in: WITH_AUTHOR }, deletedAt: null },
    { $push: { documents: { $each: evidence } } },
    { new: true }
  );
  if (!updated) {
    evidence.forEach(removeFile);
    return errorResponse(res, 409, 'The report was submitted or decided while you were attaching files; reload it');
  }
  await audit(req, liq, 'UPLOAD', { details: { attachmentsAdded: evidence.length } });
  successResponse(res, 200, 'Documents attached', updated);
});

/** Open an attachment — `?inline=1` to preview, otherwise download. Scoped like the report. */
exports.serveAttachment = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findById(req.params.id).select('municipality barangay submittedBy documents deletedAt');
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (liq.deletedAt && !ADMINS.includes(req.user.role)) return errorResponse(res, 404, 'Liquidation not found');
  if (readScopeViolation(liq, req.user, LIQ_SCOPE)) return errorResponse(res, 403, 'Not authorized to view this liquidation');
  const attachment = liq.documents.id(req.params.attachmentId);
  if (!attachment) return errorResponse(res, 404, 'Attachment not found');
  const inline = req.query.inline === '1' || req.query.inline === 'true';
  return sendFile(res, storageRefOf(attachment), { disposition: inline ? 'inline' : 'attachment' });
});

/** Municipal reviewers of a report: its municipality's administrators. */
const notifyReviewers = async (liq, title, message) => {
  const reviewers = await User.find({
    role: 'municipal_admin', municipality: liq.municipality, isActive: true, isApproved: true, deletedAt: null,
  }).select('_id').lean();
  if (!reviewers.length) return;
  await Notification.createWithExpiry(reviewers.map((r) => ({
    recipient: r._id, type: 'approval_request', title, message, link: '/liquidations', priority: 'high',
  })));
};

exports.submitLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findOne({ _id: req.params.id, deletedAt: null });
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (writeScopeViolation(liq, req.user, LIQ_SCOPE)) return errorResponse(res, 403, 'Not authorized to submit this liquidation');
  if (!WITH_AUTHOR.includes(liq.status)) return errorResponse(res, 400, 'Only draft or returned liquidations can be submitted');
  if (evidenceCount(liq) === 0) return errorResponse(res, 400, NO_EVIDENCE);

  // Atomic on the expected state: two clicks cannot both submit it.
  const submitted = await Liquidation.findOneAndUpdate(
    { _id: req.params.id, status: { $in: WITH_AUTHOR }, deletedAt: null },
    { status: 'submitted', submittedAt: new Date() },
    { new: true }
  );
  if (!submitted) return errorResponse(res, 409, 'This report was already submitted');

  await notifyReviewers(liq, liq.status === 'returned' ? 'Liquidation Resubmitted' : 'New Liquidation Submitted',
    `Liquidation report "${liq.referenceNumber}" was ${liq.status === 'returned' ? 'corrected and resubmitted' : 'submitted'} for review.`);
  await audit(req, liq, 'SUBMIT', { oldValues: { status: liq.status }, newValues: { status: 'submitted' } });
  successResponse(res, 200, 'Liquidation submitted for review', submitted);
});

/**
 * Approve a report. Its expenses become `liquidated` in the same transaction — only those still
 * `approved`, so an expense can never be liquidated without first having been approved and deducted.
 * Approval moves no money: the deduction happened when each expense was approved, so approving a
 * report twice (or one naming the same expenses as another) cannot deduct anything a second time.
 */
exports.approveLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findOne({ _id: req.params.id, deletedAt: null });
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (writeScopeViolation(liq, req.user)) return errorResponse(res, 403, 'Not authorized to approve this liquidation');
  if (evidenceCount(liq) === 0) return errorResponse(res, 400, 'This report has no supporting documents and cannot be approved. Return it for the missing proof.');
  if (idOf(liq.submittedBy) === idOf(req.user._id)) return errorResponse(res, 403, 'You cannot approve a liquidation report you submitted');

  let approved;
  try {
    approved = await withTransaction(async (session) => {
      const opts = sessionOpts(session);
      const claimed = await Liquidation.findOneAndUpdate(
        { _id: req.params.id, status: { $in: ['submitted', 'under_review'] }, deletedAt: null },
        { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), reviewedBy: req.user._id, reviewedAt: new Date() },
        { new: true, ...opts }
      );
      if (!claimed) throw httpError(409, 'Liquidation was already processed or is not in a reviewable state');
      if (claimed.expenses?.length) {
        await Expense.updateMany(
          { _id: { $in: claimed.expenses }, status: 'approved' },
          { isLiquidated: true, liquidationId: claimed._id, status: 'liquidated' },
          opts
        );
      }
      return claimed;
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.statusCode, err.message);
    throw err;
  }

  await audit(req, liq, 'APPROVE', {
    oldValues: { status: liq.status }, newValues: { status: 'approved' },
    details: { remarks: (req.body.remarks || '').trim() || null, expensesLiquidated: approved.expenses?.length || 0 },
  });

  if (liq.submittedBy) {
    Notification.create({
      recipient: liq.submittedBy,
      type: 'approval_granted',
      title: 'Liquidation Report Approved',
      message: `Your liquidation report "${liq.referenceNumber}" has been approved.`,
      link: '/liquidations',
      priority: 'high',
    }).catch(() => {});

    User.findById(liq.submittedBy).select('email firstName').then((submitter) => {
      if (submitter) sendQuietly('sendLiquidationApproved', submitter, approved);
    }).catch(() => {});
  }

  successResponse(res, 200, 'Liquidation approved', approved);
});

/**
 * Reject (final) or return (for correction or more documents) a report under review — always with
 * the reviewer's remarks, by an atomic change from the reviewable state.
 */
const decide = (decision) => asyncHandler(async (req, res) => {
  const reason = (req.body.reason || req.body.remarks || '').trim();
  if (!reason) return errorResponse(res, 400, `A reason is required when ${decision === 'returned' ? 'returning' : 'rejecting'} a liquidation report`);

  const liq = await Liquidation.findOne({ _id: req.params.id, deletedAt: null });
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (writeScopeViolation(liq, req.user)) return errorResponse(res, 403, `Not authorized to ${decision === 'returned' ? 'return' : 'reject'} this liquidation`);
  if (!['submitted', 'under_review'].includes(liq.status)) return errorResponse(res, 400, 'Liquidation cannot be decided in its current state');

  const now = new Date();
  const update = decision === 'returned'
    ? { status: 'returned', returnReason: reason, returnedBy: req.user._id, returnedAt: now, reviewedBy: req.user._id, reviewedAt: now }
    : { status: 'rejected', rejectionReason: reason, rejectedBy: req.user._id, rejectedAt: now, reviewedBy: req.user._id, reviewedAt: now };
  const decided = await Liquidation.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['submitted', 'under_review'] }, deletedAt: null },
    update,
    { new: true }
  );
  if (!decided) return errorResponse(res, 409, 'Liquidation was already processed by another user');

  await audit(req, liq, decision === 'returned' ? 'RETURN' : 'REJECT', {
    oldValues: { status: liq.status }, newValues: { status: decision }, details: { reason },
  });

  if (liq.submittedBy) {
    Notification.create({
      recipient: liq.submittedBy,
      type: 'approval_rejected',
      title: decision === 'returned' ? 'Liquidation Report Returned' : 'Liquidation Report Rejected',
      message: `Your liquidation report "${liq.referenceNumber}" was ${decision}. Reason: ${reason}`,
      link: '/liquidations',
      priority: 'high',
    }).catch(() => {});

    User.findById(liq.submittedBy).select('email firstName').then((submitter) => {
      if (submitter) sendQuietly(decision === 'returned' ? 'sendLiquidationReturned' : 'sendLiquidationRejected', submitter, liq, reason);
    }).catch(() => {});
  }

  successResponse(res, 200, decision === 'returned' ? 'Liquidation returned for correction' : 'Liquidation rejected', decided);
});

exports.rejectLiquidation = decide('rejected');
exports.returnLiquidation = decide('returned');

/**
 * Move a report to the recycle bin. Approved reports closed their expenses and stay. Scoped — this
 * route is open to ADMINS, which includes the scoped municipal_admin, and once had no check at all.
 */
exports.deleteLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findById(req.params.id);
  if (!liq || liq.deletedAt) return errorResponse(res, 404, 'Liquidation not found');
  if (writeScopeViolation(liq, req.user, LIQ_SCOPE)) return errorResponse(res, 403, 'Not authorized to delete this liquidation');
  if (['approved', 'submitted', 'under_review'].includes(liq.status)) {
    return errorResponse(res, 400, liq.status === 'approved'
      ? 'Approved liquidations cannot be deleted'
      : 'A report under review cannot be deleted; ask the reviewer to return it first');
  }
  const moved = await Liquidation.findOneAndUpdate(
    { _id: liq._id, deletedAt: null, status: { $nin: ['approved', 'submitted', 'under_review'] } },
    { deletedAt: new Date(), deletedBy: req.user._id },
    { new: true }
  );
  if (!moved) return errorResponse(res, 409, 'The report changed while you were deleting it; reload and try again');
  await audit(req, liq, 'DELETE', { details: { title: liq.title, status: liq.status, recoverable: true } });
  successResponse(res, 200, 'Liquidation moved to the recycle bin');
});

exports.getDeletedLiquidations = asyncHandler(async (req, res) => {
  const filter = { deletedAt: { $ne: null } };
  applyReadScope(filter, req.user, { ...LIQ_SCOPE, requestedBarangay: req.query.barangay });
  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [items, total] = await Promise.all([
    Liquidation.find(filter)
      .populate('program', 'title')
      .populate('barangay', 'name')
      .populate('submittedBy', 'firstName lastName')
      .populate('deletedBy', 'firstName lastName')
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Liquidation.countDocuments(filter),
  ]);
  const canPurge = ADMINS.includes(req.user.role);
  paginatedResponse(res, items.map((l) => ({ ...l.toJSON(), canPermanentlyDelete: canPurge })), safePage, safeLimit, total);
});

exports.restoreLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findById(req.params.id);
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (!liq.deletedAt) return errorResponse(res, 400, 'This report is not in the recycle bin');
  if (writeScopeViolation(liq, req.user, LIQ_SCOPE)) return errorResponse(res, 403, 'Not authorized to restore this liquidation');
  // A restored report must not double-claim expenses another live report has taken meanwhile.
  if (liq.expenses?.length && await Liquidation.exists({
    _id: { $ne: liq._id }, expenses: { $in: liq.expenses }, status: { $in: ACTIVE }, deletedAt: null,
  })) {
    return errorResponse(res, 409, 'Another liquidation report now covers some of these expenses, so this one cannot be restored');
  }
  const restored = await Liquidation.findOneAndUpdate(
    { _id: liq._id, deletedAt: { $ne: null } },
    { deletedAt: null, $unset: { deletedBy: '' } },
    { new: true }
  );
  if (!restored) return errorResponse(res, 409, 'This report was already restored');
  await audit(req, liq, 'RESTORE', { details: { status: liq.status } });
  successResponse(res, 200, 'Liquidation restored', restored);
});

exports.permanentlyDeleteLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findById(req.params.id);
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (!liq.deletedAt) return errorResponse(res, 400, 'Move the report to the recycle bin before deleting it permanently');
  if (writeScopeViolation(liq, req.user, LIQ_SCOPE)) return errorResponse(res, 403, 'Not authorized to delete this liquidation');
  await audit(req, liq, 'PERMANENT_DELETE', { oldValues: liq.toObject(), details: { irreversible: true } });
  (liq.documents || []).forEach((d) => removeFile(storageRefOf(d)));
  await Liquidation.deleteOne({ _id: liq._id });
  successResponse(res, 200, 'Liquidation permanently deleted');
});
