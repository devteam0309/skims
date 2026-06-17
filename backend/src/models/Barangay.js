const mongoose = require('mongoose');

const barangaySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    municipality: { type: mongoose.Schema.Types.ObjectId, ref: 'Municipality', required: true },
    skChairperson: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    population: { type: Number, default: 0 },
    youthPopulation: { type: Number, default: 0 },
    annualBudget: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

barangaySchema.index({ municipality: 1 });
barangaySchema.index({ name: 1, municipality: 1 }, { unique: true });

module.exports = mongoose.model('Barangay', barangaySchema);
