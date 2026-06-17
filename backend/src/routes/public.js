const express = require('express');
const router = express.Router();
const { getPublicPrograms, getPublicAnnouncements, getPublicBudgetSummary, getPublicDocuments, downloadPublicDocument, getMunicipalities, getPublicStats } = require('../controllers/publicController');

router.get('/programs', getPublicPrograms);
router.get('/announcements', getPublicAnnouncements);
router.get('/budget', getPublicBudgetSummary);
router.get('/documents', getPublicDocuments);
router.get('/documents/:id/download', downloadPublicDocument);
router.get('/municipalities', getMunicipalities);
router.get('/stats', getPublicStats);

module.exports = router;
