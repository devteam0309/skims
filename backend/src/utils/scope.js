/**
 * Municipality and barangay scoping, in one place.
 *
 * Every module already forced `municipality` from `req.user`; each did it with its own three or
 * four lines, which is how `getDocuments` and `getLiquidations` came to use an inline
 * `!== 'super_admin' && !== 'provincial_admin'` pair and silently exclude `dilg_representative`.
 * Barangay scoping is added here rather than repeated per controller so the same mistake cannot be
 * made a second time in a second dimension.
 *
 * ## Barangay semantics
 *
 * Municipality → Barangay → SK account. An SK officer's barangay comes from their account and is
 * never read from the request: `?barangay=`, a body field and a hidden form input are all ignored
 * for a barangay-bound account, so there is nothing to tamper with.
 *
 * A record with NO barangay is a municipality-level record and stays visible to the whole
 * municipality. That is deliberate and load-bearing:
 *
 *   - every record that existed before this change has no barangay, so treating "no barangay" as
 *     "not mine" would have blanked the Programs, Youth, Expenses and Documents pages for every
 *     barangay-bound officer on the day it shipped;
 *   - budgets are drawn per municipality and fiscal year, so municipality-level records are a real
 *     and continuing category, not only a legacy one.
 *
 * What the rule forbids is the thing that was asked for: an officer in Barangay A never sees or
 * writes a record belonging to Barangay B.
 *
 * ## Fail closed
 *
 * A scoped account with no municipality matches `{ $in: [] }` — nothing — rather than having the
 * key dropped from the filter. Mongoose 8 happens to treat an `undefined` value as null, so an
 * omitted assignment fails closed by accident today; saying "match nothing" outright does not
 * depend on that.
 */
const mongoose = require('mongoose');
const { CROSS_MUNICIPALITY_READ, CROSS_MUNICIPALITY_WRITE } = require('../constants/roles');

/** Ids arrive populated (`{ _id, name }`) or raw depending on the query that loaded them. */
const idOf = (value) => {
  const id = value?._id || value;
  return id ? id.toString() : null;
};

/**
 * The same id as a real ObjectId, for use inside a FILTER rather than a comparison.
 *
 * `find()` casts a string id against the schema, so a string works there. An aggregation `$match`
 * does not: the pipeline is passed to the server as written, a string never equals an ObjectId, and
 * the stage matches nothing at all. Every scoped stats and summary endpoint runs through an
 * aggregation, so a filter built from `idOf` alone would silently report zero of everything to every
 * scoped account — caught by the document-stats test in barangayScope.test.js.
 */
const objectIdOf = (value) => {
  const id = idOf(value);
  return id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
};

/**
 * Roles whose operational scope narrows to a single barangay.
 *
 * The three admin tiers are municipality-wide (or wider) by design, and `dilg_representative` is
 * provincial oversight — none of them is bound to one barangay even if a barangay is recorded on
 * the account. `youth` is scoped by its own registry record, not by this.
 */
const BARANGAY_BOUND_ROLES = ['sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad'];

/** The barangay an account is confined to, or null if it spans its whole municipality. */
const barangayScopeOf = (user) =>
  (BARANGAY_BOUND_ROLES.includes(user?.role) ? idOf(user?.barangay) : null);

const municipalityScopeOf = (user) => idOf(user?.municipality);

/** True when the account may read outside its own municipality. */
const spansMunicipalitiesForRead = (user) => CROSS_MUNICIPALITY_READ.includes(user?.role);

/** True when the account may WRITE outside its own municipality. Never use this for a read. */
const spansMunicipalitiesForWrite = (user) => CROSS_MUNICIPALITY_WRITE.includes(user?.role);

/**
 * Narrow a list filter to what `user` may read, mutating and returning it.
 *
 * Pass `barangay: false` for collections that have no barangay of their own (budgets and
 * liquidations are municipality-level documents) — the municipality half still applies.
 *
 * `requestedBarangay` is honoured only for accounts that are not barangay-bound; for everyone else
 * the account's own barangay wins, so a supplied value can only ever narrow, never widen.
 */
const applyReadScope = (filter, user, { barangay = true, requestedBarangay } = {}) => {
  const ownBarangay = barangay ? objectIdOf(barangayScopeOf(user)) : null;

  if (!spansMunicipalitiesForRead(user)) {
    filter.municipality = objectIdOf(user?.municipality) || { $in: [] };
  }

  if (ownBarangay) {
    // Own barangay, plus the municipality-level records that belong to no barangay. `$or` would
    // collide with a search term's own `$or`, so this is expressed on the field itself.
    filter.barangay = { $in: [ownBarangay, null] };
  } else if (barangay && requestedBarangay) {
    const requested = objectIdOf(requestedBarangay);
    // An unparseable id matches nothing rather than being dropped, which would widen the query.
    filter.barangay = requested || { $in: [] };
  }

  return filter;
};

