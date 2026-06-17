const asyncHandler = require('express-async-handler');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

exports.getPrograms = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, category, municipality, barangay, search, startDate, endDate } = req.query;
  const filter = { deletedAt: null };

  if (status) filter.status = status;
  if (category) filter.category = category;
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
  programData.createdBy = req.user._id;
  if (!programData.municipality) programData.municipality = req.user.municipality;

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

  const start = updates.startDate || program.startDate;
  const end = updates.endDate || program.endDate;
  if (start && end && new Date(end) <= new Date(start)) {
    return errorResponse(res, 400, 'End date must be after start date');
  }

  const updated = await Program.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  await AuditLog.create({ user: req.user._id, action: 'UPDATE', resource: 'program', resourceId: program._id, details: { changes: Object.keys(updates) }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Program updated', updated);
});

exports.deleteProgram = asyncHandler(async (req, res) => {
  const program = await Program.findById(req.params.id);
  if (!program || program.deletedAt) return errorResponse(res, 404, 'Program not found');
  program.deletedAt = new Date();
  await program.save();
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

  successResponse(res, 200, 'Program statistics', { byStatus: stats, byCategory });
});
