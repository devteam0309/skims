const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { STAFF } = require('../constants/roles');
const { getMonitoringOverview, getMunicipalityReport, getComplianceStatus, getProgramTimeline } = require('../controllers/monitoringController');

router.use(protect);
router.get('/overview', authorize(...STAFF), getMonitoringOverview);
router.get('/municipalities', authorize(...STAFF), getMunicipalityReport);
router.get('/compliance', authorize(...STAFF), getComplianceStatus);
router.get('/timeline', authorize(...STAFF), getProgramTimeline);

module.exports = router;
