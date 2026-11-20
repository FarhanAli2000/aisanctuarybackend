const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');
const Enrollment = require('../models/Enrollment');
const EnrollmentRequest = require('../models/EnrollmentRequest');
const Fee = require('../models/Fee');
const Attendance = require('../models/Attendance');
const CommunicationLog = require('../models/CommunicationLog');
const StudentEvaluation = require('../models/StudentEvaluation');
const StudentPlacement = require('../models/StudentPlacement');
const TripApplication = require('../models/TripApplication');

const deleteStudentByProfile = async (student) => {
  const studentId = student._id;
  const userId = student.user?._id || student.user;

  await StudentEvaluation.deleteMany({ student: studentId });
  await StudentPlacement.deleteMany({ student: studentId });
  await TripApplication.deleteMany({ student: studentId });
  await Attendance.deleteMany({ student: studentId });
  await Fee.deleteMany({ student: studentId });
  await Enrollment.deleteMany({ student: studentId });
  await EnrollmentRequest.deleteMany({ student: studentId });
  if (userId) {
    await CommunicationLog.deleteMany({ recipient: userId });
    await User.findByIdAndDelete(userId);
  }
  await StudentProfile.findByIdAndDelete(studentId);
};

module.exports = { deleteStudentByProfile };
