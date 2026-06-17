const asyncHandler = require('express-async-handler');
const { randomUUID } = require('crypto');
const Liquidation = require('../models/Liquidation');
const Expense = require('../models/Expense');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const User = require('../models/User');
const emailService = require('../services/emailService');
const { uploadToCloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.getLiquidations = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, status, program, search } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (status) filter.status = status;
  if (program) filter.program = program;
  if (search) filter.$or = [
    { title: { $regex: escapeRegex(search), $options: 'i' } },
    { referenceNumber: { $regex: escapeRegex(search), $options: 'i' } },
  ];
  if (req.user.role !== 'super_admin' && req.user.role !== 'provincial_admin') {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  }

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [liquidations, total] = await Promise.all([
    Liquidation.find(filter)
      .populate('program', 'title category')
      .populate('municipality', 'name code')
      .populate('submittedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Liquidation.countDocuments(filter),
  ]);
  paginatedResponse(res, liquidations, safePage, safeLimit, total);
});

exports.getLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findById(req.params.id)
    .populate('program', 'title category budget')
    .populate('expenses')
    .populate('municipality', 'name')
    .populate('submittedBy', 'firstName lastName email')
    .populate('approvedBy', 'firstName lastName');
  if (!liq || liq.deletedAt) return errorResponse(res, 404, 'Liquidation not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (liq.municipality?._id?.toString() !== userMunId && liq.municipality?.toString() !== userMunId) {
      return errorResponse(res, 403, 'Not authorized to view this liquidation');
    }
  }
  successResponse(res, 200, 'Liquidation', liq);
});

exports.createLiquidation = asyncHandler(async (req, res) => {
  const ALLOWED_CREATE_FIELDS = ['title', 'program', 'budget', 'expenses', 'totalAmount', 'liquidatedAmount', 'dueDate', 'remarks'];
  const liqData = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED_CREATE_FIELDS.includes(k))
  );
  liqData.submittedBy = req.user._id;
  liqData.municipality = req.user.municipality?._id || req.user.municipality;

  if (req.files && req.files.length > 0) {
    const uploaded = await Promise.all(
      req.files.map((f, i) =>
        uploadToCloudinary(f.buffer, { folder: 'skims/documents', resource_type: 'raw', public_id: randomUUID() })
          .then((r) => ({
            type: req.body.documentTypes?.[i] || 'other',
            fileName: f.originalname,
            fileUrl: r.secure_url,
          }))
      )
    );
    liqData.documents = uploaded;
  }

  const liq = await Liquidation.create(liqData);
  await AuditLog.create({ user: req.user._id, action: 'CREATE', resource: 'liquidation', resourceId: liq._id, details: { title: liq.title, totalAmount: liq.totalAmount }, ipAddress: req.ip });
  successResponse(res, 201, 'Liquidation created', liq);
});

exports.submitLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findOne({ _id: req.params.id, deletedAt: null });
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (liq.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to submit this liquidation');
  }
  if (liq.status !== 'draft') return errorResponse(res, 400, 'Only draft liquidations can be submitted');

  const submitted = await Liquidation.findByIdAndUpdate(
    req.params.id,
    { status: 'submitted', submittedAt: new Date() },
    { new: true }
  );

  const reviewers = await User.find({ role: { $in: ['dilg_representative', 'municipal_admin', 'provincial_admin'] }, municipality: liq.municipality });
  await Notification.createWithExpiry(reviewers.map((r) => ({
    recipient: r._id,
    type: 'approval_request',
    title: 'New Liquidation Submitted',
    message: `A new liquidation report "${liq.referenceNumber}" has been submitted for review.`,
    link: `/liquidations/${liq._id}`,
    priority: 'high',
  })));

  await AuditLog.create({ user: req.user._id, action: 'SUBMIT', resource: 'liquidation', resourceId: liq._id, ipAddress: req.ip });
  successResponse(res, 200, 'Liquidation submitted for review', submitted);
});

exports.approveLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findOne({ _id: req.params.id, deletedAt: null });
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (liq.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to approve this liquidation');
  }

  // Atomic conditional update prevents double-approval race condition
  const approved = await Liquidation.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['submitted', 'under_review'] } },
    { status: 'approved', approvedBy: req.user._id, approvedAt: new Date() },
    { new: true }
  );
  if (!approved) return errorResponse(res, 409, 'Liquidation was already processed or is not in a reviewable state');

  await Expense.updateMany({ _id: { $in: liq.expenses } }, { isLiquidated: true, liquidationId: liq._id, status: 'liquidated' });
  await AuditLog.create({ user: req.user._id, action: 'APPROVE', resource: 'liquidation', resourceId: liq._id, details: { totalAmount: liq.totalAmount }, ipAddress: req.ip });

  if (liq.submittedBy) {
    Notification.create({
      recipient: liq.submittedBy,
      type: 'approval_granted',
      title: 'Liquidation Report Approved',
      message: `Your liquidation report "${liq.referenceNumber}" has been approved.`,
      link: `/liquidations/${liq._id}`,
      priority: 'high',
    }).catch(() => {});

    User.findById(liq.submittedBy).select('email firstName').then((submitter) => {
      if (submitter) emailService.sendLiquidationApproved(submitter, approved).catch(() => {});
    }).catch(() => {});
  }

  successResponse(res, 200, 'Liquidation approved', approved);
});

exports.rejectLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findOne({ _id: req.params.id, deletedAt: null });
  if (!liq) return errorResponse(res, 404, 'Liquidation not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (liq.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to reject this liquidation');
  }
  if (!['submitted', 'under_review'].includes(liq.status)) return errorResponse(res, 400, 'Liquidation cannot be rejected in its current state');

  const rejected = await Liquidation.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected', rejectionReason: req.body.reason, reviewedBy: req.user._id, reviewedAt: new Date() },
    { new: true }
  );
  await AuditLog.create({ user: req.user._id, action: 'REJECT', resource: 'liquidation', resourceId: liq._id, details: { reason: req.body.reason }, ipAddress: req.ip });

  if (liq.submittedBy) {
    Notification.create({
      recipient: liq.submittedBy,
      type: 'approval_rejected',
      title: 'Liquidation Report Rejected',
      message: `Your liquidation report "${liq.referenceNumber}" was rejected. Reason: ${req.body.reason || 'No reason provided.'}`,
      link: `/liquidations/${liq._id}`,
      priority: 'high',
    }).catch(() => {});

    User.findById(liq.submittedBy).select('email firstName').then((submitter) => {
      if (submitter) emailService.sendLiquidationRejected(submitter, liq, req.body.reason).catch(() => {});
    }).catch(() => {});
  }

  successResponse(res, 200, 'Liquidation rejected', rejected);
});

exports.deleteLiquidation = asyncHandler(async (req, res) => {
  const liq = await Liquidation.findById(req.params.id);
  if (!liq || liq.deletedAt) return errorResponse(res, 404, 'Liquidation not found');
  if (liq.status === 'approved') {
    return errorResponse(res, 400, 'Approved liquidations cannot be deleted');
  }
  liq.deletedAt = new Date();
  await liq.save();
  successResponse(res, 200, 'Liquidation deleted');
});
