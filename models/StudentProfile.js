const mongoose = require('mongoose');

const studentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Optional: students applying for a course are no longer asked for an address or ID;
    // an admin can still record them when registering a student by hand
    address: {
      type: String,
      trim: true,
      default: '',
    },
    // Identity document: CNIC if the student has one, otherwise B-Form
    identityDocType: {
      type: String,
      enum: ['CNIC', 'B-Form'],
    },
    identityDocFrontUrl: {
      type: String,
    },
    // Back photo is enforced at upload time (requireAndVerifyIdCards), not here, so
    // students registered without ID photos can still be edited
    identityDocBackUrl: {
      type: String,
    },
    identityDocImageUrl: {
      type: String,
    },
    // Guardian info is mandatory when identityDocType is B-Form
    guardianName: {
      type: String,
      trim: true,
      required: function () {
        return this.identityDocType === 'B-Form';
      },
    },
    guardianContact: {
      type: String,
      trim: true,
      required: function () {
        return this.identityDocType === 'B-Form';
      },
    },
    enrollmentStatus: {
      type: String,
      enum: ['pending', 'active', 'completed', 'inactive'],
      default: 'pending',
    },
    // Admin pauses a student (e.g. travelling): enrollments stay intact but the
    // student is hidden from attendance rosters and cannot be marked until resumed
    isPaused: {
      type: Boolean,
      default: false,
    },
    pausedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

studentProfileSchema.index({ enrollmentStatus: 1, createdAt: -1 });

// Restrict which fields get returned to non-authorized roles (CNIC/B-Form image is sensitive)
studentProfileSchema.methods.toPublicJSON = function () {
  const obj = this.toObject();
  delete obj.identityDocImageUrl;
  delete obj.identityDocFrontUrl;
  delete obj.identityDocBackUrl;
  return obj;
};

module.exports = mongoose.model('StudentProfile', studentProfileSchema);
