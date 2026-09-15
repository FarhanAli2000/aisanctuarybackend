const asyncHandler = require('express-async-handler');
const AttendanceStatusType = require('../models/AttendanceStatusType');
const ClassSession = require('../models/ClassSession');
const Attendance = require('../models/Attendance');
const Enrollment = require('../models/Enrollment');
const Batch = require('../models/Batch');
const TeacherProfile = require('../models/TeacherProfile');
const StudentProfile = require('../models/StudentProfile');
const AuditLog = require('../models/AuditLog');
const triggerN8n = require('../utils/triggerN8n');
const {
  ensureAttendanceStatuses,
  invalidateStatusCache,
  getActiveStatuses,
  getAlertThreshold,
  calcBatchAttendance,
  getLowAttendanceAlerts,
  getEnrollmentAttendanceList,
  attendanceTotalsByEnrollment,
} = require('../utils/attendanceStats');

const todayYmd = () => new Date().toISOString().slice(0, 10);

const getTeacherProfileId = async (user) => {
  if (user.role !== 'teacher') return null;
  const profile = await TeacherProfile.findOne({ user: user._id });
  return profile?._id || null;
};

const assertCanAccessBatch = async (req, batch) => {
  if (req.user.role === 'admin' || req.user.role === 'founder') return;
  if (req.user.role === 'teacher') {
    const teacherId = await getTeacherProfileId(req.user);
    if (String(batch.teacher) !== String(teacherId)) {
      const err = new Error('Not authorized to access this batch');
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  const err = new Error('Not authorized');
  err.statusCode = 403;
  throw err;
};

const getStatuses = asyncHandler(async (req, res) => {
  const statuses = await getActiveStatuses();
  res.json({
    success: true,
    threshold: getAlertThreshold(),
    data: statuses,
  });
});

const updateStatusLabel = asyncHandler(async (req, res) => {
  const { label } = req.body;
  if (!label) {
    res.status(400);
    throw new Error('Label is required');
  }
  const status = await AttendanceStatusType.findById(req.params.id);
  if (!status) {
    res.status(404);
    throw new Error('Attendance status not found');
  }
  status.label = label;
  await status.save();
  invalidateStatusCache();
  res.json({ success: true, data: status });
});

const getOrCreateSession = asyncHandler(async (req, res) => {
  const { batch, sessionDate } = req.body;
  const date = sessionDate || todayYmd();
  if (!batch) {
    res.status(400);
    throw new Error('Batch is required');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400);
    throw new Error('sessionDate must be YYYY-MM-DD');
  }

  const batchDoc = await Batch.findById(batch);
  if (!batchDoc || !batchDoc.isActive) {
    res.status(404);
    throw new Error('Batch not found or inactive');
  }

  try {
    await assertCanAccessBatch(req, batchDoc);
  } catch (err) {
    res.status(err.statusCode || 403);
    throw err;
  }

  if (req.user.role === 'founder') {
    const existing = await ClassSession.findOne({ batch, sessionDate: date });
    if (!existing) {
      res.status(404);
      throw new Error('No class session on this date');
    }
    return res.json({ success: true, data: existing });
  }

  let session = await ClassSession.findOne({ batch, sessionDate: date });
  if (!session) {
    session = await ClassSession.create({
      batch,
      teacher: batchDoc.teacher,
      sessionDate: date,
    });
  }

  res.status(201).json({ success: true, data: session });
});

const getSessionRoster = asyncHandler(async (req, res) => {
  const session = await ClassSession.findById(req.params.id).populate('batch', 'name teacher');
  if (!session) {
    res.status(404);
    throw new Error('Class session not found');
  }

  const batchDoc = await Batch.findById(session.batch._id || session.batch);
  try {
    await assertCanAccessBatch(req, batchDoc);
  } catch (err) {
    res.status(err.statusCode || 403);
    throw err;
  }

  const enrollments = await Enrollment.find({
    batch: session.batch._id || session.batch,
    status: 'active',
  }).populate({ path: 'student', populate: { path: 'user', select: 'name email' } });

  const marks = await Attendance.find({ session: session._id }).populate('status', 'code label');
  const markByStudent = {};
  marks.forEach((m) => {
    markByStudent[String(m.student)] = m;
  });

  const roster = enrollments.map((en) => {
    const mark = markByStudent[String(en.student._id)];
    return {
      enrollmentId: en._id,
      studentId: en.student._id,
      name: en.student?.user?.name,
      email: en.student?.user?.email,
      statusId: mark?.status?._id || mark?.status || null,
      statusCode: mark?.status?.code || null,
      statusLabel: mark?.status?.label || null,
    };
  });

  res.json({
    success: true,
    data: {
      session,
      roster,
    },
  });
});

const saveSessionAttendance = asyncHandler(async (req, res) => {
  const session = await ClassSession.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error('Class session not found');
  }

  const batchDoc = await Batch.findById(session.batch);
  try {
    await assertCanAccessBatch(req, batchDoc);
  } catch (err) {
    res.status(err.statusCode || 403);
    throw err;
  }

  if (req.user.role === 'founder') {
    res.status(403);
    throw new Error('Founder has view-only access');
  }

  const { marks } = req.body;
  if (!Array.isArray(marks) || marks.length === 0) {
    res.status(400);
    throw new Error('marks array is required');
  }

  await ensureAttendanceStatuses();
  const statuses = await getActiveStatuses();
  const statusIds = new Set(statuses.map((s) => String(s._id)));

  const saved = [];
  for (const row of marks) {
    if (!row.student || !row.enrollment || !row.status) {
      res.status(400);
      throw new Error('Each mark needs student, enrollment, and status');
    }
    if (!statusIds.has(String(row.status))) {
      res.status(400);
      throw new Error('Invalid attendance status');
    }

    const enrollment = await Enrollment.findOne({
      _id: row.enrollment,
      student: row.student,
      batch: session.batch,
      status: 'active',
    });
    if (!enrollment) {
      res.status(400);
      throw new Error('Student is not actively enrolled in this batch');
    }

    const record = await Attendance.findOneAndUpdate(
      { session: session._id, student: row.student },
      {
        enrollment: row.enrollment,
        status: row.status,
        markedBy: req.user._id,
        markedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    saved.push(record);
  }

  await AuditLog.create({
    user: req.user._id,
    action: 'attendance.marked',
    entityType: 'ClassSession',
    entityId: session._id,
    changes: { sessionDate: session.sessionDate, count: saved.length },
  });

  const stats = [];
  const uniqueEnrollments = [...new Set(marks.map((m) => String(m.enrollment)))];
  const enrollmentDocs = await Enrollment.find({ _id: { $in: uniqueEnrollments } })
    .populate({
      path: 'student',
      populate: { path: 'user', select: 'name email' },
    })
    .lean();
  const totals = await attendanceTotalsByEnrollment(uniqueEnrollments);
  const threshold = getAlertThreshold();

  enrollmentDocs.forEach((enrollmentDoc) => {
    const row = totals.get(String(enrollmentDoc._id)) || { total: 0, present: 0 };
    const percent = row.total === 0 ? null : Math.round((row.present / row.total) * 1000) / 10;
    stats.push({
      enrollmentId: enrollmentDoc._id,
      student: enrollmentDoc.student,
      batch: enrollmentDoc.batch,
      totalSessions: row.total,
      presentCount: row.present,
      percent,
      belowThreshold: percent !== null && percent < threshold,
      threshold,
      studentName: enrollmentDoc?.student?.user?.name,
      studentEmail: enrollmentDoc?.student?.user?.email,
      userId: enrollmentDoc?.student?.user?._id,
    });
  });

  triggerN8n('attendance-submitted', {
    sessionId: session._id,
    batchId: session.batch,
    sessionDate: session.sessionDate,
    threshold: getAlertThreshold(),
    students: stats,
  });

  res.json({ success: true, count: saved.length, data: { session, stats } });
});

const getAlerts = asyncHandler(async (req, res) => {
  let batchIds;
  if (req.user.role === 'teacher') {
    const teacherId = await getTeacherProfileId(req.user);
    const batches = await Batch.find({ teacher: teacherId }).select('_id');
    batchIds = batches.map((b) => b._id);
  }
  const all = req.query.all === 'true' || req.query.all === '1';
  const alerts = all
    ? await getEnrollmentAttendanceList({ batchIds, belowOnly: false })
    : await getLowAttendanceAlerts({ batchIds });
  res.json({
    success: true,
    threshold: getAlertThreshold(),
    count: alerts.length,
    data: alerts,
  });
});

const getMyAttendance = asyncHandler(async (req, res) => {
  const profile = await StudentProfile.findOne({ user: req.user._id });
  if (!profile) {
    return res.json({ success: true, threshold: getAlertThreshold(), data: [] });
  }

  const enrollments = await Enrollment.find({ student: profile._id, status: 'active' })
    .populate('course', 'title')
    .populate('batch', 'name')
    .lean();

  const enrollmentIds = enrollments.map((en) => en._id);
  const [totals, records] = await Promise.all([
    attendanceTotalsByEnrollment(enrollmentIds),
    Attendance.find({ enrollment: { $in: enrollmentIds } })
      .populate('status', 'code label')
      .populate('session', 'sessionDate')
      .lean(),
  ]);

  const recordsByEnrollment = {};
  records.forEach((r) => {
    const key = String(r.enrollment);
    if (!recordsByEnrollment[key]) recordsByEnrollment[key] = [];
    recordsByEnrollment[key].push(r);
  });

  const threshold = getAlertThreshold();
  const data = enrollments.map((en) => {
    const row = totals.get(String(en._id)) || { total: 0, present: 0 };
    const percent = row.total === 0 ? null : Math.round((row.present / row.total) * 1000) / 10;
    return {
      enrollmentId: en._id,
      student: en.student,
      batch: en.batch,
      totalSessions: row.total,
      presentCount: row.present,
      percent,
      belowThreshold: percent !== null && percent < threshold,
      threshold,
      courseTitle: en.course?.title,
      batchName: en.batch?.name,
      records: (recordsByEnrollment[String(en._id)] || []).map((r) => ({
        date: r.session?.sessionDate,
        status: r.status?.label,
        code: r.status?.code,
      })),
    };
  });

  res.json({ success: true, threshold: getAlertThreshold(), data });
});

const getBatchStats = asyncHandler(async (req, res) => {
  const batchDoc = await Batch.findById(req.params.batchId);
  if (!batchDoc) {
    res.status(404);
    throw new Error('Batch not found');
  }
  try {
    await assertCanAccessBatch(req, batchDoc);
  } catch (err) {
    res.status(err.statusCode || 403);
    throw err;
  }
  const data = await calcBatchAttendance(req.params.batchId);
  res.json({ success: true, threshold: getAlertThreshold(), data });
});

module.exports = {
  getStatuses,
  updateStatusLabel,
  getOrCreateSession,
  getSessionRoster,
  saveSessionAttendance,
  getAlerts,
  getMyAttendance,
  getBatchStats,
};
