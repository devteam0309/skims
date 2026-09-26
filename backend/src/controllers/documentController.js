const asyncHandler = require('express-async-handler');
const { randomUUID } = require('crypto');
const Document = require('../models/Document');
const AuditLog = require('../models/AuditLog');
const { uploadToCloudinary, destroyQuietly, rawUploadOptions } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { normalizeLabel } = require('../utils/labels');
const { escapeRegex } = require('../utils/regex');
const { CROSS_MUNICIPALITY_READ, CROSS_MUNICIPALITY_WRITE } = require('../constants/roles');
const { applyReadScope, writeScopeViolation, readScopeViolation, idOf } = require('../utils/scope');

const MAX_LIMIT = 100;
const { pickCreatable, pickWritable, toMutation } = require('../utils/writeFields');

exports.getDocuments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, category, search, isArchived, isPublic } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  // Free text now — match the canonical form of what was typed, not the caller's spelling.
  if (category) filter.category = normalizeLabel(category);
  if (isArchived !== undefined) filter.isArchived = isArchived === 'true';
  if (isPublic !== undefined) filter.isPublic = isPublic === 'true';
  /*
   * A substring match, as on every other list. This was `$text`, which matches whole indexed
   * words only: "Resolut" or "Annual Bud" found nothing while "Resolution" worked — the same
   * defect the panel reported against the programmes search, left behind here when that was fixed.
   * `tags` is an array, and $regex matches if any element does.
   */
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ title: rx }, { description: rx }, { tags: rx }];
  }

  /*
   * The two role lists, as everywhere else. This was an inline `!== 'super_admin' && !==
   * 'provincial_admin'` pair, which is why the sweep that converted the rest missed it — and, more
   * importantly, why dilg_representative was excluded from the province-wide reads it is meant to
   * have. A DILG account saw an empty Documents page.
   *
   * `{ $in: [] }` is deliberate rather than decorative. Mongoose 8 happens to treat a filter value
   * of `undefined` as null, so the previous `filter.municipality = req.user.municipality` did fail
   * closed for an account with no municipality — but only by relying on that behaviour. Saying
   * "match nothing" outright does not depend on it, and matches the rule the rest of the codebase
   * states explicitly.
   */
  // Municipality and barangay from the account, via the shared helper.
  applyReadScope(filter, req.user, { requestedBarangay: req.query.barangay });

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [documents, total] = await Promise.all([
    Document.find(filter)
      .populate('municipality', 'name code')
      .populate('barangay', 'name')
      .populate('uploadedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .select('-downloadHistory'),
    Document.countDocuments(filter),
  ]);
  paginatedResponse(res, documents, safePage, safeLimit, total);
});

exports.getDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id)
    .populate('municipality', 'name')
    .populate('uploadedBy', 'firstName lastName');
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  // Re-asserted per record: a list that hides a foreign document is not the same as the API
  // refusing one requested directly by id.
  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role) && readScopeViolation(doc, req.user)) {
    return errorResponse(res, 403, 'Not authorized to view this document');
  }
  successResponse(res, 200, 'Document', doc);
});

exports.uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'No file uploaded');

  const ALLOWED_FIELDS = ['title', 'description', 'category', 'barangay', 'program', 'fiscalYear', 'isPublic'];
  // Blanks dropped — an unlinked programme or barangay posts '' and cannot be cast to an ObjectId.
  const body = pickCreatable(Document, req.body, ALLOWED_FIELDS);

  const isImage = req.file.mimetype.startsWith('image/');
  /*
   * Images keep the old shape — Cloudinary detects an image format and appends it to the delivery
   * URL itself. A raw file gets no such treatment, so the extension must ride on the public_id or
   * the download arrives as an extensionless octet-stream. See rawUploadOptions.
   */
  const result = await uploadToCloudinary(req.file.buffer, isImage
    ? { folder: 'skims/avatars', resource_type: 'image', public_id: randomUUID() }
    : rawUploadOptions(req.file.originalname));

  const doc = await Document.create({
    title: body.title || req.file.originalname,
    description: body.description,
    category: normalizeLabel(body.category),
    fileName: result.public_id,
    originalName: req.file.originalname,
    fileUrl: result.secure_url,
    fileType: req.file.mimetype,
    fileSize: req.file.size,
    municipality: req.user.municipality,
    barangay: body.barangay,
    program: body.program,
    uploadedBy: req.user._id,
    fiscalYear: body.fiscalYear,
    tags: body.tags ? (() => { try { return JSON.parse(body.tags); } catch { return []; } })() : [],
    isPublic: body.isPublic === 'true',
  });

  await AuditLog.create({ user: req.user._id, action: 'UPLOAD', resource: 'document', resourceId: doc._id, details: { title: doc.title, category: doc.category, fileSize: doc.fileSize }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 201, 'Document uploaded', doc);
});

