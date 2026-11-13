const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ADMINS, BUDGET_APPROVERS, FINANCE_EDITORS, FINANCE_MONITORS } = require('../constants/roles');
const {
  getBudgets, getBudget, createBudget, updateBudget,
  submitBudget, approveBudget, rejectBudget, reopenBudget, deleteBudget, getBudgetSummary,
  getDeletedBudgets, restoreBudget, permanentlyDeleteBudget, getBarangayPerformance,
} = require('../controllers/budgetController');

const budgetValidation = validate([
  body('title').trim().notEmpty().withMessage('Budget title is required'),
  body('fiscalYear').isInt({ min: 2000, max: 2100 }).withMessage('Valid fiscal year is required'),
  body('totalBudget').isFloat({ min: 0 }).withMessage('Total budget must be a non-negative number'),
  body('barangay').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid barangay'),
]);

const idParam = validate([param('id').isMongoId().withMessage('Invalid budget ID')]);

router.use(protect);
router.get('/summary', getBudgetSummary);
// Declared before '/:id' so neither path segment is read as a budget id.
router.get('/barangay-performance', authorize(...FINANCE_MONITORS), getBarangayPerformance);
router.get('/recycle-bin', authorize(...FINANCE_EDITORS), getDeletedBudgets);
router.get('/', getBudgets);
router.get('/:id', idParam, getBudget);
router.post('/', authorize(...FINANCE_EDITORS), budgetValidation, createBudget);
router.put('/:id', authorize(...FINANCE_EDITORS), idParam, updateBudget);
router.patch('/:id/submit', authorize(...FINANCE_EDITORS), idParam, submitBudget);
router.patch('/:id/approve', authorize(...BUDGET_APPROVERS), idParam, approveBudget);
router.patch('/:id/reject', authorize(...BUDGET_APPROVERS), idParam, rejectBudget);
router.patch('/:id/reopen', authorize(...FINANCE_EDITORS), idParam, reopenBudget);
/*
 * Recycle bin. Deleting moves a (non-approved) budget there and restoring brings it back — both open
 * to the officers who write budgets, within their own scope. Destroying one for good is an
 * administrator's act, and refused while anything still references the budget.
 */
router.delete('/:id', authorize(...FINANCE_EDITORS), idParam, deleteBudget);
router.patch('/:id/restore', authorize(...FINANCE_EDITORS), idParam, restoreBudget);
router.delete('/:id/permanent', authorize(...ADMINS), idParam, permanentlyDeleteBudget);

module.exports = router;
