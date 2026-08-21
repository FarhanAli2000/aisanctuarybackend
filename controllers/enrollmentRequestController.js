const asyncHandler = require('express-async-handler');
const EnrollmentRequest = require('../models/EnrollmentRequest');
const Enrollment = require('../models/Enrollment');
const StudentProfile = require('../models/StudentProfile');
const Batch = require('../models/Batch');
const Course = require('../models/Course');
const triggerN8n = require('../utils/triggerN8n');
const { requireAndVerifyIdCards, cleanupIdCardFiles } = require('../utils/idCardFiles');
const {
  MAX_ACTIVE_ENROLLMENTS_PER_STUDENT,
  createActiveEnrollment,
  countOccupiedSlots,
} = require('../utils/enrollStudent');

const populateRequest = (query) =>
  query
    .populate({ path: 'student', populate: { path: 'user', select: 'name email phone' } })
    .populate('course', 'title defaultDurationWeeks')
    .populate('batch', 'name scheduleDays scheduleStartTime scheduleEndTime capacity')
    .populate('reviewedBy', 'name email')
    .populate('enrollment')
    .lean();

const sanitizeRequest = (doc, role) => {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (role !== 'admin' && obj.student) {
    delete obj.student.identityDocImageUrl;
    delete obj.student.identityDocFrontUrl;
    delete obj.student.identityDocBackUrl;
  }
  return obj;
};

const getOrCreateStudentProfile = async (req) => {
  let profile = await StudentProfile.findOne({ user: req.user._id });
  if (profile) return profile;

  const {
    address,
    identityDocType,
    guardianName,
    guardianContact,
  } = req.body;

  if (!address || !identityDocType) {
    cleanupIdCardFiles(req);
    const err = new Error('Address and identity document type are required for your first enrollment request');
    err.statusCode = 400;
    throw err;
  }

  if (identityDocType === 'B-Form' && (!guardianName || !guardianContact)) {
    cleanupIdCardFiles(req);
    const err = new Error('Guardian name and contact are required when identity document is B-Form');
    err.statusCode = 400;
    throw err;
  }

  let idUrls;
  try {
    idUrls = await requireAndVerifyIdCards(req, identityDocType);
  } catch (err) {
    throw err;
  }

  profile = await StudentProfile.create({
    user: req.user._id,
    address,
    identityDocType,
    identityDocFrontUrl: idUrls.identityDocFrontUrl,
    identityDocBackUrl: idUrls.identityDocBackUrl,
    identityDocImageUrl: idUrls.identityDocImageUrl,
    guardianName: identityDocType === 'B-Form' ? guardianName : undefined,
    guardianContact: identityDocType === 'B-Form' ? guardianContact : undefined,
    enrollmentStatus: 'pending',
  });

  triggerN8n('student-registered', {
    studentId: profile._id,
    userId: req.user._id,
    name: req.user.name,
    email: req.user.email,
  });

  return profile;
};

