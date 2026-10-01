const asyncHandler = require('express-async-handler');
const StudentProfile = require('../models/StudentProfile');
const TeacherProfile = require('../models/TeacherProfile');
const Course = require('../models/Course');
const Batch = require('../models/Batch');
const Enrollment = require('../models/Enrollment');
const { getLowAttendanceAlerts, getAlertThreshold } = require('../utils/attendanceStats');

const TREND_MONTHS = 12;

// Month buckets (UTC) for the last TREND_MONTHS months, oldest first
const buildMonthKeys = () => {
  const now = new Date();
  const keys = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push({
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    });
  }
  return keys;
};

// Per-month additions plus running total for a model, used for sparklines and trend charts
const monthlySeries = async (Model, monthKeys, match = {}) => {
  const windowStart = new Date(Date.UTC(monthKeys[0].y, monthKeys[0].m - 1, 1));
  const [rows, baseline] = await Promise.all([
    Model.aggregate([
      { $match: { ...match, createdAt: { $gte: windowStart } } },
      {
        $group: {
          _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
    ]),
    Model.countDocuments({ ...match, createdAt: { $lt: windowStart } }),
  ]);
  const byMonth = new Map(rows.map((r) => [`${r._id.y}-${r._id.m}`, r.count]));
  let running = baseline;
  return monthKeys.map((k) => {
    const added = byMonth.get(`${k.y}-${k.m}`) || 0;
    running += added;
    return { month: k.label, added, total: running };
  });
};

// Percent change; null when there is no baseline to compare against
const percentChange = (current, previous) => {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
};

// @desc    Get summary KPIs for the management dashboard
// @route   GET /api/dashboard/summary
// @access  Private/Admin,Founder
const getDashboardSummary = asyncHandler(async (req, res) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const before30 = { createdAt: { $lt: thirtyDaysAgo } };
  const prev30Window = { createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } };
  const monthKeys = buildMonthKeys();

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
    recentRegistrations,
    studentsByCourseAgg,
    lowAttendance,
    prevTotalStudents,
    prevActiveStudents,
    prevNewStudents,
    prevTeachers,
    prevActiveCourses,
    prevBatches,
    enrollments30d,
    prevEnrollments30d,
    studentSeries,
    activeStudentSeries,
    teacherSeries,
    courseSeries,
    batchSeries,
    enrollmentSeries,
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
    StudentProfile.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'name')
      .select('user enrollmentStatus createdAt')
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
    StudentProfile.countDocuments(before30),
    StudentProfile.countDocuments({ enrollmentStatus: 'active', ...before30 }),
    StudentProfile.countDocuments(prev30Window),
    TeacherProfile.countDocuments({ isActive: true, ...before30 }),
    Course.countDocuments({ isActive: true, ...before30 }),
    Batch.countDocuments({ isActive: true, ...before30 }),
    Enrollment.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    Enrollment.countDocuments(prev30Window),
    monthlySeries(StudentProfile, monthKeys),
    monthlySeries(StudentProfile, monthKeys, { enrollmentStatus: 'active' }),
    monthlySeries(TeacherProfile, monthKeys, { isActive: true }),
    monthlySeries(Course, monthKeys, { isActive: true }),
    monthlySeries(Batch, monthKeys, { isActive: true }),
    monthlySeries(Enrollment, monthKeys),
  ]);

  const lastSix = (series, key = 'total') => series.slice(-6).map((p) => p[key]);

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
      recentRegistrations: recentRegistrations.map((s) => ({
        _id: s._id,
        name: s.user?.name || 'Unknown',
        status: s.enrollmentStatus,
        createdAt: s.createdAt,
      })),
      trends: {
        students: { change: percentChange(totalStudents, prevTotalStudents), series: lastSix(studentSeries) },
        activeStudents: {
          change: percentChange(activeStudents, prevActiveStudents),
          series: lastSix(activeStudentSeries),
        },
        newStudents: {
          change: percentChange(newStudents30d, prevNewStudents),
          series: lastSix(studentSeries, 'added'),
        },
        teachers: { change: percentChange(totalTeachers, prevTeachers), series: lastSix(teacherSeries) },
        courses: { change: percentChange(activeCourses, prevActiveCourses), series: lastSix(courseSeries) },
        batches: { change: percentChange(totalBatches, prevBatches), series: lastSix(batchSeries) },
      },
      enrollmentTrend: {
        months: enrollmentSeries.map((p) => ({ month: p.month, count: p.added })),
        last30Days: enrollments30d,
        change: percentChange(enrollments30d, prevEnrollments30d),
      },
    },
  });
});

module.exports = { getDashboardSummary };
