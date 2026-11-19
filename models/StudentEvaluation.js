const mongoose = require('mongoose');

const rating = { type: Number, required: true, min: 1, max: 5 };

// A teacher's evaluation of one student in one class (enrollment). A student can be evaluated more than
// once in the same class (e.g. every month); the latest one counts towards the performance score.
const studentEvaluationSchema = new mongoose.Schema(
  {
    enrollment: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'TeacherProfile', required: true },
    ratings: {
      skills: rating,
      participation: rating,
      assignments: rating,
      behaviour: rating,
    },
    comment: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true }
);

studentEvaluationSchema.index({ student: 1, createdAt: -1 });
studentEvaluationSchema.index({ enrollment: 1, createdAt: -1 });
studentEvaluationSchema.index({ teacher: 1 });

module.exports = mongoose.model('StudentEvaluation', studentEvaluationSchema);
