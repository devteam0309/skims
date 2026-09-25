const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const { YOUTH_EDITORS, YOUTH_REGISTRARS, CROSS_MUNICIPALITY_READ, CROSS_MUNICIPALITY_WRITE } = require('../constants/roles');
const asyncHandler = require('express-async-handler');
const YouthMember = require('../models/YouthMember');
const AuditLog = require('../models/AuditLog');
const validate = require('../middleware/validate');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const { calculateAge, isYouthEligibleAge, YOUTH_MIN_AGE, YOUTH_MAX_AGE } = require('../utils/age');
const { normalizeLabel } = require('../utils/labels');
const { escapeRegex } = require('../utils/regex');
const { checkBarangay, barangayErrorMessage } = require('../utils/barangay');
const { applyReadScope, writeScopeViolation, forceScopeOnCreate, barangayScopeOf, idOf } = require('../utils/scope');
const upload = require('../middleware/fileUpload');
const { parseYouthWorkbook, markInFileDuplicates, COLUMN_LABELS, REQUIRED_COLUMNS, MAX_ROWS } = require('../services/youthImportService');


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
    else $set[key] = key === 'educationalAttainment' ? normalizeLabel(value) : value;
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

/* ============================================================================================= *
 * Excel import
 *
 * Two calls, and the FILE is what is sent both times:
 *
 *   POST /api/youth/import/preview  -> parse, validate, report. Writes nothing.
 *   POST /api/youth/import          -> re-parse, re-validate, insert the rows that pass.
 *
 * The confirmation step deliberately does not accept rows from the client. A preview the server does
 * not re-derive is an ordinary request body wearing a preview's clothes: it could carry rows that
 * were never in the file, a barangay from another municipality, or an age outside the SK band.
 * ============================================================================================= */

/** Shared by both endpoints: parse, then check each row against the registry. */
const analyseImport = async (buffer, user) => {
  const parsed = await parseYouthWorkbook(buffer);
  if (!parsed.ok) return parsed;

  const municipality = idOf(user.municipality);
  // Barangay comes from the account, never from the sheet: a spreadsheet column naming somebody
  // else's barangay is exactly the tampering the scope rules exist to stop. Unbound admin accounts
  // import at municipality level and can set a barangay per member afterwards.
  const barangay = barangayScopeOf(user);

  markInFileDuplicates(parsed.rows);

  /*
   * Existing members, in one query rather than one per row. Matched on the registry's own unique key
   * (name + birth date + municipality), case-insensitively, because a roster that capitalises
   * differently still describes the same person.
   */
  const candidates = parsed.rows.filter((r) => r.errors.length === 0 && !r.duplicateOf);
  const existing = candidates.length > 0
    ? await YouthMember.find({
      municipality,
      deletedAt: null,
      $or: candidates.map((r) => ({
        firstName: { $regex: `^${escapeRegex(r.record.firstName)}$`, $options: 'i' },
        lastName: { $regex: `^${escapeRegex(r.record.lastName)}$`, $options: 'i' },
        birthDate: r.record.birthDate,
      })),
    }).select('firstName lastName birthDate').lean()
    : [];

  const keyOf = (first, last, birth) =>
    `${first.toLowerCase()}|${last.toLowerCase()}|${new Date(birth).toISOString().slice(0, 10)}`;
  const existingKeys = new Set(existing.map((m) => keyOf(m.firstName, m.lastName, m.birthDate)));
  candidates.forEach((row) => {
    if (existingKeys.has(keyOf(row.record.firstName, row.record.lastName, row.record.birthDate))) {
      row.alreadyRegistered = true;
    }
  });

  const valid = parsed.rows.filter((r) => r.errors.length === 0 && !r.duplicateOf && !r.alreadyRegistered);
  const invalid = parsed.rows.filter((r) => r.errors.length > 0);
  const duplicates = parsed.rows.filter((r) => r.errors.length === 0 && (r.duplicateOf || r.alreadyRegistered));

  return { ok: true, parsed, valid, invalid, duplicates, municipality, barangay };
};

