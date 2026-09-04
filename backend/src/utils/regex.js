/**
 * Neutralise regex metacharacters in user input before it reaches a `$regex` query.
 *
 * A search term is data, not a pattern: unescaped, `.` matches anything and a term such as
 * `(a+)+$` is a ReDoS vector. Every `$regex` built from a query parameter goes through here.
 *
 * Previously copy-pasted into routes/youth.js and userController.js; this is the shared copy.
 */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { escapeRegex };
