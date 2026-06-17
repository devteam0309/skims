const asyncHandler = require('express-async-handler');
const { randomUUID } = require('crypto');
const Document = require('../models/Document');
const AuditLog = require('../models/AuditLog');
const { cloudinary, uploadToCloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

exports.getDocuments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, category, search, isArchived, isPublic } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (category) filter.category = category;
  if (isArchived !== undefined) filter.isArchived = isArchived === 'true';
  if (isPublic !== undefined) filter.isPublic = isPublic === 'true';
  if (search) filter.$text = { $search: search };

  if (req.user?.role !== 'super_admin' && req.user?.role !== 'provincial_admin') {
    filter.municipality = req.user?.municipality;
  }

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
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if ((doc.municipality?._id || doc.municipality)?.toString() !== userMunId) {
      return errorResponse(res, 403, 'Not authorized to view this document');
    }
  }
  successResponse(res, 200, 'Document', doc);
});

exports.uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'No file uploaded');

  const ALLOWED_FIELDS = ['title', 'description', 'category', 'barangay', 'program', 'fiscalYear', 'isPublic'];
  const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_FIELDS.includes(k)));

  const isImage = req.file.mimetype.startsWith('image/');
  const result = await uploadToCloudinary(req.file.buffer, {
    folder: isImage ? 'skims/avatars' : 'skims/documents',
    resource_type: isImage ? 'image' : 'raw',
    public_id: randomUUID(),
  });

  const doc = await Document.create({
    title: body.title || req.file.originalname,
    description: body.description,
    category: body.category,
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
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if ((doc.municipality?._id || doc.municipality)?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to update this document');
  }

  const allowed = ['title', 'description', 'category', 'tags', 'isPublic', 'fiscalYear'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  const updated = await Document.findByIdAndUpdate(req.params.id, updates, { new: true });
  successResponse(res, 200, 'Document updated', updated);
});

exports.archiveDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if ((doc.municipality?._id || doc.municipality)?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to archive this document');
  }
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
    if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
      const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
      if (doc.municipality?.toString() !== userMunId) {
        return errorResponse(res, 403, 'Not authorized to access this document');
      }
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
    if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
      const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
      if (doc.municipality?.toString() !== userMunId) {
        return errorResponse(res, 403, 'Not authorized to access this document');
      }
    }
  }

  await Document.findByIdAndUpdate(req.params.id, {
    $inc: { downloadCount: 1 },
    $push: { downloadHistory: { $each: [{ downloadedBy: req.user?._id, ipAddress: req.ip }], $slice: -100 } },
  });

  const safeFilename = encodeURIComponent(doc.originalName || doc.fileName || 'document');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.redirect(302, doc.fileUrl);
});

exports.unarchiveDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc || doc.deletedAt) return errorResponse(res, 404, 'Document not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if ((doc.municipality?._id || doc.municipality)?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to restore this document');
  }
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
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if ((doc.municipality?._id || doc.municipality)?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to replace this document');
  }

  const isImage = req.file.mimetype.startsWith('image/');
  const result = await uploadToCloudinary(req.file.buffer, {
    folder: isImage ? 'skims/avatars' : 'skims/documents',
    resource_type: isImage ? 'image' : 'raw',
    public_id: randomUUID(),
  });

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
    cloudinary.uploader.destroy(doc.fileName, { resource_type: oldResourceType }).catch(() => {});
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
    if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
      const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
      if (doc.municipality?.toString() !== userMunId) {
        return errorResponse(res, 403, 'Not authorized to access this document');
      }
    }
  }

  const versionNum = parseInt(req.params.version, 10);
  const pv = doc.previousVersions.find((v) => v.version === versionNum);
  if (!pv) return errorResponse(res, 404, 'Version not found');

  const safeFilename = encodeURIComponent(pv.fileName?.split('/').pop() || `version_${versionNum}`);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.redirect(302, pv.fileUrl);
});

exports.bulkArchiveDocuments = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse(res, 400, 'No document IDs provided');
  if (ids.length > 50) return errorResponse(res, 400, 'Cannot bulk archive more than 50 documents at once');
  const filter = { _id: { $in: ids }, isArchived: false, deletedAt: null };
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    filter.municipality = req.user.municipality?._id || req.user.municipality;
  }
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
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if ((doc.municipality?._id || doc.municipality)?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to delete this document');
  }
  doc.deletedAt = new Date();
  await doc.save();
  // Clean up file from Cloudinary
  if (doc.fileName) {
    const resourceType = doc.fileType?.startsWith('image/') ? 'image' : 'raw';
    cloudinary.uploader.destroy(doc.fileName, { resource_type: resourceType }).catch(() => {});
  }
  await AuditLog.create({ user: req.user._id, action: 'DELETE', resource: 'document', resourceId: doc._id, details: { title: doc.title, category: doc.category }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Document deleted');
});

exports.getDocumentStats = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };
  if (req.query.municipality) filter.municipality = req.query.municipality;

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
