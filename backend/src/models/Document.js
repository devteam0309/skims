const mongoose = require('mongoose');

const DOCUMENT_CATEGORIES = [
  'resolution',
  'purchase_request',
  'purchase_order',
  'liquidation_report',
  'abyip',
  'cbydp',
  'annual_budget',
  'attendance',
  'compliance_report',
  'dilg_report',
  'minutes',
  'ordinance',
  'certificate',
  'other',
];

const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: String,
    category: { type: String, enum: DOCUMENT_CATEGORIES, required: true },
    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality' },
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay' },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fiscalYear: Number,
    tags: [String],
    isPublic: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    archivedAt: Date,
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    version: { type: Number, default: 1 },
    previousVersions: [
      {
        version: Number,
        fileUrl: String,
        fileName: String,
        uploadedAt: Date,
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    downloadCount: { type: Number, default: 0 },
    downloadHistory: [
      {
        downloadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        downloadedAt: { type: Date, default: Date.now },
        ipAddress: String,
      },
    ],
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

documentSchema.index({ municipality: 1, isArchived: 1, deletedAt: 1 });
documentSchema.index({ municipality: 1, category: 1, deletedAt: 1 });
documentSchema.index({ uploadedBy: 1 });
documentSchema.index({ deletedAt: 1 });
documentSchema.index({ title: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Document', documentSchema);
module.exports.DOCUMENT_CATEGORIES = DOCUMENT_CATEGORIES;
