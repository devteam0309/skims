const mongoose = require('mongoose');
const Counter = require('./Counter');

const liquidationSchema = new mongoose.Schema(
  {
    referenceNumber: { type: String, unique: true },
    title: { type: String, required: true },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true },
    budget: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget' },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality', required: true },
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
    rejectionReason: String,
    documents: [
      {
        type: {
          type: String,
          enum: [
            'purchase_request',
            'purchase_order',
            'delivery_receipt',
            'inspection_report',
            'sales_invoice',
            'disbursement_voucher',
            'official_receipt',
            'other',
          ],
        },
        fileName: String,
        fileUrl: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

liquidationSchema.index({ municipality: 1, status: 1, deletedAt: 1 });
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
