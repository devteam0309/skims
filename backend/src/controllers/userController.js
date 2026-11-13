const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const emailService = require('../services/emailService');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { escapeRegex } = require('../utils/regex');
const { CROSS_MUNICIPALITY_READ, VERIFICATION_REQUIRED_ROLES } = require('../constants/roles');
const { checkBarangay, barangayErrorMessage } = require('../utils/barangay');
const { sendFile } = require('../services/fileStorage');

const MAX_LIMIT = 100;

/*
 * A save that would give an account a seat someone else already holds fails on the unique
 * `seatKey` index. Said in words an administrator can act on, rather than as "seatKey already exists".
 */
const isSeatConflict = (err) => err?.code === 11000 && Boolean(err.keyPattern?.seatKey);
const SEAT_CONFLICT = 'That barangay already has an active account in this SK position. Deactivate or reassign that account first.';

const audit = (req, user, action, extra = {}) => AuditLog.create({
  user: req.user._id, action, resource: 'user', resourceId: user._id,
  // The account's municipality, not the administrator's: super_admin has none of its own.
  municipality: user.municipality?._id || user.municipality, ipAddress: req.ip,
  ...extra,
});

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

/**
 * Let an applicant in.
 *
 * Refused for an applicant who uploaded no identity or residency document: the panel's rule is that
 * verification is not complete without the attachment, and the reviewer cannot have inspected
 * something that does not exist. Atomic on the pending state, so two reviewers (or a double click)
 * cannot both approve, and an application rejected meanwhile is not resurrected.
 */
exports.approveUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) return errorResponse(res, 404, 'User not found');
  if (user.isApproved) return errorResponse(res, 409, 'This account is already approved');
  if (!user.isActive) return errorResponse(res, 409, 'This application was rejected or the account is deactivated');
  if (VERIFICATION_REQUIRED_ROLES.includes(user.role) && !(user.verificationDocuments?.length > 0)) {
    return errorResponse(res, 400, 'This applicant has not uploaded a supporting document. An account cannot be approved without proof of identity or residency.');
  }

  const approved = await User.findOneAndUpdate(
    { _id: user._id, isApproved: false, isActive: true, deletedAt: null },
    { isApproved: true, approvedBy: req.user._id, approvedAt: new Date() },
    { new: true }
  );
  if (!approved) return errorResponse(res, 409, 'This application was already decided by someone else');

  await audit(req, approved, 'ACCOUNT_APPROVE', {
    newValues: { isApproved: true },
    details: { role: approved.role, barangay: approved.barangay || null, verificationDocuments: approved.verificationDocuments.length },
  });

  await Notification.create({
    recipient: user._id,
    type: 'approval_granted',
    title: 'Account Approved',
    message: 'Your SKIMS account has been approved. You can now log in.',
    priority: 'high',
  });

  emailService.sendApprovalNotification(approved).catch(() => {});

  successResponse(res, 200, 'User approved successfully', approved);
});

/**
 * Refuse an application. Deactivating the account releases the SK seat it was holding, so the
 * barangay's position is open to the rightful applicant straight away.
 *
 * Only for applications still awaiting a decision: taking access away from an approved account is
 * deactivation (PUT /:id/toggle-status), a different act with a different record.
 */
exports.rejectUser = asyncHandler(async (req, res) => {
  const reason = (req.body.reason || '').trim();
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) return errorResponse(res, 404, 'User not found');
  if (user.isApproved) return errorResponse(res, 409, 'This account is already approved — deactivate it instead');
  if (!user.isActive) return errorResponse(res, 409, 'This application was already rejected');

  user.isActive = false;
  user.rejectedAt = new Date();
  user.rejectedBy = req.user._id;
  user.rejectionReason = reason || undefined;
  await user.save({ validateBeforeSave: false });

  await audit(req, user, 'ACCOUNT_REJECT', {
    newValues: { isActive: false },
    details: { role: user.role, reason: reason || null, seatReleased: true },
  });

  await Notification.create({
    recipient: user._id,
    type: 'approval_rejected',
    title: 'Account Application Rejected',
    message: reason || 'Your account application has been rejected.',
    priority: 'high',
  });

  successResponse(res, 200, 'User rejected');
});

/**
 * Open one of an applicant's identity or residency documents — inline for preview, or as a download
 * with `?download=1`. super_admin only (the route says so), and every opening is audited: these are
 * government ids, and who looked at whose is worth being able to answer.
 */
