const mongoose = require('mongoose');

const PROGRAM_STATUSES = ['planned', 'ongoing', 'delayed', 'completed', 'cancelled'];
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
    category: { type: String, enum: PROGRAM_CATEGORIES, required: true },
    status: { type: String, enum: PROGRAM_STATUSES, default: 'planned' },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality', required: true },
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay' },
    budget: { type: Number, required: true, min: 0 },
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
