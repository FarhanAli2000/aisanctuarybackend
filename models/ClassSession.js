const mongoose = require('mongoose');

const classSessionSchema = new mongoose.Schema(
  {
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
    sessionDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
  },
  { timestamps: true }
);

classSessionSchema.index({ batch: 1, sessionDate: 1 }, { unique: true });

module.exports = mongoose.model('ClassSession', classSessionSchema);