/** Row shape for the preview table. Dates are ISO, so the UI shows what will actually be stored. */
const previewRow = (row, status) => ({
  line: row.line,
  status,
  firstName: row.record.firstName,
  lastName: row.record.lastName,
  birthDate: row.record.birthDate ? new Date(row.record.birthDate).toISOString().slice(0, 10) : null,
  gender: row.record.gender,
  email: row.record.email || null,
  contactNumber: row.record.contactNumber || null,
  educationalAttainment: row.record.educationalAttainment || null,
  errors: row.errors,
  duplicateOf: row.duplicateOf || null,
  alreadyRegistered: !!row.alreadyRegistered,
});

router.post('/import/preview', authorize(...YOUTH_REGISTRARS), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'Attach an .xlsx spreadsheet to import');
  if (!idOf(req.user.municipality)) {
    return errorResponse(res, 400, 'Your account has no municipality, so there is no roster to import into');
  }

  const result = await analyseImport(req.file.buffer, req.user);
  if (!result.ok) return errorResponse(res, 400, result.error);

  successResponse(res, 200, 'Import preview', {
    fileName: req.file.originalname,
    recognisedColumns: result.parsed.headers,
    requiredColumns: REQUIRED_COLUMNS.map((f) => COLUMN_LABELS[f]),
    maxRows: MAX_ROWS,
    totals: {
      rows: result.parsed.rows.length,
      valid: result.valid.length,
      invalid: result.invalid.length,
      duplicates: result.duplicates.length,
    },
    // One list ordered by line number, so it reads as the user's own spreadsheet.
    rows: [
      ...result.valid.map((r) => previewRow(r, 'valid')),
      ...result.invalid.map((r) => previewRow(r, 'invalid')),
      ...result.duplicates.map((r) => previewRow(r, 'duplicate')),
    ].sort((a, b) => a.line - b.line),
  });
}));

