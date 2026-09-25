const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { BUDGET_APPROVERS, FINANCE_EDITORS } = require('../constants/roles');
const {
  getBudgets, getBudget, createBudget, updateBudget,
  submitBudget, approveBudget, rejectBudget, reopenBudget, deleteBudget, getBudgetSummary,
} = require('../controllers/budgetController');

const budgetValidation = validate([
  body('title').trim().notEmpty().withMessage('Budget title is required'),
  body('fiscalYear').isInt({ min: 2000, max: 2100 }).withMessage('Valid fiscal year is required'),
  body('totalBudget').isFloat({ min: 0 }).withMessage('Total budget must be a non-negative number'),
]);

router.use(protect);
router.get('/summary', getBudgetSummary);
router.get('/', getBudgets);
router.get('/:id', getBudget);
router.post('/', authorize(...FINANCE_EDITORS), budgetValidation, createBudget);
router.put('/:id', authorize(...FINANCE_EDITORS), updateBudget);
router.patch('/:id/submit', authorize(...FINANCE_EDITORS), submitBudget);
router.patch('/:id/approve', authorize(...BUDGET_APPROVERS), approveBudget);
router.patch('/:id/reject', authorize(...BUDGET_APPROVERS), rejectBudget);
router.patch('/:id/reopen', authorize(...FINANCE_EDITORS), reopenBudget);
router.delete('/:id', authorize('super_admin', 'provincial_admin'), deleteBudget);

module.exports = router;
