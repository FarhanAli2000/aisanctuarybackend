const mongoose = require('mongoose');

const attendanceStatusTypeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      enum: ['present', 'absent', 'leave'],
      required: true,
      unique: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AttendanceStatusType', attendanceStatusTypeSchema);
