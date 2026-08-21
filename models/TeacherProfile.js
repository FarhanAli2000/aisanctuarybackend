const mongoose = require('mongoose');

const teacherProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // What the teacher is an expert in, e.g. ["MERN Stack Developer", "Python"]
    expertise: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

teacherProfileSchema.index({ isActive: 1 });

module.exports = mongoose.model('TeacherProfile', teacherProfileSchema);
