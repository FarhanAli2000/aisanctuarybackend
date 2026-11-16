const Batch = require('../models/Batch');

// The portal works with courses only: a course runs as one class, and the teacher, class days,
// time and seats of that class live in the course's batch record. Clients send just the course;
// this finds that record (the oldest active one if a course ever has more than one).
const getCourseBatch = async (courseId) => {
  const batch = await Batch.findOne({ course: courseId, isActive: true }).sort({ createdAt: 1 });
  if (!batch) {
    const err = new Error('This course has no class schedule yet. Add the teacher and time on the Courses page first.');
    err.statusCode = 400;
    throw err;
  }
  return batch;
};

module.exports = { getCourseBatch };
