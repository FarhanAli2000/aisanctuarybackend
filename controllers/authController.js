const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');
const generateToken = require('../utils/generateToken');

const authPayload = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  token: generateToken(user._id, user.role),
});

// @desc    Login user (all roles use the same login endpoint)
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are required');
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error('This account has been deactivated. Contact the admin.');
  }

  User.updateOne({ _id: user._id }, { lastLogin: new Date() }).catch(() => {});

  const payload = authPayload(user);
  if (user.role === 'student') {
    payload.hasStudentProfile = !!(await StudentProfile.exists({ user: user._id }));
  }

  res.json({
    success: true,
    data: payload,
  });
});

// @desc    Public student signup (account only — enrollment form comes next)
// @route   POST /api/auth/signup
// @access  Public
const signup = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || !email || !phone || !password) {
    res.status(400);
    throw new Error('Name, email, phone, and password are required');
  }

  if (String(password).length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const emailExists = await User.findOne({ email: email.toLowerCase() });
  if (emailExists) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }

  const user = await User.create({
    role: 'student',
    name,
    email,
    phone,
    password,
  });

  res.status(201).json({
    success: true,
    data: authPayload(user),
  });
});

// @desc    Get logged-in user's own profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  const data = {
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  };
  if (req.user.role === 'student') {
    data.hasStudentProfile = !!(await StudentProfile.exists({ user: req.user._id }));
  }
  res.json({ success: true, data });
});

module.exports = { login, signup, getMe };
