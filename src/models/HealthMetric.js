import mongoose from 'mongoose';

const healthMetricSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  date: {
    type: Date,
    default: Date.now,
    index: true,
  },
  source: {
    type: String,
    enum: ['google_fit', 'manual'],
    default: 'google_fit',
  },
  steps: { type: Number, default: 0 },
  calories: { type: Number, default: 0 },
  sleepHours: { type: Number, default: 0 },
  water: { type: Number, default: 0 }, // glasses per day
  heartRateAvg: { type: Number },
  bloodGlucose: { type: Number },
  bloodPressure: {
    systolic: { type: Number },
    diastolic: { type: Number },
  },
  syncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('HealthMetric', healthMetricSchema);

