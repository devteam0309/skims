const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { ADMINS } = require('../constants/roles');
const {
  getUsers, getUser, approveUser, rejectUser,
  updateUserRole, toggleUserStatus, deleteUser, getPendingApprovals,
} = require('../controllers/userController');

router.use(protect);
router.get('/', authorize(...ADMINS), getUsers);
router.get('/pending', authorize(...ADMINS), getPendingApprovals);
router.get('/:id', getUser);
router.put('/:id/approve', authorize(...ADMINS), approveUser);
router.put('/:id/reject', authorize(...ADMINS), rejectUser);
router.put('/:id/role', authorize('super_admin', 'provincial_admin'), updateUserRole);
router.put('/:id/toggle-status', authorize(...ADMINS), toggleUserStatus);
router.delete('/:id', authorize('super_admin'), deleteUser);

module.exports = router;