router.post('/import', authorize(...YOUTH_REGISTRARS), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'Attach an .xlsx spreadsheet to import');
  if (!idOf(req.user.municipality)) {
    return errorResponse(res, 400, 'Your account has no municipality, so there is no roster to import into');
  }

  const result = await analyseImport(req.file.buffer, req.user);
  if (!result.ok) return errorResponse(res, 400, result.error);
  if (result.valid.length === 0) {
    return errorResponse(res, 400, 'No importable rows. Correct the highlighted rows and upload the file again.');
  }

  const docs = result.valid.map((row) => ({
    ...row.record,
    municipality: result.municipality,
    ...(result.barangay ? { barangay: result.barangay } : {}),
    registeredBy: req.user._id,
    // Imported from an office roster, so it awaits the same confirmation any canvassed member gets.
    verificationStatus: 'unverified',
  }));

  /*
   * Inserted one at a time rather than with insertMany. A single bad row must not discard the other
   * two hundred, and the per-row outcome is what the response has to report -- the registry's unique
   * index can still refuse a pair this pass could not see (a member somebody else created seconds
   * ago, or two rows differing only in a way the index collates).
   */
  const imported = [];
  const failed = [];
  for (const doc of docs) {
    try {
      const member = await YouthMember.create(doc);
      imported.push(member._id);
    } catch (err) {
      failed.push({
        name: `${doc.firstName} ${doc.lastName}`,
        reason: err.code === 11000 ? 'Already registered in this municipality' : 'Could not be saved',
      });
    }
  }

  await AuditLog.create({
    user: req.user._id,
    action: 'IMPORT',
    resource: 'youth_member',
    details: {
      fileName: req.file.originalname,
      rows: result.parsed.rows.length,
      imported: imported.length,
      skippedInvalid: result.invalid.length,
      skippedDuplicate: result.duplicates.length,
      failed: failed.length,
      barangay: result.barangay || null,
    },
    municipality: result.municipality,
    ipAddress: req.ip,
  });

  successResponse(res, 201, `Imported ${imported.length} youth member${imported.length === 1 ? '' : 's'}`, {
    imported: imported.length,
    skippedInvalid: result.invalid.length,
    skippedDuplicate: result.duplicates.length,
    failed,
  });
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
  /*
   * Scoped like the list, so a chairperson checking for a duplicate is told about one in their own
   * barangay (or an unassigned municipality-level record) and not about a namesake in another
   * barangay they may not see. Fails closed for an account with no municipality.
   */
  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role) && !idOf(req.user.municipality)) {
    return successResponse(res, 200, 'Duplicate check', { exists: false, member: null });
  }
  applyReadScope(filter, req.user);
  const member = await YouthMember.findOne(filter).select('_id firstName lastName');
  successResponse(res, 200, 'Duplicate check', { exists: !!member, member: member || null });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, municipality, barangay, search, gender, educationalAttainment, isActive, skEligible } = req.query;
  const filter = { deletedAt: null };
  if (municipality) filter.municipality = municipality;
  // Free-text values are stored as typed, so the filter matches the whole value case-insensitively
  // rather than requiring the caller to reproduce the original casing exactly.
  if (gender) filter.gender = { $regex: `^${escapeRegex(gender)}$`, $options: 'i' };
  // Free text now, so match the canonical form of whatever was typed rather than requiring the
  // caller to reproduce the stored spelling exactly.
  if (educationalAttainment) filter.educationalAttainment = normalizeLabel(educationalAttainment);
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

  /*
   * Municipality and barangay both come from the account, not the query. A chairperson bound to
   * Barangay A sees Barangay A plus the municipality-level records that name no barangay, and
   * `?barangay=<another>` is discarded rather than honoured — see utils/scope.js.
   */
  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role) && !idOf(req.user.municipality)) {
    return paginatedResponse(res, [], 1, 20, 0);
  }
  applyReadScope(filter, req.user, { requestedBarangay: barangay });

  const safePage = Math.max(1, parseInt(page) || 1);
  const safeLimit = Math.min(parseInt(limit) || 20, MAX_LIMIT);
  const skip = (safePage - 1) * safeLimit;
  const [members, total] = await Promise.all([
    /*
     * Sorted the way the registry is read. The Name column renders "{firstName} {lastName}", so a
     * surname sort put Juan dela Cruz ahead of Ana Reyes and the list looked unordered to anyone
     * scanning it — reported separately by three different roles. lastName is the tiebreak.
     *
     * Collated so case and accents do not split the alphabet, matching the municipality and
     * barangay lists. Sorting happens before skip/limit, so the order is global, not per page.
     */
    YouthMember.find(filter)
      .populate('municipality', 'name')
      .populate('barangay', 'name')
      .collation({ locale: 'en' })
      .sort({ firstName: 1, lastName: 1 })
      .skip(skip)
      .limit(safeLimit),
    YouthMember.countDocuments(filter),
  ]);
  paginatedResponse(res, members, safePage, safeLimit, total);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const member = await YouthMember.findById(req.params.id).populate('municipality', 'name').populate('barangay', 'name');
  if (!member || member.deletedAt) return errorResponse(res, 404, 'Youth member not found');
  /*
   * Read scope has to be re-asserted per record: the list hides a foreign member, and before the
   * equivalent fix on `userController.getUser` a direct request by id still returned one.
   */
  if (!CROSS_MUNICIPALITY_READ.includes(req.user.role)) {
    const userMunId = idOf(req.user.municipality);
    if (idOf(member.municipality) !== userMunId) return errorResponse(res, 403, 'Not authorized to view this youth member');
    const ownBarangay = barangayScopeOf(req.user);
    const memberBarangay = idOf(member.barangay);
    if (ownBarangay && memberBarangay && memberBarangay !== ownBarangay) {
      return errorResponse(res, 403, 'Not authorized to view this youth member');
    }
  }
  successResponse(res, 200, 'Youth member', member);
}));

