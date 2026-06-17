const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');
const AuditLog = require('../models/AuditLog');
const { paginatedResponse } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

router.use(protect);
router.use(authorize('super_admin', 'provincial_admin', 'municipal_admin'));

router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, user, action, resource, municipality, startDate, endDate } = req.query;
  const filter = {};

  if (user) filter.user = user;
  if (action) filter.action = action;
  if (resource) filter.resource = resource;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  // municipal_admin scoped to their municipality
  if (req.user.role === 'municipal_admin') {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  } else if (municipality) {
    filter.municipality = municipality;
  }

  const safeLimit = Math.min(parseInt(limit) || 20, MAX_LIMIT);
  const skip = (parseInt(page) - 1) * safeLimit;
  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('user', 'firstName lastName email role')
      .populate('municipality', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    AuditLog.countDocuments(filter),
  ]);

  paginatedResponse(res, logs, page, safeLimit, total);
}));

module.exports = router;
