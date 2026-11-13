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
];

const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: String,
    // Free text. DOCUMENT_CATEGORIES remains the suggested list the UI offers, but an office
    // filing something the list does not name should record what it is, not pick 'other'.
    category: { type: String, required: true, trim: true, maxlength: 60 },
    // The storage id (Cloudinary public_id). Named fileName for historical reasons.
    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    /*
     * Public delivery URL — set only for documents uploaded before October 2026, which were public
     * Cloudinary assets. Newer uploads are private (`storageType: 'cloudinary_private'`) and have no
     * URL at all: they are served only through GET /api/documents/:id/serve after an access check.
     */
    fileUrl: { type: String },
    fileType: { type: String, required: true },
    fileSize: { type: Number },
    storageType: { type: String, default: 'cloudinary' },
    resourceType: String,
    storageVersion: Number,
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality' },
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay' },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fiscalYear: Number,
    tags: [String],
    isPublic: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    archivedAt: Date,
    /*
     * Recycle bin. `deletedAt` was already a soft delete — the record survived, but the Cloudinary
     * asset was destroyed in the same breath, so there was nothing to restore it to and no way to
     * ask for it back. Deleting now keeps the file; destroying it is the separate, explicit act of
     * permanent deletion.
     */
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    version: { type: Number, default: 1 },
    /*
     * Superseded files. Replacing a document used to destroy the old file in the same call while
     * still listing it here, so every "download previous version" link led to a deleted asset. The
     * old file is now kept, and destroyed only when the document is permanently deleted.
     */
    previousVersions: [
      {
        version: Number,
        fileUrl: String,
        fileName: String,
        originalName: String,
        fileType: String,
        storageType: String,
        resourceType: String,
        storageVersion: Number,
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

/*
 * A document's file is reached through the authorised serve route, never through a stored URL, so
 * the URLs are left out of every response: a list of documents is not a list of download links.
 */
documentSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.fileUrl;
    if (Array.isArray(ret.previousVersions)) {
      ret.previousVersions = ret.previousVersions.map(({ fileUrl, storageType, resourceType, storageVersion, ...v }) => v);
    }
    return ret;
  },
});

documentSchema.index({ municipality: 1, isArchived: 1, deletedAt: 1 });
documentSchema.index({ barangay: 1, deletedAt: 1 });
documentSchema.index({ municipality: 1, category: 1, deletedAt: 1 });
documentSchema.index({ uploadedBy: 1 });
documentSchema.index({ deletedAt: 1 });
documentSchema.index({ title: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Document', documentSchema);
module.exports.DOCUMENT_CATEGORIES = DOCUMENT_CATEGORIES;
