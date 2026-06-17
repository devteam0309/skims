const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const emailService = require('../services/emailService');
const { cloudinary, uploadToCloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse } = require('../utils/apiResponse');

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

const SELF_ASSIGNABLE_ROLES = ['sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative', 'public_user'];

exports.register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, role, municipality, barangay, contactNumber } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) return errorResponse(res, 400, 'Email already registered');

  const assignedRole = SELF_ASSIGNABLE_ROLES.includes(role) ? role : 'public_user';

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    role: assignedRole,
    municipality,
    barangay,
    contactNumber,
    isApproved: assignedRole === 'public_user',
  });

  const verificationToken = user.getEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  try {
    await emailService.sendEmailVerification(user, verificationToken);
  } catch (_) {}

  // Notify admins when a non-public_user registers and requires approval
  if (assignedRole !== 'public_user') {
    const adminFilter = { role: { $in: ['super_admin', 'provincial_admin', 'municipal_admin'] }, isActive: true, deletedAt: null };
    if (user.municipality) adminFilter.$or = [{ municipality: user.municipality }, { role: { $in: ['super_admin', 'provincial_admin'] } }];
    const admins = await User.find(adminFilter).select('_id').lean();
    if (admins.length > 0) {
      await Notification.insertMany(admins.map((a) => ({
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
      if (publicId) cloudinary.uploader.destroy(publicId).catch(() => {});
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
  try {
    await emailService.sendEmailVerification(user, verificationToken);
  } catch (_) {}
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
