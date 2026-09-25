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

    /*
     * An array is appended one element at a time, under the same key.
     *
     * `fd.append(key, ['a', 'b'])` stringifies it to "a,b" — a single field holding a comma-joined
     * blob, which arrives at a handler expecting a list and is silently discarded as the wrong type.
     * Repeating the key is what multer turns back into an array. An empty array appends nothing,
     * which is the correct representation of "none selected".
     */
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null || item === '') return;
        fd.append(key, item);
      });
      return;
    }

    fd.append(key, value);
  });
  return fd;
}

export default toFormData;
