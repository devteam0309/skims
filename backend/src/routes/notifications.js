const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { getNotifications, markAsRead, markAllAsRead, deleteNotification, getUnreadCount } = require('../controllers/notificationController');

const idParam = validate([param('id').isMongoId().withMessage('Invalid notification ID')]);

router.use(protect);
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read-all', markAllAsRead);
router.put('/:id/read', idParam, markAsRead);
router.delete('/:id', idParam, deleteNotification);

module.exports = router;
