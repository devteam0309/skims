const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { REPORTERS } = require('../constants/roles');
const asyncHandler = require('express-async-handler');
const Program = require('../models/Program');
const Expense = require('../models/Expense');
const YouthMember = require('../models/YouthMember');
const { successResponse } = require('../utils/apiResponse');

router.use(protect);
router.use(authorize(...REPORTERS));

const scopeAnalytics = (req, filter) => {
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  }
};

router.get('/fund-utilization', asyncHandler(async (req, res) => {
  const { municipality, year = new Date().getFullYear() } = req.query;
  const filter = { deletedAt: null, transactionDate: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } };
  if (municipality) filter.municipality = municipality;
  scopeAnalytics(req, filter);

  const monthly = await Expense.aggregate([
    { $match: filter },
    { $group: { _id: { month: { $month: '$transactionDate' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { '_id.month': 1 } },
  ]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const found = monthly.find((m) => m._id.month === i + 1);
    return { month: i + 1, total: found?.total || 0, count: found?.count || 0 };
  });

  successResponse(res, 200, 'Fund utilization', months);
}));

router.get('/program-success', asyncHandler(async (req, res) => {
  const { municipality } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  scopeAnalytics(req, filter);

  const data = await Program.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$category',
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        avgCompletionRate: { $avg: '$completionRate' },
        totalBudget: { $sum: '$budget' },
      },
    },
    { $addFields: { successRate: { $multiply: [{ $divide: ['$completed', '$total'] }, 100] } } },
    { $sort: { total: -1 } },
  ]);
  successResponse(res, 200, 'Program success rates', data);
}));

router.get('/youth-engagement', asyncHandler(async (req, res) => {
  const { municipality } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  scopeAnalytics(req, filter);

  const [byGender, byEducation, byMunicipality] = await Promise.all([
    YouthMember.aggregate([{ $match: filter }, { $group: { _id: '$gender', count: { $sum: 1 } } }]),
    YouthMember.aggregate([{ $match: filter }, { $group: { _id: '$educationalAttainment', count: { $sum: 1 } } }]),
    YouthMember.aggregate([
      { $match: filter },
      { $group: { _id: '$municipality', count: { $sum: 1 } } },
      { $lookup: { from: 'municipalities', localField: '_id', foreignField: '_id', as: 'municipality' } },
      { $unwind: '$municipality' },
      { $project: { 'municipality.name': 1, count: 1 } },
    ]),
  ]);
  successResponse(res, 200, 'Youth engagement', { byGender, byEducation, byMunicipality });
}));

module.exports = router;
