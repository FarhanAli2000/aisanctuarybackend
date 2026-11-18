const asyncHandler = require('express-async-handler');
const StudentProfile = require('../models/StudentProfile');
const TeacherProfile = require('../models/TeacherProfile');
const Course = require('../models/Course');
const Batch = require('../models/Batch');
const Enrollment = require('../models/Enrollment');
const { getLowAttendanceAlerts, getAlertThreshold } = require('../utils/attendanceStats');
const { SEAT_FREE_STUDENT_STATUSES } = require('../utils/queryHelpers');

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
      {
        $lookup: {
          from: 'studentprofiles',
          localField: 'student',
          foreignField: '_id',
          as: 'studentProfile',
        },
      },
      // Same seat rule as batch capacity: inactive/completed students don't count
      {
        $match: {
          'studentProfile.0': { $exists: true },
          'studentProfile.enrollmentStatus': { $nin: SEAT_FREE_STUDENT_STATUSES },
        },
      },
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

  // A student counts as completed when an enrollment is completed OR the admin marked the
  // student profile completed (Students page); the profile flag alone used to be missed here.
  const enrollmentCompletedIds = new Set(completedEnrollmentList.map((e) => String(e.student?._id)));
  const profileCompleted = await StudentProfile.find({ enrollmentStatus: 'completed' })
    .populate('user', 'name email')
    .select('user updatedAt')
    .lean();
  const profileOnly = profileCompleted.filter((s) => !enrollmentCompletedIds.has(String(s._id)));
  const latestEnrollments = profileOnly.length
    ? await Enrollment.find({ student: { $in: profileOnly.map((s) => s._id) } })
        .sort({ createdAt: -1 })
        .populate('course', 'title')
        .populate('batch', 'name')
        .lean()
    : [];
  const latestByStudent = new Map();
  latestEnrollments.forEach((e) => {
    if (!latestByStudent.has(String(e.student))) latestByStudent.set(String(e.student), e);
  });
  const profileOnlyList = profileOnly.map((s) => {
    const e = latestByStudent.get(String(s._id));
    return {
      _id: `profile-${s._id}`,
      studentName: s.user?.name || 'Unknown',
      studentEmail: s.user?.email || '',
      courseTitle: e?.course?.title || '—',
      batchName: e?.batch?.name || '—',
      completedAt: e?.completedAt || s.updatedAt || null,
      enrolledAt: e?.enrolledAt || null,
    };
  });
  const completedStudentCount = enrollmentCompletedIds.size + profileOnly.length;

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
        completed: completedStudentCount,
        completedList: [...completedEnrollmentList.map((e) => ({
          _id: e._id,
          studentName: e.student?.user?.name || 'Unknown',
          studentEmail: e.student?.user?.email || '',
          courseTitle: e.course?.title || '—',
          batchName: e.batch?.name || '—',
          completedAt: e.completedAt || e.updatedAt || null,
          enrolledAt: e.enrolledAt || null,
        })), ...profileOnlyList],
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

