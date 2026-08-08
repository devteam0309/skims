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

module.exports = { cloudinary, uploadToCloudinary, destroyQuietly };
