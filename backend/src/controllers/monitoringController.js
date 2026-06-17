const asyncHandler = require('express-async-handler');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const Liquidation = require('../models/Liquidation');
const Municipality = require('../models/Municipality');
const { successResponse } = require('../utils/apiResponse');

const scopeMunicipality = (req, filter) => {
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    filter.municipality = munId || { $in: [] };
  }
};

exports.getMonitoringOverview = asyncHandler(async (req, res) => {
  const { municipality, fiscalYear } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  scopeMunicipality(req, filter);

  const [delayedPrograms, upcomingDeadlines, pendingLiquidations, overBudgetPrograms] = await Promise.all([
    Program.find({ ...filter, status: 'delayed' })
      .populate('municipality', 'name')
      .populate('barangay', 'name')
      .select('title status startDate endDate budget completionRate'),
    Program.find({ ...filter, endDate: { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), $gte: new Date() } })
      .populate('municipality', 'name')
      .select('title endDate status'),
    Liquidation.find({ ...filter, status: { $in: ['draft', 'submitted'] }, dueDate: { $lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) } })
      .populate('program', 'title')
      .populate('municipality', 'name')
      .select('referenceNumber dueDate status'),
    Program.find({ ...filter, $expr: { $gt: ['$actualExpenses', '$budget'] } })
      .populate('municipality', 'name')
      .select('title budget actualExpenses'),
  ]);

  successResponse(res, 200, 'Monitoring overview', {
    delayedPrograms,
    upcomingDeadlines,
    pendingLiquidations,
    overBudgetPrograms,
  });
});

exports.getMunicipalityReport = asyncHandler(async (req, res) => {
  const matchStage = ['super_admin', 'provincial_admin'].includes(req.user.role)
    ? {}
    : { _id: req.user.municipality?._id || req.user.municipality };

  const report = await Municipality.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'programs',
        let: { mId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$municipality', '$$mId'] }, deletedAt: null } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              budget: { $sum: '$budget' },
            },
          },
        ],
        as: 'programStats',
      },
    },
    {
      $lookup: {
        from: 'budgets',
        let: { mId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$municipality', '$$mId'] }, status: 'approved', deletedAt: null } },
          { $group: { _id: null, total: { $sum: '$totalBudget' }, disbursed: { $sum: '$disbursedAmount' } } },
        ],
        as: 'budgetStats',
      },
    },
    {
      $project: {
        name: 1,
        code: 1,
        programStats: 1,
        budgetStats: { $arrayElemAt: ['$budgetStats', 0] },
      },
    },
  ]);
  successResponse(res, 200, 'Municipality report', report);
});

exports.getComplianceStatus = asyncHandler(async (req, res) => {
  const { municipality } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  scopeMunicipality(req, filter);

  const [pendingLiq, overduePrograms, missingDocuments] = await Promise.all([
    Liquidation.countDocuments({ ...filter, status: { $in: ['draft', 'submitted'] }, dueDate: { $lt: new Date() } }),
    Program.countDocuments({ ...filter, status: 'delayed' }),
    Program.countDocuments({ ...filter, status: 'completed', 'attachments.0': { $exists: false } }),
  ]);

  const complianceScore = Math.max(0, 100 - pendingLiq * 10 - overduePrograms * 5 - missingDocuments * 3);

  successResponse(res, 200, 'Compliance status', {
    pendingLiquidations: pendingLiq,
    overduePrograms,
    missingDocuments,
    complianceScore,
    status: complianceScore >= 80 ? 'compliant' : complianceScore >= 60 ? 'at_risk' : 'non_compliant',
  });
});

exports.getProgramTimeline = asyncHandler(async (req, res) => {
  const { municipality } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  scopeMunicipality(req, filter);

  const programs = await Program.find(filter)
    .select('title status startDate endDate completionRate category')
    .populate('municipality', 'name')
    .sort({ startDate: 1 });

  successResponse(res, 200, 'Program timeline', programs);
});
