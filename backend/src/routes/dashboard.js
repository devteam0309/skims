const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { STAFF, REPORTERS } = require('../constants/roles');
const { getDashboard, getMunicipalityComparison } = require('../controllers/dashboardController');

router.use(protect);
router.use(authorize(...STAFF));
router.get('/', getDashboard);
router.get('/municipality-comparison', authorize(...REPORTERS), getMunicipalityComparison);

module.exports = router;
