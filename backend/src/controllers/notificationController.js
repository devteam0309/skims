const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');
const { PRIORITY_RANK } = require('../models/Notification');
const { successResponse, errorResponse, paginatedResponse, parsePagination } = require('../utils/apiResponse');

const MAX_LIMIT = 100;

exports.getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, isRead } = req.query;
  const filter = { recipient: req.user._id };
  if (isRead !== undefined) filter.isRead = isRead === 'true';

  const { safePage, safeLimit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: MAX_LIMIT });

  /*
   * Most urgent first, newest first within a priority.
   *
   * The list was ordered by `createdAt` alone, so an urgent budget-overrun alert was pushed down the
   * page by whatever routine notification arrived after it. Sorting on the priority STRING would be
   * worse than no sort at all — alphabetically "high" < "low" < "medium" < "urgent" — so the rank is
   * projected first and sorted on. Done in the database, before skip/limit, or the ordering would
   * only hold within whichever page happened to be fetched.
   *
   * `?sort=newest` keeps the old behaviour for a caller that wants a strict timeline.
   */
  const byNewestOnly = req.query.sort === 'newest';
  const pipeline = [
    { $match: filter },
    { $addFields: { priorityRank: { $switch: {
      branches: Object.entries(PRIORITY_RANK).map(([value, rank]) => ({ case: { $eq: ['$priority', value] }, then: rank })),
      default: PRIORITY_RANK.medium,
    } } } },
    { $sort: byNewestOnly ? { createdAt: -1 } : { priorityRank: -1, createdAt: -1 } },
    { $skip: skip },
    { $limit: safeLimit },
    { $project: { priorityRank: 0 } },
  ];

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.aggregate(pipeline),
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
