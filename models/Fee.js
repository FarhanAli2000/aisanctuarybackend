const mongoose = require('mongoose');

const feeSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: true,
    },
    enrollment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Enrollment',
      required: true,
    },
    status: {
      type: String,
      enum: ['paid', 'unpaid'],
      default: 'paid',
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    paidDate: {
      type: Date,
      required: true,
    },
    method: {
      type: String,
      enum: ['cash', 'bank'],
      required: true,
    },
    nextDueDate: {
      type: Date,
    },
    reminderSent: {
      type: Boolean,
      default: false,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

feeSchema.index({ enrollment: 1, paidDate: -1 });
feeSchema.index({ paidDate: 1 });

module.exports = mongoose.model('Fee', feeSchema);
