const express = require('express');
const router = express.Router();
const {
  createEnrollmentRequest,
  getEnrollmentRequests,
  approveEnrollmentRequest,
  rejectEnrollmentRequest,
} = require('../controllers/enrollmentRequestController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(protect);

router
  .route('/')
  .get(allowRoles('admin', 'founder', 'student'), getEnrollmentRequests)
  .post(allowRoles('student'), upload.idCardFields, createEnrollmentRequest);

router.post('/:id/approve', allowRoles('admin'), approveEnrollmentRequest);
router.post('/:id/reject', allowRoles('admin'), rejectEnrollmentRequest);

module.exports = router;