/*
 * Youth now register themselves; this is the fallback, not the main path. It is deliberately kept:
 * the registry is the Katipunan ng Kabataan roster, and self-registration requires an email
 * address. Removing it would make any youth without one impossible to record, which would leave
 * the roster incomplete for exactly the households least likely to be reached otherwise.
 *
 * Open to YOUTH_REGISTRARS — the admins plus the SK Chairperson. Narrowed to ADMINS alone it
 * excluded the officer who actually does the canvassing, so a chairperson could not add a member
 * at all: the route answered 403 and the UI hid the button to match.
 */
router.post('/', authorize(...YOUTH_REGISTRARS), youthValidation, asyncHandler(async (req, res) => {
  /*
   * Only the two genuinely province-wide roles may file a record against another municipality.
   * municipal_admin used to be listed here, which let a Mogpog administrator post a youth record
   * with a Sta. Cruz id in the body and have it stored there — a write across the boundary every
   * other check in the system holds. It is scoped everywhere else; it is scoped here now.
   */
  const isCrossMunicipality = CROSS_MUNICIPALITY_WRITE.includes(req.user.role);
  const userMunId = idOf(req.user.municipality);
  const targetMunId = isCrossMunicipality ? (req.body.municipality || userMunId) : userMunId;
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
  if (data.educationalAttainment) data.educationalAttainment = normalizeLabel(data.educationalAttainment);
  data.registeredBy = req.user._id;
  data.municipality = targetMunId;
  /*
   * A barangay-bound officer registers into their OWN barangay, whatever the payload says — the
   * form no longer asks them to choose one and a hand-built request cannot choose for them. An
   * unbound account (the admin tiers) may still name a barangay, which is then checked against the
   * municipality below.
   *
   * Overwritten rather than refused, which is this module's established contract for scope fields:
   * `municipality` in the body is ignored the same way, and three suites pin that. The record can
   * therefore never land outside the caller's scope, which is the property that matters.
   */
  const ownBarangay = barangayScopeOf(req.user);
  if (ownBarangay) data.barangay = ownBarangay;
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
  const violation = writeScopeViolation(member, req.user);
  if (violation) return errorResponse(res, 403, 'Not authorized to update this youth member');
  // Non-empty values are set; blank values are unset (clears the field). This avoids
  // casting '' to an ObjectId (barangay) or an empty enum (educationalAttainment),
  // which would otherwise throw a CastError/ValidationError on the whole update.
  const $set = {};
  const $unset = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!ALLOWED_UPDATE_FIELDS.includes(k)) continue;
    if (v === '' || v === null || v === undefined) $unset[k] = '';
    else $set[k] = k === 'educationalAttainment' ? normalizeLabel(v) : v;
  }
  /*
   * A barangay, if being set, must belong to the member's municipality (municipality itself is
   * immutable here). A barangay-bound officer cannot re-file a member into a different barangay:
   * that would be a write into a scope they cannot read, so the value is pinned to their own.
   */
  const editorBarangay = barangayScopeOf(req.user);
  const touchesBarangay = Object.prototype.hasOwnProperty.call($set, 'barangay')
    || Object.prototype.hasOwnProperty.call($unset, 'barangay');
  if (editorBarangay && touchesBarangay) {
    delete $unset.barangay;
    $set.barangay = editorBarangay;
  }
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
  if (writeScopeViolation(member, req.user)) return errorResponse(res, 403, 'Not authorized to delete this youth member');
  member.deletedAt = new Date();
  await member.save();
  await AuditLog.create({ user: req.user._id, action: 'DELETE', resource: 'youth_member', resourceId: member._id, details: { name: `${member.firstName} ${member.lastName}` }, municipality: member.municipality, ipAddress: req.ip });
  successResponse(res, 200, 'Youth member deleted');
}));

module.exports = router;
