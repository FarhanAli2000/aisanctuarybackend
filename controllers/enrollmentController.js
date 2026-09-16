const asyncHandler = require('express-async-handler');
const Enrollment = require('../models/Enrollment');
const StudentProfile = require('../models/StudentProfile');
const Batch = require('../models/Batch');
const { createActiveEnrollment } = require('../utils/enrollStudent');
const { getCycleRange } = require('../utils/feePeriod');

// @desc    Enroll a student into a course/batch - Workflow: WF-02
// @route   POST /api/enrollments
// @access  Private/Admin
const createEnrollment = asyncHandler(async (req, res) => {
  const { student, course, batch, courseDurationWeeks } = req.body;

  if (!student || !course || !batch) {
    res.status(400);
    throw new Error('Student, course, and batch are required');
  }

  try {
    const enrollment = await createActiveEnrollment({
      studentId: student,
      courseId: course,
      batchId: batch,
      courseDurationWeeks,
    });
    res.status(201).json({ success: true, data: enrollment });
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
});

// @desc    Get enrollments (filterable by student/course/batch/teacher/status)
// @route   GET /api/enrollments
// @access  Private
const getEnrollments = asyncHandler(async (req, res) => {
  const { student, course, batch, teacher, status } = req.query;
  const filter = {};
  if (student) filter.student = student;
  if (course) filter.course = course;
  if (batch) filter.batch = batch;
  if (teacher) filter.teacher = teacher;
  if (status) filter.status = status;

  if (req.user.role === 'teacher') {
    const TeacherProfile = require('../models/TeacherProfile');
    const teacherProfile = await TeacherProfile.findOne({ user: req.user._id });
    filter.teacher = teacherProfile?._id;
  }

  if (req.user.role === 'student') {
    const studentProfile = await StudentProfile.findOne({ user: req.user._id });
    filter.student = studentProfile?._id;
  }

  // Founder: only enrollments completed (created) in the current 25–25 fee cycle
  let period = null;
  if (req.user.role === 'founder') {
    const range = getCycleRange(req.query.periodEnd || new Date());
    filter.enrolledAt = { $gte: range.start, $lte: range.end };
    period = { start: range.start, end: range.end, cycleEnd: range.cycleEnd };
  }

  const enrollments = await Enrollment.find(filter)
    .populate({ path: 'student', populate: { path: 'user', select: 'name email' } })
    .populate('course', 'title')
    .populate('batch', 'name scheduleDays scheduleStartTime scheduleEndTime')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    count: enrollments.length,
    ...(period ? { period } : {}),
    data: enrollments,
  });
});

// @desc    Update enrollment (e.g. teacher extends course duration, or admin marks completed)
// @route   PUT /api/enrollments/:id
// @access  Private/Admin,Teacher(own)
const updateEnrollment = asyncHandler(async (req, res) => {
  const enrollment = await Enrollment.findById(req.params.id);
  if (!enrollment) {
    res.status(404);
    throw new Error('Enrollment not found');
  }

  if (req.user.role === 'teacher') {
    const TeacherProfile = require('../models/TeacherProfile');
    const teacherProfile = await TeacherProfile.findOne({ user: req.user._id });
    if (String(enrollment.teacher) !== String(teacherProfile?._id)) {
      res.status(403);
      throw new Error('Not authorized to edit this enrollment');
    }
  }

  const { status, courseDurationWeeks, batch } = req.body;

  if (batch && String(batch) !== String(enrollment.batch)) {
    if (req.user.role !== 'admin') {
      res.status(403);
      throw new Error('Only admin can change enrollment batch');
    }
    const batchDoc = await Batch.findById(batch);
    if (!batchDoc || batchDoc.isActive === false) {
      res.status(404);
      throw new Error('Batch not found or inactive');
    }
    if (String(batchDoc.course) !== String(enrollment.course)) {
      res.status(400);
      throw new Error('New batch must belong to the same course');
    }
    if (enrollment.status === 'active') {
      const batchEnrolledCount = await Enrollment.countDocuments({
        batch,
        status: 'active',
        _id: { $ne: enrollment._id },
      });
      if (batchEnrolledCount >= batchDoc.capacity) {
        res.status(400);
        throw new Error('Selected batch is full');
      }
    }
    enrollment.batch = batch;
    enrollment.teacher = batchDoc.teacher;
  }

  if (courseDurationWeeks) {
    enrollment.courseDurationWeeks = courseDurationWeeks;
    const newEndDate = new Date(enrollment.enrolledAt);
    newEndDate.setDate(newEndDate.getDate() + courseDurationWeeks * 7);
    enrollment.expectedEndDate = newEndDate;
  }

  if (status) {
    enrollment.status = status;
    if (status === 'completed') enrollment.completedAt = new Date();
  }

  await enrollment.save();

  if (status === 'completed' || status === 'dropped' || status === 'active') {
    const student = await StudentProfile.findById(enrollment.student);
    if (student) {
      const activeCount = await Enrollment.countDocuments({
        student: student._id,
        status: 'active',
      });
      if (activeCount > 0) student.enrollmentStatus = 'active';
      else if (status === 'completed') student.enrollmentStatus = 'completed';
      else if (student.enrollmentStatus === 'active') student.enrollmentStatus = 'inactive';
      await student.save();
    }
  }

  const populated = await Enrollment.findById(enrollment._id)
    .populate({ path: 'student', populate: { path: 'user', select: 'name email' } })
    .populate('course', 'title')
    .populate('batch', 'name')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } });

  res.json({ success: true, data: populated });
});

module.exports = { createEnrollment, getEnrollments, updateEnrollment };
