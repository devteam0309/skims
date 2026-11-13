const asyncHandler = require('express-async-handler');
const Document = require('../models/Document');
const Program = require('../models/Program');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { normalizeLabel } = require('../utils/labels');
const { escapeRegex } = require('../utils/regex');
const { CROSS_MUNICIPALITY_READ, ADMINS, DOC_EDITORS } = require('../constants/roles');
const {
  applyReadScope, writeScopeViolation, readScopeViolation, createScopeViolation, forceScopeOnCreate, idOf, objectIdOf,
} = require('../utils/scope');
const { checkBarangay, barangayErrorMessage } = require('../utils/barangay');
const { storeFile, removeFile, sendFile } = require('../services/fileStorage');

const MAX_LIMIT = 100;
const { pickCreatable, pickWritable, toMutation } = require('../utils/writeFields');

/*
 * The shared barangay repository.
 *
 * Documents an SK officer uploads are filed under the officer's own barangay — the treasurer's
 * financial papers and the chairperson's resolutions land in the same place, so all three officers
 * of a barangay read one repository rather than three. An officer can never file into, read, or
 * change another barangay's documents.
 *
 * Uploads used to take the barangay from the request (and nothing checked it), and an officer who
 * left it blank produced a municipality-level document every other barangay could read. Both are
 * closed: the barangay now comes from the account.
 *
 * Writes are STRICT (utils/scope.js): an officer changes their own barangay's documents, and a
 * municipality-level one only if they uploaded it themselves. Municipality-level documents — the
 * municipal office's circulars — remain readable to every barangay.
 */
const DOC_WRITE_SCOPE = { strict: true, ownerField: 'uploadedBy' };

/**
 * Whether the caller may move a document to the recycle bin or back. Editors (chairperson,
 * secretary, administrators) may for any document in their scope; an uploader who is not an
 * editor — the treasurer — only for documents they uploaded themselves.
 */
const binDenial = (doc, user) => {
  if (writeScopeViolation(doc, user, DOC_WRITE_SCOPE)) return 'This document belongs to another barangay or municipality';
  if (!DOC_EDITORS.includes(user.role) && idOf(doc.uploadedBy) !== idOf(user._id)) {
    return 'You can only remove documents you uploaded yourself';
  }
  return null;
};

/** The current file of a document, as a storage reference. */
const currentFile = (doc) => ({
  storageType: doc.storageType,
  publicId: doc.fileName,
  resourceType: doc.resourceType,
  version: doc.storageVersion,
  fileUrl: doc.fileUrl,
  fileType: doc.fileType,
  originalName: doc.originalName,
});

/** A superseded version, as a storage reference. Versions saved before October 2026 lack most fields. */
const versionFile = (doc, v) => ({
  storageType: v.storageType || 'cloudinary',
  publicId: v.fileName,
  resourceType: v.resourceType || (doc.fileType?.startsWith('image/') ? 'image' : 'raw'),
  version: v.storageVersion,
  fileUrl: v.fileUrl,
  fileType: v.fileType || doc.fileType,
  originalName: v.originalName || v.fileName?.split('/').pop() || `version_${v.version}`,
});

