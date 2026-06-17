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
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay' },
    totalBudget: { type: Number, required: true, min: 0 },
    allocations: [allocationSchema],
    approvedAmount: { type: Number, default: 0 },
    disbursedAmount: { type: Number, default: 0 },
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
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

budgetSchema.index({ municipality: 1, status: 1, deletedAt: 1 });
budgetSchema.index({ municipality: 1, fiscalYear: 1, deletedAt: 1 });
// Prevent duplicate budgets for the same municipality and fiscal year
budgetSchema.index(
  { municipality: 1, fiscalYear: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

// Auto-compute remaining balance
budgetSchema.pre('save', function (next) {
  this.remainingBalance = this.totalBudget - this.disbursedAmount;
  next();
});

module.exports = mongoose.model('Budget', budgetSchema);
