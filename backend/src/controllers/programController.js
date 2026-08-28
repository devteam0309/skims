const asyncHandler = require('express-async-handler');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const YouthMember = require('../models/YouthMember');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

/*
 * Categories are free text now, so two people can type "Peace & Order", "peace and order" and
 * "Peace and Order" for one thing and the category filter would treat them as three. Normalising
 * on write collapses them onto the same canonical slug the seeded data already uses, so a typed
 * category groups with an existing one instead of splintering the list. Display prettifies it
 * back; nothing user-facing shows the underscore form.
 */
const normalizeCategory = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

exports.getPrograms = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, approvalStatus, category, municipality, barangay, search, startDate, endDate } = req.query;
  const filter = { deletedAt: null };

  if (status) filter.status = status;
  if (approvalStatus) filter.approvalStatus = approvalStatus;
  if (category) filter.category = normalizeCategory(category);
  if (barangay) filter.barangay = barangay;
  if (search) filter.$text = { $search: search };
  if (startDate || endDate) {
    filter.startDate = {};
    if (startDate) filter.startDate.$gte = new Date(startDate);
    if (endDate) filter.startDate.$lte = new Date(endDate);
  }

  if (!['super_admin', 'provincial_admin'].includes(req.user?.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  } else if (municipality) {
    filter.municipality = municipality;
  }

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [programs, total] = await Promise.all([
    Program.find(filter)
      .populate('municipality', 'name code')
      .populate('barangay', 'name')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Program.countDocuments(filter),
  ]);

  paginatedResponse(res, programs, safePage, safeLimit, total);
});

exports.getProgram = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id)
    .populate('municipality', 'name code')
    .populate('barangay', 'name')
    .populate('createdBy', 'firstName lastName email')
    .populate('assignedOfficers', 'firstName lastName role email')
    .populate('budgetRef', 'title fiscalYear status totalBudget remainingBalance');

  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');

  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    const programMunId = (program.municipality?._id || program.municipality)?.toString();
    if (programMunId !== userMunId) return errorResponse(res, 403, 'Not authorized to view this program');
  }

  successResponse(res, 200, 'Program', program);
});

exports.createProgram = asyncHandler(async (req, res) => {
  const ALLOWED_CREATE_FIELDS = ['title', 'description', 'category', 'status', 'municipality', 'barangay', 'budget', 'budgetRef', 'startDate', 'endDate', 'targetParticipants', 'objectives', 'assignedOfficers', 'isPublic'];
  const programData = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED_CREATE_FIELDS.includes(k))
  );
  if (programData.category) programData.category = normalizeCategory(programData.category);
  programData.createdBy = req.user._id;

  // Only the two genuinely cross-municipality roles may direct a program at another
  // municipality. For everyone else the body value is ignored outright: a `!municipality`
  // fallback still let a scoped user file a program under a municipality they cannot read,
  // which is precisely the isolation the panel asked us to guarantee.
  if (['super_admin', 'provincial_admin'].includes(req.user.role)) {
    if (!programData.municipality) programData.municipality = req.user.municipality;
  } else {
    programData.municipality = req.user.municipality?._id || req.user.municipality;
  }
  if (!programData.municipality) {
    return errorResponse(res, 400, 'A municipality is required to create a program');
  }

  if (programData.startDate && programData.endDate && new Date(programData.endDate) <= new Date(programData.startDate)) {
    return errorResponse(res, 400, 'End date must be after start date');
  }

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
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (program.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to update this program');
  }

  const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'objectives', 'category', 'status', 'barangay', 'budget', 'budgetRef', 'startDate', 'endDate', 'targetParticipants', 'actualParticipants', 'assignedOfficers', 'milestones', 'accomplishmentReport', 'isPublic', 'tags', 'location', 'attachments'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k)));

  if (updates.category) updates.category = normalizeCategory(updates.category);

  const start = updates.startDate || program.startDate;
  const end = updates.endDate || program.endDate;
  if (start && end && new Date(end) <= new Date(start)) {
    return errorResponse(res, 400, 'End date must be after start date');
  }

  const updated = await Program.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  await AuditLog.create({ user: req.user._id, action: 'UPDATE', resource: 'program', resourceId: program._id, details: { changes: Object.keys(updates) }, municipality: req.user.municipality, ipAddress: req.ip });
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
const denyIfForeign = (req, program, verb) => {
  if (['super_admin', 'provincial_admin'].includes(req.user.role)) return null;
  const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
  if (program.municipality?.toString() !== userMunId) return `Not authorized to ${verb} this program`;
  return null;
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
  const budget = program.budgetRef ? await Budget.findOne({ _id: program.budgetRef, deletedAt: null }) : null;

  // Guard before the state change, so a rejected commitment leaves no half-approved program.
  if (budget && amount > 0) {
    if (budget.status !== 'approved') {
      return errorResponse(res, 400, 'The linked budget is not approved yet');
    }
    if (amount > budget.availableBalance) {
      return errorResponse(
        res, 400,
        `Only ₱${budget.availableBalance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} is uncommitted in the linked budget`
      );
    }
  }

  const approved = await Program.findOneAndUpdate(
    { _id: req.params.id, approvalStatus: 'submitted' },
    {
      approvalStatus: 'approved',
      approvedBy: req.user._id,
      approvedAt: new Date(),
      committedAmount: budget ? amount : 0,
      rejectionReason: undefined,
    },
    { new: true }
  );
  if (!approved) return errorResponse(res, 409, 'Program was already processed or is not awaiting approval');

  // Encumber the money only once the program is definitively approved. $inc, not a read-modify-
  // write, so concurrent approvals against the same budget cannot lose one another's commitment.
  if (budget && amount > 0) {
    await Budget.updateOne({ _id: budget._id }, { $inc: { committedAmount: amount } });
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
  const denied = denyIfForeign(req, program, 'view participants for');
  if (denied) return errorResponse(res, 403, denied);

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

  program.deletedAt = new Date();
  await program.save();

  // Give the money back. A deleted program cannot hold an encumbrance against a live budget.
  if (program.committedAmount > 0 && program.budgetRef) {
    await Budget.updateOne({ _id: program.budgetRef }, { $inc: { committedAmount: -program.committedAmount } });
    await Program.updateOne({ _id: program._id }, { committedAmount: 0 });
  }

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
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (program.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to update this program');
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
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (program.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to update this program');
  }
  const ALLOWED_MILESTONE_FIELDS = ['title', 'description', 'targetDate', 'completedAt', 'status', 'completionRate'];
  const milestoneData = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_MILESTONE_FIELDS.includes(k)));
  program.milestones.push(milestoneData);
  await program.save();
  successResponse(res, 200, 'Milestone added', program);
});

exports.updateMilestone = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id);
  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (program.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to update this program');
  }
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
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  } else if (req.query.municipality) {
    filter.municipality = req.query.municipality;
  }

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