exports.getDocuments = asyncHandler(async (req, res) => {
  const { municipality, category, search, isArchived, isPublic } = req.query;
  const filter = { deletedAt: null };
  if (municipality && CROSS_MUNICIPALITY_READ.includes(req.user.role)) filter.municipality = municipality;
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

  // Municipality and barangay from the account, via the shared helper. `{ $in: [] }` — match
  // nothing — for an account with no municipality, never a dropped key.
  applyReadScope(filter, req.user, { requestedBarangay: req.query.barangay });

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [documents, total] = await Promise.all([
    Document.find(filter)
      .populate('municipality', 'name code')
      .populate('barangay', 'name')
      .populate('uploadedBy', 'firstName lastName role')
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
    .populate('barangay', 'name')
    .populate('uploadedBy', 'firstName lastName role');
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  // Re-asserted per record: a list that hides a foreign document is not the same as the API
  // refusing one requested directly by id.
  if (readScopeViolation(doc, req.user)) return errorResponse(res, 403, 'Not authorized to view this document');
  successResponse(res, 200, 'Document', doc);
});

exports.uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'No file uploaded');

  const ALLOWED_FIELDS = ['title', 'description', 'category', 'barangay', 'program', 'fiscalYear', 'isPublic', 'tags'];
  // Blanks dropped — an unlinked programme or barangay posts '' and cannot be cast to an ObjectId.
  const body = pickCreatable(Document, req.body, ALLOWED_FIELDS);

  // Filed under the uploader's barangay, whatever the form says; naming another one is refused.
  const tamper = createScopeViolation(req.body, req.user);
  if (tamper) return errorResponse(res, 403, tamper.replace('records', 'documents'));
  const scope = forceScopeOnCreate({ barangay: body.barangay }, req.user);
  if (scope.barangay && scope.municipality) {
    const check = await checkBarangay(scope.barangay, idOf(scope.municipality));
    if (check !== 'ok') return errorResponse(res, 400, barangayErrorMessage(check));
  }

  // A linked programme must be one the uploader could edit — otherwise the link is a way to attach
  // a document to another barangay's programme.
  if (body.program) {
    const program = await Program.findOne({ _id: body.program, deletedAt: null }).select('municipality barangay createdBy');
    if (!program) return errorResponse(res, 404, 'Program not found');
    if (writeScopeViolation(program, req.user, { strict: true, ownerField: 'createdBy' })) {
      return errorResponse(res, 403, 'That program belongs to another barangay or municipality');
    }
  }

  const stored = await storeFile(req.file, { folder: 'skims/documents' });

  let tags = [];
  if (body.tags) {
    try { tags = [].concat(JSON.parse(body.tags)); } catch { tags = String(body.tags).split(',').map((t) => t.trim()).filter(Boolean); }
  }

  let doc;
  try {
    doc = await Document.create({
      title: body.title || req.file.originalname,
      description: body.description,
      category: normalizeLabel(body.category),
      fileName: stored.publicId,
      originalName: stored.originalName,
      fileType: stored.fileType,
      fileSize: stored.fileSize,
      storageType: stored.storageType,
      resourceType: stored.resourceType,
      storageVersion: stored.version,
      municipality: scope.municipality || undefined,
      barangay: scope.barangay || undefined,
      program: body.program,
      uploadedBy: req.user._id,
      fiscalYear: body.fiscalYear,
      tags,
      isPublic: body.isPublic === true || body.isPublic === 'true',
    });
  } catch (err) {
    removeFile(stored);
    throw err;
  }

  await AuditLog.create({
    user: req.user._id, action: 'UPLOAD', resource: 'document', resourceId: doc._id,
    details: { title: doc.title, category: doc.category, fileSize: doc.fileSize, barangay: doc.barangay || null },
    municipality: doc.municipality || req.user.municipality, ipAddress: req.ip,
  });
  successResponse(res, 201, 'Document uploaded', doc);
});

exports.updateDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user, DOC_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to update this document');

  const allowed = ['title', 'description', 'category', 'tags', 'isPublic', 'fiscalYear'];
  if (req.body.category) req.body.category = normalizeLabel(req.body.category);
  const updated = await Document.findByIdAndUpdate(
    req.params.id,
    toMutation(pickWritable(Document, req.body, allowed)),
    { new: true },
  );
  await AuditLog.create({
    user: req.user._id, action: 'UPDATE', resource: 'document', resourceId: doc._id,
    details: { title: updated.title, changes: Object.keys(req.body).filter((k) => allowed.includes(k)) },
    municipality: doc.municipality, ipAddress: req.ip,
  });
  successResponse(res, 200, 'Document updated', updated);
});

exports.archiveDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user, DOC_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to archive this document');
  const archived = await Document.findByIdAndUpdate(
    req.params.id,
    { isArchived: true, archivedAt: new Date(), archivedBy: req.user._id },
    { new: true }
  );
  await AuditLog.create({ user: req.user._id, action: 'ARCHIVE', resource: 'document', resourceId: doc._id, details: { title: doc.title }, municipality: doc.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Document archived', archived);
});

/** The access check every file route shares: public documents for anyone, the rest by scope. */
const fileAccessDenial = (doc, user) => {
  if (doc.isPublic) return null;
  if (!user) return { status: 401, message: 'Authentication required to access this document' };
  if (readScopeViolation(doc, user)) return { status: 403, message: 'Not authorized to access this document' };
  return null;
};

