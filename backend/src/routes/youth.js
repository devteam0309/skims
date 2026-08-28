const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const { YOUTH_EDITORS, YOUTH_REGISTRARS, ADMINS } = require('../constants/roles');
const asyncHandler = require('express-async-handler');
const YouthMember = require('../models/YouthMember');
const Barangay = require('../models/Barangay');
const AuditLog = require('../models/AuditLog');
const validate = require('../middleware/validate');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const { calculateAge, isYouthEligibleAge, YOUTH_MIN_AGE, YOUTH_MAX_AGE } = require('../utils/age');

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
  // Free text: the form offers male / female as quick picks and lets anything else be typed,
  // so an entry such as "LGBTQIA+" is recorded as written instead of flattened to "other".
  body('gender').trim().notEmpty().withMessage('Gender is required').isLength({ max: 40 })
    .withMessage('Gender must be 40 characters or fewer'),
  body('contactNumber').optional({ checkFalsy: true })
    .matches(/^(09|\+639)\d{9}$/).withMessage('Use PH format: 09XXXXXXXXX or +639XXXXXXXXX'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email format'),
]);

const MAX_LIMIT = 100;

// The Sangguniang Kabataan age band. Mirrors YouthMember.isSkEligible.
const SK_MIN_AGE = 15;
const SK_MAX_AGE = 30;
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


/*
 * A youth's own registry record. The allowlist in middleware/auth.js opens exactly these two
 * paths to the role — /api/youth itself stays closed, so a youth cannot read the roster and see
 * other members' addresses and contact numbers.
 */
router.get('/me', authorize('youth'), asyncHandler(async (req, res) => {
  const member = await YouthMember.findOne({ user: req.user._id, deletedAt: null })
    .populate('municipality', 'name code')
    .populate('barangay', 'name')
    .populate('programParticipations.program', 'title status category startDate endDate');
  if (!member) return errorResponse(res, 404, 'No youth registry record is linked to your account');
  successResponse(res, 200, 'Your youth record', member);
}));

// Contact details only. Name, birth date and municipality are what identify the record in an
// official roster, so they are not self-editable — a correction goes through SK staff.
const SELF_EDITABLE = ['contactNumber', 'address', 'occupation', 'educationalAttainment', 'barangay'];

router.put('/me', authorize('youth'), asyncHandler(async (req, res) => {
  const member = await YouthMember.findOne({ user: req.user._id, deletedAt: null });
  if (!member) return errorResponse(res, 404, 'No youth registry record is linked to your account');

  const $set = {};
  const $unset = {};
  for (const key of SELF_EDITABLE) {
    if (!(key in req.body)) continue;
    const value = req.body[key];
    if (value === '' || value === null || value === undefined) $unset[key] = '';
    else $set[key] = value;
  }

  if ($set.barangay) {
    const check = await checkBarangay($set.barangay, member.municipality);
    if (check !== 'ok') return errorResponse(res, 400, barangayErrorMessage(check));
  }

  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  if (!Object.keys(update).length) return successResponse(res, 200, 'Nothing to update', member);

  const updated = await YouthMember.findByIdAndUpdate(member._id, update, { new: true, runValidators: true })
    .populate('municipality', 'name code')
    .populate('barangay', 'name');
  successResponse(res, 200, 'Your details were updated', updated);
}));

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
    const munId = req.user.municipality?._id || req.user.municipality;
    // Fail closed. An undefined value is dropped from the query by Mongoose, which would have
    // turned a municipality-less account's duplicate check into a province-wide name lookup.
    if (!munId) return successResponse(res, 200, 'Duplicate check', { exists: false, member: null });
    filter.municipality = munId;
  }
  const member = await YouthMember.findOne(filter).select('_id firstName lastName');
  successResponse(res, 200, 'Duplicate check', { exists: !!member, member: member || null });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, municipality, barangay, search, gender, educationalAttainment, isActive, skEligible } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  if (barangay) filter.barangay = barangay;
  // Free-text values are stored as typed, so the filter matches the whole value case-insensitively
  // rather than requiring the caller to reproduce the original casing exactly.
  if (gender) filter.gender = { $regex: `^${escapeRegex(gender)}$`, $options: 'i' };
  if (educationalAttainment) filter.educationalAttainment = educationalAttainment;
  if (isActive !== undefined && isActive !== '') filter.isActive = isActive === 'true';

  /*
   * SK membership is an age band (15–30), not a stored flag, so it is expressed as a birthDate
   * range. Someone aged exactly 30 is still covered, which is why the lower bound subtracts
   * MAX_AGE + 1 years and then steps forward a day rather than subtracting MAX_AGE outright.
   */
  if (skEligible === 'true' || skEligible === 'false') {
    const now = new Date();
    const youngest = new Date(now.getFullYear() - SK_MIN_AGE, now.getMonth(), now.getDate());
    const oldest = new Date(now.getFullYear() - SK_MAX_AGE - 1, now.getMonth(), now.getDate() + 1);
    filter.birthDate = skEligible === 'true'
      ? { $gte: oldest, $lte: youngest }
      : { $not: { $gte: oldest, $lte: youngest } };
  }
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

/*
 * Youth now register themselves; this is the fallback, not the main path.
 *
 * It is narrowed from YOUTH_REGISTRARS to ADMINS and hidden in the UI, but deliberately kept: the
 * registry is the Katipunan ng Kabataan roster, and self-registration requires an email address.
 * Removing this entirely would make any youth without one impossible to record, which would leave
 * the roster incomplete for exactly the households least likely to be reached otherwise.
 */
router.post('/', authorize(...ADMINS), youthValidation, asyncHandler(async (req, res) => {
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
    const age = calculateAge(data.birthDate);
    if (!isYouthEligibleAge(age)) {
      return errorResponse(res, 400, `Youth member must be between ${YOUTH_MIN_AGE} and ${YOUTH_MAX_AGE} years old`);
    }
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
