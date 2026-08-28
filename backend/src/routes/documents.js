const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const validate = require('../middleware/validate');
const { ADMINS, DOC_UPLOADERS, DOC_EDITORS } = require('../constants/roles');
const { DOCUMENT_CATEGORIES } = require('../models/Document');
const { getDocuments, getDocument, uploadDocument, updateDocument, archiveDocument, unarchiveDocument, replaceFile, trackDownload, serveFile, serveVersion, deleteDocument, getDocumentStats, bulkArchiveDocuments } = require('../controllers/documentController');

const idParam = validate([param('id').isMongoId().withMessage('Invalid document ID')]);

// Runs after multer parses the multipart body, so req.body fields are populated.
const uploadValidation = validate([
  // Free text, not a fixed list — see models/Document.js. Length-capped so it stays a label.
  body('category').trim().notEmpty().withMessage('A document category is required')
    .isLength({ max: 60 }).withMessage('Category must be 60 characters or fewer'),
  body('title').optional({ checkFalsy: true }).trim().isLength({ max: 200 }).withMessage('Title too long'),
  body('fiscalYear').optional({ checkFalsy: true }).isInt({ min: 2000, max: 2100 }).withMessage('Invalid fiscal year'),
]);

const updateValidation = validate([
  body('category').optional({ checkFalsy: true }).trim()
    .isLength({ max: 60 }).withMessage('Category must be 60 characters or fewer'),
  body('title').optional({ checkFalsy: true }).trim().isLength({ max: 200 }).withMessage('Title too long'),
  body('fiscalYear').optional({ checkFalsy: true }).isInt({ min: 2000, max: 2100 }).withMessage('Invalid fiscal year'),
]);

router.get('/stats', protect, getDocumentStats);
router.get('/', protect, getDocuments);
router.get('/:id', protect, idParam, getDocument);
router.post('/', protect, authorize(...DOC_UPLOADERS), upload.single('file'), uploadValidation, uploadDocument);
router.put('/:id', protect, authorize(...DOC_EDITORS), idParam, updateValidation, updateDocument);
router.patch('/bulk-archive', protect, authorize(...DOC_EDITORS), bulkArchiveDocuments);
router.patch('/:id/archive', protect, authorize(...DOC_EDITORS), idParam, archiveDocument);
router.patch('/:id/unarchive', protect, authorize(...DOC_EDITORS), idParam, unarchiveDocument);
router.patch('/:id/replace-file', protect, authorize(...DOC_EDITORS), idParam, upload.single('file'), replaceFile);
router.post('/:id/download', optionalAuth, idParam, trackDownload);
router.get('/:id/serve', optionalAuth, idParam, serveFile);
router.get('/:id/versions/:version/serve', optionalAuth, idParam, serveVersion);
router.delete('/:id', protect, authorize(...ADMINS), idParam, deleteDocument);

module.exports = router;
