const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');
const Municipality = require('../models/Municipality');
const Barangay = require('../models/Barangay');
const { successResponse, errorResponse } = require('../utils/apiResponse');

router.get('/', asyncHandler(async (req, res) => {
  const municipalities = await Municipality.find({ isActive: true });
  successResponse(res, 200, 'Municipalities', municipalities);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const mun = await Municipality.findById(req.params.id);
  if (!mun) return errorResponse(res, 404, 'Municipality not found');
  successResponse(res, 200, 'Municipality', mun);
}));

router.get('/:id/barangays', asyncHandler(async (req, res) => {
  const barangays = await Barangay.find({ municipality: req.params.id, isActive: true });
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
