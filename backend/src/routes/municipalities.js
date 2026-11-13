const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');
const Municipality = require('../models/Municipality');
const Barangay = require('../models/Barangay');
const User = require('../models/User');
const { SEAT_ROLES } = require('../constants/roles');
const { successResponse, errorResponse } = require('../utils/apiResponse');

router.get('/', asyncHandler(async (req, res) => {
  // Alphabetical at the source, so every municipality dropdown in the app is ordered without
  // each caller having to sort it again.
  const municipalities = await Municipality.find({ isActive: true }).collation({ locale: 'en' }).sort({ name: 1 });
  successResponse(res, 200, 'Municipalities', municipalities);
}));

/*
 * Every barangay in the province, each carrying its municipality.
 *
 * Declared ahead of `/:id` deliberately — Express matches in order, so further down the file
 * "barangays" would be read as a municipality id and 404.
 *
 * It backs the Youth Registry barangay filter for the two province-wide roles, which have no
 * single municipality to hang the list off and were previously left with a disabled control
 * reading "Pick a municipality" until they chose one.
 */
router.get('/barangays', asyncHandler(async (req, res) => {
  const barangays = await Barangay.find({ isActive: true })
    .populate('municipality', 'name')
    .collation({ locale: 'en' })
    .sort({ name: 1 });
  successResponse(res, 200, 'Barangays', barangays);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const mun = await Municipality.findById(req.params.id);
  if (!mun) return errorResponse(res, 404, 'Municipality not found');
  successResponse(res, 200, 'Municipality', mun);
}));

router.get('/:id/barangays', asyncHandler(async (req, res) => {
  // Barangay lists ran in insertion order, so the picker was effectively unordered. The English
  // collation keeps case and accents from splitting the alphabet (e.g. Ñ sorting after Z).
  const barangays = await Barangay.find({ municipality: req.params.id, isActive: true })
    .collation({ locale: 'en' })
    .sort({ name: 1 })
    .lean();

  /*
   * `?role=sk_chairperson` (or treasurer / secretary) adds each barangay's seat for that office:
   * `vacant`, `pending` (an application is awaiting review) or `filled`. The register form uses it to
   * stop an applicant choosing a barangay whose position is already claimed — the server refuses the
   * registration anyway, but finding out after filling in the whole form is the wrong time.
   *
   * Public, because registration is. It says whether a seat is held, never by whom.
   */
  const { role } = req.query;
  if (role && SEAT_ROLES.includes(role)) {
    const holders = await User.find({ seatKey: { $in: barangays.map((b) => `${b._id}:${role}`) } })
      .select('seatKey isApproved')
      .lean();
    const status = new Map(holders.map((h) => [h.seatKey, h.isApproved ? 'filled' : 'pending']));
    return successResponse(res, 200, 'Barangays', barangays.map((b) => ({
      _id: b._id, name: b.name, municipality: b.municipality,
      seatStatus: status.get(`${b._id}:${role}`) || 'vacant',
    })));
  }

  successResponse(res, 200, 'Barangays', barangays);
}));

router.post('/', protect, authorize('super_admin'), asyncHandler(async (req, res) => {
  const mun = await Municipality.create(req.body);
  successResponse(res, 201, 'Municipality created', mun);
}));

router.put('/:id', protect, authorize('super_admin'), asyncHandler(async (req, res) => {
  const mun = await Municipality.findByIdAndUpdate(req.params.id, req.body, { new: true });
  successResponse(res, 200, 'Municipality updated', mun);
}));

module.exports = router;
