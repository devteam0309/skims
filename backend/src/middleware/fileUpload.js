const multer = require('multer');
const path = require('path');

const ALLOWED_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

// A refused file is the client's mistake, so it carries 400 — errorHandler otherwise answers 500.
const rejected = (message) => Object.assign(new Error(message), { statusCode: 400 });

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const expectedMime = ALLOWED_TYPES[ext];
  if (!expectedMime) {
    return cb(rejected(`File type ${ext || '(none)'} not allowed. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`), false);
  }
  if (file.mimetype !== expectedMime) {
    return cb(rejected('File content does not match its extension'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
});

module.exports = upload;
