const asyncHandler = require('express-async-handler');
const Batch = require('../models/Batch');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const TeacherProfile = require('../models/TeacherProfile');
const { enrolledCountByBatch } = require('../utils/queryHelpers');

// @desc    Create batch (teacher selects schedule days/time)
// @route   POST /api/batches
// @access  Private/Admin
const createBatch = asyncHandler(async (req, res) => {
  const { course, teacher, name, scheduleDays, scheduleStartTime, scheduleEndTime, capacity } =
    req.body;

  if (!course || !teacher || !name || !scheduleDays || !scheduleStartTime || !scheduleEndTime) {
    res.status(400);
    throw new Error('Course, teacher, name, schedule days, and start/end time are required');
  }

  const courseExists = await Course.findById(course);
  if (!courseExists) {
    res.status(404);
    throw new Error('Course not found');
  }

  const teacherExists = await TeacherProfile.findById(teacher);
  if (!teacherExists) {
    res.status(404);
    throw new Error('Teacher not found');
  }

  // Enforce hard max capacity of 20
  const requestedCapacity = capacity ? Number(capacity) : Batch.MAX_CAPACITY;
  if (requestedCapacity > Batch.MAX_CAPACITY) {
    res.status(400);
    throw new Error(`Batch capacity cannot exceed ${Batch.MAX_CAPACITY} students`);
  }

  const batch = await Batch.create({
    course,
    teacher,
    name,
    scheduleDays,
    scheduleStartTime,
    scheduleEndTime,
    capacity: requestedCapacity,
  });

  res.status(201).json({ success: true, data: batch });
});

// @desc    Get all batches (optionally filtered by course/teacher)
// @route   GET /api/batches
// @access  Private
const getBatches = asyncHandler(async (req, res) => {
  const { course, teacher } = req.query;
  const filter = {};
  if (course) filter.course = course;
  if (teacher) filter.teacher = teacher;

  // Teachers only see their own batches
  if (req.user.role === 'teacher') {
    const teacherProfile = await TeacherProfile.findOne({ user: req.user._id });
    filter.teacher = teacherProfile?._id;
  }

  const batches = await Batch.find(filter)
    .populate('course', 'title')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } })
    .sort({ createdAt: -1 })
    .lean();

  const countMap = await enrolledCountByBatch(batches.map((b) => b._id));
  const withCounts = batches.map((b) => {
    const enrolledCount = countMap.get(String(b._id)) || 0;
    return { ...b, enrolledCount, spotsLeft: b.capacity - enrolledCount };
  });

  res.json({ success: true, count: withCounts.length, data: withCounts });
});

// @desc    Get single batch with enrolled students
// @route   GET /api/batches/:id
// @access  Private
const getBatchById = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id)
    .populate('course', 'title')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } });

  if (!batch) {
    res.status(404);
    throw new Error('Batch not found');
  }

  const enrollments = await Enrollment.find({ batch: batch._id, status: 'active' }).populate({
    path: 'student',
    populate: { path: 'user', select: 'name email phone' },
  });

  res.json({
    success: true,
    data: {
      ...batch.toObject(),
      enrolledCount: enrollments.length,
      spotsLeft: batch.capacity - enrollments.length,
      students: enrollments,
    },
  });
});

// @desc    Update batch
// @route   PUT /api/batches/:id
// @access  Private/Admin
const updateBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error('Batch not found');
  }

  const { name, scheduleDays, scheduleStartTime, scheduleEndTime, capacity, isActive, teacher } =
    req.body;

  if (capacity && Number(capacity) > Batch.MAX_CAPACITY) {
    res.status(400);
    throw new Error(`Batch capacity cannot exceed ${Batch.MAX_CAPACITY} students`);
  }

  if (name) batch.name = name;
  if (scheduleDays) batch.scheduleDays = scheduleDays;
  if (scheduleStartTime) batch.scheduleStartTime = scheduleStartTime;
  if (scheduleEndTime) batch.scheduleEndTime = scheduleEndTime;
  if (capacity) batch.capacity = capacity;
  if (typeof isActive === 'boolean') batch.isActive = isActive;
  if (teacher) batch.teacher = teacher;

  await batch.save();
  res.json({ success: true, data: batch });
});

module.exports = { createBatch, getBatches, getBatchById, updateBatch };
