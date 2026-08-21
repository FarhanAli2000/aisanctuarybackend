const asyncHandler = require('express-async-handler');
const Course = require('../models/Course');
const Batch = require('../models/Batch');

// @desc    Create course
// @route   POST /api/courses
// @access  Private/Admin
const createCourse = asyncHandler(async (req, res) => {
  const { title, description, defaultDurationWeeks } = req.body;

  if (!title || !defaultDurationWeeks) {
    res.status(400);
    throw new Error('Title and default duration (in weeks) are required');
  }

  const course = await Course.create({ title, description, defaultDurationWeeks });
  res.status(201).json({ success: true, data: course });
});

// @desc    Get all courses
// @route   GET /api/courses
// @access  Private
const getCourses = asyncHandler(async (req, res) => {
  const { activeOnly } = req.query;
  const filter = activeOnly === 'true' ? { isActive: true } : {};

  const courses = await Course.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ success: true, count: courses.length, data: courses });
});

// @desc    Get single course with its batches
// @route   GET /api/courses/:id
// @access  Private
const getCourseById = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    res.status(404);
    throw new Error('Course not found');
  }

  const batches = await Batch.find({ course: course._id })
    .populate('teacher', 'user')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } });

  res.json({ success: true, data: { ...course.toObject(), batches } });
});

// @desc    Update course
// @route   PUT /api/courses/:id
// @access  Private/Admin
const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    res.status(404);
    throw new Error('Course not found');
  }

  const { title, description, defaultDurationWeeks, isActive } = req.body;
  if (title) course.title = title;
  if (description !== undefined) course.description = description;
  if (defaultDurationWeeks) course.defaultDurationWeeks = defaultDurationWeeks;
  if (typeof isActive === 'boolean') course.isActive = isActive;

  await course.save();
  res.json({ success: true, data: course });
});

// @desc    Activate/deactivate course
// @route   PATCH /api/courses/:id/status
// @access  Private/Admin
const toggleCourseStatus = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    res.status(404);
    throw new Error('Course not found');
  }

  course.isActive = !course.isActive;
  await course.save();
  res.json({ success: true, data: course });
});

module.exports = {
  createCourse,
  getCourses,
  getCourseById,
  updateCourse,
  toggleCourseStatus,
};
