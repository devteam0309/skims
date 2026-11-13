const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const validate = require('../middleware/validate');
const { ADMINS, FINANCE_EDITORS, FINANCE_APPROVERS } = require('../constants/roles');
const {
  getLiquidations, getLiquidation, createLiquidation, submitLiquidation, approveLiquidation,
  rejectLiquidation, returnLiquidation, deleteLiquidation, addAttachments, serveAttachment,
  getDeletedLiquidations, restoreLiquidation, permanentlyDeleteLiquidation,
} = require('../controllers/liquidationController');

const idParam = validate([param('id').isMongoId().withMessage('Invalid liquidation ID')]);

// Note: the liquidatedAmount <= totalAmount rule is enforced by the Mongoose model validator (returns 400);
// kept out of here so that business-rule violation stays distinct from a malformed-request 422.
const liquidationValidation = validate([
  body('title').trim().notEmpty().withMessage('Liquidation title is required'),
  body('program').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid program reference'),
  body('budget').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid budget reference'),
  body('totalAmount').isFloat({ min: 0 }).withMessage('Total amount must be a non-negative number'),
  body('liquidatedAmount').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Liquidated amount must be a non-negative number'),
  body('dueDate').optional({ checkFalsy: true }).isISO8601().withMessage('Valid due date is required'),
]);

// Rejecting or returning a report must say why, so the treasurer knows what to fix.
const reasonValidation = validate([
  body().custom((value) => {
    const reason = (value?.reason || value?.remarks || '').trim();
    if (!reason) throw new Error('A reason is required for this decision');
    if (reason.length > 500) throw new Error('Reason must be 500 characters or fewer');
    return true;
  }),
]);

router.use(protect);
router.get('/recycle-bin', authorize(...FINANCE_EDITORS), getDeletedLiquidations);
router.get('/', getLiquidations);
router.get('/:id', idParam, getLiquidation);
router.get('/:id/attachments/:attachmentId', idParam, serveAttachment);
router.post('/', authorize(...FINANCE_EDITORS), upload.array('documents', 20), liquidationValidation, createLiquidation);
router.post('/:id/attachments', authorize(...FINANCE_EDITORS), idParam, upload.array('documents', 20), addAttachments);
router.patch('/:id/submit', authorize(...FINANCE_EDITORS), idParam, submitLiquidation);
router.patch('/:id/approve', authorize(...FINANCE_APPROVERS), idParam, approveLiquidation);
router.patch('/:id/reject', authorize(...FINANCE_APPROVERS), idParam, reasonValidation, rejectLiquidation);
router.patch('/:id/return', authorize(...FINANCE_APPROVERS), idParam, reasonValidation, returnLiquidation);
// Recycle bin: in and out for the officers who file reports; destruction for administrators.
router.delete('/:id', authorize(...FINANCE_EDITORS), idParam, deleteLiquidation);
router.patch('/:id/restore', authorize(...FINANCE_EDITORS), idParam, restoreLiquidation);
router.delete('/:id/permanent', authorize(...ADMINS), idParam, permanentlyDeleteLiquidation);

module.exports = router;
