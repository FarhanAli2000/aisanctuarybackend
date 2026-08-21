const mongoose = require('mongoose');

const BATCH_MAX_CAPACITY = 20;

const batchSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeacherProfile',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Teacher selects which days this batch meets
    scheduleDays: {
      type: [String],
      enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      required: true,
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'At least one schedule day must be selected',
      },
    },
    scheduleStartTime: {
      type: String, // e.g. "17:00"
      required: true,
    },
    scheduleEndTime: {
      type: String, // e.g. "18:00"
      required: true,
    },
    capacity: {
      type: Number,
      default: BATCH_MAX_CAPACITY,
      max: BATCH_MAX_CAPACITY,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

batchSchema.index({ isActive: 1 });
batchSchema.index({ teacher: 1 });
batchSchema.index({ course: 1 });

batchSchema.statics.MAX_CAPACITY = BATCH_MAX_CAPACITY;

module.exports = mongoose.model('Batch', batchSchema);
