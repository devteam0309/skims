const asyncHandler = require('express-async-handler');
const Announcement = require('../models/Announcement');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');
const { normalizeLabel } = require('../utils/labels');
const {
  ADMINS, EDITORS, CROSS_MUNICIPALITY_READ, CROSS_MUNICIPALITY_WRITE, AUTHORITY_RANK,
} = require('../constants/roles');
const { idOf } = require('../utils/scope');

const MAX_LIMIT = 100;

const ALLOWED_CREATE_FIELDS = ['title', 'content', 'type', 'municipality', 'isPublic', 'publishedAt', 'expiresAt', 'eventDate', 'eventLocation', 'isPinned'];
const ALLOWED_UPDATE_FIELDS = ['title', 'content', 'type', 'isPublic', 'publishedAt', 'expiresAt', 'eventDate', 'eventLocation', 'isPinned'];

/**
 * The office an announcement is issued from, derived from its author — never typed, so nobody can
 * publish under an office they do not hold. Shown in the announcement's expanded view.
 */
const issuingOfficeFor = (user) => {
  const municipality = user.municipality?.name;
  const barangay = user.barangay?.name;
  switch (user.role) {
    case 'super_admin': return 'SKIMS System Administration';
    case 'provincial_admin': return 'Provincial SK Federation — Marinduque';
    case 'dilg_representative': return 'DILG Marinduque';
    case 'municipal_admin': return municipality ? `Municipal SK Federation — ${municipality}` : 'Municipal SK Federation';
    default:
      if (barangay) return `Sangguniang Kabataan — Barangay ${barangay}${municipality ? `, ${municipality}` : ''}`;
      return municipality ? `Sangguniang Kabataan — ${municipality}` : 'Sangguniang Kabataan';
  }
};

const authorRoleOf = (ann) => ann.authorRole || ann.author?.role;

/**
 * Why `user` may NOT change `ann`, or null when they may.
 *
 * Until this existed the only check was the municipality, and a province-wide announcement has
 * none — so any SK Chairperson could rewrite what the provincial office or DILG published. The rule
 * now:
 *
 *   - the author may manage their own announcement;
 *   - otherwise only an account of strictly HIGHER authority (AUTHORITY_RANK) may, within its reach —
 *     a municipal administrator over its own municipality's barangay officers, the provincial office
 *     over every municipality;
 *   - super_admin may manage everything: it is the break-glass account.
 *
 * Equal authority is not enough: one barangay's chairperson cannot edit another's.
 */
const managementDenial = (ann, user, verb = 'change') => {
  if (user.role === 'super_admin') return null;

  const isAuthor = idOf(ann.author) === idOf(user._id);
  if (!isAuthor) {
    // An author whose role cannot be read is treated as the highest authority: nobody below
    // super_admin may take it over on the strength of missing data.
    const authorRank = AUTHORITY_RANK[authorRoleOf(ann)] ?? AUTHORITY_RANK.super_admin;
    const ownRank = AUTHORITY_RANK[user.role] ?? 0;
    if (ownRank <= authorRank) {
      return `You can only ${verb} announcements you issued, or ones issued by an office below yours`;
    }
  }

  if (!CROSS_MUNICIPALITY_WRITE.includes(user.role)) {
    const annMunicipality = idOf(ann.municipality);
    if (!annMunicipality) {
      if (!isAuthor) return `Province-wide announcements can only be ${verb === 'delete' ? 'deleted' : 'changed'} by the provincial office`;
    } else if (annMunicipality !== idOf(user.municipality)) {
      return 'This announcement belongs to another municipality';
    }
  }
  return null;
};

/**
 * The announcement as a client sees it, with what the caller may do to it. The flags are a
 * convenience for the page — the same rule is re-checked on every update and delete.
 */
const withPermissions = (ann, user) => ({
  ...ann.toJSON(),
  issuingOffice: ann.issuingOffice || (ann.author?.role ? issuingOfficeFor(ann.author) : null),
  canEdit: EDITORS.includes(user.role) && !managementDenial(ann, user, 'edit'),
  canDelete: ADMINS.includes(user.role) && !managementDenial(ann, user, 'delete'),
});

const AUTHOR_FIELDS = 'firstName lastName role municipality barangay';
const populateAuthor = (query) => query.populate({
  path: 'author',
  select: AUTHOR_FIELDS,
  populate: [{ path: 'municipality', select: 'name' }, { path: 'barangay', select: 'name' }],
});

