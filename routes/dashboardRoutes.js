const express = require('express');
const router = express.Router();
const { getDashboardSummary, getEnrollmentTrend } = require('../controllers/dashboardController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router.get('/summary', allowRoles('admin', 'founder'), getDashboardSummary);
router.get('/enrollment-trend', allowRoles('admin', 'founder'), getEnrollmentTrend);

module.exports = router;
