const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { REPORT_VIEWERS } = require('../constants/roles');
const { generateProgramReport, generateFinancialReport, generateYouthReport, generateTemplate } = require('../controllers/reportController');

router.use(protect);
router.get('/programs', authorize(...REPORT_VIEWERS), generateProgramReport);
router.get('/financial', authorize(...REPORT_VIEWERS), generateFinancialReport);
router.get('/youth', authorize(...REPORT_VIEWERS), generateYouthReport);
router.get('/template/:name', authorize(...REPORT_VIEWERS), generateTemplate);

module.exports = router;
