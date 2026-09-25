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
const { applyReadScope } = require('../utils/scope');

exports.getDashboard = asyncHandler(async (req, res) => {
  const { municipalityId, barangay } = req.query;
  const user = req.user;

  /*
   * TWO filters, because the collections do not all carry a barangay.
   *
   * Programmes, expenses, documents and youth members each have one, so a barangay-bound officer's
   * figures cover their own barangay plus the municipality-level records that name none. Budgets and
   * liquidations are municipality-level documents — a budget is drawn per municipality and fiscal
   * year, which is what its unique index is on — so those stay municipality-scoped and are filtered
   * with `barangay: false`.
   *
   * Until this was split the dashboard totals were municipality-wide for everybody, so a chairperson
   * read barangay figures in every list and municipality figures in the KPI row above them. The
   * numbers disagreed with the rows they sat on top of.
   *
   * Both are built by the shared helper, which also means the ids in them are real ObjectIds:
   * `find()` casts a string against the schema but an aggregation `$match` does not, and half of
   * what follows is an aggregation.
   */
  const scopedFilter = {};
  const municipalityFilter = {};
  if (CROSS_MUNICIPALITY_READ.includes(user.role) && municipalityId) {
    scopedFilter.municipality = municipalityId;
    municipalityFilter.municipality = municipalityId;
  }
  applyReadScope(scopedFilter, user, { requestedBarangay: barangay });
  applyReadScope(municipalityFilter, user, { barangay: false });

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
    Program.countDocuments({ ...scopedFilter, deletedAt: null }),
    Program.aggregate([
      { $match: { ...scopedFilter, deletedAt: null } },
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
      { $match: { ...scopedFilter, deletedAt: null, status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Liquidation.countDocuments({ ...municipalityFilter, status: { $in: ['draft', 'submitted', 'under_review'] }, deletedAt: null }),
    Document.countDocuments({ ...scopedFilter, deletedAt: null }),
    /*
     * Staff serve a municipality, not a barangay, so this is municipality-scoped rather than
     * barangay-scoped — but scoped it must be: it counted every active account in the province for
     * everybody, so a Boac chairperson's dashboard reported the province's headcount as their own.
     */
    User.countDocuments({ ...municipalityFilter, deletedAt: null, isActive: true }),
    YouthMember.countDocuments({ ...scopedFilter, deletedAt: null }),
    Program.find({ ...scopedFilter, deletedAt: null })
      .populate('municipality', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title status budget completionRate createdAt'),
    Expense.find({ ...scopedFilter, deletedAt: null })
      .populate('program', 'title')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title amount type transactionDate status'),
    Notification.countDocuments({ recipient: user._id, isRead: false }),
    Expense.aggregate([
      {
        $match: {
          ...scopedFilter,
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
