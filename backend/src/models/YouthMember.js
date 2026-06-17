const mongoose = require('mongoose');

const youthMemberSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    birthDate: { type: Date, required: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    email: { type: String, lowercase: true, trim: true },
    contactNumber: String,
    address: String,
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality', required: true },
    barangay: { type: mongoose.Schema.Types.ObjectId, ref: 'Barangay' },
    educationalAttainment: {
      type: String,
      enum: ['elementary', 'high_school', 'college', 'vocational', 'graduate', 'out_of_school'],
    },
    occupation: String,
    isRegisteredVoter: { type: Boolean, default: false },
    registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    programParticipations: [
      {
        program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
        joinedAt: { type: Date, default: Date.now },
        role: String,
      },
    ],
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

youthMemberSchema.virtual('age').get(function () {
  if (!this.birthDate) return null;
  return Math.floor((Date.now() - this.birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
});

youthMemberSchema.index({ municipality: 1, barangay: 1 });
youthMemberSchema.index({ lastName: 1, firstName: 1 });
youthMemberSchema.index({ deletedAt: 1 });
// DB-level duplicate prevention: same person cannot be registered twice in the same municipality
youthMemberSchema.index(
  { firstName: 1, lastName: 1, birthDate: 1, municipality: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, name: 'youth_dedup_unique' }
);

module.exports = mongoose.model('YouthMember', youthMemberSchema);