/**
 * Whether `user` may write `resource`, as a reason string or null when allowed.
 *
 * The reason is returned rather than thrown so callers keep their own 403 wording and status.
 */
const writeScopeViolation = (resource, user, { barangay = true } = {}) => {
  if (spansMunicipalitiesForWrite(user)) return null;

  const ownMunicipality = municipalityScopeOf(user);
  if (!ownMunicipality || idOf(resource?.municipality) !== ownMunicipality) {
    return 'This record belongs to another municipality';
  }

  if (barangay) {
    const ownBarangay = barangayScopeOf(user);
    const recordBarangay = idOf(resource?.barangay);
    // A record with no barangay is municipality-level and stays writable; one that names a
    // different barangay never is.
    if (ownBarangay && recordBarangay && recordBarangay !== ownBarangay) {
      return 'This record belongs to another barangay';
    }
  }

  return null;
};

/**
 * The read-side counterpart of `writeScopeViolation`, for a record fetched by id.
 *
 * Separate from the write check because the two lists differ: `dilg_representative` reads the whole
 * province and writes in none of it, so using the write check to gate a read is what once left a
 * DILG account looking at an empty Documents page.
 */
const readScopeViolation = (resource, user, { barangay = true } = {}) => {
  if (spansMunicipalitiesForRead(user)) return null;

  const ownMunicipality = municipalityScopeOf(user);
  if (!ownMunicipality || idOf(resource?.municipality) !== ownMunicipality) {
    return 'This record belongs to another municipality';
  }

  if (barangay) {
    const ownBarangay = barangayScopeOf(user);
    const recordBarangay = idOf(resource?.barangay);
    if (ownBarangay && recordBarangay && recordBarangay !== ownBarangay) {
      return 'This record belongs to another barangay';
    }
  }

  return null;
};

/**
 * Whether a create payload tries to name a scope the caller does not have, as a reason or null.
 *
 * `forceScopeOnCreate` below already makes the attempt harmless by overwriting both fields, so this
 * is not what provides the security — it provides the honest answer. Silently relocating a record
 * the caller explicitly filed elsewhere tells them the write succeeded as asked, and it did not.
 * Refusing says so, and the two together mean a tampered request is both rejected and incapable of
 * landing anywhere it should not.
 */
const createScopeViolation = (body, user, { barangay = true } = {}) => {
  if (spansMunicipalitiesForWrite(user)) return null;

  const ownMunicipality = municipalityScopeOf(user);
  if (body?.municipality && idOf(body.municipality) !== ownMunicipality) {
    return 'Cannot create records for another municipality';
  }

  if (barangay) {
    const ownBarangay = barangayScopeOf(user);
    if (ownBarangay && body?.barangay && idOf(body.barangay) !== ownBarangay) {
      return 'Cannot create records for another barangay';
    }
  }

  return null;
};

/**
 * Force `municipality` and `barangay` onto a create payload.
 *
 * The body value is ignored for any scoped role — a field whitelist alone does not prevent a
 * scoped user from assigning a new record to somewhere else, which is exactly how `createBudget`
 * once let one through. Province-wide roles may name a municipality and fall back to their own.
 */
const forceScopeOnCreate = (data, user, { barangay = true } = {}) => {
  if (spansMunicipalitiesForWrite(user)) {
    if (!data.municipality) data.municipality = municipalityScopeOf(user);
  } else {
    data.municipality = municipalityScopeOf(user);
  }

  if (barangay) {
    const ownBarangay = barangayScopeOf(user);
    // Bound accounts file into their own barangay whatever the payload says. Unbound accounts may
    // target one, which routes/validators check against the municipality before it is stored.
    if (ownBarangay) data.barangay = ownBarangay;
  }

  return data;
};

module.exports = {
  idOf,
  objectIdOf,
  BARANGAY_BOUND_ROLES,
  barangayScopeOf,
  municipalityScopeOf,
  spansMunicipalitiesForRead,
  spansMunicipalitiesForWrite,
  applyReadScope,
  writeScopeViolation,
  readScopeViolation,
  createScopeViolation,
  forceScopeOnCreate,
};
