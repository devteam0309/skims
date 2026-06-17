const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const { errorResponse } = require('../utils/apiResponse');

exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies?.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return errorResponse(res, 401, 'Not authorized to access this route');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).populate('municipality', 'name code').populate('barangay', 'name');

    if (!user || user.deletedAt) {
      return errorResponse(res, 401, 'User account not found');
    }

    if (!user.isEmailVerified) {
      return errorResponse(res, 401, 'Please verify your email address before accessing this resource');
    }

    if (!user.isActive) {
      return errorResponse(res, 401, 'Account has been deactivated');
    }

    if (!user.isApproved) {
      return errorResponse(res, 401, 'Account is pending approval');
    }

    req.user = user;
    next();
  } catch (err) {
    return errorResponse(res, 401, 'Token is invalid or expired');
  }
});

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return errorResponse(res, 403, `Role '${req.user.role}' is not authorized to access this route`);
    }
    next();
  };
};

exports.optionalAuth = asyncHandler(async (req, res, next) => {
  let token;
  if (req.cookies?.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id);
    } catch (_) {}
  }
  next();
});
