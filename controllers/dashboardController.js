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
    completedEnrollments,
    completedEnrollmentList,
    recentEnrollments,
    studentsByCourseAgg,
    lowAttendance,
  ] = await Promise.all([
    StudentProfile.countDocuments(),
    StudentProfile.countDocuments({ enrollmentStatus: 'active' }),
    StudentProfile.countDocuments({ enrollmentStatus: 'pending' }),
    StudentProfile.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    TeacherProfile.countDocuments({ isActive: true }),
    Course.countDocuments(),
    Course.countDocuments({ isActive: true }),
    Batch.countDocuments({ isActive: true }),
    Enrollment.distinct('student', { status: 'completed' }).then((ids) => ids.length),
    Enrollment.find({ status: 'completed' })
      .sort({ completedAt: -1, updatedAt: -1 })
      .populate({ path: 'student', populate: { path: 'user', select: 'name email' } })
      .populate('course', 'title')
      .populate('batch', 'name')
      .lean(),
    Enrollment.find({ status: 'active' })
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
      {
        $lookup: {
          from: 'batches',
          let: { courseId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$course', '$$courseId'] },
                    { $eq: ['$isActive', true] },
                  ],
                },
              },
            },
            { $group: { _id: null, capacity: { $sum: '$capacity' } } },
          ],
          as: 'batchCap',
        },
      },
      {
        $project: {
          _id: 0,
          courseTitle: '$course.title',
          count: 1,
          capacity: { $ifNull: [{ $arrayElemAt: ['$batchCap.capacity', 0] }, 0] },
        },
      },
      { $sort: { count: -1 } },
    ]),
    getLowAttendanceAlerts(),
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
        completed: completedEnrollments,
        completedList: completedEnrollmentList.map((e) => ({
          _id: e._id,
          studentName: e.student?.user?.name || 'Unknown',
          studentEmail: e.student?.user?.email || '',
          courseTitle: e.course?.title || '—',
          batchName: e.batch?.name || '—',
          completedAt: e.completedAt || e.updatedAt || null,
          enrolledAt: e.enrolledAt || null,
        })),
      },
      attendance: {
        threshold: getAlertThreshold(),
        lowAttendanceCount: lowAttendance.length,
        alerts: lowAttendance.slice(0, 8),
      },
      studentsByCourse: studentsByCourseAgg,
      recentEnrollments,
    },
  });
});

module.exports = { getDashboardSummary };
