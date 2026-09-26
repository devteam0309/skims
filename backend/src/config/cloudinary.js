const path = require('path');
const { randomUUID } = require('crypto');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    stream.end(buffer);
  });

/**
 * Upload options for a NON-image file, with the extension kept on the public_id.
 *
 * A `raw` asset is stored and served exactly as named, so a public_id of a bare UUID produces a
 * delivery URL with no extension — and Cloudinary then answers
 * `Content-Type: application/octet-stream` with `filename="<uuid>"`. The bytes are intact, but the
 * browser saves something Windows will not open, and the Media Library lists it as an anonymous raw
 * blob rather than a PDF. Every document, expense attachment and liquidation attachment uploaded
 * before this was stored that way.
 *
 * The UUID still supplies the uniqueness — the original name is never used as the id, because it is
 * attacker-supplied and would collide. Only the extension is carried over, and only when it is one
 * `middleware/fileUpload.js` already admits, so nothing unexpected reaches the id.
 */
/*
 * ⚠️ PDF and ZIP are deliberately excluded, and this is NOT a code limitation.
 *
 * Cloudinary blocks delivery of PDF and ZIP assets by default — an account-level security setting
 * added after PDFs were used as an attack vector. With `.pdf` on the public_id the CDN classifies
 * the delivery as a PDF and answers **401**; without it, the same bytes are served as an anonymous
 * raw blob with 200. Measured both ways on this account.
 *
 * So the extension is carried for every type that is not restricted (xlsx, docx, csv, images…),
 * which fixes their content type today, and withheld for pdf/zip so those keep downloading at all.
 *
 * To lift it: Cloudinary console → Settings → Security → enable "Allow delivery of PDF and ZIP
 * files", then delete RESTRICTED_BY_CLOUDINARY below and re-upload (or re-seed). Nothing else
 * changes; the content type starts coming back correct for PDFs too.
 */
const RESTRICTED_BY_CLOUDINARY = ['.pdf', '.zip'];

const rawUploadOptions = (originalName, folder = 'skims/documents') => {
  const ext = path.extname(originalName || '').toLowerCase();
  const usable = /^\.[a-z0-9]{1,5}$/.test(ext) && !RESTRICTED_BY_CLOUDINARY.includes(ext);
  return { folder, resource_type: 'raw', public_id: `${randomUUID()}${usable ? ext : ''}` };
};

/**
 * Best-effort removal of a previously uploaded asset.
 *
 * Every call site wrote `cloudinary.uploader.destroy(id, opts).catch(() => {})`, which handles a
 * rejected promise but not a synchronous throw — and the SDK throws synchronously when it has no
 * credentials, with a plain object rather than an Error, so `err.message` is `undefined`.
 *
 * The distinction is easy to miss because it depends on how the credentials are absent: configured
 * with empty strings the SDK returns a promise and the `.catch` works, but with the variables
 * genuinely unset (`undefined`) it throws before a promise exists. So a machine with a populated
 * .env behaves differently from one without — which is why this failed only on CI, and why every
 * CI run on this repository has been red since the first commit.
 *
 * The consequence was worse than a failed cleanup: the throw escaped mid-handler, after the record
 * had already been soft-deleted, so the caller got a 500 for an operation that had in fact
 * succeeded. Cleanup is a courtesy to Cloudinary's storage quota and must never decide the
 * response.
 */
const destroyQuietly = (publicId, options = {}) => {
  if (!publicId) return;
  try {
    const result = cloudinary.uploader.destroy(publicId, options);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Deliberately swallowed — see above.
  }
};

module.exports = { cloudinary, uploadToCloudinary, destroyQuietly, rawUploadOptions };
