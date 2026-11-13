const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    type: {
      type: String,
      // Free text, normalised on write. Normalisation matters here beyond grouping: the event
      // date and location fields are revealed by `type === 'event'`, so a value typed as "Event"
      // has to canonicalise to the same string or those fields silently disappear.
      trim: true,
      maxlength: 60,
      default: 'announcement',
    },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality' },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /*
     * The authority the announcement was issued under, frozen at creation.
     *
     * Who may change an announcement depends on who issued it: an officer may edit their own, and
     * an administrator may edit those issued by a LOWER authority within their reach — so a
     * barangay officer can never alter what the municipal, provincial or DILG level published.
     * Recorded rather than read from the author's account each time, because the account's role
     * can change later and the announcement was issued under the one it had then.
     */
    authorRole: { type: String },
    // e.g. "Municipal SK Federation — Boac". Derived from the author at creation, never typed, so
    // an announcement cannot claim to come from an office its author does not hold.
    issuingOffice: { type: String, trim: true, maxlength: 160 },
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
