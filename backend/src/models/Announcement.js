const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    type: {
      type: String,
      enum: ['announcement', 'event', 'news', 'deadline', 'alert'],
      default: 'announcement',
    },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality' },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isPublic: { type: Boolean, default: true },
    publishedAt: Date,
    expiresAt: Date,
    attachments: [{ fileName: String, fileUrl: String }],
    eventDate: Date,
    eventLocation: String,
    isPinned: { type: Boolean, default: false },
    viewCount: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

announcementSchema.index({ isPublic: 1, deletedAt: 1 });
announcementSchema.index({ municipality: 1 });
announcementSchema.index({ type: 1 });

module.exports = mongoose.model('Announcement', announcementSchema);
