const mongoose = require('mongoose');

// One document (key: 'weights') holding how much each part counts towards the performance score.
const performanceSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'weights' },
    attendance: { type: Number, min: 0, max: 100, default: 30 },
    classes: { type: Number, min: 0, max: 100, default: 20 },
    evaluation: { type: Number, min: 0, max: 100, default: 30 },
    placement: { type: Number, min: 0, max: 100, default: 20 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PerformanceSetting', performanceSettingSchema);
