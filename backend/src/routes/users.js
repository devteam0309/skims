const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getUsers, getUser, approveUser, rejectUser,
  updateUserRole, toggleUserStatus, deleteUser, getPendingApprovals,
} = require('../controllers/userController');

router.use(protect);

/*
 * Account administration is a super_admin privilege. Provincial and municipal admins were removed
 * from it at the panel's request — and these guards are what enforce that; the hidden sidebar entry
 * is not. `GET /:id` stays open to any signed-in user because it backs profile views, and is
 * municipality-scoped inside the controller.
 */
router.get('/', authorize('super_admin'), getUsers);
router.get('/pending', authorize('super_admin'), getPendingApprovals);
router.get('/:id', getUser);
router.put('/:id/approve', authorize('super_admin'), approveUser);
router.put('/:id/reject', authorize('super_admin'), rejectUser);
router.put('/:id/role', authorize('super_admin'), updateUserRole);
router.put('/:id/toggle-status', authorize('super_admin'), toggleUserStatus);
router.delete('/:id', authorize('super_admin'), deleteUser);

module.exports = router;
