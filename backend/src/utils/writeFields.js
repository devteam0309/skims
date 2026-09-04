/**
 * Turn a submitted form body into a safe Mongoose write.
 *
 * Two problems, one helper:
 *
 * 1. **Mass assignment.** Only whitelisted keys survive. This is the existing convention; it is
 *    folded in here so a caller cannot apply the blank handling and forget the whitelist.
 *
 * 2. **Blank strings.** Frontend forms submit their whole shape, so any field the user left alone
 *    arrives as `''`. Mongoose cannot cast that to an ObjectId, Date or Number and throws a
 *    CastError, which fails the entire write. This is what made the Programs module unusable for
 *    a whole panel round: an unlinked budget posted `budgetRef: ''` and the save was rejected.
 *
 * What a blank *means* depends on the schema, which is why this consults it rather than guessing:
 *
 *   - blank on an **optional** path → `$unset`. This is the only way to clear a field; treating it
 *     as "no change" would make an optional value writable once and never removable.
 *   - blank on a **required** path → **ignored**, leaving whatever is stored. There is no valid
 *     empty state for a required field, so `$unset` would swap a CastError for a ValidationError
 *     and fail the write just the same. The form's own validation is what should stop the user
 *     getting here; the server simply declines to act on it.
 *
 * `false` and `0` are values, not blanks — an `isPublic: false` or an `amount: 0` must survive.
 */
const isBlank = (v) => v === '' || v === null || v === undefined;

const isRequiredPath = (Model, key) => {
  const path = Model.schema?.path(key);
  return Boolean(path?.isRequired);
};

/**
 * @param {import('mongoose').Model} Model  the model being written to
 * @param {object} body                     req.body
 * @param {string[]} allowed                the field whitelist
 * @returns {{ set: object, unset: string[] }}
 */
const pickWritable = (Model, body, allowed) => {
  const permitted = Object.entries(body || {}).filter(([k]) => allowed.includes(k));
  const set = {};
  const unset = [];

  for (const [key, value] of permitted) {
    if (!isBlank(value)) set[key] = value;
    else if (!isRequiredPath(Model, key)) unset.push(key);
    // else: required and blank — leave the stored value alone.
  }

  return { set, unset };
};

/**
 * The same rules for a create, where there is nothing to unset: blanks are simply dropped so the
 * schema defaults apply.
 */
const pickCreatable = (Model, body, allowed) => pickWritable(Model, body, allowed).set;

/** Build the update document. Returns `{}` when there is nothing to do, which callers should skip. */
const toMutation = ({ set, unset }) => {
  const mutation = {};
  if (Object.keys(set).length) mutation.$set = set;
  if (unset.length) mutation.$unset = Object.fromEntries(unset.map((k) => [k, '']));
  return mutation;
};

module.exports = { pickWritable, pickCreatable, toMutation, isBlank };
