const mongoose = require('mongoose');

const studentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    // Identity document: CNIC if the student has one, otherwise B-Form
    identityDocType: {
      type: String,
      enum: ['CNIC', 'B-Form'],
      required: true,
    },
    identityDocFrontUrl: {
      type: String,
      required: true,
    },
    identityDocBackUrl: {
      type: String,
      required: function () {
        return this.identityDocType === 'CNIC';
      },
    },
    identityDocImageUrl: {
      type: String,
      required: true,
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