const recordDownload = (doc, req) => Document.findByIdAndUpdate(doc._id, {
  $inc: { downloadCount: 1 },
  $push: { downloadHistory: { $each: [{ downloadedBy: req.user?._id, ipAddress: req.ip }], $slice: -100 } },
});

/**
 * Count a download. It used to answer with the document's storage URL, which handed out a link that
 * worked for anyone, signed in or not, for as long as the file existed. The file itself comes from
 * GET /:id/serve, behind the same access check.
 */
exports.trackDownload = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  const denied = fileAccessDenial(doc, req.user);
  if (denied) return errorResponse(res, denied.status, denied.message);
  await recordDownload(doc, req);
  successResponse(res, 200, 'Download tracked');
});

/**
 * The document's file. `?inline=1` asks for a preview (honoured for PDFs and images); anything else
 * downloads. Previews are not counted as downloads.
 */
exports.serveFile = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  const denied = fileAccessDenial(doc, req.user);
  if (denied) return errorResponse(res, denied.status, denied.message);

  /*
   * A document row can exist with no stored file — seeded demo records when Cloudinary was not
   * configured, and any future import that registers metadata ahead of the file. Redirecting to an
   * empty or missing URL sends the browser somewhere that does not resolve, which surfaces as
   * ERR_INVALID_RESPONSE and reads as a broken download rather than as a document with no file.
   */
  if ((doc.storageType || 'cloudinary') === 'cloudinary' && !doc.fileUrl) {
    return errorResponse(res, 404, 'This document has no file attached');
  }

  const inline = req.query.inline === '1' || req.query.inline === 'true';
  if (!inline) await recordDownload(doc, req);
  return sendFile(res, currentFile(doc), { disposition: inline ? 'inline' : 'attachment' });
});

exports.unarchiveDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user, DOC_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to restore this document');
  const restored = await Document.findByIdAndUpdate(
    req.params.id,
    { isArchived: false, archivedAt: null, archivedBy: null },
    { new: true }
  );
  await AuditLog.create({ user: req.user._id, action: 'UNARCHIVE', resource: 'document', resourceId: doc._id, details: { title: doc.title }, municipality: doc.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Document restored from archive', restored);
});

/**
 * Upload a new file for an existing document. The previous file is KEPT and listed in the version
 * history: it used to be destroyed in the same call, which left every "previous version" link
 * pointing at a file that no longer existed. It goes only when the document is permanently deleted.
 */
exports.replaceFile = asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'No replacement file uploaded');

  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (writeScopeViolation(doc, req.user, DOC_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to replace this document');

  const stored = await storeFile(req.file, { folder: 'skims/documents' });

  const updated = await Document.findByIdAndUpdate(
    req.params.id,
    {
      $push: {
        previousVersions: {
          version: doc.version,
          fileUrl: doc.fileUrl,
          fileName: doc.fileName,
          originalName: doc.originalName,
          fileType: doc.fileType,
          storageType: doc.storageType || 'cloudinary',
          resourceType: doc.resourceType,
          storageVersion: doc.storageVersion,
          uploadedAt: doc.updatedAt || doc.createdAt,
          uploadedBy: doc.uploadedBy,
        },
      },
      $set: {
        fileName: stored.publicId,
        originalName: stored.originalName,
        fileType: stored.fileType,
        fileSize: stored.fileSize,
        storageType: stored.storageType,
        resourceType: stored.resourceType,
        storageVersion: stored.version,
        version: doc.version + 1,
      },
      $unset: { fileUrl: '' },
    },
    { new: true }
  );

  await AuditLog.create({
    user: req.user._id, action: 'UPDATE', resource: 'document', resourceId: doc._id,
    details: { title: doc.title, previousVersion: doc.version, newVersion: doc.version + 1 },
    municipality: doc.municipality, ipAddress: req.ip,
  });
  successResponse(res, 200, 'Document file replaced', updated);
});

