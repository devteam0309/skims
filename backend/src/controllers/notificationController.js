const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

exports.getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, isRead } = req.query;
  const filter = { recipient: req.user._id };
  if (isRead !== undefined) filter.isRead = isRead === 'true';

  const { safePage, safeLimit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: MAX_LIMIT });
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: req.user._id, isRead: false }),
  ]);
  res.json({ success: true, data: notifications, meta: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit), unreadCount } });
});

exports.markAsRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { isRead: true, readAt: new Date() }
  );
  if (!n) return errorResponse(res, 404, 'Notification not found');
  successResponse(res, 200, 'Notification marked as read');
});

exports.markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true, readAt: new Date() });
  successResponse(res, 200, 'All notifications marked as read');
});

exports.deleteNotification = asyncHandler(async (req, res) => {
  const n = await Notification.findOne({ _id: req.params.id, recipient: req.user._id });
  if (!n) return errorResponse(res, 404, 'Notification not found');
  await n.deleteOne();
  successResponse(res, 200, 'Notification deleted');
});

exports.getUnreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
  successResponse(res, 200, 'Unread count', { count });
});
