const mongoose = require('mongoose');
const Enrollment = require('../models/Enrollment');

const toIds = (batchIds) =>
  (batchIds || [])
    .filter(Boolean)
    .map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)));

const enrolledCountByBatch = async (batchIds) => {
  const ids = toIds(batchIds);
  if (!ids.length) return new Map();

  const rows = await Enrollment.aggregate([
    { $match: { status: 'active', batch: { $in: ids } } },
    { $group: { _id: '$batch', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.count]));
};

module.exports = { enrolledCountByBatch };
