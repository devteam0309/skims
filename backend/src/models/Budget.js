const mongoose = require('mongoose');

const allocationSchema = new mongoose.Schema({
  category: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  description: String,
  program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
});

const budgetSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    fiscalYear: { type: Number, required: true },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality', required: true },
    /*
     * No barangay: the MUNICIPAL budget — the municipality's total SK budget for the fiscal year.
     * A barangay: that barangay's ALLOCATION, carved out of the municipal budget. Each barangay
     * spends only from its own allocation, never from the municipal total, and approving an
     * allocation checks it fits in what the municipal budget has not already given away
     * (utils/budgetTotals.js). The field existed from the start and nothing set it until the
     * October 2026 panel round asked for budgets to be allocated per barangay.
     */
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay', default: null },
    totalBudget: { type: Number, required: true, min: 0 },
    allocations: [allocationSchema],
    approvedAmount: { type: Number, default: 0 },
    disbursedAmount: { type: Number, default: 0 },
    // Money promised to approved programs but not yet spent (an encumbrance). Kept separate from
    // disbursedAmount deliberately: expenses raised against an approved program later increase
    // disbursedAmount, so folding the programme amount into the same field would spend it twice.
    committedAmount: { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'pending_approval', 'approved', 'rejected', 'revised'],
      default: 'draft',
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes: String,
    attachments: [{ fileName: String, fileUrl: String }],
    /*
     * Bumped on the MUNICIPAL budget every time one of its barangay allocations is approved. Nothing
     * reads it; the write is the point. Two allocations approved at the same moment would otherwise
     * each read the same unallocated balance and both fit — writing this document makes their
     * transactions conflict, so the second is retried against a balance that includes the first.
     */
    allocationRevision: { type: Number, default: 0 },
    // Recycle bin: who moved it there. `deletedAt` set means it is in the bin and every list skips it.
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: String,
    deletedAt: { type: Date, default: null },
  },
  // Virtuals must serialise: availableBalance is read by the Budgets page and the program
  // approval guard, both of which see the JSON form rather than the document.
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

budgetSchema.index({ municipality: 1, status: 1, deletedAt: 1 });
budgetSchema.index({ municipality: 1, fiscalYear: 1, deletedAt: 1 });
budgetSchema.index({ barangay: 1, fiscalYear: 1 });
/*
 * One live budget per (municipality, barangay, fiscal year): a single municipal budget (barangay
 * null) and a single allocation per barangay. Budgets in the recycle bin do not count, so a deleted
 * one can be replaced — and restoring it while a replacement exists is refused with 409.
 *
 * This REPLACES the old `{ municipality, fiscalYear }` unique index, which allowed only one budget
 * per municipality and would reject every barangay allocation. Mongoose builds new indexes but never
 * drops old ones, so `scripts/migrate-barangay-finance.js --apply` must drop
 * `municipality_1_fiscalYear_1` on any database created before this change.
 */
budgetSchema.index(
  { municipality: 1, barangay: 1, fiscalYear: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, name: 'one_live_budget_per_scope_and_year' }
);

// What is genuinely still free to allocate: neither spent nor promised.
budgetSchema.virtual('availableBalance').get(function () {
  return (this.totalBudget || 0) - (this.disbursedAmount || 0) - (this.committedAmount || 0);
});

budgetSchema.pre('save', function (next) {
  this.remainingBalance = this.totalBudget - this.disbursedAmount;
  next();
});

module.exports = mongoose.model('Budget', budgetSchema);