// ---- Enrollment trend for a chosen period (admin dashboard filter) ----
// Days are counted on Pakistan time (UTC+5, no daylight saving) so "today" and "last 7 days"
// match what the admin sees on their clock.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_KEYS = ['7d', '30d', '90d', '6m', '12m', 'ytd', 'custom'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A "PKT day" is held as the UTC midnight of that calendar date (a whole number of days * DAY_MS)
const pktDayOf = (date) => Math.floor((new Date(date).getTime() + PKT_OFFSET_MS) / DAY_MS) * DAY_MS;
const dayToInstant = (dayMs) => new Date(dayMs - PKT_OFFSET_MS);
const dayKey = (dayMs) => new Date(dayMs).toISOString().slice(0, 10);
const parseDay = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
};
const monthStartDay = (dayMs, monthsBack = 0) => {
  const d = new Date(dayMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1);
};
const dayLabel = (dayMs) => {
  const d = new Date(dayMs);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

const resolveTrendPeriod = (range, from, to) => {
  const today = pktDayOf(new Date());
  let start;
  let end = today;
  switch (range) {
    case '7d':
      start = today - 6 * DAY_MS;
      break;
    case '90d':
      start = today - 89 * DAY_MS;
      break;
    case '6m':
      start = monthStartDay(today, 5);
      break;
    case '12m':
      start = monthStartDay(today, 11);
      break;
    case 'ytd':
      start = Date.UTC(new Date(today).getUTCFullYear(), 0, 1);
      break;
    case 'custom': {
      start = parseDay(from);
      end = parseDay(to);
      if (start === null || end === null) return { error: 'Choose a valid From and To date.' };
      if (end > today) end = today;
      if (start > end) return { error: 'The From date must be before the To date.' };
      if ((end - start) / DAY_MS > 366 * 5) return { error: 'Choose a period of up to 5 years.' };
      break;
    }
    case '30d':
    default:
      start = today - 29 * DAY_MS;
  }
  return { start, end };
};

// Buckets: one per day up to 31 days, one per week (Monday start) up to ~4 months, otherwise per month
const buildTrendBuckets = (start, end) => {
  const days = (end - start) / DAY_MS + 1;
  const buckets = [];
  if (days <= 31) {
    for (let d = start; d <= end; d += DAY_MS) buckets.push({ from: d, to: d, label: dayLabel(d), count: 0 });
    return { granularity: 'day', buckets };
  }
  if (days <= 125) {
    const monday = (d) => d - ((new Date(d).getUTCDay() + 6) % 7) * DAY_MS;
    for (let d = monday(start); d <= end; d += 7 * DAY_MS) {
      buckets.push({ from: Math.max(d, start), to: Math.min(d + 6 * DAY_MS, end), label: dayLabel(d), count: 0 });
    }
    return { granularity: 'week', buckets };
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  const withYear = days > 366;
  let y = startDate.getUTCFullYear();
  let m = startDate.getUTCMonth();
  while (y < endDate.getUTCFullYear() || (y === endDate.getUTCFullYear() && m <= endDate.getUTCMonth())) {
    const from = Math.max(Date.UTC(y, m, 1), start);
    const to = Math.min(Date.UTC(y, m + 1, 0), end);
    buckets.push({ from, to, label: withYear ? `${MONTHS[m]} ${String(y).slice(2)}` : MONTHS[m], count: 0 });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return { granularity: 'month', buckets };
};

// @desc    Enrollments (admissions) in a chosen period, bucketed for the dashboard chart
// @route   GET /api/dashboard/enrollment-trend?range=7d|30d|90d|6m|12m|ytd|custom&from=&to=
// @access  Private/Admin,Founder
const getEnrollmentTrend = asyncHandler(async (req, res) => {
  const range = RANGE_KEYS.includes(req.query.range) ? req.query.range : '30d';
  const period = resolveTrendPeriod(range, req.query.from, req.query.to);
  if (period.error) {
    res.status(400);
    throw new Error(period.error);
  }
  const { start, end } = period;
  const length = (end - start) / DAY_MS + 1;
  const prevEnd = start - DAY_MS;
  const prevStart = prevEnd - (length - 1) * DAY_MS;

  const windowStart = dayToInstant(prevStart);
  const windowEnd = dayToInstant(end + DAY_MS - 1);
  const inWindow = (field) => ({ [field]: { $gte: windowStart, $lte: windowEnd } });

  const [enrollments, students] = await Promise.all([
    Enrollment.find({ $or: [inWindow('enrolledAt'), { enrolledAt: { $exists: false }, ...inWindow('createdAt') }] })
      .select('enrolledAt createdAt')
      .lean(),
    StudentProfile.find(inWindow('createdAt')).select('createdAt').lean(),
  ]);

  const { granularity, buckets } = buildTrendBuckets(start, end);
  let total = 0;
  let previousTotal = 0;
  enrollments.forEach((e) => {
    const day = pktDayOf(e.enrolledAt || e.createdAt);
    if (day >= start && day <= end) {
      total += 1;
      const bucket = buckets.find((b) => day >= b.from && day <= b.to);
      if (bucket) bucket.count += 1;
    } else if (day >= prevStart && day <= prevEnd) {
      previousTotal += 1;
    }
  });
  let newStudents = 0;
  let previousNewStudents = 0;
  students.forEach((s) => {
    const day = pktDayOf(s.createdAt);
    if (day >= start && day <= end) newStudents += 1;
    else if (day >= prevStart && day <= prevEnd) previousNewStudents += 1;
  });

  res.json({
    success: true,
    data: {
      range,
      from: dayKey(start),
      to: dayKey(end),
      days: length,
      granularity,
      buckets: buckets.map((b) => ({ label: b.label, count: b.count })),
      total,
      previousTotal,
      change: percentChange(total, previousTotal),
      newStudents,
      previousNewStudents,
    },
  });
});

// @desc    Admissions per course in a chosen period (students who joined each course in that period)
// @route   GET /api/dashboard/students-by-course?range=7d|30d|90d|6m|12m|ytd|custom&from=&to=
// @access  Private/Admin,Founder
const getStudentsByCoursePeriod = asyncHandler(async (req, res) => {
  const range = RANGE_KEYS.includes(req.query.range) ? req.query.range : '30d';
  const period = resolveTrendPeriod(range, req.query.from, req.query.to);
  if (period.error) {
    res.status(400);
    throw new Error(period.error);
  }
  const { start, end } = period;
  const windowStart = dayToInstant(start);
  const windowEnd = dayToInstant(end + DAY_MS - 1);
  const inWindow = (field) => ({ [field]: { $gte: windowStart, $lte: windowEnd } });

  const [courses, enrollments] = await Promise.all([
    Course.find({}).select('title').lean(),
    Enrollment.find({ $or: [inWindow('enrolledAt'), { enrolledAt: { $exists: false }, ...inWindow('createdAt') }] })
      .select('course')
      .lean(),
  ]);
  const counts = new Map();
  enrollments.forEach((e) => counts.set(String(e.course), (counts.get(String(e.course)) || 0) + 1));
  const rows = courses
    .map((c) => ({ courseTitle: c.title, count: counts.get(String(c._id)) || 0 }))
    .sort((a, b) => b.count - a.count || a.courseTitle.localeCompare(b.courseTitle));

  res.json({ success: true, data: { range, from: dayKey(start), to: dayKey(end), courses: rows } });
});

module.exports = { getDashboardSummary, getEnrollmentTrend, getStudentsByCoursePeriod };
