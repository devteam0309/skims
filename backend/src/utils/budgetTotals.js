/**
 * Budget totals without double counting.
 *
 * A municipality's SK budget for a fiscal year is ONE record that names no barangay: the municipal
 * budget. Each barangay's allocation is a second record naming that barangay, carved OUT of the
 * municipal budget — so the municipal record's `totalBudget` already contains every allocation, and
 * summing `totalBudget` across both kinds counts the allocated money twice. Every figure that adds
 * budgets up goes through this module for that reason.
 *
 * Per (municipality, fiscal year):
 *
 *   total     the municipal budget's total when the set contains it; otherwise the sum of the
 *             allocations it does contain (a barangay officer's own, or one barangay picked out)
 *   disbursed Σ disbursedAmount over every record — the municipality's direct spending plus each
 *             barangay's, since an expense is charged to exactly one of them
 *   remaining total − disbursed
 *
 * `remainingBalance` is deliberately not summed: each record's own remaining figure is relative to
 * itself, and adding the municipal one to the barangays' would count the allocated money as
 * unspent twice over.
 */
const Budget = require('../models/Budget');

const IS_MUNICIPAL = { $eq: [{ $ifNull: ['$barangay', null] }, null] };

/**
 * Aggregation stages that reduce matched budgets to one grand-total row, or with
 * `{ byMunicipality: true }` one row per municipality (`_id` = the municipality id).
 */
const budgetTotalsStages = ({ byMunicipality = false } = {}) => [
  {
    $group: {
      _id: { municipality: '$municipality', fiscalYear: '$fiscalYear' },
      municipalTotal: { $sum: { $cond: [IS_MUNICIPAL, '$totalBudget', 0] } },
      hasMunicipal: { $max: { $cond: [IS_MUNICIPAL, 1, 0] } },
      allocationTotal: { $sum: { $cond: [IS_MUNICIPAL, 0, '$totalBudget'] } },
      disbursed: { $sum: { $ifNull: ['$disbursedAmount', 0] } },
      committed: { $sum: { $ifNull: ['$committedAmount', 0] } },
      count: { $sum: 1 },
    },
  },
  {
    $group: {
      _id: byMunicipality ? '$_id.municipality' : null,
      total: { $sum: { $cond: [{ $eq: ['$hasMunicipal', 1] }, '$municipalTotal', '$allocationTotal'] } },
      allocatedToBarangays: { $sum: '$allocationTotal' },
      disbursed: { $sum: '$disbursed' },
      committed: { $sum: '$committed' },
      count: { $sum: '$count' },
    },
  },
  { $addFields: { remaining: { $subtract: ['$total', '$disbursed'] } } },
];

/** The same reduction in JavaScript, for code that already holds the documents (reports). */
const summarizeBudgets = (budgets = []) => {
  const groups = new Map();
  for (const b of budgets) {
    const key = `${b.municipality?._id || b.municipality}:${b.fiscalYear}`;
    const g = groups.get(key) || { municipalTotal: 0, hasMunicipal: false, allocationTotal: 0, disbursed: 0, committed: 0 };
    if (b.barangay) g.allocationTotal += b.totalBudget || 0;
    else { g.municipalTotal += b.totalBudget || 0; g.hasMunicipal = true; }
    g.disbursed += b.disbursedAmount || 0;
    g.committed += b.committedAmount || 0;
    groups.set(key, g);
  }
  let total = 0; let allocatedToBarangays = 0; let disbursed = 0; let committed = 0;
  for (const g of groups.values()) {
    total += g.hasMunicipal ? g.municipalTotal : g.allocationTotal;
    allocatedToBarangays += g.allocationTotal;
    disbursed += g.disbursed;
    committed += g.committed;
  }
  return { total, allocatedToBarangays, disbursed, committed, remaining: total - disbursed, count: budgets.length };
};

/**
 * What a municipal budget can still give away or spend directly.
 *
 * Approved barangay allocations are money already promised, so they are subtracted along with the
 * municipality's own spending and commitments. Two callers need this: approving a new allocation
 * (which must fit) and charging the municipal budget directly (which must not dip into a barangay's
 * share).
 */
const municipalBudgetAvailability = async (municipalBudget, { session = null, excludeBudgetId = null } = {}) => {
  const match = {
    municipality: municipalBudget.municipality?._id || municipalBudget.municipality,
    fiscalYear: municipalBudget.fiscalYear,
    barangay: { $ne: null },
    status: 'approved',
    deletedAt: null,
  };
  if (excludeBudgetId) match._id = { $ne: excludeBudgetId };
  const query = Budget.aggregate([{ $match: match }, { $group: { _id: null, allocated: { $sum: '$totalBudget' } } }]);
  if (session) query.session(session);
  const [row] = await query;
  const allocated = row?.allocated || 0;
  const available = (municipalBudget.totalBudget || 0)
    - (municipalBudget.disbursedAmount || 0)
    - (municipalBudget.committedAmount || 0)
    - allocated;
  return { allocated, available };
};

/** Peso amount for messages, matching formatPHP in reportController. */
const peso = (amount) =>
  `₱${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)}`;

module.exports = { budgetTotalsStages, summarizeBudgets, municipalBudgetAvailability, peso };
