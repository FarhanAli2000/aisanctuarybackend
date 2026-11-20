const mongoose = require('mongoose');

// A reward trip (e.g. parents of the year's top performer go on Umrah). Admin creates it, picks winners.
const tripSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    destination: { type: String, required: true, trim: true, maxlength: 120 },
    tripDate: { type: Date },
    // Students can fill or edit their form until the end of this day
    deadline: { type: Date },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Trip', tripSchema);
