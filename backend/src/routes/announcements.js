const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { ADMINS, EDITORS } = require('../constants/roles');
const { getAnnouncements, getAnnouncement, createAnnouncement, updateAnnouncement, deleteAnnouncement } = require('../controllers/announcementController');

router.use(protect);
router.get('/', getAnnouncements);
router.get('/:id', getAnnouncement);
router.post('/', authorize(...EDITORS), createAnnouncement);
router.put('/:id', authorize(...EDITORS), updateAnnouncement);
router.delete('/:id', authorize(...ADMINS), deleteAnnouncement);

module.exports = router;
