const asyncHandler = require('express-async-handler');
const Fee = require('../models/Fee');
const Enrollment = require('../models/Enrollment');
const StudentProfile = require('../models/StudentProfile');
const triggerN8n = require('../utils/triggerN8n');
const { getCycleRange, paidDateFilter, splitAmount } = require('../utils/feePeriod');

const populateFee = (query) =>
  query
    .populate({ path: 'student', populate: { path: 'user', select: 'name email' } })
    .populate({
      path: 'enrollment',
      populate: [
        { path: 'course', select: 'title' },
        { path: 'teacher', populate: { path: 'user', select: 'name' } },
      ],
    })
    .populate('recordedBy', 'name');

const studentScope = async (req) => {
  if (req.user.role !== 'student') return null;
  const profile = await StudentProfile.findOne({ user: req.user._id });
  return profile?._id || null;
};

// @desc    Set monthly fee amount for an enrollment (0 = no fee)
// @route   PUT /api/fees/plans/:enrollmentId
// @access  Private/Admin
const setFeePlan = asyncHandler(async (req, res) => {
  const { monthlyFeeAmount } = req.body;
  const amount = Number(monthlyFeeAmount);

  if (Number.isNaN(amount) || amount < 0) {
    res.status(400);
    throw new Error('Monthly fee amount must be 0 or a positive number');
  }

  const enrollment = await Enrollment.findById(req.params.enrollmentId);
  if (!enrollment) {
    res.status(404);
    throw new Error('Enrollment not found');
  }

  enrollment.monthlyFeeAmount = amount;
  await enrollment.save();

  const populated = await Enrollment.findById(enrollment._id)
    .populate({ path: 'student', populate: { path: 'user', select: 'name email' } })
    .populate('course', 'title')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } });

  res.json({ success: true, data: populated });
});

// @desc    Admin records a cash/bank fee payment
// @route   POST /api/fees
// @access  Private/Admin
const recordPayment = asyncHandler(async (req, res) => {
  const { enrollment, amount, paidDate, method, note } = req.body;

  if (!enrollment || !amount || !paidDate || !method) {
    res.status(400);
    throw new Error('Enrollment, amount, paid date, and method (cash/bank) are required');
  }

  if (!['cash', 'bank'].includes(method)) {
    res.status(400);
    throw new Error('Method must be cash or bank');
  }

  const amountNum = Number(amount);
  if (Number.isNaN(amountNum) || amountNum < 1) {
    res.status(400);
    throw new Error('Amount must be a positive number');
  }

  const enrollmentDoc = await Enrollment.findById(enrollment);
  if (!enrollmentDoc) {
    res.status(404);
    throw new Error('Enrollment not found');
  }

  const date = new Date(paidDate);
  const nextDueDate = new Date(date);
  nextDueDate.setMonth(nextDueDate.getMonth() + 1);

  const fee = await Fee.create({
    student: enrollmentDoc.student,
    enrollment: enrollmentDoc._id,
    status: 'paid',
    amount: amountNum,
    paidDate: date,
    method,
    nextDueDate,
    reminderSent: false,
    recordedBy: req.user._id,
    note: note || '',
  });

  const studentProfile = await StudentProfile.findById(enrollmentDoc.student).populate(
    'user',
    'name email'
  );

  triggerN8n('fee-payment-recorded', {
    feeId: fee._id,
    studentId: enrollmentDoc.student,
    userId: studentProfile?.user?._id,
    studentName: studentProfile?.user?.name,
    studentEmail: studentProfile?.user?.email,
    enrollmentId: enrollmentDoc._id,
    amount: amountNum,
    method,
    paidDate: date,
  });

  const populated = await populateFee(Fee.findById(fee._id));
  res.status(201).json({ success: true, data: populated });
});

// @desc    Payment history
// @route   GET /api/fees
// @access  Private/Admin,Founder,Student(own)
const getPayments = asyncHandler(async (req, res) => {
  const filter = { status: 'paid' };
  if (req.query.enrollment) filter.enrollment = req.query.enrollment;

  const ownStudentId = await studentScope(req);
  if (req.user.role === 'student') {
    if (!ownStudentId) return res.json({ success: true, count: 0, data: [] });
    filter.student = ownStudentId;
  }

  const fees = await populateFee(Fee.find(filter).sort({ paidDate: -1 }));
  res.json({ success: true, count: fees.length, data: fees });
});

// @desc    Enrollments with a monthly fee and no payment in the current 25-to-25 cycle
// @route   GET /api/fees/pending
// @access  Private/Admin,Founder,Student(own)
const getPendingFees = asyncHandler(async (req, res) => {
  const range = getCycleRange(req.query.periodEnd);
  const ownStudentId = await studentScope(req);

  const enrollFilter = { monthlyFeeAmount: { $gt: 0 }, status: 'active' };
  if (req.user.role === 'student') {
    if (!ownStudentId) return res.json({ success: true, count: 0, data: [], period: range });
    enrollFilter.student = ownStudentId;
  }

  const enrollments = await Enrollment.find(enrollFilter)
    .populate({ path: 'student', populate: { path: 'user', select: 'name email' } })
    .populate('course', 'title')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'name' } });

  const paidInCycle = await Fee.find({
    status: 'paid',
    paidDate: { $gte: range.start, $lte: range.end },
  }).select('enrollment');

  const paidEnrollmentIds = new Set(paidInCycle.map((f) => String(f.enrollment)));
  const pending = enrollments.filter((e) => !paidEnrollmentIds.has(String(e._id)));

  res.json({
    success: true,
    count: pending.length,
    period: { start: range.start, end: range.end, cycleEnd: range.cycleEnd },
    data: pending,
  });
});

// @desc    25-to-25 monthly summary with 50/10/40 split
// @route   GET /api/fees/summary
// @access  Private/Admin,Founder
const getFeeSummary = asyncHandler(async (req, res) => {
  const range = getCycleRange(req.query.periodEnd);
  const dateFilter = paidDateFilter(req.query.periodEnd);

  const payments = await populateFee(
    Fee.find({ status: 'paid', paidDate: dateFilter }).sort({ paidDate: 1 })
  );

  const byCourseMap = {};
  let totalCollected = 0;
  let teacherShare = 0;
  let managerShare = 0;
  let instituteShare = 0;

  payments.forEach((p) => {
    const split = splitAmount(p.amount);
    totalCollected += p.amount;
    teacherShare += split.teacherShare;
    managerShare += split.managerShare;
    instituteShare += split.instituteShare;

    const courseId = String(p.enrollment?.course?._id || p.enrollment?.course || 'unknown');
    if (!byCourseMap[courseId]) {
      byCourseMap[courseId] = {
        courseId,
        courseTitle: p.enrollment?.course?.title || 'Unknown course',
        teacherName: p.enrollment?.teacher?.user?.name || 'Unassigned',
        collected: 0,
        teacherShare: 0,
        managerShare: 0,
        instituteShare: 0,
        paymentCount: 0,
      };
    }
    const row = byCourseMap[courseId];
    row.collected += p.amount;
    row.teacherShare += split.teacherShare;
    row.managerShare += split.managerShare;
    row.instituteShare += split.instituteShare;
    row.paymentCount += 1;
  });

  res.json({
    success: true,
    data: {
      period: { start: range.start, end: range.end, cycleEnd: range.cycleEnd },
      totalCollected,
      teacherShare,
      managerShare,
      instituteShare,
      paymentCount: payments.length,
      byCourse: Object.values(byCourseMap),
    },
  });
});

module.exports = {
  setFeePlan,
  recordPayment,
  getPayments,
  getPendingFees,
  getFeeSummary,
};
