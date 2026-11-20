const mongoose = require('mongoose');

const parentSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    relation: { type: String, enum: ['father', 'mother', 'guardian'], required: true },
    cnic: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    passportNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    passportExpiry: { type: Date, required: true },
  },
  { _id: false }
);

// One selected student on one trip, and the parents' details the student submits.
const tripApplicationSchema = new mongoose.Schema(
  {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    status: {
      type: String,
      enum: ['pending', 'submitted', 'changes_requested', 'approved'],
      default: 'pending',
    },
    parents: { type: [parentSchema], default: [] },
    emergencyName: { type: String, trim: true, maxlength: 120, default: '' },
    emergencyPhone: { type: String, trim: true, maxlength: 30, default: '' },
    medicalNotes: { type: String, trim: true, maxlength: 500, default: '' },
    adminNote: { type: String, trim: true, maxlength: 300, default: '' },
    submittedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

tripApplicationSchema.index({ trip: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('TripApplication', tripApplicationSchema);
