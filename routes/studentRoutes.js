const express = require('express');
const router = express.Router();
const {
  registerStudent,
  getMyStudentProfile,
  getStudents,
  getStudentById,
  updateStudent,
  deactivateStudent,
} = require('../controllers/studentController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(protect);

router.get('/me', allowRoles('student'), getMyStudentProfile);

router
  .route('/')
  .get(allowRoles('admin', 'founder', 'teacher'), getStudents)
  .post(allowRoles('admin'), upload.idCardFields, registerStudent);

router
  .route('/:id')
  .get(allowRoles('admin', 'founder', 'teacher', 'student'), getStudentById)
  .put(allowRoles('admin'), upload.idCardFields, updateStudent)
  .delete(allowRoles('admin'), deactivateStudent);

module.exports = router;
