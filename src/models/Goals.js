import mongoose from 'mongoose';

const goalsSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  steps: { type: Number, default: 10000 },
  water: { type: Number, default: 8 }, // glasses
  sleep: { type: Number, default: 8 }, // hours
  calories: { type: Number, default: 2000 },
  pushEnabled: { type: Boolean, default: true },
  lastEvaluatedAt: { type: Date },
}, { timestamps: true });

export default mongoose.model('Goals', goalsSchema);