exports.getVerificationDocument = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('verificationDocuments municipality firstName lastName');
  if (!user) return errorResponse(res, 404, 'User not found');
  const doc = user.verificationDocuments.id(req.params.docId);
  if (!doc) return errorResponse(res, 404, 'Document not found');

  const download = req.query.download === '1' || req.query.download === 'true';
  await audit(req, user, download ? 'DOWNLOAD' : 'VIEW', {
    resource: 'verification_document',
    resourceId: user._id,
    details: { documentId: doc._id, documentType: doc.documentType },
  });

  return sendFile(res, doc, { disposition: download ? 'attachment' : 'inline' });
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
  super_admin: ['super_admin', 'provincial_admin', 'municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'dilg_representative'],
  provincial_admin: ['municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'dilg_representative'],
  municipal_admin: ['sk_chairperson', 'sk_treasurer', 'sk_secretary'],
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

/**
 * Accounts with an outstanding email change, for the administrator's queue.
 *
 * Alongside `getPendingApprovals` rather than folded into it: a pending registration and a pending
 * email change need different decisions and different columns, and conflating them would put an
 * existing user in a list captioned "awaiting approval to join".
 */
exports.getPendingEmailChanges = asyncHandler(async (req, res) => {
  const filter = { pendingEmail: { $ne: null }, deletedAt: null };
  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [users, total] = await Promise.all([
    User.find(filter)
      .select('firstName lastName email pendingEmail pendingEmailRequestedAt role municipality barangay')
      .populate('municipality', 'name')
      .populate('barangay', 'name')
      .sort({ pendingEmailRequestedAt: 1 })
      .skip(skip)
      .limit(safeLimit),
    User.countDocuments(filter),
  ]);
  paginatedResponse(res, users, safePage, safeLimit, total);
});

/**
 * Approve the change: the pending address becomes the active one.
 *
 * The account is NOT asked to verify the new address again. `isEmailVerified` is what the login gate
 * reads, and on this deployment verification mail cannot reach an arbitrary recipient at all — so
 * requiring re-verification would lock the user out of the account they still own, by way of a
 * mailbox nothing can deliver to. An administrator reviewing the request is the check that replaces
 * it, which is the whole point of the workflow.
 */
exports.approveEmailChange = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');
  if (!user.pendingEmail) return errorResponse(res, 400, 'This user has no pending email change');

  const previous = user.email;
  const approved = user.pendingEmail;

  // Re-checked at the moment of approval: the address may have been claimed since the request.
  const clash = await User.findOne({ _id: { $ne: user._id }, email: approved }).select('_id');
  if (clash) return errorResponse(res, 409, 'That email address has since been taken');

  user.email = approved;
  user.pendingEmail = null;
  user.pendingEmailRequestedAt = undefined;
  await user.save({ validateBeforeSave: false });

  await AuditLog.create({
    user: req.user._id, action: 'EMAIL_CHANGE_APPROVE', resource: 'user', resourceId: user._id,
    oldValues: { email: previous }, newValues: { email: approved },
    details: { previousEmail: previous, newEmail: approved },
    municipality: user.municipality, ipAddress: req.ip,
  });

  await Notification.create({
    recipient: user._id,
    type: 'approval_granted',
    title: 'Email Address Updated',
    message: `Your email address has been changed to ${approved}. Use it the next time you sign in.`,
    priority: 'high',
  });

  successResponse(res, 200, 'Email change approved', { email: user.email });
});

/** Reject it: the existing address stays active, and the reason is recorded and shown. */
exports.rejectEmailChange = asyncHandler(async (req, res) => {
  const reason = (req.body.reason || req.body.rejectionReason || '').trim();
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');
  if (!user.pendingEmail) return errorResponse(res, 400, 'This user has no pending email change');

  const refused = user.pendingEmail;
  user.pendingEmail = null;
  user.pendingEmailRequestedAt = undefined;
  user.pendingEmailRejectedAt = new Date();
  user.pendingEmailRejectionReason = reason || undefined;
  await user.save({ validateBeforeSave: false });

  await AuditLog.create({
    user: req.user._id, action: 'EMAIL_CHANGE_REJECT', resource: 'user', resourceId: user._id,
    oldValues: { pendingEmail: refused }, newValues: { email: user.email },
    details: { refusedEmail: refused, reason: reason || null, activeEmailUnchanged: user.email },
    municipality: user.municipality, ipAddress: req.ip,
  });

  await Notification.create({
    recipient: user._id,
    type: 'approval_rejected',
    title: 'Email Change Declined',
    message: reason
      ? `Your request to change your email to ${refused} was declined: ${reason}`
      : `Your request to change your email to ${refused} was declined. Your current address is unchanged.`,
    priority: 'high',
  });

  successResponse(res, 200, 'Email change declined', { email: user.email });
});

/**
 * Assign or clear a user's barangay.
 *
 * The field existed on the model from the beginning and nothing ever set it, so no SK account has
 * one — which is why barangay scope narrows only where a barangay is recorded. This is the route
 * that makes the scoping usable, and it refuses a barangay from outside the user's own municipality
 * rather than storing a reference that every per-municipality dropdown would then fail to resolve.
 */
