const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const { YOUTH_EDITORS, YOUTH_REGISTRARS } = require('../constants/roles');
const asyncHandler = require('express-async-handler');
const YouthMember = require('../models/YouthMember');
const Barangay = require('../models/Barangay');
const AuditLog = require('../models/AuditLog');
const validate = require('../middleware/validate');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');

const mongoose = require('mongoose');

// Returns: 'ok' if the barangay is valid for the municipality (or no barangay given),
// 'invalid' if the id is malformed or does not exist, 'mismatch' if it belongs elsewhere.
const checkBarangay = async (barangayId, municipalityId) => {
  if (!barangayId) return 'ok';
  if (!mongoose.Types.ObjectId.isValid(barangayId)) return 'invalid';
  const b = await Barangay.findById(barangayId).select('municipality');
  if (!b) return 'invalid';
  return b.municipality?.toString() === municipalityId?.toString() ? 'ok' : 'mismatch';
};

const barangayErrorMessage = (result) =>
  result === 'invalid'
    ? 'The selected barangay does not exist'
    : 'The selected barangay does not belong to this municipality';

const youthValidation = validate([
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('birthDate').isISO8601().withMessage('Valid birth date is required'),
  body('gender').isIn(['male', 'female', 'other']).withMessage('Gender must be male, female, or other'),
  body('contactNumber').optional({ checkFalsy: true })
    .matches(/^(09|\+639)\d{9}$/).withMessage('Use PH format: 09XXXXXXXXX or +639XXXXXXXXX'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email format'),
]);

const MAX_LIMIT = 100;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ALLOWED_CREATE_FIELDS = [
  'firstName', 'lastName', 'birthDate', 'gender', 'email', 'contactNumber',
  'address', 'barangay', 'educationalAttainment', 'occupation', 'isRegisteredVoter',
];

const ALLOWED_UPDATE_FIELDS = [
  'firstName', 'lastName', 'birthDate', 'gender', 'email', 'contactNumber',
  'address', 'barangay', 'educationalAttainment', 'occupation', 'isRegisteredVoter', 'isActive',
];

router.use(protect);

router.get('/duplicate-check', asyncHandler(async (req, res) => {
  const { firstName, lastName, birthDate } = req.query;
  if (!firstName || !lastName || !birthDate) return successResponse(res, 200, 'Duplicate check', { exists: false });

  const filter = {
    firstName: { $regex: `^${escapeRegex(firstName)}$`, $options: 'i' },
    lastName: { $regex: `^${escapeRegex(lastName)}$`, $options: 'i' },
    birthDate: new Date(birthDate),
    deletedAt: null,
  };
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    filter.municipality = req.user.municipality?._id || req.user.municipality;
  }
  const member = await YouthMember.findOne(filter).select('_id firstName lastName');
  successResponse(res, 200, 'Duplicate check', { exists: !!member, member: member || null });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, municipality, barangay, search, gender, educationalAttainment, isActive } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (barangay) filter.barangay = barangay;
  if (gender) filter.gender = gender;
  if (educationalAttainment) filter.educationalAttainment = educationalAttainment;
  if (isActive !== undefined && isActive !== '') filter.isActive = isActive === 'true';
  if (search) filter.$or = [
    { firstName: { $regex: escapeRegex(search), $options: 'i' } },
    { lastName: { $regex: escapeRegex(search), $options: 'i' } },
  ];

  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const munId = req.user.municipality?._id || req.user.municipality;
    if (!munId) return paginatedResponse(res, [], 1, 20, 0);
    filter.municipality = munId;
  }

  const safePage = Math.max(1, parseInt(page) || 1);
  const safeLimit = Math.min(parseInt(limit) || 20, MAX_LIMIT);
  const skip = (safePage - 1) * safeLimit;
  const [members, total] = await Promise.all([
    YouthMember.find(filter).populate('municipality', 'name').populate('barangay', 'name').sort({ lastName: 1 }).skip(skip).limit(safeLimit),
    YouthMember.countDocuments(filter),
  ]);
  paginatedResponse(res, members, safePage, safeLimit, total);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const member = await YouthMember.findById(req.params.id).populate('municipality', 'name').populate('barangay', 'name');
  if (!member || member.deletedAt) return errorResponse(res, 404, 'Youth member not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    const memberMunId = (member.municipality?._id || member.municipality)?.toString();
    if (memberMunId !== userMunId) return errorResponse(res, 403, 'Not authorized to view this youth member');
  }
  successResponse(res, 200, 'Youth member', member);
}));

