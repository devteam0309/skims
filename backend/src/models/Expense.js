const mongoose = require('mongoose');
const Counter = require('./Counter');

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
     * draft ──submit──▶ pending ──approve──▶ approved ──▶ liquidated
     *                      └─────reject────▶ rejected ──(edit, resubmit)──▶ pending
     *
     * `pending` means "submitted, awaiting the administrator's review" and remains the DEFAULT, so
     * every record written before this workflow existed keeps its meaning and no migration is
     * required. `draft` is opt-in at creation, for a treasurer assembling a record before sending
     * it up; it mirrors the draft/submitted pair budgets and liquidations already use.
     *
     * The officer who creates an expense never approves it — see constants/roles.js.
     */
    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected', 'liquidated'],
      default: 'pending',
    },
    submittedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    // A rejection has to say why, and by whom: an expense returned with no reason leaves the
    // treasurer guessing at what to change, and the audit trail unable to show who decided.
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectionReason: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    attachments: [{ fileName: String, fileUrl: String, fileType: String }],
    isLiquidated: { type: Boolean, default: false },
    liquidationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Liquidation' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

expenseSchema.index({ municipality: 1, status: 1, deletedAt: 1 });
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
