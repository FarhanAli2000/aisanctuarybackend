const express = require('express');
const router = express.Router();
const {
  getStatuses,
  updateStatusLabel,
  getOrCreateSession,
  getSessionRoster,
  saveSessionAttendance,
  getAlerts,
  getMyAttendance,
  getBatchStats,
} = require('../controllers/attendanceController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router.get('/statuses', getStatuses);
router.put('/statuses/:id', allowRoles('admin'), updateStatusLabel);

router.get('/me', allowRoles('student'), getMyAttendance);
router.get('/alerts', allowRoles('admin', 'founder', 'teacher'), getAlerts);
router.get('/batches/:batchId/stats', allowRoles('admin', 'founder', 'teacher'), getBatchStats);

router.post('/sessions', allowRoles('admin', 'teacher', 'founder'), getOrCreateSession);
router.get('/sessions/:id', allowRoles('admin', 'teacher', 'founder'), getSessionRoster);
router.put('/sessions/:id', allowRoles('admin', 'teacher'), saveSessionAttendance);

module.exports = router;
