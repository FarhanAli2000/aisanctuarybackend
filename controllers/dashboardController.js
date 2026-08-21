const asyncHandler = require('express-async-handler');
const StudentProfile = require('../models/StudentProfile');
const TeacherProfile = require('../models/TeacherProfile');
const Course = require('../models/Course');
const Batch = require('../models/Batch');
const Enrollment = require('../models/Enrollment');
const { getLowAttendanceAlerts, getAlertThreshold } = require('../utils/attendanceStats');

// @desc    Get summary KPIs for the management dashboard
// @route   GET /api/dashboard/summary
// @access  Private/Admin,Founder
const getDashboardSummary = asyncHandler(async (req, res) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    totalStudents,
    activeStudents,
    pendingStudents,
    newStudents30d,
    totalTeachers,
    totalCourses,
    activeCourses,
    totalBatches,
    activeEnrollments,
    completedEnrollments,
    recentEnrollments,
    studentsByCourseAgg,
    lowAttendance,
    batchFillStats,
  ] = await Promise.all([
    StudentProfile.countDocuments(),
    StudentProfile.countDocuments({ enrollmentStatus: 'active' }),
    StudentProfile.countDocuments({ enrollmentStatus: 'pending' }),
    StudentProfile.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    TeacherProfile.countDocuments({ isActive: true }),
    Course.countDocuments(),
    Course.countDocuments({ isActive: true }),
    Batch.countDocuments({ isActive: true }),
    Enrollment.countDocuments({ status: 'active' }),
    Enrollment.countDocuments({ status: 'completed' }),
    Enrollment.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate({ path: 'student', populate: { path: 'user', select: 'name' } })
      .populate('course', 'title')
      .lean(),
    Enrollment.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$course', count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: '_id',
          as: 'course',
        },
      },
      { $unwind: '$course' },
      { $project: { _id: 0, courseTitle: '$course.title', count: 1 } },
      { $sort: { count: -1 } },
    ]),
    getLowAttendanceAlerts(),
    Batch.aggregate([
      { $match: { isActive: true } },
      {
        $lookup: {
          from: 'enrollments',
          let: { batchId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$batch', '$$batchId'] },
                    { $eq: ['$status', 'active'] },
                  ],
                },
              },
            },
            { $count: 'enrolled' },
          ],
          as: 'enroll',
        },
      },
      {
        $project: {
          _id: 0,
          batchName: '$name',
          capacity: 1,
          enrolled: { $ifNull: [{ $arrayElemAt: ['$enroll.enrolled', 0] }, 0] },
        },
      },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      students: {
        total: totalStudents,
        active: activeStudents,
        pending: pendingStudents,
        newLast30Days: newStudents30d,
      },
      teachers: { total: totalTeachers },
      courses: { total: totalCourses, active: activeCourses },
      batches: { total: totalBatches },
      enrollments: {
        active: activeEnrollments,
        completed: completedEnrollments,
      },
      attendance: {
        threshold: getAlertThreshold(),
        lowAttendanceCount: lowAttendance.length,
        alerts: lowAttendance.slice(0, 8),
      },
      studentsByCourse: studentsByCourseAgg,
      batchFillStats,
      recentEnrollments,
    },
  });
});

module.exports = { getDashboardSummary };