router.post('/', authorize(...YOUTH_REGISTRARS), youthValidation, asyncHandler(async (req, res) => {
  const isAdmin = ['super_admin', 'provincial_admin', 'municipal_admin'].includes(req.user.role);
  const userMunId = req.user.municipality?._id || req.user.municipality;
  const targetMunId = isAdmin ? (req.body.municipality || userMunId) : userMunId;
  if (!targetMunId) return errorResponse(res, 400, 'Municipality is required');
  const data = Object.fromEntries(
    Object.entries(req.body)
      .filter(([k]) => ALLOWED_CREATE_FIELDS.includes(k))
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
  );
  if (data.birthDate) {
    const age = Math.floor((Date.now() - new Date(data.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 15 || age > 30) return errorResponse(res, 400, 'Youth member must be between 15 and 30 years old');
  }
  data.registeredBy = req.user._id;
  data.municipality = targetMunId;
  // A barangay, if provided, must belong to the target municipality
  const brgyCheck = await checkBarangay(data.barangay, targetMunId);
  if (brgyCheck !== 'ok') return errorResponse(res, 400, barangayErrorMessage(brgyCheck));
  try {
    const member = await YouthMember.create(data);
    await AuditLog.create({ user: req.user._id, action: 'CREATE', resource: 'youth_member', resourceId: member._id, details: { name: `${member.firstName} ${member.lastName}`, barangay: member.barangay }, municipality: member.municipality, ipAddress: req.ip });
    successResponse(res, 201, 'Youth member registered', member);
  } catch (err) {
    if (err.code === 11000) {
      return errorResponse(res, 409, 'A youth member with this name and birth date is already registered in this municipality');
    }
    throw err;
  }
}));

router.put('/:id', authorize(...YOUTH_EDITORS), asyncHandler(async (req, res) => {
  const member = await YouthMember.findById(req.params.id);
  if (!member || member.deletedAt) return errorResponse(res, 404, 'Youth member not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (member.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to update this youth member');
  }
  // Non-empty values are set; blank values are unset (clears the field). This avoids
  // casting '' to an ObjectId (barangay) or an empty enum (educationalAttainment),
  // which would otherwise throw a CastError/ValidationError on the whole update.
  const $set = {};
  const $unset = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!ALLOWED_UPDATE_FIELDS.includes(k)) continue;
    if (v === '' || v === null || v === undefined) $unset[k] = '';
    else $set[k] = v;
  }
  // A barangay, if being set, must belong to the member's municipality (municipality itself is immutable here)
  if ($set.barangay) {
    const brgyCheck = await checkBarangay($set.barangay, member.municipality);
    if (brgyCheck !== 'ok') return errorResponse(res, 400, barangayErrorMessage(brgyCheck));
  }
  const ops = {};
  if (Object.keys($set).length) ops.$set = $set;
  if (Object.keys($unset).length) ops.$unset = $unset;
  const changed = [...Object.keys($set), ...Object.keys($unset)];
  try {
    const updated = await YouthMember.findByIdAndUpdate(req.params.id, ops, { new: true, runValidators: true });
    await AuditLog.create({ user: req.user._id, action: 'UPDATE', resource: 'youth_member', resourceId: updated._id, details: { changes: changed }, municipality: member.municipality, ipAddress: req.ip });
    successResponse(res, 200, 'Youth member updated', updated);
  } catch (err) {
    if (err.code === 11000) {
      return errorResponse(res, 409, 'A youth member with this name and birth date is already registered in this municipality');
    }
    throw err;
  }
}));

router.delete('/:id', authorize(...YOUTH_EDITORS), asyncHandler(async (req, res) => {
  const member = await YouthMember.findById(req.params.id);
  if (!member || member.deletedAt) return errorResponse(res, 404, 'Youth member not found');
  if (!['super_admin', 'provincial_admin'].includes(req.user.role)) {
    const userMunId = (req.user.municipality?._id || req.user.municipality)?.toString();
    if (member.municipality?.toString() !== userMunId) return errorResponse(res, 403, 'Not authorized to delete this youth member');
  }
  member.deletedAt = new Date();
  await member.save();
  await AuditLog.create({ user: req.user._id, action: 'DELETE', resource: 'youth_member', resourceId: member._id, details: { name: `${member.firstName} ${member.lastName}` }, municipality: member.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Youth member deleted');
}));

module.exports = router;
