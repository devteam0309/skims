/**
 * Build a multipart body from a plain form object.
 *
 * Both funds pages that upload attachments had this same four-line block inlined in their
 * mutationFn. On the expenses page the submit handler *also* built a FormData and passed that in,
 * so the block ran `Object.entries()` over a FormData instance — which has no own enumerable
 * properties and therefore yields `[]`. Every field was silently dropped and the request went out
 * empty; the server then rejected it on the very fields the user had just filled in.
 *
 * Passing an existing FormData straight through makes that failure impossible to reintroduce:
 * the helper is idempotent, so it no longer matters whether a caller hands over the raw values or
 * an already-built body.
 */
export function toFormData(values) {
  if (values instanceof FormData) return values;

  const fd = new FormData();
  Object.entries(values || {}).forEach(([key, value]) => {
    // Skip only genuinely absent fields. The previous truthiness check also discarded 0 and
    // false, which are meaningful values for an amount or a flag.
    if (value === undefined || value === null || value === '') return;
    fd.append(key, value);
  });
  return fd;
}

export default toFormData;
