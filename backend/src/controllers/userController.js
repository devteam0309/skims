const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const emailService = require('../services/emailService');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { escapeRegex } = require('../utils/regex');
const { CROSS_MUNICIPALITY_READ } = require('../constants/roles');

const MAX_LIMIT = 100;

exports.getUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, municipality, search, isApproved, isActive } = req.query;
  const filter = { deletedAt: null };

  /*
   * Youth are excluded unless asked for by name.
   *
   * This page exists to manage SK officials, of whom there are a handful per municipality. Youth
   * hold accounts too and there are potentially tens of thousands of them, so including them by
   * default would bury every staff account and make the page useless for its actual purpose. They
   * are still reachable with ?role=youth, and the registry at /youth is the proper place to work
   * with them.
   */
  if (role) filter.role = role;
  else filter.role = { $ne: 'youth' };
  if (municipality) filter.municipality = municipality;
  if (isApproved === 'true' || isApproved === 'false') filter.isApproved = isApproved === 'true';
  if (isActive === 'true' || isActive === 'false') filter.isActive = isActive === 'true';
  if (search) {
    // Shared helper rather than a fourth inline copy of the same escape.
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
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

  /*
   * Scoped to the caller's own municipality, or their own profile.
   *
   * municipal_admin was exempt here while getUsers directly above scopes it correctly — so another
   * municipality's staff were hidden from the list and readable by id. Reachable-by-id is exactly
   * the gap a list-level filter cannot close.
   */
  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role)) {
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

/*
 * `youth` is deliberately absent from every list, in both directions.
 *
 * Granting it would create an account with no registry record behind it — every youth endpoint
 * resolves the member by `user`, so the account would be able to log in and do nothing at all.
 * Taking it away would leave a YouthMember pointing at what is now a staff login, and the person
 * would silently vanish from the roster. A youth account is created by registration and changed
 * by deleting it, not by role assignment.
 */
/*
 * `public_user` was the demotion target here — the way to strip someone's staff access without
 * deleting them. It is gone, and deactivation (PUT /:id/toggle-status) does that job instead.
 * Deactivating is also the more honest control: demoting left a working login that could still
 * sign in and see the portal, which is not what "revoke their access" is meant to mean.
 */
const ASSIGNABLE_ROLES = {
  super_admin: ['super_admin', 'provincial_admin', 'municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative'],
  provincial_admin: ['municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative'],
  municipal_admin: ['sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad'],
};

/**
 * Acting on your own account through the admin endpoints is a one-way door.
 *
 * Role assignment can demote, and every admin may deactivate or delete an account — so each of
 * these could be pointed at the caller and strip the caller's own access. Recovering
 * from that needs another administrator, or direct database surgery if the account was the last
 * super_admin. None of it is malicious; it is a misclick on the row that happens to be yours.
 *
 * The UI withholds these controls on your own row, but that is presentation, not enforcement:
 * the endpoints are reachable directly.
 */
const isSelf = (req) => req.user._id.equals(req.params.id);

exports.updateUserRole = asyncHandler(async (req, res) => {
  const { role, municipality, barangay } = req.body;
  if (isSelf(req)) {
    return errorResponse(res, 403, 'You cannot change your own role. Ask another administrator.');
  }
  const allowed = ASSIGNABLE_ROLES[req.user.role] || [];
  if (!allowed.includes(role)) {
    return errorResponse(res, 403, `Your role cannot assign the '${role}' role`);
  }

  const target = await User.findById(req.params.id).select('role');
  if (!target) return errorResponse(res, 404, 'User not found');
  if (target.role === 'youth') {
    return errorResponse(res, 400, 'A youth account cannot be changed into a staff role — it is tied to a registry record');
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
  if (isSelf(req)) {
    return errorResponse(res, 403, 'You cannot deactivate your own account. Ask another administrator.');
  }
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');
  user.isActive = !user.isActive;
  await user.save({ validateBeforeSave: false });
  successResponse(res, 200, `User ${user.isActive ? 'activated' : 'deactivated'}`, user);
});

exports.deleteUser = asyncHandler(async (req, res) => {
  if (isSelf(req)) {
    return errorResponse(res, 403, 'You cannot delete your own account. Ask another administrator.');
  }
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');
  user.deletedAt = new Date();
  user.isActive = false;
  await user.save({ validateBeforeSave: false });
  successResponse(res, 200, 'User deleted');
});

exports.getPendingApprovals = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  // Youth approve themselves, so none should ever be pending. Excluded explicitly all the same:
  // if that ever changes, this queue is not the place it should surface first.
  const filter = { isApproved: false, isActive: true, deletedAt: null, role: { $ne: 'youth' } };
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
