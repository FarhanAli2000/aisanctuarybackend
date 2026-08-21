const express = require('express');
const router = express.Router();
const {
  createCourse,
  getCourses,
  getCourseById,
  updateCourse,
  toggleCourseStatus,
} = require('../controllers/courseController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router.route('/').get(getCourses).post(allowRoles('admin'), createCourse);

router.route('/:id').get(getCourseById).put(allowRoles('admin'), updateCourse);

router.patch('/:id/status', allowRoles('admin'), toggleCourseStatus);

module.exports = router;
