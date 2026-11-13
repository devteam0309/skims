const mongoose = require('mongoose');

/**
 * A supporting file attached to a financial record — the receipt, invoice or voucher behind an
 * expense or a liquidation report.
 *
 * Two generations live in the same array:
 *
 *   - **legacy** entries, from before attachments were private: `fileName` holds the ORIGINAL file
 *     name and `fileUrl` a public Cloudinary URL. They are still served by redirect.
 *   - **current** entries: stored privately through services/fileStorage.js, identified by
 *     `publicId`/`storageType`, and served only through an authorised API route.
 *
 * `documentType` is free text (normalised with utils/labels.js) because the panel's list — official
 * receipt, sales invoice, acknowledgment receipt, disbursement voucher — ends with "other relevant
 * documents", and the office's own word for the paper is the only record of what it is.
 *
 * The storage internals are stripped from JSON responses; a client sees what a file is, never where
 * it lives.
 */
const attachmentSchema = new mongoose.Schema({
  documentType: { type: String, trim: true, maxlength: 60 },
  // Legacy liquidation entries stored the document type under this name. Read-only in practice:
  // new entries use `documentType`, and the JSON transform folds the two together.
  type: { type: String, trim: true, maxlength: 60 },
  fileName: String,
  fileUrl: String,
  fileType: String,
  originalName: String,
  fileSize: Number,
  storageType: String,
  publicId: String,
  resourceType: String,
  version: Number,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
});

attachmentSchema.set('toJSON', {
  transform: (doc, ret) => {
    // A display name for both generations: legacy entries kept the original name in `fileName`.
    ret.originalName = ret.originalName || ret.fileName;
    ret.documentType = ret.documentType || ret.type;
    delete ret.type;
    delete ret.fileUrl;
    delete ret.publicId;
    delete ret.storageType;
    delete ret.resourceType;
    delete ret.version;
    return ret;
  },
});

/**
 * The storage reference services/fileStorage.js needs to serve or remove an attachment.
 *
 * For a legacy entry the public id is not stored at all — only the delivery URL — so it is read back
 * out of the URL: `…/raw/upload/v1712345/skims/documents/<uuid>.pdf` → `skims/documents/<uuid>.pdf`.
 * Images drop their extension, which Cloudinary appends itself.
 */
const storageRefOf = (att) => {
  if (!att) return null;
  if (att.publicId) return att;
  const url = att.fileUrl || '';
  const tail = url.split('/upload/')[1];
  let publicId = tail ? tail.replace(/^v\d+\//, '') : null;
  const resourceType = url.includes('/image/') || (att.fileType || '').startsWith('image/') ? 'image' : 'raw';
  if (publicId && resourceType === 'image') publicId = publicId.replace(/\.[^./]+$/, '');
  return {
    storageType: 'cloudinary',
    publicId,
    resourceType,
    fileUrl: att.fileUrl,
    fileType: att.fileType,
    originalName: att.originalName || att.fileName,
  };
};

module.exports = { attachmentSchema, storageRefOf };
