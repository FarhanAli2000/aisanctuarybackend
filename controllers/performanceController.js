const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const StudentProfile = require('../models/StudentProfile');
const TeacherProfile = require('../models/TeacherProfile');
const Enrollment = require('../models/Enrollment');
const StudentEvaluation = require('../models/StudentEvaluation');
const StudentPlacement = require('../models/StudentPlacement');
const PerformanceSetting = require('../models/PerformanceSetting');
const { attendanceTotalsByEnrollment } = require('../utils/attendanceStats');
const {
  DEFAULT_WEIGHTS,
  RATING_KEYS,
  evaluationAverage,
  normaliseWeights,
  computeScore,
} = require('../utils/performanceScore');

const PLACEMENT_STATUSES = ['not_yet', 'looking', 'interview', 'placed'];
const PLACEMENT_TYPES = ['job', 'internship', 'freelance'];

const loadWeights = async () => {
  const doc = await PerformanceSetting.findOne({ key: 'weights' }).lean();
  return normaliseWeights(doc || DEFAULT_WEIGHTS);
};

const myTeacherProfile = async (user) => (user.role === 'teacher' ? TeacherProfile.findOne({ user: user._id }).lean() : null);

const round1 = (n) => Math.round(n * 10) / 10;

// Builds the performance rows for the given students. `teacher` (a TeacherProfile) is set when a
// teacher is asking: they can evaluate only the classes they teach, and only see evaluations of those.
const buildRows = async (studentIds, { teacher = null, withHistory = false } = {}) => {
  const [students, enrollments, evaluations, placements, weights] = await Promise.all([
    StudentProfile.find({ _id: { $in: studentIds } }).populate('user', 'name email phone').lean(),
    Enrollment.find({ student: { $in: studentIds } })
      .populate('course', 'title')
      .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } })
      .lean(),
    StudentEvaluation.find({ student: { $in: studentIds } })
      .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } })
      .sort({ createdAt: -1 })
      .lean(),
    StudentPlacement.find({ student: { $in: studentIds } }).lean(),
    loadWeights(),
  ]);

  const totals = await attendanceTotalsByEnrollment(enrollments.map((e) => e._id));

  const enrollmentsByStudent = new Map();
  enrollments.forEach((en) => {
    const key = String(en.student);
    if (!enrollmentsByStudent.has(key)) enrollmentsByStudent.set(key, []);
    enrollmentsByStudent.get(key).push(en);
  });

  const evalsByEnrollment = new Map(); // newest first, because of the sort above
  evaluations.forEach((ev) => {
    const key = String(ev.enrollment);
    if (!evalsByEnrollment.has(key)) evalsByEnrollment.set(key, []);
    evalsByEnrollment.get(key).push(ev);
  });

  const placementByStudent = new Map(placements.map((p) => [String(p.student), p]));
  const teacherId = teacher ? String(teacher._id) : null;

  const evalView = (ev, courseTitle) => ({
    id: ev._id,
    enrollmentId: ev.enrollment,
    courseTitle,
    teacherName: ev.teacher?.user?.name || '',
    ratings: ev.ratings,
    average: round1(evaluationAverage(ev.ratings)),
    comment: ev.comment || '',
    createdAt: ev.createdAt,
  });

  return students.map((s) => {
    const sid = String(s._id);
    const own = enrollmentsByStudent.get(sid) || [];

    let present = 0;
    let total = 0;
    const latestAverages = [];
    const history = [];

    const enrollmentRows = own.map((en) => {
      const t = totals.get(String(en._id));
      if (t) {
        present += t.present;
        total += t.total;
      }
      const evs = evalsByEnrollment.get(String(en._id)) || [];
      const latest = evs[0] || null;
      if (latest) latestAverages.push(evaluationAverage(latest.ratings));
      const isMine = teacherId ? String(en.teacher?._id || en.teacher) === teacherId : false;
      if (withHistory && (!teacherId || isMine)) evs.forEach((ev) => history.push(evalView(ev, en.course?.title || '')));
      return {
        id: en._id,
        courseId: en.course?._id,
        courseTitle: en.course?.title || '',
        status: en.status,
        teacherName: en.teacher?.user?.name || '',
        attendancePercent: t && t.total > 0 ? round1((t.present / t.total) * 100) : null,
        sessions: t ? t.total : 0,
        latestEvaluation: latest && (!teacherId || isMine) ? evalView(latest, en.course?.title || '') : null,
        evaluated: Boolean(latest),
        canEvaluate: Boolean(teacherId) && isMine && en.status !== 'dropped',
      };
    });

    const placement = placementByStudent.get(sid) || null;
    const evaluationAvg = latestAverages.length
      ? latestAverages.reduce((a, b) => a + b, 0) / latestAverages.length
      : null;

    const result = computeScore(
      {
        attendance: { present, total },
        enrollments: own,
        evaluationAvg,
        placementStatus: placement?.status || 'not_yet',
      },
      weights
    );

    return {
      studentId: s._id,
      name: s.user?.name || 'Unknown',
      email: s.user?.email || '',
      counts: {
        total: own.length,
        active: own.filter((e) => e.status === 'active').length,
        completed: own.filter((e) => e.status === 'completed').length,
        dropped: own.filter((e) => e.status === 'dropped').length,
      },
      attendance: { percent: total > 0 ? round1((present / total) * 100) : null, sessions: total },
      evaluationAverage: evaluationAvg == null ? null : round1(evaluationAvg),
      placement: placement
        ? {
            status: placement.status,
            type: placement.type,
            company: placement.company,
            role: placement.role,
            date: placement.date,
          }
        : { status: 'not_yet', type: 'job', company: '', role: '', date: null },
      score: result.score,
      band: result.band,
      components: result.components,
      enrollments: enrollmentRows,
      ...(withHistory ? { evaluations: history } : {}),
    };
  });
};

