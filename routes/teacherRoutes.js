const express = require('express');
const router = express.Router();
const {
  createTeacher,
  getTeachers,
  getTeacherById,
  updateTeacher,
} = require('../controllers/teacherController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router
  .route('/')
  .get(allowRoles('admin', 'founder'), getTeachers)
  .post(allowRoles('admin'), createTeacher);

router
  .route('/:id')
  .get(allowRoles('admin', 'founder', 'teacher'), getTeacherById)
  .put(allowRoles('admin'), updateTeacher);

module.exports = router;
