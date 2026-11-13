const mongoose = require('mongoose');
const Counter = require('./Counter');
const { attachmentSchema } = require('./schemas/attachment');

const liquidationSchema = new mongoose.Schema(
  {
    referenceNumber: { type: String, unique: true },
    title: { type: String, required: true },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true },
    budget: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget' },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality', required: true },
    /*
     * The barangay whose spending this report accounts for. A barangay treasurer's report is filed
     * under their own barangay whatever the request says, and only that barangay's officers — and
     * the municipality's reviewers — can read it. Reports written before October 2026 have none and
     * stay with the officer who submitted them (see utils/scope.js `ownerField`).
     */
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay', default: null },
    expenses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Expense' }],
    totalAmount: { type: Number, required: true, min: 0 },
    liquidatedAmount: {
      type: Number,
      default: 0,
      validate: {
        validator: function (v) { return v <= this.totalAmount; },
        message: 'Liquidated amount cannot exceed total amount',
      },
    },
    variance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'returned'],
      default: 'draft',
    },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    dueDate: Date,
    remarks: String,
    /*
     * submitted ──approve──▶ approved
     *     ├──return──▶ returned ──(add proof, resubmit)──▶ submitted
     *     └──reject──▶ rejected   (final)
     * Each decision records who made it, when, and the reviewer's remarks.
     */
    rejectionReason: String,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    returnReason: String,
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnedAt: Date,
    /*
     * Proof uploaded with the report — official receipts, sales invoices, acknowledgment receipts,
     * disbursement vouchers. Together with `supportingDocuments` below, a report cannot be created or
     * submitted without at least one piece of evidence.
     *
     * Legacy entries kept the document type in a field named `type`; it is read back as
     * `documentType` by the controller. Declared on the shared schema so both generations coexist.
     */
    documents: [attachmentSchema],
    /*
     * Supporting documents that already live in Document Management, linked rather than re-uploaded.
     *
     * The embedded array above holds a filename and a URL and nothing else: it cannot say which
     * registered document an attachment IS, so a reviewer cannot tell whether the receipt attached
     * here is the same one filed against the expense. A ref carries the document's own category,
     * municipality, version history and access rules with it, and one document can back several
     * reports without being uploaded twice.
     *
     * This completes Expense → Supporting Document → Liquidation: the expenses are already linked
     * on this model, and their paperwork now has a place to be named. The embedded array is
     * untouched — every existing liquidation stores its attachments there.
     */
    supportingDocuments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

liquidationSchema.index({ municipality: 1, status: 1, deletedAt: 1 });
liquidationSchema.index({ barangay: 1, status: 1, deletedAt: 1 });
liquidationSchema.index({ program: 1 });
liquidationSchema.index({ deletedAt: 1 });

// Auto-generate reference number using atomic counter to prevent race conditions
liquidationSchema.pre('save', async function (next) {
  if (!this.referenceNumber) {
    const year = new Date().getFullYear();
    const seq = await Counter.nextSeq(`liquidation-${year}`);
    this.referenceNumber = `LIQ-${year}-${String(seq).padStart(5, '0')}`;
  }
  this.variance = this.totalAmount - this.liquidatedAmount;
  next();
});

module.exports = mongoose.model('Liquidation', liquidationSchema);