// Which student profiles may this user see?
const visibleStudentIds = async (user) => {
  if (user.role === 'teacher') {
    const teacher = await myTeacherProfile(user);
    if (!teacher) return { teacher: null, ids: [] };
    const ids = await Enrollment.distinct('student', { teacher: teacher._id });
    return { teacher, ids };
  }
  const ids = await StudentProfile.find().distinct('_id');
  return { teacher: null, ids };
};

// @desc    Performance of every student (teachers: their own students)
// @route   GET /api/performance
// @access  Private/Admin, Founder, Teacher
const getPerformance = asyncHandler(async (req, res) => {
  const { teacher, ids } = await visibleStudentIds(req.user);
  const rows = await buildRows(ids, { teacher });
  const weights = await loadWeights();
  res.json({ success: true, count: rows.length, weights, data: rows });
});

// @desc    One student's performance with the full evaluation history
// @route   GET /api/performance/:studentId
// @access  Private/Admin, Founder, Teacher
const getStudentPerformance = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  if (!mongoose.isValidObjectId(studentId)) {
    res.status(400);
    throw new Error('Invalid student');
  }
  const { teacher, ids } = await visibleStudentIds(req.user);
  if (!ids.some((id) => String(id) === studentId)) {
    res.status(404);
    throw new Error('Student not found');
  }
  const [row] = await buildRows([studentId], { teacher, withHistory: true });
  res.json({ success: true, data: row });
});

const parseRatings = (input = {}) => {
  const out = {};
  for (const key of RATING_KEYS) {
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < 1 || n > 5) return null;
    out[key] = n;
  }
  return out;
};

// @desc    A teacher evaluates a student in one of their classes
// @route   POST /api/performance/evaluations
// @access  Private/Teacher
const createEvaluation = asyncHandler(async (req, res) => {
  const { enrollment: enrollmentId, ratings, comment } = req.body;

  if (!enrollmentId || !mongoose.isValidObjectId(enrollmentId)) {
    res.status(400);
    throw new Error('Select the class to evaluate');
  }
  const parsed = parseRatings(ratings);
  if (!parsed) {
    res.status(400);
    throw new Error('Give every rating a value from 1 to 5');
  }
  if (comment && String(comment).length > 500) {
    res.status(400);
    throw new Error('Comment can be at most 500 characters');
  }

  const teacher = await myTeacherProfile(req.user);
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment || !teacher || String(enrollment.teacher) !== String(teacher._id)) {
    res.status(403);
    throw new Error('You can only evaluate students of your own classes');
  }
  if (enrollment.status === 'dropped') {
    res.status(400);
    throw new Error('This student has dropped the class');
  }

  const evaluation = await StudentEvaluation.create({
    enrollment: enrollment._id,
    student: enrollment.student,
    course: enrollment.course,
    teacher: teacher._id,
    ratings: parsed,
    comment: comment ? String(comment).trim() : '',
  });

  res.status(201).json({ success: true, data: evaluation });
});

// @desc    Set a student's job / placement status
// @route   PUT /api/performance/placement/:studentId
// @access  Private/Admin, Teacher (for their own students)
const savePlacement = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { status, type, company, role, date } = req.body;

  if (!mongoose.isValidObjectId(studentId) || !(await StudentProfile.exists({ _id: studentId }))) {
    res.status(404);
    throw new Error('Student not found');
  }
  if (req.user.role === 'teacher') {
    const teacher = await myTeacherProfile(req.user);
    const teaches = teacher && (await Enrollment.exists({ student: studentId, teacher: teacher._id }));
    if (!teaches) {
      res.status(403);
      throw new Error('You can only update students of your own classes');
    }
  }
  if (!PLACEMENT_STATUSES.includes(status)) {
    res.status(400);
    throw new Error('Choose a valid job status');
  }
  if (type && !PLACEMENT_TYPES.includes(type)) {
    res.status(400);
    throw new Error('Choose job, internship or freelance');
  }
  let when = null;
  if (date) {
    when = new Date(date);
    if (Number.isNaN(when.getTime())) {
      res.status(400);
      throw new Error('Invalid date');
    }
  }

  const placement = await StudentPlacement.findOneAndUpdate(
    { student: studentId },
    {
      status,
      type: type || 'job',
      company: company ? String(company).trim().slice(0, 120) : '',
      role: role ? String(role).trim().slice(0, 120) : '',
      date: when,
      updatedBy: req.user._id,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.json({ success: true, data: placement });
});

// @desc    Score weights
// @route   GET /api/performance/settings
// @access  Private/Admin, Founder, Teacher
const getSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await loadWeights() });
});

// @desc    Change score weights
// @route   PUT /api/performance/settings
// @access  Private/Admin
const updateSettings = asyncHandler(async (req, res) => {
  const next = {};
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const n = Number(req.body[key]);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      res.status(400);
      throw new Error('Each weight must be a number from 0 to 100');
    }
    next[key] = n;
  }
  if (Object.values(next).every((n) => n === 0)) {
    res.status(400);
    throw new Error('At least one weight must be above 0');
  }
  await PerformanceSetting.findOneAndUpdate({ key: 'weights' }, { key: 'weights', ...next }, { upsert: true, new: true, setDefaultsOnInsert: true });
  res.json({ success: true, data: next });
});

module.exports = {
  getPerformance,
  getStudentPerformance,
  createEvaluation,
  savePlacement,
  getSettings,
  updateSettings,
};
