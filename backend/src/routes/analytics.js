const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { REPORT_VIEWERS } = require('../constants/roles');
const asyncHandler = require('express-async-handler');
const Program = require('../models/Program');
const Expense = require('../models/Expense');
const YouthMember = require('../models/YouthMember');
const { successResponse } = require('../utils/apiResponse');
const { applyReadScope } = require('../utils/scope');

router.use(protect);
router.use(authorize(...REPORT_VIEWERS));

/*
 * Every collection analytics reads — expenses, programmes, youth members — carries a barangay, so
 * all three endpoints narrow on it. That matters more here than on a list page: an analytics figure
 * is read as a fact about the reader's own scope, and a chairperson comparing "our fund utilisation"
 * against a municipality-wide total would draw a conclusion about their barangay from somebody
 * else's spending.
 *
 * The ids go in as real ObjectIds, which is what makes these `$match` stages work at all — a string
 * id is cast by `find()` against the schema and is NOT cast inside an aggregation pipeline.
 */
const scopeAnalytics = (req, filter) => {
  applyReadScope(filter, req.user, { requestedBarangay: req.query.barangay });
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

  const [byGender, byEducation, byMunicipality, byBarangay] = await Promise.all([
    YouthMember.aggregate([{ $match: filter }, { $group: { _id: '$gender', count: { $sum: 1 } } }]),
    YouthMember.aggregate([{ $match: filter }, { $group: { _id: '$educationalAttainment', count: { $sum: 1 } } }]),
    YouthMember.aggregate([
      { $match: filter },
      { $group: { _id: '$municipality', count: { $sum: 1 } } },
      { $lookup: { from: 'municipalities', localField: '_id', foreignField: '_id', as: 'municipality' } },
      { $unwind: '$municipality' },
      { $project: { 'municipality.name': 1, count: 1 } },
    ]),
    /*
     * A barangay breakdown alongside the municipality one.
     *
     * For a scoped account the municipality chart is a single bar — itself — which says nothing. The
     * barangay split is the comparison that account can actually act on, and for a province-wide
     * reader it is the detail behind the municipality totals. Members with no barangay are grouped
     * under a stated label rather than dropped, since that is a real and common state.
     */
    YouthMember.aggregate([
      { $match: filter },
      { $group: { _id: '$barangay', count: { $sum: 1 } } },
      { $lookup: { from: 'barangays', localField: '_id', foreignField: '_id', as: 'barangay' } },
      { $unwind: { path: '$barangay', preserveNullAndEmptyArrays: true } },
      { $project: { name: { $ifNull: ['$barangay.name', 'No barangay recorded'] }, count: 1 } },
      { $sort: { count: -1 } },
    ]),
  ]);
  successResponse(res, 200, 'Youth engagement', { byGender, byEducation, byMunicipality, byBarangay });
}));

module.exports = router;
