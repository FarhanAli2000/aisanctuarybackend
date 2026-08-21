const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');
const triggerN8n = require('../utils/triggerN8n');
const { deleteStudentByProfile } = require('../utils/deleteStudent');
const { requireAndVerifyIdCards, cleanupIdCardFiles } = require('../utils/idCardFiles');

// @desc    Current student's profile (404 if enrollment form not submitted yet)
// @route   GET /api/students/me
// @access  Private/Student
const getMyStudentProfile = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') {
    res.status(403);
    throw new Error('Only students can access this endpoint');
  }

  const student = await StudentProfile.findOne({ user: req.user._id })
    .populate('user', 'name email phone isActive')
    .lean();

  if (!student) {
    res.status(404);
    throw new Error('Enrollment form not submitted yet');
  }

  res.json({ success: true, data: student });
});

// @desc    Register a new student (Admin only) - Workflow: WF-01
// @route   POST /api/students
// @access  Private/Admin
const registerStudent = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    address,
    identityDocType,
    guardianName,
    guardianContact,
  } = req.body;

  if (!name || !email || !phone || !password || !address || !identityDocType) {
    cleanupIdCardFiles(req);
    res.status(400);
    throw new Error('Name, email, phone, password, address, and identity document type are required');
  }

  if (identityDocType === 'B-Form' && (!guardianName || !guardianContact)) {
    cleanupIdCardFiles(req);
    res.status(400);
    throw new Error('Guardian name and contact are required when identity document is B-Form');
  }

  let idUrls;
  try {
    idUrls = await requireAndVerifyIdCards(req, identityDocType);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }

  const emailExists = await User.findOne({ email: email.toLowerCase() });
  if (emailExists) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }

  // Create the base user account
  const user = await User.create({
    role: 'student',
    name,
    email,
    phone,
    password,
  });

  // Create the student-specific profile
  const studentProfile = await StudentProfile.create({
    user: user._id,
    address,
    identityDocType,
    identityDocFrontUrl: idUrls.identityDocFrontUrl,
    identityDocBackUrl: idUrls.identityDocBackUrl,
    identityDocImageUrl: idUrls.identityDocImageUrl,
    guardianName: identityDocType === 'B-Form' ? guardianName : undefined,
    guardianContact: identityDocType === 'B-Form' ? guardianContact : undefined,
    enrollmentStatus: 'pending',
  });

  // Fire automation: WF-01 Registration -> sends registration confirmation email
  triggerN8n('student-registered', {
    studentId: studentProfile._id,
    userId: user._id,
    name: user.name,
    email: user.email,
  });

  res.status(201).json({
    success: true,
    data: {
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone },
      profile: studentProfile,
    },
  });
});

// @desc    Get all students (with populated user info)
// @route   GET /api/students
// @access  Private/Admin,Founder,Teacher
const getStudents = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const match = {};
  if (status) match.enrollmentStatus = status;

  const pipeline = [
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
  ];

  if (search) {
    const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pipeline.push({
      $match: {
        $or: [
          { 'user.name': { $regex: term, $options: 'i' } },
          { 'user.email': { $regex: term, $options: 'i' } },
        ],
      },
    });
  }

  const hideIds = req.user.role !== 'admin';
  const project = {
    address: 1,
    identityDocType: 1,
    guardianName: 1,
    guardianContact: 1,
    enrollmentStatus: 1,
    createdAt: 1,
    updatedAt: 1,
    user: {
      _id: '$user._id',
      name: '$user.name',
      email: '$user.email',
      phone: '$user.phone',
      isActive: '$user.isActive',
    },
  };
  if (!hideIds) {
    project.identityDocImageUrl = 1;
    project.identityDocFrontUrl = 1;
    project.identityDocBackUrl = 1;
  }
  pipeline.push({ $project: project });

  const sanitized = await StudentProfile.aggregate(pipeline);

  res.json({ success: true, count: sanitized.length, data: sanitized });
});

// @desc    Get single student by id
// @route   GET /api/students/:id
// @access  Private/Admin,Founder,Teacher,Student(self)
const getStudentById = asyncHandler(async (req, res) => {
  const student = await StudentProfile.findById(req.params.id).populate(
    'user',
    'name email phone isActive'
  );

  if (!student) {
    res.status(404);
    throw new Error('Student not found');
  }

  // Students may only view their own profile
  if (req.user.role === 'student' && String(student.user._id) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to view this profile');
  }

  const obj = student.toObject();
  if (req.user.role !== 'admin' && req.user.role !== 'student') {
    delete obj.identityDocImageUrl;
    delete obj.identityDocFrontUrl;
    delete obj.identityDocBackUrl;
  }

  res.json({ success: true, data: obj });
});

// @desc    Update student profile
// @route   PUT /api/students/:id
// @access  Private/Admin
const updateStudent = asyncHandler(async (req, res) => {
  const student = await StudentProfile.findById(req.params.id);
  if (!student) {
    res.status(404);
    throw new Error('Student not found');
  }

  const { address, guardianName, guardianContact, enrollmentStatus } = req.body;

  if (address) student.address = address;
  if (guardianName) student.guardianName = guardianName;
  if (guardianContact) student.guardianContact = guardianContact;
  if (enrollmentStatus) student.enrollmentStatus = enrollmentStatus;

  if (req.files && (req.files.identityDocFront || req.files.identityDocBack)) {
    try {
      const docType = req.body.identityDocType || student.identityDocType;
      const idUrls = await requireAndVerifyIdCards(req, docType);
      student.identityDocFrontUrl = idUrls.identityDocFrontUrl;
      student.identityDocBackUrl = idUrls.identityDocBackUrl;
      student.identityDocImageUrl = idUrls.identityDocImageUrl;
    } catch (err) {
      res.status(err.statusCode || 400);
      throw err;
    }
  }

  await student.save();
  res.json({ success: true, data: student });
});

// @desc    Delete a student and related enrollments, fees, attendance
// @route   DELETE /api/students/:id
// @access  Private/Admin
const deactivateStudent = asyncHandler(async (req, res) => {
  const student = await StudentProfile.findById(req.params.id);
  if (!student) {
    res.status(404);
    throw new Error('Student not found');
  }

  await deleteStudentByProfile(student);

  res.json({ success: true, message: 'Student deleted' });
});

module.exports = {
  registerStudent,
  getMyStudentProfile,
  getStudents,
  getStudentById,
  updateStudent,
  deactivateStudent,
};
