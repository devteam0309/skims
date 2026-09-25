/**
 * Referential check for a barangay against its parent municipality.
 *
 * Mongoose validates that a ref is a well-formed ObjectId, never that it is the *right* one, so
 * without this a Boac youth could be stored with a Gasan barangay. The per-municipality dropdown
 * then cannot find it and the field renders blank, which reads as "barangay won't save" rather than
 * as the cross-municipality write it actually is.
 *
 * Lived in `routes/youth.js` until programs and user barangay assignment needed the same check.
 */
const mongoose = require('mongoose');
const Barangay = require('../models/Barangay');

/** 'ok' (valid, or none given) · 'invalid' (malformed/absent) · 'mismatch' (belongs elsewhere). */
const checkBarangay = async (barangayId, municipalityId) => {
  if (!barangayId) return 'ok';
  if (!mongoose.Types.ObjectId.isValid(barangayId)) return 'invalid';
  const b = await Barangay.findById(barangayId).select('municipality');
  if (!b) return 'invalid';
  return b.municipality?.toString() === municipalityId?.toString() ? 'ok' : 'mismatch';
};

const barangayErrorMessage = (result) =>
  (result === 'invalid'
    ? 'The selected barangay does not exist'
    : 'The selected barangay does not belong to this municipality');

module.exports = { checkBarangay, barangayErrorMessage };
