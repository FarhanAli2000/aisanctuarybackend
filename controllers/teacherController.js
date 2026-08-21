const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const TeacherProfile = require('../models/TeacherProfile');
const Batch = require('../models/Batch');

// @desc    Create a new teacher
// @route   POST /api/teachers
// @access  Private/Admin
const createTeacher = asyncHandler(async (req, res) => {
  const { name, email, phone, password, expertise } = req.body;

  if (!name || !email || !phone || !password) {
    res.status(400);
    throw new Error('Name, email, phone, and password are required');
  }

  const emailExists = await User.findOne({ email: email.toLowerCase() });
  if (emailExists) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }

  const user = await User.create({ role: 'teacher', name, email, phone, password });

  const teacherProfile = await TeacherProfile.create({
    user: user._id,
    expertise: Array.isArray(expertise) ? expertise : expertise ? [expertise] : [],
  });

  res.status(201).json({
    success: true,
    data: {
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone },
      profile: teacherProfile,
    },
  });
});

// @desc    Get all teachers
// @route   GET /api/teachers
// @access  Private/Admin,Founder
const getTeachers = asyncHandler(async (req, res) => {
  const teachers = await TeacherProfile.find()
    .populate('user', 'name email phone isActive')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, count: teachers.length, data: teachers });
});

// @desc    Get single teacher with their batches
// @route   GET /api/teachers/:id
// @access  Private/Admin,Founder,Teacher(self)
const getTeacherById = asyncHandler(async (req, res) => {
  const teacher = await TeacherProfile.findById(req.params.id).populate(
    'user',
    'name email phone isActive'
  );

  if (!teacher) {
    res.status(404);
    throw new Error('Teacher not found');
  }

  const batches = await Batch.find({ teacher: teacher._id }).populate('course', 'title');

  res.json({ success: true, data: { ...teacher.toObject(), batches } });
});

// @desc    Update teacher profile
// @route   PUT /api/teachers/:id
// @access  Private/Admin
const updateTeacher = asyncHandler(async (req, res) => {
  const teacher = await TeacherProfile.findById(req.params.id);
  if (!teacher) {
    res.status(404);
    throw new Error('Teacher not found');
  }

  const { expertise, isActive } = req.body;
  if (expertise) teacher.expertise = Array.isArray(expertise) ? expertise : [expertise];
  if (typeof isActive === 'boolean') teacher.isActive = isActive;

  await teacher.save();
  res.json({ success: true, data: teacher });
});

module.exports = { createTeacher, getTeachers, getTeacherById, updateTeacher };
