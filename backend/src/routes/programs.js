const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const { ADMINS, EDITORS } = require('../constants/roles');
const validate = require('../middleware/validate');
const {
  getPrograms, getProgram, createProgram, updateProgram,
  deleteProgram, updateProgramStatus, addMilestone, updateMilestone, getProgramStats,
  submitProgram, approveProgram, rejectProgram,
  requestToJoin, withdrawJoinRequest, getParticipants, decideParticipant,
} = require('../controllers/programController');

const programValidation = validate([
  body('title').trim().notEmpty().withMessage('Program title is required').isLength({ max: 200 }),
  body('description').trim().notEmpty().withMessage('Description is required'),
  // Free text, not an enum: a municipality may name a category the suggested list does not
  // cover rather than filing it under 'other'. Length-capped so it stays a label.
  body('category').trim().notEmpty().withMessage('Category is required').isLength({ max: 60 })
    .withMessage('Category must be 60 characters or fewer'),
  // Optional — a program can be planned and submitted for approval before it has any funding.
  body('budget').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Budget must be a non-negative number'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required'),
  body('targetParticipants').isInt({ min: 1 }).withMessage('Target participants must be at least 1'),
]);

const rejectValidation = validate([
  body('reason').trim().notEmpty().withMessage('A reason is required').isLength({ max: 500 }),
]);

const statusValidation = validate([
  body('status')
    .isIn(['planned', 'ongoing', 'delayed', 'completed', 'cancelled'])
    .withMessage('Invalid status value'),
]);

const milestoneValidation = validate([
  body('title').trim().notEmpty().withMessage('Milestone title is required'),
]);

router.get('/stats', protect, getProgramStats);
router.get('/', protect, getPrograms);
router.get('/:id', protect, getProgram);
router.post('/', protect, authorize(...EDITORS), programValidation, createProgram);
router.put('/:id', protect, authorize(...EDITORS), updateProgram);
router.patch('/:id/status', protect, authorize(...EDITORS), statusValidation, updateProgramStatus);
// Submitting is an author action; approving and rejecting are not — an SK Chairperson may submit
// their municipality's program, but clearing it is an admin decision.
router.patch('/:id/submit', protect, authorize(...EDITORS), submitProgram);
router.patch('/:id/approve', protect, authorize(...ADMINS), approveProgram);
router.patch('/:id/reject', protect, authorize(...ADMINS), rejectValidation, rejectProgram);
/*
 * Participation. Joining is the one write a youth account may perform anywhere in the API — the
 * role is otherwise closed by the allowlist in middleware/auth.js — and the decision on that
 * request belongs to SK staff, so the two sides are authorised separately.
 */
router.post('/:id/join', protect, authorize('youth'), requestToJoin);
router.delete('/:id/join', protect, authorize('youth'), withdrawJoinRequest);
router.get('/:id/participants', protect, authorize(...EDITORS), getParticipants);
router.patch('/:id/participants/:youthId', protect, authorize(...EDITORS), decideParticipant);

router.post('/:id/milestones', protect, authorize(...EDITORS), milestoneValidation, addMilestone);
router.put('/:id/milestones/:milestoneId', protect, authorize(...EDITORS), updateMilestone);
router.delete('/:id', protect, authorize(...ADMINS), deleteProgram);

module.exports = router;
