const asyncHandler = require('express-async-handler');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const Liquidation = require('../models/Liquidation');
const Document = require('../models/Document');
const User = require('../models/User');
const Notification = require('../models/Notification');
const YouthMember = require('../models/YouthMember');
const { successResponse } = require('../utils/apiResponse');
const { CROSS_MUNICIPALITY_READ } = require('../constants/roles');

exports.getDashboard = asyncHandler(async (req, res) => {
  const { municipalityId } = req.query;
  const user = req.user;

  let municipalityFilter;
  if (!CROSS_MUNICIPALITY_READ.includes(user.role)) {
    const munId = user.municipality?._id || user.municipality;
    municipalityFilter = { municipality: munId || { $in: [] } };
  } else if (municipalityId) {
    municipalityFilter = { municipality: municipalityId };
  } else {
    municipalityFilter = {};
  }

  const [
    totalPrograms,
    programsByStatus,
    budgetSummary,
    expenseSummary,
    pendingLiquidations,
    totalDocuments,
    totalUsers,
    totalYouth,
    recentPrograms,
    recentExpenses,
    unreadNotifications,
    monthlyExpenses,
  ] = await Promise.all([
    Program.countDocuments({ ...municipalityFilter, deletedAt: null }),
    Program.aggregate([
      { $match: { ...municipalityFilter, deletedAt: null } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Budget.aggregate([
      { $match: { ...municipalityFilter, deletedAt: null, status: 'approved' } },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalBudget' },
          disbursed: { $sum: '$disbursedAmount' },
          remaining: { $sum: '$remainingBalance' },
        },
      },
    ]),
    Expense.aggregate([
      { $match: { ...municipalityFilter, deletedAt: null, status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Liquidation.countDocuments({ ...municipalityFilter, status: { $in: ['draft', 'submitted', 'under_review'] }, deletedAt: null }),
    Document.countDocuments({ ...municipalityFilter, deletedAt: null }),
    User.countDocuments({ deletedAt: null, isActive: true }),
    YouthMember.countDocuments({ ...municipalityFilter, deletedAt: null }),
    Program.find({ ...municipalityFilter, deletedAt: null })
      .populate('municipality', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title status budget completionRate createdAt'),
    Expense.find({ ...municipalityFilter, deletedAt: null })
      .populate('program', 'title')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title amount type transactionDate status'),
    Notification.countDocuments({ recipient: user._id, isRead: false }),
    Expense.aggregate([
      {
        $match: {
          ...municipalityFilter,
          deletedAt: null,
          transactionDate: { $gte: new Date(new Date().getFullYear(), 0, 1) },
        },
      },
      {
        $group: {
          _id: { month: { $month: '$transactionDate' } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.month': 1 } },
    ]),
  ]);

  const programStatusMap = {};
  programsByStatus.forEach((p) => { programStatusMap[p._id] = p.count; });

  const kpis = {
    totalPrograms,
    activePrograms: programStatusMap.ongoing || 0,
    completedPrograms: programStatusMap.completed || 0,
    plannedPrograms: programStatusMap.planned || 0,
    delayedPrograms: programStatusMap.delayed || 0,
    totalBudget: budgetSummary[0]?.total || 0,
    disbursedBudget: budgetSummary[0]?.disbursed || 0,
    remainingBudget: budgetSummary[0]?.remaining || 0,
    totalExpenses: expenseSummary[0]?.total || 0,
    pendingLiquidations,
    totalDocuments,
    totalUsers,
    totalYouth,
    unreadNotifications,
    budgetUtilization: budgetSummary[0]?.total
      ? Math.round((budgetSummary[0].disbursed / budgetSummary[0].total) * 100)
      : 0,
  };

  successResponse(res, 200, 'Dashboard data', {
    kpis,
    recentPrograms,
    recentExpenses,
    monthlyExpenses,
    programsByStatus: programStatusMap,
  });
});

// Cross-municipality by design — it is the one province-wide view. It therefore carries NO
// money: this endpoint is open to every REPORTER, which includes an SK Chairperson, so summing
// budgets here handed each municipality's figures to the neighbouring municipality's staff.
// Programme counts and completion rates are the comparison; peso amounts stay municipality-scoped.
exports.getMunicipalityComparison = asyncHandler(async (req, res) => {
  const comparison = await Program.aggregate([
    { $match: { deletedAt: null } },
    {
      $group: {
        _id: '$municipality',
        totalPrograms: { $sum: 1 },
        completedPrograms: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        avgCompletionRate: { $avg: '$completionRate' },
      },
    },
    {
      $lookup: {
        from: 'municipalities',
        localField: '_id',
        foreignField: '_id',
        as: 'municipality',
      },
    },
    { $unwind: '$municipality' },
    { $sort: { totalPrograms: -1 } },
  ]);
  successResponse(res, 200, 'Municipality comparison', comparison);
});
