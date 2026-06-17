const asyncHandler = require('express-async-handler');
const Budget = require('../models/Budget');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const User = require('../models/User');
const emailService = require('../services/emailService');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.getBudgets = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, fiscalYear, status, search } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (fiscalYear) filter.fiscalYear = parseInt(fiscalYear);
  if (status) filter.status = status;
  if (search) filter.title = { $regex: escapeRegex(search), $options: 'i' };
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  }

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [budgets, total] = await Promise.all([
    Budget.find(filter)
      .populate('municipality', 'name code')
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .sort({ fiscalYear: -1, createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Budget.countDocuments(filter),
  ]);
  paginatedResponse(res, budgets, safePage, safeLimit, total);
});

exports.getBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id)
    .populate('municipality', 'name code')
    .populate('createdBy', 'firstName lastName')
    .populate('approvedBy', 'firstName lastName');
  if (!budget || budget.deletedAt) return errorResponse(res, 404, 'Budget not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (budget.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to view this budget');
  }
  successResponse(res, 200, 'Budget', budget);
});

exports.createBudget = asyncHandler(async (req, res) => {
  const ALLOWED_CREATE_FIELDS = ['title', 'fiscalYear', 'totalBudget', 'allocations', 'notes', 'municipality', 'attachments'];
  const budgetData = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED_CREATE_FIELDS.includes(k))
  );
  budgetData.createdBy = req.user._id;
  if (!budgetData.municipality) budgetData.municipality = req.user.municipality;

  if (budgetData.allocations?.length) {
    const allocTotal = budgetData.allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    if (allocTotal > parseFloat(budgetData.totalBudget || 0)) {
      return errorResponse(res, 400, 'Total allocations cannot exceed the budget amount');
    }
  }

  const budget = await Budget.create(budgetData);
  await AuditLog.create({ user: req.user._id, action: 'CREATE', resource: 'budget', resourceId: budget._id, details: { title: budget.title, totalBudget: budget.totalBudget }, ipAddress: req.ip });
  successResponse(res, 201, 'Budget created', budget);
});

exports.updateBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id);
  if (!budget || budget.deletedAt) return errorResponse(res, 404, 'Budget not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (budget.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to update this budget');
  }
  if (budget.status === 'approved') return errorResponse(res, 400, 'Approved budgets cannot be edited');
  const ALLOWED_UPDATE_FIELDS = ['title', 'fiscalYear', 'totalBudget', 'allocations', 'notes', 'attachments'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k))
  );
  // Use aggregation pipeline to keep remainingBalance in sync when totalBudget changes
  const updated = await Budget.findByIdAndUpdate(
    req.params.id,
    [{ $set: { ...updates, remainingBalance: { $subtract: [updates.totalBudget ?? '$totalBudget', '$disbursedAmount'] } } }],
    { new: true, runValidators: true }
  );
  await AuditLog.create({ user: req.user._id, action: 'UPDATE', resource: 'budget', resourceId: budget._id, details: { changes: Object.keys(updates) }, ipAddress: req.ip });
  successResponse(res, 200, 'Budget updated', updated);
});

exports.submitBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, deletedAt: null });
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (budget.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to submit this budget');
  }
  if (budget.status !== 'draft') return errorResponse(res, 400, 'Only draft budgets can be submitted');

  const submitted = await Budget.findByIdAndUpdate(
    req.params.id,
    { status: 'pending_approval' },
    { new: true }
  );
  await AuditLog.create({ user: req.user._id, action: 'SUBMIT', resource: 'budget', resourceId: budget._id, ipAddress: req.ip });
  successResponse(res, 200, 'Budget submitted for approval', submitted);
});

exports.approveBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, deletedAt: null });
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (budget.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to approve this budget');
  }

  // Atomic conditional update prevents double-approval race condition
  const approved = await Budget.findOneAndUpdate(
    { _id: req.params.id, status: 'pending_approval' },
    { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), approvedAmount: budget.totalBudget },
    { new: true }
  );
  if (!approved) return errorResponse(res, 409, 'Budget was already processed or is not pending approval');

  await AuditLog.create({ user: req.user._id, action: 'APPROVE', resource: 'budget', resourceId: budget._id, details: { approvedAmount: budget.totalBudget }, ipAddress: req.ip });

  User.findById(budget.createdBy).select('email firstName').then((creator) => {
    if (creator) emailService.sendBudgetApproved(creator, approved).catch(() => {});
  }).catch(() => {});

  successResponse(res, 200, 'Budget approved', approved);
});

exports.rejectBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, deletedAt: null });
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (budget.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to reject this budget');
  }
  if (budget.status !== 'pending_approval') return errorResponse(res, 400, 'Only pending budgets can be rejected');

  const rejected = await Budget.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected', notes: req.body.reason },
    { new: true }
  );
  await AuditLog.create({ user: req.user._id, action: 'REJECT', resource: 'budget', resourceId: budget._id, details: { reason: req.body.reason }, ipAddress: req.ip });

  User.findById(budget.createdBy).select('email firstName').then((creator) => {
    if (creator) emailService.sendBudgetRejected(creator, budget, req.body.reason).catch(() => {});
  }).catch(() => {});

  successResponse(res, 200, 'Budget rejected', rejected);
});

exports.reopenBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, deletedAt: null });
  if (!budget) return errorResponse(res, 404, 'Budget not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (budget.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to reopen this budget');
  }
  if (budget.status !== 'rejected') return errorResponse(res, 400, 'Only rejected budgets can be reopened');
  const reopened = await Budget.findByIdAndUpdate(req.params.id, { status: 'draft', notes: '' }, { new: true });
  await AuditLog.create({ user: req.user._id, action: 'REOPEN', resource: 'budget', resourceId: budget._id, ipAddress: req.ip });
  successResponse(res, 200, 'Budget reopened for revision', reopened);
});

exports.deleteBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id);
  if (!budget || budget.deletedAt) return errorResponse(res, 404, 'Budget not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (budget.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to delete this budget');
  }
  if (budget.status === 'approved') return errorResponse(res, 400, 'Approved budgets cannot be deleted — they have linked expenses');
  budget.deletedAt = new Date();
  await budget.save();
  await AuditLog.create({ user: req.user._id, action: 'DELETE', resource: 'budget', resourceId: budget._id, details: { title: budget.title, status: budget.status }, ipAddress: req.ip, municipality: req.user.municipality });
  successResponse(res, 200, 'Budget deleted');
});

exports.getBudgetSummary = asyncHandler(async (req, res) => {
  const { municipalityId, fiscalYear } = req.query;
  const filter = { deletedAt: null, status: 'approved' };
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  } else if (municipalityId) {
    filter.municipality = municipalityId;
  }
  if (fiscalYear) filter.fiscalYear = parseInt(fiscalYear);

  const summary = await Budget.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalBudget: { $sum: '$totalBudget' },
        totalDisbursed: { $sum: '$disbursedAmount' },
        totalRemaining: { $sum: '$remainingBalance' },
        count: { $sum: 1 },
      },
    },
  ]);
  successResponse(res, 200, 'Budget summary', summary[0] || {});
});
