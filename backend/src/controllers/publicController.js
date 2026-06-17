const asyncHandler = require('express-async-handler');
const Program = require('../models/Program');
const Announcement = require('../models/Announcement');
const Budget = require('../models/Budget');
const Document = require('../models/Document');
const Municipality = require('../models/Municipality');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

exports.getPublicPrograms = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, category, status } = req.query;
  const filter = { isPublic: true, deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (category) filter.category = category;
  if (status) filter.status = status;

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [programs, total] = await Promise.all([
    Program.find(filter)
      .populate('municipality', 'name')
      .populate('barangay', 'name')
      .select('title description category status budget startDate endDate completionRate targetParticipants actualParticipants')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Program.countDocuments(filter),
  ]);
  paginatedResponse(res, programs, safePage, safeLimit, total);
});

exports.getPublicAnnouncements = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, type } = req.query;
  const filter = { isPublic: true, deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (type) filter.type = type;

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

exports.getPublicBudgetSummary = asyncHandler(async (req, res) => {
  const { municipality, fiscalYear } = req.query;
  const filter = { status: 'approved', deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (fiscalYear) filter.fiscalYear = parseInt(fiscalYear);

  const summary = await Budget.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$municipality',
        totalBudget: { $sum: '$totalBudget' },
        disbursed: { $sum: '$disbursedAmount' },
        remaining: { $sum: '$remainingBalance' },
      },
    },
    {
      $lookup: { from: 'municipalities', localField: '_id', foreignField: '_id', as: 'municipality' },
    },
    { $unwind: '$municipality' },
    { $project: { 'municipality.name': 1, totalBudget: 1, disbursed: 1, remaining: 1 } },
  ]);
  successResponse(res, 200, 'Public budget summary', summary);
});

exports.getPublicDocuments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, municipality, category } = req.query;
  const filter = { isPublic: true, deletedAt: null, isArchived: false };
  if (municipality) filter.municipality = municipality;
  if (category) filter.category = category;

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [docs, total] = await Promise.all([
    Document.find(filter)
      .populate('municipality', 'name')
      .select('title category fileType fileSize createdAt downloadCount')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Document.countDocuments(filter),
  ]);
  paginatedResponse(res, docs, safePage, safeLimit, total);
});

exports.downloadPublicDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, isPublic: true, deletedAt: null });
  if (!doc) return errorResponse(res, 404, 'Document not found');

  await Document.findByIdAndUpdate(req.params.id, {
    $inc: { downloadCount: 1 },
    $push: { downloadHistory: { $each: [{ ipAddress: req.ip }], $slice: -100 } },
  });

  res.redirect(302, doc.fileUrl);
});

exports.getMunicipalities = asyncHandler(async (req, res) => {
  const municipalities = await Municipality.find({ isActive: true }).select('name code province region');
  successResponse(res, 200, 'Municipalities', municipalities);
});

exports.getPublicStats = asyncHandler(async (req, res) => {
  const [totalPrograms, completedPrograms, totalMunicipalities] = await Promise.all([
    Program.countDocuments({ isPublic: true, deletedAt: null }),
    Program.countDocuments({ isPublic: true, deletedAt: null, status: 'completed' }),
    Municipality.countDocuments({ isActive: true }),
  ]);
  successResponse(res, 200, 'Public stats', { totalPrograms, completedPrograms, totalMunicipalities });
});
