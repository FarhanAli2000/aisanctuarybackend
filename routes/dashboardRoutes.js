const express = require('express');
const router = express.Router();
const { getDashboardSummary, getEnrollmentTrend, getStudentsByCoursePeriod, getAttendanceByCourse } = require('../controllers/dashboardController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router.get('/summary', allowRoles('admin', 'founder'), getDashboardSummary);
router.get('/enrollment-trend', allowRoles('admin', 'founder'), getEnrollmentTrend);
router.get('/students-by-course', allowRoles('admin', 'founder'), getStudentsByCoursePeriod);
router.get('/attendance-by-course', allowRoles('admin', 'founder'), getAttendanceByCourse);

module.exports = router;
