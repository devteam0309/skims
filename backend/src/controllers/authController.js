const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const emailService = require('../services/emailService');
const { uploadToCloudinary, destroyQuietly } = require('../config/cloudinary');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const YouthMember = require('../models/YouthMember');
const { calculateAge, YOUTH_MIN_AGE, YOUTH_MAX_AGE } = require('../utils/age');

const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Send a verification link without blocking the response, but never silently.
 *
 * The send must stay off the request path: a host that blocks outbound SMTP leaves the socket
 * open until nodemailer's timeout, which reaches the client as a 504 even though the account was
 * created. The failure still has to be attributable, though — login is gated on isEmailVerified,
 * so a swallowed error leaves an account that can never be used and a user who was told to go
 * check their inbox. emailService logs the transport error; this adds what that cannot know,
 * which is the consequence and the account it applies to.
 */
const sendVerificationInBackground = (user, token) =>
  emailService.sendEmailVerification(user, token).catch(() => {
    logger.warn(
      `Verification email was NOT delivered to ${user.email} — that account cannot log in until it is verified. ` +
      'Check the transport error logged above, then use POST /api/auth/resend-verification.'
    );
  });

const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 15 * 60 * 1000, // 15 minutes
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/api/auth', // restrict refresh token to auth routes only
};

const sendTokenResponse = async (user, statusCode, res) => {
  const accessToken = user.getSignedJwtToken();
  const rawRefreshToken = user.getRefreshToken();
  await user.save({ validateBeforeSave: false });

  const userData = {
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    municipality: user.municipality,
    barangay: user.barangay,
    avatar: user.avatar,
    isEmailVerified: user.isEmailVerified,
  };
  res.cookie('token', accessToken, ACCESS_COOKIE_OPTIONS);
  res.cookie('refreshToken', rawRefreshToken, REFRESH_COOKIE_OPTIONS);
  return successResponse(res, statusCode, 'Success', { user: userData });
};

/*
 * What a registrant may claim for themselves. Everything else — the three admin tiers — is
 * assigned by an existing admin after the fact, or anyone could register as super_admin.
 *
 * `public_user` was removed along with the role itself. Nothing takes its place as a fallback:
 * an unrecognised role is now an error rather than a silent downgrade. See registerRole() below.
 */
const SELF_ASSIGNABLE_ROLES = ['sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative', 'youth'];


/*
 * Creates or claims the registry record behind a youth login.
 *
 * A youth is identified by full name and email. Where SK staff have already entered someone —
 * during a barangay canvass, say — self-registering must attach to that record rather than make a
 * second one: the registry is a roster of people, and the same person appearing twice is exactly
 * the failure the unique indexes exist to prevent. Without this the compound index would simply
 * reject the insert, and the youth would be told they are "already registered" with no way past it.
 *
 * Matching is on name + birth date + municipality, which is what a staff-entered record reliably
 * has — it usually has no email at all, so email cannot be the matching key even though it is part
 * of the identity once one exists.
 */
const attachYouthRecord = async (user, { birthDate, gender, contactNumber, barangay }) => {
  const fail = (message, statusCode = 400) => {
    const e = new Error(message);
    e.statusCode = statusCode;
    return e;
  };

  if (!birthDate) throw fail('A birth date is required to register as a youth member');
  if (!gender) throw fail('Gender is required to register as a youth member');

  const age = calculateAge(birthDate);
  if (age === null) throw fail('Enter a valid birth date');
  if (age < YOUTH_MIN_AGE || age > YOUTH_MAX_AGE) {
    throw fail(`Youth membership is for ages ${YOUTH_MIN_AGE} to ${YOUTH_MAX_AGE}; this birth date gives ${age}`);
  }

  const municipalityId = user.municipality?._id || user.municipality;
  const existing = await YouthMember.findOne({
    firstName: new RegExp(`^${escapeRegex(user.firstName)}$`, 'i'),
    lastName: new RegExp(`^${escapeRegex(user.lastName)}$`, 'i'),
    birthDate: new Date(birthDate),
    municipality: municipalityId,
    deletedAt: null,
  });

  if (existing) {
    if (existing.user) throw fail('This youth member already has an account', 409);
    existing.user = user._id;
    existing.email = user.email;
    if (contactNumber && !existing.contactNumber) existing.contactNumber = contactNumber;
    await existing.save();
    return existing;
  }

  return YouthMember.create({
    firstName: user.firstName,
    lastName: user.lastName,
    birthDate: new Date(birthDate),
    gender,
    email: user.email,
    contactNumber,
    municipality: municipalityId,
    barangay: barangay || undefined,
    user: user._id,
    registeredBy: user._id,
    // Self-entered, so nobody has vouched for it yet.
    verificationStatus: 'unverified',
  });
};

