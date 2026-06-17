const mongoose = require('mongoose');

const municipalitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    province: { type: String, default: 'Marinduque' },
    region: { type: String, default: 'MIMAROPA' },
    totalBarangays: { type: Number, default: 0 },
    skFederationName: { type: String },
    federationChairperson: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    annualBudget: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Municipality', municipalitySchema);