exports.updateUserBarangay = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, 404, 'User not found');

  const { barangay } = req.body;
  const previous = user.barangay?.toString() || null;

  if (!barangay) {
    user.barangay = undefined;
  } else {
    if (!user.municipality) {
      return errorResponse(res, 400, 'Assign the user a municipality before assigning a barangay');
    }
    const check = await checkBarangay(barangay, user.municipality.toString());
    if (check !== 'ok') return errorResponse(res, 400, barangayErrorMessage(check));
    user.barangay = barangay;
  }
  try {
    await user.save({ validateBeforeSave: false });
  } catch (err) {
    // Moving an officer into a barangay whose seat is already held.
    if (isSeatConflict(err)) return errorResponse(res, 409, SEAT_CONFLICT);
    throw err;
  }

  await AuditLog.create({
    user: req.user._id, action: 'UPDATE', resource: 'user', resourceId: user._id,
    oldValues: { barangay: previous }, newValues: { barangay: user.barangay?.toString() || null },
    details: { field: 'barangay' },
    municipality: user.municipality, ipAddress: req.ip,
  });

  const updated = await User.findById(user._id).populate('municipality', 'name').populate('barangay', 'name');
  successResponse(res, 200, barangay ? 'Barangay assigned' : 'Barangay cleared', updated);
});

exports.updateUserRole = asyncHandler(async (req, res) => {
  const { role, municipality, barangay } = req.body;
  if (isSelf(req)) {
    return errorResponse(res, 403, 'You cannot change your own role. Ask another administrator.');
  }
  const allowed = ASSIGNABLE_ROLES[req.user.role] || [];
  if (!allowed.includes(role)) {
    return errorResponse(res, 403, `Your role cannot assign the '${role}' role`);
  }

  const target = await User.findById(req.params.id);
  if (!target || target.deletedAt) return errorResponse(res, 404, 'User not found');
  if (target.role === 'youth') {
    return errorResponse(res, 400, 'A youth account cannot be changed into a staff role — it is tied to a registry record');
  }

  /*
   * Saved through the document rather than findByIdAndUpdate, so the seat is recomputed by the model
   * hook: promoting someone to chairperson of a barangay that already has one now fails with 409
   * instead of quietly producing two. Municipality and barangay are changed only when sent, and a
   * barangay must belong to the account's (possibly new) municipality.
   */
  const previousRole = target.role;
  target.role = role;
  if (municipality !== undefined) target.municipality = municipality || undefined;
  if (barangay !== undefined) target.barangay = barangay || undefined;
  if (target.barangay) {
    if (!target.municipality) return errorResponse(res, 400, 'Assign the user a municipality before assigning a barangay');
    const check = await checkBarangay(target.barangay.toString(), target.municipality.toString());
    if (check !== 'ok') return errorResponse(res, 400, barangayErrorMessage(check));
  }
  try {
    await target.save({ validateBeforeSave: false });
  } catch (err) {
    if (isSeatConflict(err)) return errorResponse(res, 409, SEAT_CONFLICT);
    throw err;
  }

  await audit(req, target, 'ROLE_CHANGE', {
    oldValues: { role: previousRole },
    newValues: { role },
    details: { newRole: role, newMunicipality: municipality },
  });
  successResponse(res, 200, 'User role updated', target);
});

/**
 * Deactivate or reactivate an account.
 *
 * Deactivating releases the account's SK seat, which is how a legitimate vacancy is opened when an
 * officer leaves. Reactivating claims it back — and is refused with 409 if the barangay has filled
 * the position in the meantime, rather than producing two officers in one seat.
 */
exports.toggleUserStatus = asyncHandler(async (req, res) => {
  if (isSelf(req)) {
    return errorResponse(res, 403, 'You cannot deactivate your own account. Ask another administrator.');
  }
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) return errorResponse(res, 404, 'User not found');
  user.isActive = !user.isActive;
  try {
    await user.save({ validateBeforeSave: false });
  } catch (err) {
    if (isSeatConflict(err)) {
      return errorResponse(res, 409, 'This account cannot be reactivated: its barangay position is now held by another account.');
    }
    throw err;
  }
  await audit(req, user, user.isActive ? 'ACCOUNT_ACTIVATE' : 'ACCOUNT_DEACTIVATE', {
    newValues: { isActive: user.isActive },
    details: { role: user.role },
  });
  successResponse(res, 200, `User ${user.isActive ? 'activated' : 'deactivated'}`, user);
});

exports.deleteUser = asyncHandler(async (req, res) => {
  if (isSelf(req)) {
    return errorResponse(res, 403, 'You cannot delete your own account. Ask another administrator.');
  }
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) return errorResponse(res, 404, 'User not found');
  user.deletedAt = new Date();
  user.isActive = false;
  // The seat is released by the model hook, so the position can be filled by a new registration.
  await user.save({ validateBeforeSave: false });
  await audit(req, user, 'DELETE', { details: { role: user.role, email: user.email } });
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
    // Barangay and the uploaded documents' descriptions are what the reviewer decides on.
    User.find(filter).populate('municipality', 'name').populate('barangay', 'name')
      .sort({ createdAt: -1 }).skip(skip).limit(safeLimit).select('-password'),
    User.countDocuments(filter),
  ]);
  paginatedResponse(res, users, safePage, safeLimit, total);
});
