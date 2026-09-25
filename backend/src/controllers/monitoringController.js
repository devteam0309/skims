const asyncHandler = require('express-async-handler');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const Liquidation = require('../models/Liquidation');
const Municipality = require('../models/Municipality');
const { successResponse } = require('../utils/apiResponse');
const { CROSS_MUNICIPALITY_READ } = require('../constants/roles');
const { applyReadScope, objectIdOf } = require('../utils/scope');

/**
 * Scope a monitoring filter, mutating it.
 *
 * `barangay` is false for a filter that will be run against budgets or liquidations: those are
 * municipality-level documents and have no barangay field, so narrowing on one would match nothing
 * at all rather than narrowing. Programme filters take the default.
 */
const scopeMonitoring = (req, filter, { barangay = true } = {}) => {
  applyReadScope(filter, req.user, { barangay, requestedBarangay: req.query.barangay });
};

exports.getMonitoringOverview = asyncHandler(async (req, res) => {
  const { municipality, fiscalYear } = req.query;

  /*
   * Programmes carry a barangay; liquidations do not. One filter across both would either leave the
   * programme lists municipality-wide (the state this replaces, where a chairperson's "delayed
   * programmes" panel listed other barangays' work) or ask the liquidation collection for a field it
   * has no column for, which matches nothing.
   */
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  scopeMonitoring(req, filter);

  const liquidationFilter = { deletedAt: null };
  if (municipality) liquidationFilter.municipality = municipality;
  scopeMonitoring(req, liquidationFilter, { barangay: false });

  const [delayedPrograms, upcomingDeadlines, pendingLiquidations, overBudgetPrograms] = await Promise.all([
    Program.find({ ...filter, status: 'delayed' })
      .populate('municipality', 'name')
      .populate('barangay', 'name')
      .select('title status startDate endDate budget completionRate'),
    Program.find({ ...filter, endDate: { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), $gte: new Date() } })
      .populate('municipality', 'name')
      // Named, because a province-wide reader now sees deadlines from several barangays in one list.
      .populate('barangay', 'name')
      .select('title endDate status'),
    Liquidation.find({ ...liquidationFilter, status: { $in: ['draft', 'submitted'] }, dueDate: { $lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) } })
      .populate('program', 'title')
      .populate('municipality', 'name')
      .select('referenceNumber dueDate status'),
    Program.find({ ...filter, $expr: { $gt: ['$actualExpenses', '$budget'] } })
      .populate('municipality', 'name')
      .populate('barangay', 'name')
      .select('title budget actualExpenses'),
  ]);

  successResponse(res, 200, 'Monitoring overview', {
    delayedPrograms,
    upcomingDeadlines,
    pendingLiquidations,
    overBudgetPrograms,
  });
});

// Feeds the Municipality Performance Comparison chart. Deliberately reports programme activity
// only — no budget or disbursement totals. For a super_admin the match stage is empty, so any
// money summed here would be every municipality's, rendered on one chart.
//
// NOT barangay-scoped, on purpose. Each row IS a municipality and is labelled with its name, so
// narrowing the counts to one barangay would print a barangay's figures under the municipality's
// heading — a wrong number rather than a narrower one. A barangay-bound officer sees one row, their
// own municipality's, which is what the chart claims to show.
exports.getMunicipalityReport = asyncHandler(async (req, res) => {
  /*
   * `objectIdOf` rather than the raw value, and an explicit `{ $in: [] }` when the account has none.
   * This is an aggregation, so nothing is cast against a schema: a string id would match no
   * municipality at all, and an undefined one relies on the driver's own coercion to fail closed.
   */
  const ownMunicipality = objectIdOf(req.user.municipality);
  const matchStage = CROSS_MUNICIPALITY_READ.includes(req.user.role)
    ? {}
    : { _id: ownMunicipality || { $in: [] } };

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
            },
          },
        ],
        as: 'programStats',
      },
    },
    {
      $project: {
        name: 1,
        code: 1,
        programStats: 1,
      },
    },
  ]);
  successResponse(res, 200, 'Municipality report', report);
});

exports.getComplianceStatus = asyncHandler(async (req, res) => {
  const { municipality } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  scopeMonitoring(req, filter);

  // Liquidations are municipality-level, so the overdue count is too — see scopeMonitoring.
  const liquidationFilter = { deletedAt: null };
  if (municipality) liquidationFilter.municipality = municipality;
  scopeMonitoring(req, liquidationFilter, { barangay: false });

  const [pendingLiq, overduePrograms, missingDocuments] = await Promise.all([
    Liquidation.countDocuments({ ...liquidationFilter, status: { $in: ['draft', 'submitted'] }, dueDate: { $lt: new Date() } }),
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
  scopeMonitoring(req, filter);

  const programs = await Program.find(filter)
    .select('title status startDate endDate completionRate category')
    .populate('municipality', 'name')
    .populate('barangay', 'name')
    .sort({ startDate: 1 });

  successResponse(res, 200, 'Program timeline', programs);
});
