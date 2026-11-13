const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const validate = require('../middleware/validate');
const { ADMINS, FINANCE_EDITORS, REPORT_VIEWERS, FINANCE_APPROVERS } = require('../constants/roles');
const { EXPENSE_TYPES } = require('../models/Expense');
const {
  getExpenses, getExpense, createExpense, updateExpense, submitExpense, approveExpense, rejectExpense,
  returnExpense, reverseExpense, deleteExpense, getExpenseSummary, bulkApproveExpenses,
  addAttachments, serveAttachment, getDeletedExpenses, restoreExpense, permanentlyDeleteExpense,
} = require('../controllers/expenseController');

const idParam = validate([param('id').isMongoId().withMessage('Invalid expense ID')]);

// A decision on an expense must say why: the treasurer has to know what to change, and the audit
// trail what it was based on. Either field name is accepted, so older clients keep working.
const reasonValidation = validate([
  body().custom((value) => {
    const reason = (value?.rejectionReason || value?.returnReason || value?.reason || '').trim();
    if (!reason) throw new Error('A reason is required for this decision');
    if (reason.length > 500) throw new Error('Reason must be 500 characters or fewer');
    return true;
  }),
]);

const expenseValidation = validate([
  body('type').isIn(EXPENSE_TYPES).withMessage(`Expense type must be one of: ${EXPENSE_TYPES.join(', ')}`),
  body('title').trim().notEmpty().withMessage('Expense title is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('transactionDate').isISO8601().withMessage('Valid transaction date is required'),
]);

router.use(protect);
router.get('/summary', authorize(...REPORT_VIEWERS), getExpenseSummary);
router.get('/recycle-bin', authorize(...FINANCE_EDITORS), getDeletedExpenses);
router.get('/', getExpenses);
router.get('/:id', idParam, getExpense);
router.get('/:id/attachments/:attachmentId', idParam, serveAttachment);
router.post('/', authorize(...FINANCE_EDITORS), upload.array('attachments', 10), expenseValidation, createExpense);
router.post('/:id/attachments', authorize(...FINANCE_EDITORS), idParam, upload.array('attachments', 10), addAttachments);
router.put('/:id', authorize(...FINANCE_EDITORS), idParam, updateExpense);
router.patch('/bulk-approve', authorize(...FINANCE_APPROVERS), bulkApproveExpenses);
// Submitting is the treasurer's act; approving, returning, rejecting and reversing are the
// reviewer's. Different lists on purpose — see constants/roles.js.
router.patch('/:id/submit', authorize(...FINANCE_EDITORS), idParam, submitExpense);
router.patch('/:id/approve', authorize(...FINANCE_APPROVERS), idParam, approveExpense);
router.patch('/:id/return', authorize(...FINANCE_APPROVERS), idParam, reasonValidation, returnExpense);
router.patch('/:id/reject', authorize(...FINANCE_APPROVERS), idParam, reasonValidation, rejectExpense);
router.patch('/:id/reverse', authorize(...FINANCE_APPROVERS), idParam, reasonValidation, reverseExpense);
// Recycle bin: in and out for the officers who record expenses; destruction for administrators.
router.delete('/:id', authorize(...FINANCE_EDITORS), idParam, deleteExpense);
router.patch('/:id/restore', authorize(...FINANCE_EDITORS), idParam, restoreExpense);
router.delete('/:id/permanent', authorize(...ADMINS), idParam, permanentlyDeleteExpense);

module.exports = router;