exports.register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, role, municipality, barangay, contactNumber, birthDate, gender } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) return errorResponse(res, 400, 'Email already registered');

  /*
   * Reject rather than downgrade.
   *
   * This used to fall back to `public_user` for anything unrecognised, which is how the register
   * form could offer "Provincial SK Fed. Admin" and "Municipal SK Fed. Admin" — neither
   * self-assignable — and hand back a working account of an entirely different kind with no
   * message at all. The registrant chose one thing and silently received another.
   */
  if (!role) return errorResponse(res, 400, 'Select the type of account you are registering for');
  if (!SELF_ASSIGNABLE_ROLES.includes(role)) {
    return errorResponse(res, 400, 'That account type cannot be self-registered. Ask an administrator to assign it.');
  }
  const assignedRole = role;

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    role: assignedRole,
    municipality,
    barangay,
    contactNumber,
    // Youth approve themselves. Requiring an admin to let each member in would put staff back in
    // the middle of the self-service flow the whole feature exists to provide; the registry record
    // carries the vetting instead, as verificationStatus.
    isApproved: assignedRole === 'youth',
  });

  if (assignedRole === 'youth') {
    try {
      await attachYouthRecord(user, { birthDate, gender, contactNumber, barangay });
    } catch (err) {
      // The login is useless without its registry record, and a half-created account would block
      // the address from ever registering again. Roll back rather than strand them.
      await User.deleteOne({ _id: user._id });
      return errorResponse(res, err.statusCode || 400, err.message);
    }
  }

  const verificationToken = user.getEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  sendVerificationInBackground(user, verificationToken);

  // Notify admins when a role that requires approval registers. Youth are excluded: they approve
  // themselves, and a notification per youth sign-up would bury every other admin notification.
  if (assignedRole !== 'youth') {
    // Only super_admin is notified, because only super_admin can act on it. The other two admin
    // tiers used to receive these and no longer have the Users page, so the notification would
    // have linked them to a screen they cannot open.
    const admins = await User.find({ role: 'super_admin', isActive: true, deletedAt: null }).select('_id').lean();
    if (admins.length > 0) {
      // createWithExpiry, not insertMany: insertMany bypasses the pre-save hook that sets
      // expiresAt, so these would sit in the collection forever despite the TTL index.
      await Notification.createWithExpiry(admins.map((a) => ({
        recipient: a._id,
        type: 'approval_request',
        title: 'New Account Pending Approval',
        message: `${user.firstName} ${user.lastName} registered as ${user.role.replace(/_/g, ' ')} and requires approval.`,
        link: '/users?tab=pending',
        priority: 'high',
      })));
    }
  }

  successResponse(res, 201, 'Registration successful. Please check your email to verify your account.', {
    userId: user._id,
  });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return errorResponse(res, 400, 'Please provide email and password');

  const user = await User.findOne({ email, deletedAt: null }).select('+password').populate('municipality').populate('barangay');
  if (!user) return errorResponse(res, 401, 'Invalid credentials');

  if (user.lockUntil && user.lockUntil > Date.now()) {
    return errorResponse(res, 401, 'Account locked due to too many failed login attempts. Try again later.');
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    const updated = await User.findByIdAndUpdate(
      user._id,
      { $inc: { loginAttempts: 1 } },
      { new: true }
    );
    if (updated.loginAttempts >= 5) {
      await User.findByIdAndUpdate(user._id, { lockUntil: Date.now() + 30 * 60 * 1000 });
    }
    return errorResponse(res, 401, 'Invalid credentials');
  }

  if (!user.isEmailVerified) return errorResponse(res, 403, 'Please verify your email address before logging in');
  if (!user.isActive) return errorResponse(res, 401, 'Account has been deactivated');
  if (!user.isApproved) return errorResponse(res, 401, 'Account is pending admin approval');

  user.loginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLogin = Date.now();
  await user.save({ validateBeforeSave: false });

  await AuditLog.create({ user: user._id, action: 'LOGIN', resource: 'auth', ipAddress: req.ip, userAgent: req.get('user-agent') });

  sendTokenResponse(user, 200, res);
});

