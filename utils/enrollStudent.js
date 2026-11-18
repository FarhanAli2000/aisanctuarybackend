const Enrollment = require('../models/Enrollment');
const StudentProfile = require('../models/StudentProfile');
const Batch = require('../models/Batch');
const Course = require('../models/Course');
const EnrollmentRequest = require('../models/EnrollmentRequest');
const triggerN8n = require('./triggerN8n');
const { countBatchSeats } = require('./queryHelpers');
const { getCourseBatch } = require('./courseBatch');

const MAX_ACTIVE_ENROLLMENTS_PER_STUDENT = 2;

const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const createActiveEnrollment = async ({ studentId, courseId, batchId, courseDurationWeeks }) => {
  const studentProfile = await StudentProfile.findById(studentId).populate('user', 'name email');
  if (!studentProfile) {
    throw httpError(404, 'Student not found');
  }

  const courseDoc = await Course.findById(courseId);
  if (!courseDoc || !courseDoc.isActive) {
    throw httpError(404, 'Course not found or inactive');
  }

  // Callers send just the course; its class schedule record is found here.
  const batchDoc = batchId ? await Batch.findById(batchId) : await getCourseBatch(courseId);
  if (!batchDoc || !batchDoc.isActive) {
    throw httpError(404, 'This class has no active schedule');
  }
  batchId = batchDoc._id;

  if (String(batchDoc.course) !== String(courseId)) {
    throw httpError(400, 'Selected class schedule does not belong to this class');
  }

  const activeCount = await Enrollment.countDocuments({ student: studentId, status: 'active' });
  if (activeCount >= MAX_ACTIVE_ENROLLMENTS_PER_STUDENT) {
    throw httpError(
      400,
      `This student already has ${MAX_ACTIVE_ENROLLMENTS_PER_STUDENT} active course enrollments. Complete one before adding another.`
    );
  }

  const batchEnrolledCount = await countBatchSeats(batchId);
  if (batchEnrolledCount >= batchDoc.capacity) {
    throw httpError(400, 'This class is full.');
  }

  const alreadyEnrolled = await Enrollment.findOne({
    student: studentId,
    course: courseId,
    status: 'active',
  });
  if (alreadyEnrolled) {
    throw httpError(400, 'Student is already actively enrolled in this class');
  }

  const duration = courseDurationWeeks || courseDoc.defaultDurationWeeks;
  const expectedEndDate = new Date();
  expectedEndDate.setDate(expectedEndDate.getDate() + duration * 7);

  const enrollment = await Enrollment.create({
    student: studentId,
    course: courseId,
    batch: batchId,
    teacher: batchDoc.teacher,
    courseDurationWeeks: duration,
    expectedEndDate,
  });

  if (studentProfile.enrollmentStatus === 'pending') {
    studentProfile.enrollmentStatus = 'active';
    await studentProfile.save();
  }

  triggerN8n('enrollment-created', {
    enrollmentId: enrollment._id,
    studentId,
    userId: studentProfile.user._id,
    studentName: studentProfile.user.name,
    studentEmail: studentProfile.user.email,
    courseTitle: courseDoc.title,
    batchName: batchDoc.name,
  });

  return enrollment;
};

const countOccupiedSlots = async (studentId) => {
  const [activeCount, pendingCount] = await Promise.all([
    Enrollment.countDocuments({ student: studentId, status: 'active' }),
    EnrollmentRequest.countDocuments({ student: studentId, status: 'pending' }),
  ]);
  return { activeCount, pendingCount, occupied: activeCount + pendingCount };
};

module.exports = {
  MAX_ACTIVE_ENROLLMENTS_PER_STUDENT,
  createActiveEnrollment,
  countOccupiedSlots,
};
