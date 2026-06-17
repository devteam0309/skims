const asyncHandler = require('express-async-handler');
const Announcement = require('../models/Announcement');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

const ALLOWED_CREATE_FIELDS = ['title', 'content', 'type', 'municipality', 'isPublic', 'publishedAt', 'expiresAt', 'eventDate', 'eventLocation', 'isPinned'];
const ALLOWED_UPDATE_FIELDS = ['title', 'content', 'type', 'isPublic', 'publishedAt', 'expiresAt', 'eventDate', 'eventLocation', 'isPinned'];

exports.getAnnouncements = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, type, isPublic } = req.query;
  const filter = { deletedAt: null };
  if (type) filter.type = type;
  if (isPublic !== undefined) filter.isPublic = isPublic === 'true';

  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    filter.$or = [{ municipality: req.user.municipality?._id || req.user.municipality }, { municipality: null }];
  } else if (municipality) {
    filter.municipality = municipality;
  }

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [announcements, total] = await Promise.all([
    Announcement.find(filter)
      .populate('municipality', 'name')
      .populate('author', 'firstName lastName role')
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Announcement.countDocuments(filter),
  ]);
  paginatedResponse(res, announcements, safePage, safeLimit, total);
});

exports.getAnnouncement = asyncHandler(async (req, res) => {
  const ann = await Announcement.findById(req.params.id)
    .populate('municipality', 'name')
    .populate('author', 'firstName lastName role');
  if (!ann || ann.deletedAt) return errorResponse(res, 404, 'Announcement not found');

  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    const annMunId = (ann.municipality?._id || ann.municipality)?.toString();
    if (annMunId && annMunId !== userMunId) return errorResponse(res, 403, 'Not authorized to view this announcement');
  }

  successResponse(res, 200, 'Announcement', ann);
});

exports.createAnnouncement = asyncHandler(async (req, res) => {
  const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_CREATE_FIELDS.includes(k)));
  data.author = req.user._id;
  const isAdmin = ['super_admin', 'provincial_admin'].includes(req.user.role);
  data.municipality = isAdmin ? (data.municipality || req.user.municipality?._id || req.user.municipality || null) : (req.user.municipality?._id || req.user.municipality || null);
  if (!data.publishedAt) data.publishedAt = new Date();

  const ann = await Announcement.create(data);
  await AuditLog.create({ user: req.user._id, action: 'CREATE', resource: 'announcement', resourceId: ann._id, details: { title: ann.title, type: ann.type }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 201, 'Announcement created', ann);
});

exports.updateAnnouncement = asyncHandler(async (req, res) => {
  const ann = await Announcement.findById(req.params.id);
  if (!ann || ann.deletedAt) return errorResponse(res, 404, 'Announcement not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (ann.municipality && ann.municipality.toString() !== userMunId) {
      return errorResponse(res, 403, 'Not authorized to edit this announcement');
    }
  }
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k)));
  const updated = await Announcement.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  successResponse(res, 200, 'Announcement updated', updated);
});

exports.deleteAnnouncement = asyncHandler(async (req, res) => {
  const ann = await Announcement.findById(req.params.id);
  if (!ann || ann.deletedAt) return errorResponse(res, 404, 'Announcement not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (ann.municipality && ann.municipality.toString() !== userMunId) {
      return errorResponse(res, 403, 'Not authorized to delete this announcement');
    }
  }
  ann.deletedAt = new Date();
  await ann.save();
  await AuditLog.create({ user: req.user._id, action: 'DELETE', resource: 'announcement', resourceId: ann._id, details: { title: ann.title }, municipality: req.user.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Announcement deleted');
});
