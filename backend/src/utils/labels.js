/**
 * Canonical form for a user-typed classification label.
 *
 * Several fields that were closed enums are now free text, so a municipality can record a value the
 * suggested list did not anticipate rather than filing it under "Other". Free text fragments: left
 * alone, "Peace & Order", "peace and order" and "Peace_and_Order" are three different categories to
 * every filter, chart and group-by in the system.
 *
 * Normalising on write collapses them onto the slug form the seeded data already uses, so a typed
 * value groups with an existing one. Display always prettifies it back — nothing user-facing shows
 * the underscore form.
 *
 * It also keeps behaviour that keys off a specific value working: an announcement typed as "Event"
 * still satisfies `type === 'event'`, which is what reveals the event date and location fields.
 */
const normalizeLabel = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

/** The inverse, for display: `peace_and_order` -> `Peace And Order`. */
const prettifyLabel = (value) => (typeof value === 'string'
  ? value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  : value);

module.exports = { normalizeLabel, prettifyLabel };
