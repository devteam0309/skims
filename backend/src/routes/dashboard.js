const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { STAFF, REPORT_VIEWERS } = require('../constants/roles');
const { getDashboard, getMunicipalityComparison } = require('../controllers/dashboardController');

router.use(protect);
router.use(authorize(...STAFF));
router.get('/', getDashboard);
router.get('/municipality-comparison', authorize(...REPORT_VIEWERS), getMunicipalityComparison);

module.exports = router;
