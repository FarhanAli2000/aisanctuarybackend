const express = require('express');
const router = express.Router();
const {
  createEnrollment,
  getEnrollments,
  updateEnrollment,
} = require('../controllers/enrollmentController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router
  .route('/')
  .get(allowRoles('admin', 'founder', 'teacher', 'student'), getEnrollments)
  .post(allowRoles('admin'), createEnrollment);

router.route('/:id').put(allowRoles('admin', 'teacher'), updateEnrollment);

module.exports = router;