exports.serveVersion = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  const denied = fileAccessDenial(doc, req.user);
  if (denied) return errorResponse(res, denied.status, denied.message);

  const versionNum = parseInt(req.params.version, 10);
  const pv = doc.previousVersions.find((v) => v.version === versionNum);
  if (!pv) return errorResponse(res, 404, 'Version not found');

  const ref = versionFile(doc, pv);
  if (ref.storageType === 'cloudinary' && !pv.fileUrl) return errorResponse(res, 404, 'That version has no file attached');
  return sendFile(res, ref, { disposition: 'attachment' });
});

exports.bulkArchiveDocuments = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse(res, 400, 'No document IDs provided');
  if (ids.length > 50) return errorResponse(res, 400, 'Cannot bulk archive more than 50 documents at once');
  const filter = { _id: { $in: ids }, isArchived: false, deletedAt: null };
  // Scoped like the single-record route it batches — strict, so a bound officer archives only their
  // own barangay's documents — and closed for an account with no municipality.
  applyReadScope(filter, req.user, DOC_WRITE_SCOPE);
  const toArchive = await Document.find(filter).select('_id title');
  if (toArchive.length === 0) {
    return errorResponse(res, 400, 'No eligible documents found. Documents may already be archived or outside your barangay.');
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
  const denied = binDenial(doc, req.user);
  if (denied) return errorResponse(res, 403, denied);
  doc.deletedAt = new Date();
  doc.deletedBy = req.user._id;
  await doc.save();
  /*
   * The stored file is deliberately NOT destroyed here.
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
 * Open to everyone who can upload, scoped STRICTLY: an SK officer sees their own barangay's deleted
 * documents (and municipality-level ones they uploaded themselves), nothing else. It is a separate
 * endpoint rather than a flag on `getDocuments`, so a deleted document can never appear in an
 * ordinary listing by accident.
 */
exports.getDeletedDocuments = asyncHandler(async (req, res) => {
  const filter = { deletedAt: { $ne: null } };
  if (req.query.search) {
    const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
    filter.$or = [{ title: rx }, { description: rx }, { tags: rx }];
  }
  applyReadScope(filter, req.user, { ...DOC_WRITE_SCOPE, requestedBarangay: req.query.barangay });

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
  const canPurge = ADMINS.includes(req.user.role);
  paginatedResponse(res, documents.map((d) => ({
    ...d.toJSON(),
    canRestore: !binDenial(d, req.user),
    canPermanentlyDelete: canPurge && !writeScopeViolation(d, req.user, DOC_WRITE_SCOPE),
  })), safePage, safeLimit, total);
});

/**
 * Back out of the recycle bin. The file was never destroyed, so the document returns intact — to
 * the same barangay, with its uploader, category, versions and download history untouched.
 */
exports.restoreDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) return errorResponse(res, 404, 'Document not found');
  if (!doc.deletedAt) return errorResponse(res, 400, 'This document is not in the recycle bin');
  const denied = binDenial(doc, req.user);
  if (denied) return errorResponse(res, 403, denied);

  doc.deletedAt = null;
  doc.deletedBy = undefined;
  await doc.save();

  await AuditLog.create({ user: req.user._id, action: 'RESTORE', resource: 'document', resourceId: doc._id, details: { title: doc.title, category: doc.category, barangay: doc.barangay || null }, municipality: doc.municipality, ipAddress: req.ip });
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
  if (writeScopeViolation(doc, req.user, DOC_WRITE_SCOPE)) return errorResponse(res, 403, 'Not authorized to delete this document');

  await AuditLog.create({
    user: req.user._id, action: 'PERMANENT_DELETE', resource: 'document', resourceId: doc._id,
    oldValues: { title: doc.title, category: doc.category, originalName: doc.originalName, fileName: doc.fileName, barangay: doc.barangay || null, uploadedBy: doc.uploadedBy },
    details: { title: doc.title, category: doc.category, irreversible: true },
    municipality: doc.municipality, ipAddress: req.ip,
  });

  // Now the file goes, along with every stored version of it — superseded files are stored
  // separately and would otherwise be orphaned in storage for ever.
  removeFile(currentFile(doc));
  (doc.previousVersions || []).forEach((v) => removeFile(versionFile(doc, v)));

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
    // An ObjectId, not the raw string: an aggregation $match does no casting, and a string id
    // matches nothing at all.
    filter.municipality = objectIdOf(req.query.municipality) || { $in: [] };
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
