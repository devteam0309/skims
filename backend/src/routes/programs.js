const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const { ADMINS, EDITORS } = require('../constants/roles');
const validate = require('../middleware/validate');
const {
  getPrograms, getProgram, createProgram, updateProgram,
  deleteProgram, updateProgramStatus, addMilestone, updateMilestone, getProgramStats,
} = require('../controllers/programController');

const PROGRAM_CATEGORIES = [
  'education', 'health', 'livelihood', 'sports', 'environment',
  'peace_and_order', 'governance', 'social_services', 'culture_and_arts', 'infrastructure', 'other',
];

const programValidation = validate([
  body('title').trim().notEmpty().withMessage('Program title is required').isLength({ max: 200 }),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('category').isIn(PROGRAM_CATEGORIES).withMessage('Invalid program category'),
  body('budget').isFloat({ min: 0 }).withMessage('Budget must be a non-negative number'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required'),
  body('targetParticipants').isInt({ min: 1 }).withMessage('Target participants must be at least 1'),
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
router.post('/:id/milestones', protect, authorize(...EDITORS), milestoneValidation, addMilestone);
router.put('/:id/milestones/:milestoneId', protect, authorize(...EDITORS), updateMilestone);
router.delete('/:id', protect, authorize(...ADMINS), deleteProgram);

module.exports = router;