// @desc    Student submits an enrollment request
// @route   POST /api/enrollment-requests
// @access  Private/Student
const createEnrollmentRequest = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') {
    res.status(403);
    throw new Error('Only students can submit enrollment requests');
  }

  const { course, batch } = req.body;
  if (!course || !batch) {
    res.status(400);
    throw new Error('Course and batch are required');
  }

  let profile;
  try {
    profile = await getOrCreateStudentProfile(req);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }

  const courseDoc = await Course.findById(course);
  if (!courseDoc || !courseDoc.isActive) {
    res.status(404);
    throw new Error('Course not found or inactive');
  }

  const batchDoc = await Batch.findById(batch);
  if (!batchDoc || !batchDoc.isActive) {
    res.status(404);
    throw new Error('Batch not found or inactive');
  }

  if (String(batchDoc.course) !== String(course)) {
    res.status(400);
    throw new Error('Selected batch does not belong to this course');
  }

  const { occupied } = await countOccupiedSlots(profile._id);
  if (occupied >= MAX_ACTIVE_ENROLLMENTS_PER_STUDENT) {
    res.status(400);
    throw new Error(
      `You already have ${MAX_ACTIVE_ENROLLMENTS_PER_STUDENT} active or pending enrollments. Complete or wait for one before requesting another.`
    );
  }

  const alreadyActive = await Enrollment.findOne({
    student: profile._id,
    course,
    status: 'active',
  });
  if (alreadyActive) {
    res.status(400);
    throw new Error('You are already enrolled in this course');
  }

  const alreadyPending = await EnrollmentRequest.findOne({
    student: profile._id,
    course,
    status: 'pending',
  });
  if (alreadyPending) {
    res.status(400);
    throw new Error('You already have a pending request for this course');
  }

  const batchEnrolledCount = await Enrollment.countDocuments({ batch, status: 'active' });
  if (batchEnrolledCount >= batchDoc.capacity) {
    res.status(400);
    throw new Error('This batch is full. Please choose a different batch.');
  }

  const request = await EnrollmentRequest.create({
    student: profile._id,
    course,
    batch,
    status: 'pending',
  });

  const populated = await populateRequest(EnrollmentRequest.findById(request._id));
  res.status(201).json({ success: true, data: sanitizeRequest(populated, req.user.role) });
});

// @desc    List enrollment requests
// @route   GET /api/enrollment-requests
// @access  Private/Admin,Founder,Student(own)
const getEnrollmentRequests = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  if (req.user.role === 'student') {
    const profile = await StudentProfile.findOne({ user: req.user._id });
    if (!profile) {
      return res.json({ success: true, count: 0, data: [] });
    }
    filter.student = profile._id;
  } else if (!['admin', 'founder'].includes(req.user.role)) {
    res.status(403);
    throw new Error(`Role '${req.user.role}' is not permitted to perform this action`);
  }

  const requests = await populateRequest(EnrollmentRequest.find(filter).sort({ createdAt: -1 }));
  const data = requests.map((r) => sanitizeRequest(r, req.user.role));
  res.json({ success: true, count: data.length, data });
});

// @desc    Admin approves a pending enrollment request
// @route   POST /api/enrollment-requests/:id/approve
// @access  Private/Admin
const approveEnrollmentRequest = asyncHandler(async (req, res) => {
  const request = await EnrollmentRequest.findById(req.params.id);
  if (!request) {
    res.status(404);
    throw new Error('Enrollment request not found');
  }

  if (request.status !== 'pending') {
    res.status(400);
    throw new Error(`This request is already ${request.status}`);
  }

  try {
    const enrollment = await createActiveEnrollment({
      studentId: request.student,
      courseId: request.course,
      batchId: request.batch,
    });

    request.status = 'approved';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.enrollment = enrollment._id;
    await request.save();

    const populated = await populateRequest(EnrollmentRequest.findById(request._id));
    res.json({ success: true, data: sanitizeRequest(populated, req.user.role) });
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }
});

// @desc    Admin rejects a pending enrollment request
// @route   POST /api/enrollment-requests/:id/reject
// @access  Private/Admin
const rejectEnrollmentRequest = asyncHandler(async (req, res) => {
  const request = await EnrollmentRequest.findById(req.params.id);
  if (!request) {
    res.status(404);
    throw new Error('Enrollment request not found');
  }

  if (request.status !== 'pending') {
    res.status(400);
    throw new Error(`This request is already ${request.status}`);
  }

  request.status = 'rejected';
  request.reviewedBy = req.user._id;
  request.reviewedAt = new Date();
  await request.save();

  const populated = await populateRequest(EnrollmentRequest.findById(request._id));
  res.json({ success: true, data: sanitizeRequest(populated, req.user.role) });
});

module.exports = {
  createEnrollmentRequest,
  getEnrollmentRequests,
  approveEnrollmentRequest,
  rejectEnrollmentRequest,
};
