const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const validate = require('../middleware/validate');
const { ADMINS, FINANCE_STAFF, REPORTERS } = require('../constants/roles');
const { getLiquidations, getLiquidation, createLiquidation, submitLiquidation, approveLiquidation, rejectLiquidation, deleteLiquidation } = require('../controllers/liquidationController');

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

router.use(protect);
router.get('/', getLiquidations);
router.get('/:id', idParam, getLiquidation);
router.post('/', authorize(...FINANCE_STAFF), upload.array('documents', 20), liquidationValidation, createLiquidation);
router.patch('/:id/submit', authorize(...FINANCE_STAFF), idParam, submitLiquidation);
router.patch('/:id/approve', authorize(...REPORTERS), idParam, approveLiquidation);
router.patch('/:id/reject', authorize(...REPORTERS), idParam, rejectLiquidation);
router.delete('/:id', authorize(...ADMINS), idParam, deleteLiquidation);

module.exports = router;
