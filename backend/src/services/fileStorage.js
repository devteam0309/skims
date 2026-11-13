/**
 * Where uploaded files live, and the only way they are read back.
 *
 * ## Why files are private now
 *
 * Every upload used to be a public Cloudinary asset: the record held its delivery URL, list and
 * detail responses returned that URL, and anyone holding it could fetch the file for ever, signed in
 * or not. The id documents applicants now submit at registration, and the receipts behind every
 * expense, cannot be handled that way — the panel's rule is that access to an attachment is decided
 * by an authenticated, authorised request, every time.
 *
 * So new uploads are stored with Cloudinary's `authenticated` delivery type. Such an asset cannot be
 * fetched without a URL signed with the account's API secret, which only this server holds. The
 * server checks the caller's role and scope, fetches the file with a freshly signed URL and streams
 * the bytes back; the signed URL never leaves the server and no stored field can be replayed.
 *
 * Records written before this keep working: they carry no `storageType` (read as `cloudinary`, the
 * old public kind) and are still served by redirecting to their stored URL, exactly as before.
 *
 * ## Drivers
 *
 * `FILE_STORAGE_DRIVER=memory` keeps files in process memory. The test suite uses it so uploads need
 * no Cloudinary credentials, and so does an isolated end-to-end run, which must not write to the
 * real account. It is refused in production, where a restart would lose every file.
 */
const { randomUUID } = require('crypto');
const { cloudinary, uploadToCloudinary, destroyQuietly, rawUploadOptions } = require('../config/cloudinary');

const STORAGE = { PUBLIC: 'cloudinary', PRIVATE: 'cloudinary_private', MEMORY: 'memory' };

const memoryFiles = new Map();

const driver = () => {
  const chosen = (process.env.FILE_STORAGE_DRIVER || 'cloudinary').toLowerCase();
  if (chosen === 'memory' && process.env.NODE_ENV === 'production') {
    throw new Error('FILE_STORAGE_DRIVER=memory is not allowed in production — files would be lost on restart');
  }
  return chosen;
};

const isImage = (mimeType) => typeof mimeType === 'string' && mimeType.startsWith('image/');

/**
 * Store an uploaded (multer, memoryStorage) file privately.
 *
 * Returns a reference to keep on the owning record. It deliberately contains no usable URL: the
 * file is reachable only through `sendFile` below.
 */
const storeFile = async (file, { folder = 'skims/documents' } = {}) => {
  const base = {
    originalName: file.originalname,
    fileType: file.mimetype,
    fileSize: file.size,
    uploadedAt: new Date(),
  };

  if (driver() === 'memory') {
    const publicId = `${folder}/${randomUUID()}`;
    memoryFiles.set(publicId, { buffer: Buffer.from(file.buffer), mimeType: file.mimetype });
    return { ...base, storageType: STORAGE.MEMORY, publicId, resourceType: isImage(file.mimetype) ? 'image' : 'raw' };
  }

  const options = isImage(file.mimetype)
    ? { folder, resource_type: 'image', public_id: randomUUID() }
    : rawUploadOptions(file.originalname, folder);
  const result = await uploadToCloudinary(file.buffer, { ...options, type: 'authenticated' });
  return {
    ...base,
    storageType: STORAGE.PRIVATE,
    publicId: result.public_id,
    resourceType: result.resource_type || options.resource_type,
    version: result.version,
  };
};

/** Store several files; if any upload fails, the ones already stored are removed again. */
const storeFiles = async (files = [], options = {}) => {
  const stored = [];
  try {
    for (const f of files) stored.push(await storeFile(f, options));
    return stored;
  } catch (err) {
    stored.forEach(removeFile);
    throw err;
  }
};

/** Best-effort removal. Never throws — cleanup must not decide a response. */
const removeFile = (ref) => {
  if (!ref) return;
  const storageType = ref.storageType || STORAGE.PUBLIC;
  const publicId = ref.publicId || ref.fileName;
  if (!publicId) return;
  if (storageType === STORAGE.MEMORY) {
    memoryFiles.delete(publicId);
    return;
  }
  const resourceType = ref.resourceType || (isImage(ref.fileType) ? 'image' : 'raw');
  if (storageType === STORAGE.PRIVATE) {
    destroyQuietly(publicId, { resource_type: resourceType, type: 'authenticated', invalidate: true });
  } else {
    destroyQuietly(publicId, { resource_type: resourceType });
  }
};

/**
 * RFC 6266 / 5987 Content-Disposition. The plain `filename=` carries an ASCII stand-in for old
 * clients; `filename*=` carries the real name, so "Resibo ng Barangay Ñ.pdf" survives the trip.
 */
const contentDisposition = (disposition, filename) => {
  const name = String(filename || 'file').replace(/[\r\n"]/g, '');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

/* Only types a browser renders safely are ever served inline; anything else is a download. */
const INLINE_SAFE = /^(application\/pdf|image\/(png|jpe?g|gif))$/i;

/**
 * Send a stored file to the client. Call ONLY after the caller's access has been checked.
 *
 * `disposition: 'inline'` is for in-app preview and is honoured for PDFs and images alone.
 */
const sendFile = async (res, ref, { disposition = 'attachment', filename } = {}) => {
  const storageType = ref?.storageType || STORAGE.PUBLIC;
  const publicId = ref?.publicId || ref?.fileName;
  const name = filename || ref?.originalName || 'file';
  const mode = disposition === 'inline' && INLINE_SAFE.test(ref?.fileType || '') ? 'inline' : 'attachment';

  // Legacy public asset: its URL was always public, so a redirect discloses nothing new.
  if (storageType === STORAGE.PUBLIC) {
    if (!ref?.fileUrl) return res.status(404).json({ success: false, message: 'This file is not available' });
    res.setHeader('Content-Disposition', contentDisposition(mode, name));
    return res.redirect(302, ref.fileUrl);
  }

  let buffer;
  let contentType = ref.fileType || 'application/octet-stream';

  if (storageType === STORAGE.MEMORY) {
    const entry = memoryFiles.get(publicId);
    if (!entry) return res.status(404).json({ success: false, message: 'This file is not available' });
    buffer = entry.buffer;
    contentType = entry.mimeType || contentType;
  } else {
    const url = cloudinary.url(publicId, {
      resource_type: ref.resourceType || (isImage(ref.fileType) ? 'image' : 'raw'),
      type: 'authenticated',
      sign_url: true,
      secure: true,
      ...(ref.version ? { version: ref.version } : {}),
    });
    let upstream;
    try {
      upstream = await fetch(url);
    } catch {
      return res.status(502).json({ success: false, message: 'The file store could not be reached' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({
        success: false,
        message: upstream.status === 404 ? 'This file is not available' : 'The file store refused the request',
      });
    }
    buffer = Buffer.from(await upstream.arrayBuffer());
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', contentDisposition(mode, name));
  // Per-user content: never cache it anywhere shared, and never let the browser second-guess the type.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).end(buffer);
};

/**
 * The fields of a stored-file reference that are safe to return to a client: what it is and how
 * large, never where it lives.
 */
const publicView = (ref) => ref && {
  _id: ref._id,
  originalName: ref.originalName || ref.fileName,
  fileType: ref.fileType,
  fileSize: ref.fileSize,
  uploadedAt: ref.uploadedAt,
};

module.exports = {
  STORAGE, storeFile, storeFiles, removeFile, sendFile, publicView, contentDisposition,
  // Exposed for tests that assert what was stored.
  _memoryFiles: memoryFiles,
};
