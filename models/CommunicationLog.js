const mongoose = require('mongoose');

const communicationLogSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: [
        'registration',
        'enrollment',
        'welcome',
        'class_reminder',
        'attendance_alert',
        'fee_reminder',
        'certificate',
        'announcement',
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed'],
      default: 'sent',
    },
    subject: {
      type: String,
      trim: true,
      default: '',
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CommunicationLog', communicationLogSchema);
