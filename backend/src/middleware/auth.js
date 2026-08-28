const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const { errorResponse } = require('../utils/apiResponse');


/*
 * Deny-by-default surface for the `youth` role.
 *
 * Youth accounts are the only role held by members of the public rather than SK officials, and
 * they exist in far greater numbers. Most of this API is guarded by `authorize(...)` whitelists,
 * which a new role fails automatically — but a substantial set of read routes carry only
 * `protect`: budgets, expenses, liquidations, documents, /users/:id, the dashboard, and the youth
 * registry itself. Adding a role without closing those would hand every youth account the
 * municipality's financial records and every other member's address and contact number.
 *
 * Rather than add `authorize(...STAFF)` to fifteen routes and rely on nobody forgetting the
 * sixteenth, the role is closed here and opened explicitly. A route added later is denied to
 * youth until someone deliberately lists it, which is the safe direction to fail in.
 */
const YOUTH_ALLOWED = [
  // Their own account and session.
  { method: 'GET', pattern: /^\/api\/auth\/me$/ },
  { method: 'PUT', pattern: /^\/api\/auth\/me$/ },
  { method: 'PUT', pattern: /^\/api\/auth\/password$/ },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/ },

  // Their own registry record.
  { method: 'GET', pattern: /^\/api\/youth\/me$/ },
  { method: 'PUT', pattern: /^\/api\/youth\/me$/ },

  // Programmes they may browse and ask to join. Read is municipality-scoped by the controller.
  { method: 'GET', pattern: /^\/api\/programs(\/[0-9a-f]{24})?(\?.*)?$/i },
  { method: 'POST', pattern: /^\/api\/programs\/[0-9a-f]{24}\/join$/i },
  { method: 'DELETE', pattern: /^\/api\/programs\/[0-9a-f]{24}\/join$/i },

  // Announcements are published to the public anyway, and their own notifications.
  { method: 'GET', pattern: /^\/api\/announcements(\/[0-9a-f]{24})?(\?.*)?$/i },
  { method: 'GET', pattern: /^\/api\/notifications(\/unread-count)?(\?.*)?$/i },
  { method: 'PUT', pattern: /^\/api\/notifications\/([0-9a-f]{24}\/read|read-all)$/i },
  { method: 'DELETE', pattern: /^\/api\/notifications\/[0-9a-f]{24}$/i },
];

const youthMayAccess = (method, url) =>
  YOUTH_ALLOWED.some((r) => r.method === method && r.pattern.test(url));

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

    // Closed surface — see YOUTH_ALLOWED above. Applied here rather than per route so that it
    // covers every authenticated endpoint, including ones added after this was written.
    if (user.role === 'youth' && !youthMayAccess(req.method, req.originalUrl)) {
      return errorResponse(res, 403, 'Not authorized to access this route');
    }

    req.user = user;
    next();
  } catch (err) {
    return errorResponse(res, 401, 'Token is invalid or expired');
  }
});

// Exported so the route tests can assert the allowlist directly rather than only through requests.
exports.youthMayAccess = youthMayAccess;
exports.YOUTH_ALLOWED = YOUTH_ALLOWED;

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