exports.getAnnouncements = asyncHandler(async (req, res) => {
  const { municipality, type, isPublic } = req.query;
  const filter = { deletedAt: null };
  // Free text now; canonicalise so a typed "Event" finds records stored as `event`.
  if (type) filter.type = normalizeLabel(type);
  if (isPublic !== undefined) filter.isPublic = isPublic === 'true';

  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role)) {
    filter.$or = [{ municipality: req.user.municipality?._id || req.user.municipality }, { municipality: null }];
  } else if (municipality) {
    filter.municipality = municipality;
  }

  const { safePage, safeLimit, skip } = parsePagination(req.query, { maxLimit: MAX_LIMIT });
  const [announcements, total] = await Promise.all([
    populateAuthor(Announcement.find(filter).populate('municipality', 'name'))
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Announcement.countDocuments(filter),
  ]);
  paginatedResponse(res, announcements.map((a) => withPermissions(a, req.user)), safePage, safeLimit, total);
});

exports.getAnnouncement = asyncHandler(async (req, res) => {
  const ann = await populateAuthor(Announcement.findById(req.params.id).populate('municipality', 'name'));
  if (!ann || ann.deletedAt) return errorResponse(res, 404, 'Announcement not found');

  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    const annMunId = (ann.municipality?._id || ann.municipality)?.toString();
    if (annMunId && annMunId !== userMunId) return errorResponse(res, 403, 'Not authorized to view this announcement');
  }

  successResponse(res, 200, 'Announcement', withPermissions(ann, req.user));
});

exports.createAnnouncement = asyncHandler(async (req, res) => {
  const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_CREATE_FIELDS.includes(k)));
  if (data.type) data.type = normalizeLabel(data.type);
  data.author = req.user._id;
  // The authority it is issued under, frozen now — see models/Announcement.js.
  data.authorRole = req.user.role;
  data.issuingOffice = issuingOfficeFor(req.user);
  const isAdmin = CROSS_MUNICIPALITY_WRITE.includes(req.user.role);
  data.municipality = isAdmin ? (data.municipality || req.user.municipality?._id || req.user.municipality || null) : (req.user.municipality?._id || req.user.municipality || null);
  if (!data.publishedAt) data.publishedAt = new Date();

  const ann = await Announcement.create(data);
  await AuditLog.create({ user: req.user._id, action: 'CREATE', resource: 'announcement', resourceId: ann._id, details: { title: ann.title, type: ann.type, issuingOffice: ann.issuingOffice }, municipality: ann.municipality, ipAddress: req.ip });
  successResponse(res, 201, 'Announcement created', ann);
});

exports.updateAnnouncement = asyncHandler(async (req, res) => {
  const ann = await Announcement.findById(req.params.id).populate('author', 'role');
  if (!ann || ann.deletedAt) return errorResponse(res, 404, 'Announcement not found');
  // Enforced here, not by hiding the Edit button: the route is reachable directly.
  const denied = managementDenial(ann, req.user, 'edit');
  if (denied) return errorResponse(res, 403, denied);

  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k)));
  if (updates.type) updates.type = normalizeLabel(updates.type);
  const updated = await Announcement.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  await AuditLog.create({
    user: req.user._id, action: 'UPDATE', resource: 'announcement', resourceId: ann._id,
    details: { title: updated.title, changes: Object.keys(updates), issuedBy: ann.authorRole || ann.author?.role || null },
    municipality: ann.municipality, ipAddress: req.ip,
  });
  successResponse(res, 200, 'Announcement updated', updated);
});

exports.deleteAnnouncement = asyncHandler(async (req, res) => {
  const ann = await Announcement.findById(req.params.id).populate('author', 'role');
  if (!ann || ann.deletedAt) return errorResponse(res, 404, 'Announcement not found');
  const denied = managementDenial(ann, req.user, 'delete');
  if (denied) return errorResponse(res, 403, denied);

  ann.deletedAt = new Date();
  await ann.save();
  await AuditLog.create({ user: req.user._id, action: 'DELETE', resource: 'announcement', resourceId: ann._id, details: { title: ann.title }, municipality: ann.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Announcement deleted');
});

// Exported for the tests that pin the rule directly.
exports.managementDenial = managementDenial;
exports.issuingOfficeFor = issuingOfficeFor;
