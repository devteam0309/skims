const mongoose = require('mongoose');
const { calculateAge } = require('../utils/age');

const youthMemberSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    birthDate: { type: Date, required: true },
    // Free text rather than an enum. 'other' collapsed every identity that is not male or female
    // into one unusable bucket; a member who identifies as LGBTQIA+ can now be recorded as such.
    // Length-capped so it stays a short label rather than a note field.
    gender: { type: String, required: true, trim: true, maxlength: 40 },
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
  // The registry table reads `age`, `isSkEligible` and `isActive` together to say who is still
  // under the SK, so the virtuals have to survive serialisation.
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

youthMemberSchema.virtual('age').get(function () {
  return calculateAge(this.birthDate);
});

// SK membership is defined by the Sangguniang Kabataan age band. A member who has aged past it is
// still a valid registry record — a historical one — but is no longer under the SK, which is the
// distinction the registry could not previously show.
const SK_MIN_AGE = 15;
const SK_MAX_AGE = 30;
youthMemberSchema.virtual('isSkEligible').get(function () {
  const age = calculateAge(this.birthDate);
  return age !== null && age !== undefined && age >= SK_MIN_AGE && age <= SK_MAX_AGE;
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
