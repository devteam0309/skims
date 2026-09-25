const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const {
  getUsers, getUser, approveUser, rejectUser,
  updateUserRole, toggleUserStatus, deleteUser, getPendingApprovals,
  getPendingEmailChanges, approveEmailChange, rejectEmailChange, updateUserBarangay,
} = require('../controllers/userController');

const idParam = validate([param('id').isMongoId().withMessage('Invalid user ID')]);
// Clearing the assignment is legitimate, so an empty value is allowed; a present one must be an id.
const barangayValidation = validate([
  body('barangay').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid barangay ID'),
]);

router.use(protect);

/*
 * Account administration is a super_admin privilege. Provincial and municipal admins were removed
 * from it at the panel's request — and these guards are what enforce that; the hidden sidebar entry
 * is not. `GET /:id` stays open to any signed-in user because it backs profile views, and is
 * municipality-scoped inside the controller.
 */
router.get('/', authorize('super_admin'), getUsers);
router.get('/pending', authorize('super_admin'), getPendingApprovals);
// Declared before '/:id' so "email-changes" is not parsed as a user id.
router.get('/email-changes', authorize('super_admin'), getPendingEmailChanges);
router.get('/:id', getUser);
router.put('/:id/approve', authorize('super_admin'), approveUser);
router.put('/:id/reject', authorize('super_admin'), rejectUser);
router.put('/:id/role', authorize('super_admin'), updateUserRole);
router.put('/:id/toggle-status', authorize('super_admin'), toggleUserStatus);
/*
 * Email changes are approved here and nowhere else. `PUT /api/auth/me` does not accept `email`, so
 * these two routes are the only path by which a user's address can change at all.
 */
router.put('/:id/email-change/approve', authorize('super_admin'), idParam, approveEmailChange);
router.put('/:id/email-change/reject', authorize('super_admin'), idParam, rejectEmailChange);
// Barangay assignment: what makes barangay-level scope usable for SK accounts.
router.put('/:id/barangay', authorize('super_admin'), idParam, barangayValidation, updateUserBarangay);
router.delete('/:id', authorize('super_admin'), deleteUser);

module.exports = router;
