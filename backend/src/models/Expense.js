const mongoose = require('mongoose');
const Counter = require('./Counter');
const { attachmentSchema } = require('./schemas/attachment');

const EXPENSE_TYPES = [
  'purchase_request',
  'purchase_order',
  'delivery_receipt',
  'inspection_acceptance_report',
  'sales_invoice',
  'disbursement_voucher',
  'official_receipt',
];

const expenseSchema = new mongoose.Schema(
  {
    referenceNumber: { type: String, unique: true },
    type: { type: String, enum: EXPENSE_TYPES, required: true },
    title: { type: String, required: true },
    description: String,
    amount: { type: Number, required: true, min: 0 },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
    budget: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget' },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality', required: true },
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay' },
    vendor: {
      name: String,
      address: String,
      tin: String,
    },
    transactionDate: { type: Date, required: true },
    /*
     * draft ──submit──▶ pending ──approve──▶ approved ──(liquidation approved)──▶ liquidated
     *                      ├──return──▶ returned ──(correct, add proof, resubmit)──▶ pending
     *                      └──reject──▶ rejected   (final)
     *
     * `pending` means "submitted, awaiting the administrator's review" and remains the DEFAULT, so
     * every record written before this workflow existed keeps its meaning. `draft` is opt-in at
     * creation, for a treasurer assembling a record before sending it up.
     *
     * `returned` and `rejected` are different decisions. Returning sends the expense back for
     * correction or further proof and it can be resubmitted; rejecting refuses it outright. Until
     * October 2026 there was only `rejected`, used to mean "returned" — the live database held no
     * rejected expense when the two were split, so nothing needed converting.
     *
     * Only approval moves money: the budget is deducted once, in the same transaction that claims
     * the `pending → approved` transition, so a review repeated or resubmitted cannot deduct twice.
     *
     * The officer who creates an expense never approves it — see constants/roles.js.
     */
    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'returned', 'rejected', 'liquidated'],
      default: 'pending',
    },
    submittedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    // A rejection has to say why, and by whom: an expense refused with no reason leaves the
    // treasurer guessing, and the audit trail unable to show who decided.
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectionReason: String,
    // The same for a return: what has to change before it comes back.
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnedAt: Date,
    returnReason: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /*
     * Proof of the expenditure. An expense cannot be submitted for review, or approved, without at
     * least one — the panel's rule is that nothing is "fully documented or approved" on the
     * treasurer's word alone.
     */
    attachments: [attachmentSchema],
    /*
     * Set when the approval deducts money: which budget was charged, and how much programme
     * commitment the approval released. Reversing an approval reads both to refund exactly what was
     * taken — so a reversed and re-approved expense is deducted once, never twice.
     */
    chargedBudget: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget', default: null },
    commitmentReleased: { type: Number, default: 0 },
    isLiquidated: { type: Boolean, default: false },
    liquidationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Liquidation' },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

expenseSchema.index({ municipality: 1, status: 1, deletedAt: 1 });
expenseSchema.index({ barangay: 1, status: 1, deletedAt: 1 });
expenseSchema.index({ budget: 1, status: 1 });
expenseSchema.index({ municipality: 1, transactionDate: -1, deletedAt: 1 });
expenseSchema.index({ program: 1 });
expenseSchema.index({ type: 1 });
expenseSchema.index({ deletedAt: 1 });

// Auto-generate reference number using atomic counter to prevent race conditions
expenseSchema.pre('save', async function (next) {
  if (!this.referenceNumber) {
    const year = new Date().getFullYear();
    const seq = await Counter.nextSeq(`expense-${year}`);
    this.referenceNumber = `EXP-${year}-${String(seq).padStart(5, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Expense', expenseSchema);
module.exports.EXPENSE_TYPES = EXPENSE_TYPES;
