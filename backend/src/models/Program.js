const mongoose = require('mongoose');

const PROGRAM_STATUSES = ['planned', 'ongoing', 'delayed', 'completed', 'cancelled'];

// Approval is tracked separately from `status` on purpose. The two answer different questions —
// "has this been cleared to run?" and "how far along is it?" — and the panel's own wording,
// "approved and implemented", describes a program that is simultaneously approved and ongoing.
// One overloaded field cannot hold both, and folding these into PROGRAM_STATUSES would also
// silently reclassify every existing program and break the status filters and stat bar.
const PROGRAM_APPROVAL_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];
const PROGRAM_CATEGORIES = [
  'education',
  'health',
  'livelihood',
  'sports',
  'environment',
  'peace_and_order',
  'governance',
  'social_services',
  'culture_and_arts',
  'infrastructure',
  'other',
];

const milestoneSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  targetDate: Date,
  completedAt: Date,
  status: { type: String, enum: ['pending', 'completed', 'delayed'], default: 'pending' },
  completionRate: { type: Number, default: 0, min: 0, max: 100 },
  notes: String,
});

const programSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true },
    objectives: [{ type: String }],
    // Not an enum. PROGRAM_CATEGORIES is the suggested list the UI offers, but a municipality
    // running something genuinely outside it may type its own rather than be pushed into 'other',
    // which erased the distinction between every unusual program.
    category: { type: String, required: true, trim: true, maxlength: 60 },
    status: { type: String, enum: PROGRAM_STATUSES, default: 'planned' },
    approvalStatus: { type: String, enum: PROGRAM_APPROVAL_STATUSES, default: 'draft' },
    submittedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectionReason: String,
    // Set when an approval encumbers a budget, so a later rejection or deletion releases exactly
    // what was committed even if program.budget has been edited since.
    committedAmount: { type: Number, default: 0 },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality', required: true },
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay' },
    // Optional by design: a program may be planned and submitted for approval before any budget
    // exists for it. Requiring an amount here blocked exactly that.
    budget: { type: Number, default: 0, min: 0 },
    budgetRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget', default: null },
    actualExpenses: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    targetParticipants: { type: Number, default: 0 },
    actualParticipants: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedOfficers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    milestones: [milestoneSchema],
    attachments: [
      {
        fileName: String,
        fileUrl: String,
        fileType: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    completionRate: { type: Number, default: 0, min: 0, max: 100 },
    accomplishmentReport: { type: String },
    isPublic: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    tags: [String],
    location: {
      lat: Number,
      lng: Number,
      address: String,
    },
  },
  { timestamps: true }
);

programSchema.index({ municipality: 1, status: 1, deletedAt: 1 });
programSchema.index({ municipality: 1, category: 1, deletedAt: 1 });
programSchema.index({ startDate: 1, endDate: 1 });
programSchema.index({ deletedAt: 1 });
programSchema.index({ title: 'text', description: 'text' });

// Auto-compute completion rate
programSchema.pre('save', function (next) {
  if (this.milestones && this.milestones.length > 0) {
    const completed = this.milestones.filter((m) => m.status === 'completed').length;
    this.completionRate = Math.round((completed / this.milestones.length) * 100);
  }
  next();
});

module.exports = mongoose.model('Program', programSchema);
module.exports.PROGRAM_STATUSES = PROGRAM_STATUSES;
module.exports.PROGRAM_CATEGORIES = PROGRAM_CATEGORIES;
module.exports.PROGRAM_APPROVAL_STATUSES = PROGRAM_APPROVAL_STATUSES;