exports.updateDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user)) return errorResponse(res, 403, 'Not authorized to update this document');

  const allowed = ['title', 'description', 'category', 'tags', 'isPublic', 'fiscalYear'];
  if (req.body.category) req.body.category = normalizeLabel(req.body.category);
  const updated = await Document.findByIdAndUpdate(
    req.params.id,
    toMutation(pickWritable(Document, req.body, allowed)),
    { new: true },
  );
  successResponse(res, 200, 'Document updated', updated);
});

exports.archiveDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user)) return errorResponse(res, 403, 'Not authorized to archive this document');
  const archived = await Document.findByIdAndUpdate(
    req.params.id,
    { isArchived: true, archivedAt: new Date(), archivedBy: req.user._id },
    { new: true }
  );
  await AuditLog.create({ user: req.user._id, action: 'ARCHIVE', resource: 'document', resourceId: doc._id, details: { title: doc.title }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Document archived', archived);
});

exports.trackDownload = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');

  // Non-public documents require authentication and municipality membership
  if (!doc.isPublic) {
    if (!req.user) return errorResponse(res, 401, 'Authentication required to access this document');
    if (!CROSS_MUNICIPALITY_READ.includes(req.user.role) && readScopeViolation(doc, req.user)) {
      return errorResponse(res, 403, 'Not authorized to access this document');
    }
  }

  await Document.findByIdAndUpdate(req.params.id, {
    $inc: { downloadCount: 1 },
    $push: { downloadHistory: { $each: [{ downloadedBy: req.user?._id, ipAddress: req.ip }], $slice: -100 } },
  });

  successResponse(res, 200, 'Download tracked', { fileUrl: doc.fileUrl });
});

exports.serveFile = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');

  if (!doc.isPublic) {
    if (!req.user) return errorResponse(res, 401, 'Authentication required to access this document');
    if (!CROSS_MUNICIPALITY_READ.includes(req.user.role) && readScopeViolation(doc, req.user)) {
      return errorResponse(res, 403, 'Not authorized to access this document');
    }
  }

  await Document.findByIdAndUpdate(req.params.id, {
    $inc: { downloadCount: 1 },
    $push: { downloadHistory: { $each: [{ downloadedBy: req.user?._id, ipAddress: req.ip }], $slice: -100 } },
  });

  const safeFilename = encodeURIComponent(doc.originalName || doc.fileName || 'document');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  /*
   * A document row can exist with no stored file — seeded demo records when Cloudinary was not
   * configured, and any future import that registers metadata ahead of the file. Redirecting to an
   * empty or missing URL sends the browser somewhere that does not resolve, which surfaces as
   * ERR_INVALID_RESPONSE and reads as a broken download rather than as a document with no file.
   */
  if (!doc.fileUrl) return errorResponse(res, 404, 'This document has no file attached');
  res.redirect(302, doc.fileUrl);
});

exports.unarchiveDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user)) return errorResponse(res, 403, 'Not authorized to restore this document');
  const restored = await Document.findByIdAndUpdate(
    req.params.id,
    { isArchived: false, archivedAt: null, archivedBy: null },
    { new: true }
  );
  await AuditLog.create({ user: req.user._id, action: 'UNARCHIVE', resource: 'document', resourceId: doc._id, details: { title: doc.title }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Document restored from archive', restored);
});

