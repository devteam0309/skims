const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { REPORTERS } = require('../constants/roles');
const { generateProgramReport, generateFinancialReport, generateYouthReport, generateTemplate } = require('../controllers/reportController');

router.use(protect);
router.get('/programs', authorize(...REPORTERS), generateProgramReport);
router.get('/financial', authorize(...REPORTERS), generateFinancialReport);
router.get('/youth', authorize(...REPORTERS), generateYouthReport);
router.get('/template/:name', authorize(...REPORTERS), generateTemplate);

module.exports = router;
