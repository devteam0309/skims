const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ROLES = [
  'super_admin',
  'provincial_admin',
  'municipal_admin',
  'sk_chairperson',
  'sk_treasurer',
  'sk_secretary',
  'sk_kagawad',
  'dilg_representative',
  'public_user',
];

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email'],
    },
    password: {
      type: String,
      required: true,
      minlength: [8, 'Password must be at least 8 characters'],
      validate: {
        validator: (v) => /^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}/.test(v),
        message: 'Password must contain at least one uppercase letter, one number, and one special character',
      },
      select: false,
    },
    role: { type: String, enum: ROLES, default: 'public_user' },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality' },
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay' },
    contactNumber: { type: String, trim: true },
    avatar: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    isApproved: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: String,
    emailVerificationExpire: Date,
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    refreshToken: { type: String, select: false },
    refreshTokenExpire: Date,
    lastLogin: Date,
    loginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indexes
userSchema.index({ role: 1 });
userSchema.index({ municipality: 1 });
userSchema.index({ deletedAt: 1 });

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Sign JWT — short-lived access token (15 min). Long-lived sessions use refresh tokens.
userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '15m',
  });
};

// Match password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate email verification token
userSchema.methods.getEmailVerificationToken = function () {
  const token = crypto.randomBytes(20).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;
  return token;
};

// Generate password reset token
userSchema.methods.getResetPasswordToken = function () {
  const token = crypto.randomBytes(20).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
  return token;
};

// Generate opaque refresh token (stored as hash, returned as raw)
userSchema.methods.getRefreshToken = function () {
  const token = crypto.randomBytes(40).toString('hex');
  this.refreshToken = crypto.createHash('sha256').update(token).digest('hex');
  this.refreshTokenExpire = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  return token;
};

// Soft delete query
userSchema.statics.findActive = function (filter = {}) {
  return this.find({ ...filter, deletedAt: null });
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
