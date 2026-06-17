const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const emailService = require('../services/emailService');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

exports.getUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, municipality, search, isApproved, isActive } = req.query;
  const filter = { deletedAt: null };

  if (role) filter.role = role;
  if (municipality) filter.municipality = municipality;
  if (isApproved === 'true' || isApproved === 'false') filter.isApproved = isApproved === 'true';
  if (isActive === 'true' || isActive === 'false') filter.isActive = isActive === 'true';
  if (search) {
    const s = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { firstName: { $regex: s, $options: 'i' } },
      { lastName: { $regex: s, $options: 'i' } },
      { email: { $regex: s, $options: 'i' } },
    ];
  }

  // municipal_admin can only see users from their own municipality
  if (req.user.role === 'municipal_admin') {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  }

  const { safePage, safeLimit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: MAX_LIMIT });
  const [users, total] = await Promise.all([
    User.find(filter).populate('municipality', 'name code').populate('barangay', 'name').sort({ createdAt: -1 }).skip(skip).limit(safeLimit).select('-password'),
    User.countDocuments(filter),
  ]);

  paginatedResponse(res, users, safePage, safeLimit, total);
});

exports.getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate('municipality', 'name code')
    .populate('barangay', 'name')
    .populate('approvedBy', 'firstName lastName')
    .select('-loginAttempts -lockUntil -emailVerificationToken -emailVerificationExpire -resetPasswordToken -resetPasswordExpire');
  if (!user || user.deletedAt) return errorResponse(res, 404, 'User not found');

  // Non-admin users can only view their own profile or profiles within their municipality
  if (!['super_admin', 'provincial_admin', 'municipal_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    const targetMunId = (user.municipality?._id || user.municipality)?.toString();
    if (user._id.toString() !== req.user._id.toString() && targetMunId !== userMunId) {
      return errorResponse(res, 403, 'Not authorized to view this user profile');
    }
  }

  successResponse(res, 200, 'User', user);
});

exports.approveUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');
  user.isApproved = true;
  user.approvedBy = req.user._id;
  user.approvedAt = Date.now();
  await user.save({ validateBeforeSave: false });

  await Notification.create({
    recipient: user._id,
    type: 'approval_granted',
    title: 'Account Approved',
    message: 'Your SKIMS account has been approved. You can now log in.',
    priority: 'high',
  });

  emailService.sendApprovalNotification(user).catch(() => {});

  successResponse(res, 200, 'User approved successfully', user);
});

exports.rejectUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');
  user.isApproved = false;
  user.isActive = false;
  await user.save({ validateBeforeSave: false });

  await Notification.create({
    recipient: user._id,
    type: 'approval_rejected',
    title: 'Account Application Rejected',
    message: req.body.reason || 'Your account application has been rejected.',
    priority: 'high',
  });

  successResponse(res, 200, 'User rejected');
});

const ASSIGNABLE_ROLES = {
  super_admin: ['super_admin', 'provincial_admin', 'municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative', 'public_user'],
  provincial_admin: ['municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative', 'public_user'],
  municipal_admin: ['sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'public_user'],
};

exports.updateUserRole = asyncHandler(async (req, res) => {
  const { role, municipality, barangay } = req.body;
  const allowed = ASSIGNABLE_ROLES[req.user.role] || [];
  if (!allowed.includes(role)) {
    return errorResponse(res, 403, `Your role cannot assign the '${role}' role`);
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role, municipality, barangay },
    { new: true, runValidators: true }
  );
  if (!user) return errorResponse(res, 404, 'User not found');
  await AuditLog.create({ user: req.user._id, action: 'ROLE_CHANGE', resource: 'user', resourceId: user._id, details: { newRole: role, newMunicipality: municipality }, ipAddress: req.ip });
  successResponse(res, 200, 'User role updated', user);
});

exports.toggleUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');
  user.isActive = !user.isActive;
  await user.save({ validateBeforeSave: false });
  successResponse(res, 200, `User ${user.isActive ? 'activated' : 'deactivated'}`, user);
});

exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');
  user.deletedAt = new Date();
  user.isActive = false;
  await user.save({ validateBeforeSave: false });
  successResponse(res, 200, 'User deleted');
});

exports.getPendingApprovals = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const filter = { isApproved: false, isActive: true, deletedAt: null };
  if (req.user.role === 'municipal_admin') {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  }
  const { safePage, safeLimit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: MAX_LIMIT });
  const [users, total] = await Promise.all([
    User.find(filter).populate('municipality', 'name').sort({ createdAt: -1 }).skip(skip).limit(safeLimit).select('-password'),
    User.countDocuments(filter),
  ]);
  paginatedResponse(res, users, safePage, safeLimit, total);
});
