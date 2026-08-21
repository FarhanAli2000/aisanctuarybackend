const express = require('express');
const router = express.Router();
const { dispatchAiNewsDigest } = require('../controllers/aiNewsController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.post('/dispatch', protect, allowRoles('admin'), dispatchAiNewsDigest);

module.exports = router;