exports.replaceFile = asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'No replacement file uploaded');

  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user)) return errorResponse(res, 403, 'Not authorized to replace this document');

  const isImage = req.file.mimetype.startsWith('image/');
  /*
   * Images keep the old shape — Cloudinary detects an image format and appends it to the delivery
   * URL itself. A raw file gets no such treatment, so the extension must ride on the public_id or
   * the download arrives as an extensionless octet-stream. See rawUploadOptions.
   */
  const result = await uploadToCloudinary(req.file.buffer, isImage
    ? { folder: 'skims/avatars', resource_type: 'image', public_id: randomUUID() }
    : rawUploadOptions(req.file.originalname));

  const updated = await Document.findByIdAndUpdate(
    req.params.id,
    {
      $push: {
        previousVersions: {
          version: doc.version,
          fileUrl: doc.fileUrl,
          fileName: doc.fileName,
          uploadedAt: doc.updatedAt || doc.createdAt,
          uploadedBy: doc.uploadedBy,
        },
      },
      $set: {
        fileName: result.public_id,
        originalName: req.file.originalname,
        fileUrl: result.secure_url,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        version: doc.version + 1,
      },
    },
    { new: true }
  );

  if (doc.fileName) {
    const oldResourceType = doc.fileType?.startsWith('image/') ? 'image' : 'raw';
    destroyQuietly(doc.fileName, { resource_type: oldResourceType });
  }

  await AuditLog.create({
    user: req.user._id, action: 'UPDATE', resource: 'document', resourceId: doc._id,
    details: { title: doc.title, previousVersion: doc.version, newVersion: doc.version + 1 },
    municipality: req.user.municipality, ipAddress: req.ip,
  });
  successResponse(res, 200, 'Document file replaced', updated);
});

exports.serveVersion = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');

  if (!doc.isPublic) {
    if (!req.user) return errorResponse(res, 401, 'Authentication required to access this document');
    if (!CROSS_MUNICIPALITY_READ.includes(req.user.role) && readScopeViolation(doc, req.user)) {
      return errorResponse(res, 403, 'Not authorized to access this document');
    }
  }

  const versionNum = parseInt(req.params.version, 10);
  const pv = doc.previousVersions.find((v) => v.version === versionNum);
  if (!pv) return errorResponse(res, 404, 'Version not found');

  const safeFilename = encodeURIComponent(pv.fileName?.split('/').pop() || `version_${versionNum}`);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  if (!pv.fileUrl) return errorResponse(res, 404, 'That version has no file attached');
  res.redirect(302, pv.fileUrl);
});

exports.bulkArchiveDocuments = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse(res, 400, 'No document IDs provided');
  if (ids.length > 50) return errorResponse(res, 400, 'Cannot bulk archive more than 50 documents at once');
  const filter = { _id: { $in: ids }, isArchived: false, deletedAt: null };
  // Scoped with the same helper as the single-record route it batches — fails closed for an
  // account with no municipality rather than dropping the key from the filter.
  applyReadScope(filter, req.user);
  const toArchive = await Document.find(filter).select('_id title');
  if (toArchive.length === 0) {
    return errorResponse(res, 400, 'No eligible documents found. Documents may already be archived or outside your municipality.');
  }
  const archiveIds = toArchive.map((d) => d._id);
  await Document.updateMany(
    { _id: { $in: archiveIds } },
    { $set: { isArchived: true, archivedAt: new Date(), archivedBy: req.user._id } }
  );
  await AuditLog.create({
    user: req.user._id, action: 'BULK_ARCHIVE', resource: 'document',
    details: { archived: toArchive.length, requestedCount: ids.length },
    municipality: req.user.municipality, ipAddress: req.ip,
  });
  successResponse(res, 200, `${toArchive.length} document(s) archived`, {
    archived: toArchive.length,
    skipped: ids.length - toArchive.length,
  });
});

exports.deleteDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user)) return errorResponse(res, 403, 'Not authorized to delete this document');
  doc.deletedAt = new Date();
  doc.deletedBy = req.user._id;
  await doc.save();
  /*
   * The Cloudinary asset is deliberately NOT destroyed here.
   *
   * This used to soft-delete the record and destroy the file in the same call, which made the
   * surviving record worthless: restoring it would have produced a document whose every download
   * 404s. Deletion is now reversible, and the file is destroyed only by permanent deletion below.
   */
  await AuditLog.create({ user: req.user._id, action: 'DELETE', resource: 'document', resourceId: doc._id, details: { title: doc.title, category: doc.category, recoverable: true }, municipality: doc.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Document moved to the recycle bin');
});

