const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const validate = require('../middleware/validate');
const { ADMINS, FINANCE_EDITORS, REPORT_VIEWERS, FINANCE_APPROVERS } = require('../constants/roles');
const { EXPENSE_TYPES } = require('../models/Expense');
const { getExpenses, getExpense, createExpense, updateExpense, submitExpense, approveExpense, rejectExpense, deleteExpense, getExpenseSummary, bulkApproveExpenses } = require('../controllers/expenseController');

// A returned expense must say why: the treasurer has to know what to change.
const rejectValidation = validate([
  body('rejectionReason').trim().notEmpty().withMessage('A reason is required when returning an expense')
    .isLength({ max: 500 }).withMessage('Reason must be 500 characters or fewer'),
]);

const expenseValidation = validate([
  body('type').isIn(EXPENSE_TYPES).withMessage(`Expense type must be one of: ${EXPENSE_TYPES.join(', ')}`),
  body('title').trim().notEmpty().withMessage('Expense title is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('transactionDate').isISO8601().withMessage('Valid transaction date is required'),
]);

router.use(protect);
router.get('/summary', authorize(...REPORT_VIEWERS), getExpenseSummary);
router.get('/', getExpenses);
router.get('/:id', getExpense);
router.post('/', authorize(...FINANCE_EDITORS), upload.array('attachments', 10), expenseValidation, createExpense);
router.put('/:id', authorize(...FINANCE_EDITORS), updateExpense);
router.patch('/bulk-approve', authorize(...FINANCE_APPROVERS), bulkApproveExpenses);
// Submitting is the treasurer's act; approving and returning are the administrator's. Different
// lists on purpose — see constants/roles.js.
router.patch('/:id/submit', authorize(...FINANCE_EDITORS), submitExpense);
router.patch('/:id/approve', authorize(...FINANCE_APPROVERS), approveExpense);
router.patch('/:id/reject', authorize(...FINANCE_APPROVERS), rejectValidation, rejectExpense);
router.delete('/:id', authorize(...ADMINS), deleteExpense);

module.exports = router;