exports.logout = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { refreshToken: null, refreshTokenExpire: null });
  await AuditLog.create({ user: req.user._id, action: 'LOGOUT', resource: 'auth', ipAddress: req.ip });
  res.cookie('token', '', { httpOnly: true, expires: new Date(0) });
  res.cookie('refreshToken', '', { httpOnly: true, expires: new Date(0), path: '/api/auth' });
  successResponse(res, 200, 'Logged out successfully');
});

exports.refreshAccessToken = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (!rawToken) return errorResponse(res, 401, 'No refresh token provided');

  const hashed = require('crypto').createHash('sha256').update(rawToken).digest('hex');
  const user = await User.findOne({
    refreshToken: hashed,
    refreshTokenExpire: { $gt: Date.now() },
    deletedAt: null,
  }).select('+refreshToken').populate('municipality', 'name code').populate('barangay', 'name');

  if (!user) return errorResponse(res, 401, 'Refresh token is invalid or expired');
  if (!user.isEmailVerified || !user.isActive || !user.isApproved) {
    return errorResponse(res, 401, 'Account is not authorized');
  }

  // Rotate: issue new access token and new refresh token (invalidates old one)
  const newAccessToken = user.getSignedJwtToken();
  const newRawRefresh = user.getRefreshToken();
  await user.save({ validateBeforeSave: false });

  res.cookie('token', newAccessToken, ACCESS_COOKIE_OPTIONS);
  res.cookie('refreshToken', newRawRefresh, REFRESH_COOKIE_OPTIONS);
  successResponse(res, 200, 'Token refreshed');
});

exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('municipality', 'name code').populate('barangay', 'name');
  successResponse(res, 200, 'User profile', user);
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['firstName', 'lastName', 'contactNumber'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  if (req.file) {
    // Delete old avatar from Cloudinary before uploading new one
    const existingUser = await User.findById(req.user._id).select('avatar');
    if (existingUser?.avatar && existingUser.avatar.includes('res.cloudinary.com')) {
      const publicId = existingUser.avatar
        .split('/upload/')[1]
        ?.replace(/^v\d+\//, '')
        .replace(/\.[^.]+$/, '');
      destroyQuietly(publicId);
    }

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: 'skims/avatars',
      public_id: randomUUID(),
    });
    updates.avatar = result.secure_url;
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  successResponse(res, 200, 'Profile updated', user);
});

exports.updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.matchPassword(currentPassword))) return errorResponse(res, 401, 'Current password is incorrect');
  user.password = newPassword;
  await user.save();
  sendTokenResponse(user, 200, res);
});

exports.verifyEmail = asyncHandler(async (req, res) => {
  const token = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({ emailVerificationToken: token, emailVerificationExpire: { $gt: Date.now() } });
  if (!user) return errorResponse(res, 400, 'Invalid or expired verification token');
  if (!user.isEmailVerified) {
    user.isEmailVerified = true;
    await user.save({ validateBeforeSave: false });
  }
  // Token left in place — emailVerificationExpire (24h TTL) handles cleanup naturally.
  // This makes the endpoint idempotent: re-clicking the link within 24h always succeeds.
  successResponse(res, 200, 'Email verified successfully');
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  // Always return 200 to prevent user enumeration
  if (!user) return successResponse(res, 200, 'If that email is registered, a password reset link has been sent');
  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });
  try {
    await emailService.sendPasswordReset(user, resetToken);
  } catch (_) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });
  }
  successResponse(res, 200, 'If that email is registered, a password reset link has been sent');
});

exports.resendVerification = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email, isEmailVerified: false, deletedAt: null });
  // Generic response regardless of whether user exists, to prevent enumeration
  if (!user) return successResponse(res, 200, 'If your email is pending verification, a new link has been sent');
  const verificationToken = user.getEmailVerificationToken();
  await user.save({ validateBeforeSave: false });
  sendVerificationInBackground(user, verificationToken);
  successResponse(res, 200, 'If your email is pending verification, a new link has been sent');
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const token = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpire: { $gt: Date.now() } });
  if (!user) return errorResponse(res, 400, 'Invalid or expired reset token');
  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();
  sendTokenResponse(user, 200, res);
});

// Exported so registerValidation can reject an unusable role with a message that names it,
// rather than letting it fall through to a misleading municipality error.
exports.SELF_ASSIGNABLE_ROLES = SELF_ASSIGNABLE_ROLES;