/**
 * The recycle bin: documents with a `deletedAt`, which every other read excludes.
 *
 * Scoped exactly like the active list, so a deleted document is no more visible across a boundary
 * than a live one — and it is a separate endpoint rather than a flag on `getDocuments`, so a
 * deleted document can never appear in an ordinary listing by accident.
 */
exports.getDeletedDocuments = asyncHandler(async (req, res) => {
  const filter = { deletedAt: { $ne: null } };
  if (req.query.search) {
    const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
    filter.$or = [{ title: rx }, { description: rx }, { tags: rx }];
  }
  applyReadScope(filter, req.user);

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [documents, total] = await Promise.all([
    Document.find(filter)
      .populate('municipality', 'name code')
      .populate('barangay', 'name')
      .populate('uploadedBy', 'firstName lastName')
      .populate('deletedBy', 'firstName lastName')
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .select('-downloadHistory'),
    Document.countDocuments(filter),
  ]);
  paginatedResponse(res, documents, safePage, safeLimit, total);
});

/** Back out of the recycle bin. The file was never destroyed, so the document returns intact. */
exports.restoreDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) return errorResponse(res, 404, 'Document not found');
  if (!doc.deletedAt) return errorResponse(res, 400, 'This document is not in the recycle bin');
  if (writeScopeViolation(doc, req.user)) return errorResponse(res, 403, 'Not authorized to restore this document');

  doc.deletedAt = null;
  doc.deletedBy = undefined;
  await doc.save();

  await AuditLog.create({ user: req.user._id, action: 'RESTORE', resource: 'document', resourceId: doc._id, details: { title: doc.title, category: doc.category }, municipality: doc.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Document restored', doc);
});

/**
 * Permanent deletion: destroys the stored file and the record together.
 *
 * Only reachable for a document already in the recycle bin, so nothing can be destroyed in a single
 * step — the two-stage path is the point. ADMINS only, and audited before the record disappears,
 * because afterwards the audit entry is the only remaining trace that the document ever existed.
 */
exports.permanentlyDeleteDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) return errorResponse(res, 404, 'Document not found');
  if (!doc.deletedAt) {
    return errorResponse(res, 400, 'Move the document to the recycle bin before deleting it permanently');
  }
  if (writeScopeViolation(doc, req.user)) return errorResponse(res, 403, 'Not authorized to delete this document');

  await AuditLog.create({
    user: req.user._id, action: 'PERMANENT_DELETE', resource: 'document', resourceId: doc._id,
    oldValues: { title: doc.title, category: doc.category, originalName: doc.originalName, fileName: doc.fileName },
    details: { title: doc.title, category: doc.category, irreversible: true },
    municipality: doc.municipality, ipAddress: req.ip,
  });

  // Now the file goes, along with every stored version of it.
  const destroy = (fileName, fileType) => {
    if (!fileName) return;
    destroyQuietly(fileName, { resource_type: fileType?.startsWith('image/') ? 'image' : 'raw' });
  };
  destroy(doc.fileName, doc.fileType);
  // Superseded files are stored separately and would otherwise be orphaned in Cloudinary for ever.
  (doc.previousVersions || []).forEach((v) => destroy(v.fileName, doc.fileType));

  await Document.deleteOne({ _id: doc._id });
  successResponse(res, 200, 'Document permanently deleted');
});

exports.getDocumentStats = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };
  /*
   * This had no role scoping at all: it took `?municipality` when given and otherwise counted the
   * whole province, so any authenticated account could read every municipality's category counts
   * and the five most recent documents anywhere — with uploader names attached. The list handler
   * twenty lines above scopes correctly; this one was simply never given the same treatment.
   */
  if (CROSS_MUNICIPALITY_READ.includes(req.user?.role) && req.query.municipality) {
    filter.municipality = req.query.municipality;
  }
  applyReadScope(filter, req.user, { requestedBarangay: req.query.barangay });

  const byCategory = await Document.aggregate([
    { $match: filter },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const recent = await Document.find(filter)
    .populate('uploadedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(5);

  successResponse(res, 200, 'Document stats', { byCategory, recent });
});
