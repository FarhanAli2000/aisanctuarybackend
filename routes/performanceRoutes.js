const express = require('express');
const router = express.Router();
const {
  getPerformance,
  getStudentPerformance,
  createEvaluation,
  savePlacement,
  getSettings,
  updateSettings,
} = require('../controllers/performanceController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

const viewers = allowRoles('admin', 'founder', 'teacher');

// Fixed paths first, so they are not read as a :studentId
router.route('/settings').get(viewers, getSettings).put(allowRoles('admin'), updateSettings);
router.post('/evaluations', allowRoles('teacher'), createEvaluation);
router.put('/placement/:studentId', allowRoles('admin', 'teacher'), savePlacement);

router.get('/', viewers, getPerformance);
router.get('/:studentId', viewers, getStudentPerformance);

module.exports = router;
