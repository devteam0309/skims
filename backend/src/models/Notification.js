const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'deadline_reminder',
        'compliance_alert',
        'approval_request',
        'approval_granted',
        'approval_rejected',
        'budget_overrun',
        'program_delay',
        'document_uploaded',
        'liquidation_due',
        'new_assignment',
        'system',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: String,
    isRead: { type: Boolean, default: false },
    readAt: Date,
    data: { type: mongoose.Schema.Types.Mixed },
    /*
     * urgent > high > medium > low. The values are unchanged — 'medium' is this project's word for
     * a normal notification and is used by ~20 call sites — but they sort alphabetically, which puts
     * "urgent" last and "high" second. Ordering is therefore done on PRIORITY_RANK below rather than
     * on the string, so the list can be sorted by urgency in the database instead of per page.
     */
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    expiresAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });
// Serves the default listing: highest priority first, newest first within a priority.
notificationSchema.index({ recipient: 1, priority: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Auto-set 90-day expiry so the TTL index actually fires
notificationSchema.pre('save', function (next) {
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  }
  next();
});

// insertMany bypasses pre-save hooks; set expiresAt via a static helper
notificationSchema.statics.createWithExpiry = function (docs) {
  const expiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const normalized = Array.isArray(docs) ? docs : [docs];
  return this.insertMany(normalized.map((d) => ({ ...d, expiresAt: d.expiresAt || expiry })));
};

/**
 * Sort weight per priority, highest first. Exported so the controller and any future consumer
 * cannot disagree about what "most urgent" means.
 */
const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.PRIORITY_RANK = PRIORITY_RANK;
