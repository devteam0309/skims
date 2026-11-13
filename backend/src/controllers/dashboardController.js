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
const { applyReadScope, objectIdOf } = require('../utils/scope');
const { budgetTotalsStages } = require('../utils/budgetTotals');

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
  /*
   * Finance has its own two filters, STRICT on barangay (utils/scope.js): a barangay officer's money
   * figures are their barangay's budget and expenses, never the municipal total. Budgets go through
   * budgetTotalsStages so a barangay allocation is not counted on top of the municipal budget it was
   * carved from.
   */
  const scopedFilter = {};
  const municipalityFilter = {};
  const financeFilter = {};
  const budgetFilter = {};
  const liquidationFilter = {};
  if (CROSS_MUNICIPALITY_READ.includes(user.role) && municipalityId) {
    const munId = objectIdOf(municipalityId) || { $in: [] };
    [scopedFilter, municipalityFilter, financeFilter, budgetFilter, liquidationFilter].forEach((f) => { f.municipality = munId; });
  }
  applyReadScope(scopedFilter, user, { requestedBarangay: barangay });
  applyReadScope(municipalityFilter, user, { barangay: false });
  applyReadScope(financeFilter, user, { strict: true, ownerField: 'createdBy', requestedBarangay: barangay });
  applyReadScope(budgetFilter, user, { strict: true, requestedBarangay: barangay });
  applyReadScope(liquidationFilter, user, { strict: true, ownerField: 'submittedBy', requestedBarangay: barangay });

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
      { $match: { ...budgetFilter, deletedAt: null, status: 'approved' } },
      ...budgetTotalsStages(),
    ]),
    // Spending means approved — and liquidated, which were approved first.
    Expense.aggregate([
      { $match: { ...financeFilter, deletedAt: null, status: { $in: ['approved', 'liquidated'] } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Liquidation.countDocuments({ ...liquidationFilter, status: { $in: ['draft', 'submitted', 'under_review', 'returned'] }, deletedAt: null }),
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
    Expense.find({ ...financeFilter, deletedAt: null })
      .populate('program', 'title')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title amount type transactionDate status'),
    Notification.countDocuments({ recipient: user._id, isRead: false }),
    Expense.aggregate([
      {
        $match: {
          ...financeFilter,
          deletedAt: null,
          status: { $in: ['approved', 'liquidated'] },
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
    allocatedToBarangays: budgetSummary[0]?.allocatedToBarangays || 0,
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
