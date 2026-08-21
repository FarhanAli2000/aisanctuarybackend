const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Batch',
      required: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeacherProfile',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'dropped'],
      default: 'active',
    },
    // Teacher-editable course duration for this specific student
    courseDurationWeeks: {
      type: Number,
      required: true,
      min: 1,
    },
    expectedEndDate: {
      type: Date,
    },
    enrolledAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
    },
    // 0 = no fee for this enrollment; admin decides the monthly amount
    monthlyFeeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// A student cannot be enrolled twice (active) in the exact same course
enrollmentSchema.index(
  { student: 1, course: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
  }
);

enrollmentSchema.index({ status: 1, batch: 1 });
enrollmentSchema.index({ status: 1, student: 1 });
enrollmentSchema.index({ teacher: 1, status: 1 });
enrollmentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
