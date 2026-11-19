const mongoose = require('mongoose');

// Whether a student found work after studying: one record per student.
const studentPlacementSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true, unique: true },
    status: {
      type: String,
      enum: ['not_yet', 'looking', 'interview', 'placed'],
      default: 'not_yet',
    },
    type: { type: String, enum: ['job', 'internship', 'freelance'], default: 'job' },
    company: { type: String, trim: true, maxlength: 120, default: '' },
    role: { type: String, trim: true, maxlength: 120, default: '' },
    date: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentPlacement', studentPlacementSchema);
