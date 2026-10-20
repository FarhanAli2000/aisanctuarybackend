const mongoose = require('mongoose');
const Enrollment = require('../models/Enrollment');

// Students with these statuses no longer take a seat in a batch, even if their
// enrollment is still marked active
const SEAT_FREE_STUDENT_STATUSES = ['inactive', 'completed'];

const toId = (id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id));

const toIds = (batchIds) => (batchIds || []).filter(Boolean).map(toId);

// Active enrollments of students who still count toward batch capacity
const seatPipeline = (match) => [
  { $match: { status: 'active', ...match } },
  {
    $lookup: {
      from: 'studentprofiles',
      localField: 'student',
      foreignField: '_id',
      as: 'studentProfile',
    },
  },
  {
    $match: {
      'studentProfile.0': { $exists: true },
      'studentProfile.enrollmentStatus': { $nin: SEAT_FREE_STUDENT_STATUSES },
    },
  },
];

const enrolledCountByBatch = async (batchIds) => {
  const ids = toIds(batchIds);
  if (!ids.length) return new Map();

  const rows = await Enrollment.aggregate([
    ...seatPipeline({ batch: { $in: ids } }),
    { $group: { _id: '$batch', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.count]));
};

// Seats taken in one batch; excludeEnrollmentId skips the enrollment being moved/reactivated
const countBatchSeats = async (batchId, excludeEnrollmentId) => {
  const match = { batch: toId(batchId) };
  if (excludeEnrollmentId) match._id = { $ne: toId(excludeEnrollmentId) };
  const [row] = await Enrollment.aggregate([...seatPipeline(match), { $count: 'count' }]);
  return row?.count || 0;
};

const takesSeat = (studentProfile) =>
  Boolean(studentProfile) && !SEAT_FREE_STUDENT_STATUSES.includes(studentProfile.enrollmentStatus);

module.exports = {
  SEAT_FREE_STUDENT_STATUSES,
  enrolledCountByBatch,
  countBatchSeats,
  takesSeat,
};
