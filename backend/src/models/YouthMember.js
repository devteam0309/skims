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
    /*
     * Required for a youth who registered themselves — it is their login — and optional for a
     * record SK staff entered on someone's behalf, because part of the point of keeping the staff
     * path is youth with no email address at all. The unique index below is therefore sparse.
     */
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
    // The login this registry record belongs to, when the youth has one. Absent for records
    // staff entered on behalf of someone who has not signed up.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /*
     * The registry is an official roster, so a record nobody has vouched for is marked as such.
     * A self-registered youth can log in and use the system immediately — this does not gate
     * them — but SK staff can see at a glance which entries they have not confirmed.
     */
    verificationStatus: {
      type: String,
      enum: ['unverified', 'verified'],
      default: 'unverified',
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: Date,
    /*
     * Joining is a request, not an immediate enrolment: SK staff confirm or decline it. Only
     * confirmed entries count as participation, which is what the programme cap is measured
     * against — a request is not a slot.
     */
    programParticipations: [
      {
        program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
        status: { type: String, enum: ['pending', 'confirmed', 'declined'], default: 'pending' },
        requestedAt: { type: Date, default: Date.now },
        decidedAt: Date,
        decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        declineReason: String,
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

/*
 * A youth is identified by their full name and email. Sparse on purpose — `$type: 'string'`
 * restricts the index to records that actually carry an email, so the many staff-entered records
 * without one do not all collide on a shared null.
 *
 * The name+birthDate index above is kept alongside it rather than replaced: this one cannot see a
 * duplicate whose email is absent, and two emailless records for the same person are exactly what
 * that older index exists to stop.
 */
youthMemberSchema.index(
  { firstName: 1, lastName: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null, email: { $type: 'string' } },
    name: 'youth_name_email_unique',
  }
);

// One registry record per login.
youthMemberSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { user: { $type: 'objectId' } }, name: 'youth_user_unique' }
);

module.exports = mongoose.model('YouthMember', youthMemberSchema);
