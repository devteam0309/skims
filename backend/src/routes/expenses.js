const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const validate = require('../middleware/validate');
const { ADMINS, FINANCE_STAFF, REPORTERS } = require('../constants/roles');
const { EXPENSE_TYPES } = require('../models/Expense');
const { getExpenses, getExpense, createExpense, updateExpense, approveExpense, deleteExpense, getExpenseSummary, bulkApproveExpenses } = require('../controllers/expenseController');

const expenseValidation = validate([
  body('type').isIn(EXPENSE_TYPES).withMessage(`Expense type must be one of: ${EXPENSE_TYPES.join(', ')}`),
  body('title').trim().notEmpty().withMessage('Expense title is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('transactionDate').isISO8601().withMessage('Valid transaction date is required'),
]);

router.use(protect);
router.get('/summary', authorize(...REPORTERS), getExpenseSummary);
router.get('/', getExpenses);
router.get('/:id', getExpense);
router.post('/', authorize(...FINANCE_STAFF), upload.array('attachments', 10), expenseValidation, createExpense);
router.put('/:id', authorize(...ADMINS, 'sk_treasurer'), updateExpense);
router.patch('/bulk-approve', authorize(...REPORTERS), bulkApproveExpenses);
router.patch('/:id/approve', authorize(...REPORTERS), approveExpense);
router.delete('/:id', authorize(...ADMINS), deleteExpense);

module.exports = router;
