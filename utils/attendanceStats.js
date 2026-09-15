const AttendanceStatusType = require('../models/AttendanceStatusType');
const Attendance = require('../models/Attendance');
const ClassSession = require('../models/ClassSession');
const Enrollment = require('../models/Enrollment');
const mongoose = require('mongoose');

const getAlertThreshold = () => {
  const n = Number(process.env.ATTENDANCE_ALERT_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 75;
};

const DEFAULT_STATUSES = [
  { code: 'present', label: 'Present' },
  { code: 'absent', label: 'Absent' },
  { code: 'leave', label: 'Leave' },
];

let statusesSeeded = false;
let statusCache = null;

const ensureAttendanceStatuses = async () => {
  if (statusesSeeded) return;
  await AttendanceStatusType.bulkWrite(
    DEFAULT_STATUSES.map((item) => ({
      updateOne: {
        filter: { code: item.code },
        update: { $setOnInsert: { ...item, isActive: true } },
        upsert: true,
      },
    }))
  );
  statusesSeeded = true;
};

const invalidateStatusCache = () => {
  statusCache = null;
};

const getActiveStatuses = async () => {
  await ensureAttendanceStatuses();
  if (!statusCache) {
    statusCache = await AttendanceStatusType.find({ isActive: true }).sort({ code: 1 }).lean();
  }
  return statusCache;
};

const percentFromCounts = (present, total) =>
  total === 0 ? null : Math.round((present / total) * 1000) / 10;

const attendanceTotalsByEnrollment = async (enrollmentIds) => {
  const ids = (enrollmentIds || [])
    .filter(Boolean)
    .map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)));
  if (!ids.length) return new Map();

  const presentStatus = await AttendanceStatusType.findOne({ code: 'present' }).select('_id').lean();
  const presentId = presentStatus?._id;

  const rows = await Attendance.aggregate([
    { $match: { enrollment: { $in: ids } } },
    {
      $group: {
        _id: '$enrollment',
        total: { $sum: 1 },
        present: {
          $sum: {
            $cond: [{ $eq: ['$status', presentId] }, 1, 0],
          },
        },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), row]));
};

const statsFromTotals = (enrollment, totals) => {
  const row = totals || { total: 0, present: 0 };
  const percent = percentFromCounts(row.present, row.total);
  const threshold = getAlertThreshold();
  return {
    enrollmentId: enrollment._id,
    student: enrollment.student,
    batch: enrollment.batch,
    totalSessions: row.total,
    presentCount: row.present,
    percent,
    belowThreshold: percent !== null && percent < threshold,
    threshold,
  };
};

const calcEnrollmentAttendance = async (enrollmentId) => {
  const enrollment = await Enrollment.findById(enrollmentId).select('student batch').lean();
  if (!enrollment) return null;
  const totals = await attendanceTotalsByEnrollment([enrollmentId]);
  return statsFromTotals(enrollment, totals.get(String(enrollmentId)));
};

const calcBatchAttendance = async (batchId) => {
  const enrollments = await Enrollment.find({ batch: batchId, status: 'active' })
    .populate({
      path: 'student',
      populate: { path: 'user', select: 'name email' },
    })
    .lean();
  const [sessionCount, totals] = await Promise.all([
    ClassSession.countDocuments({ batch: batchId }),
    attendanceTotalsByEnrollment(enrollments.map((en) => en._id)),
  ]);
  const rows = enrollments.map((en) => ({
    ...statsFromTotals(en, totals.get(String(en._id))),
    studentName: en.student?.user?.name,
    studentEmail: en.student?.user?.email,
  }));
  return { sessionCount, students: rows };
};

const getEnrollmentAttendanceList = async ({ batchIds, belowOnly = false } = {}) => {
  const filter = { status: 'active' };
  if (batchIds) filter.batch = { $in: batchIds };
  const enrollments = await Enrollment.find(filter)
    .populate({ path: 'student', populate: { path: 'user', select: 'name email' } })
    .populate('course', 'title')
    .populate('batch', 'name')
    .lean();

  const totals = await attendanceTotalsByEnrollment(enrollments.map((en) => en._id));
  const rows = [];
  enrollments.forEach((en) => {
    const stats = statsFromTotals(en, totals.get(String(en._id)));
    if (belowOnly && !stats.belowThreshold) return;
    rows.push({
      ...stats,
      studentName: en.student?.user?.name,
      studentEmail: en.student?.user?.email,
      courseTitle: en.course?.title,
      batchName: en.batch?.name,
    });
  });
  return rows.sort((a, b) => {
    if (a.percent == null && b.percent == null) return 0;
    if (a.percent == null) return 1;
    if (b.percent == null) return -1;
    return a.percent - b.percent;
  });
};

const getLowAttendanceAlerts = async (opts = {}) =>
  getEnrollmentAttendanceList({ ...opts, belowOnly: true });

module.exports = {
  getAlertThreshold,
  ensureAttendanceStatuses,
  invalidateStatusCache,
  getActiveStatuses,
  attendanceTotalsByEnrollment,
  calcEnrollmentAttendance,
  calcBatchAttendance,
  getEnrollmentAttendanceList,
  getLowAttendanceAlerts,
};
