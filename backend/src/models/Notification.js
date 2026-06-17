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
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    expiresAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });
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

module.exports = mongoose.model('Notification', notificationSchema);
