import mongoose from 'mongoose';

const pushTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  platform: {
    type: String,
    enum: ['ios', 'android', 'web', 'unknown'],
    default: 'unknown',
  },
  lastUsedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

export default mongoose.model('PushToken', pushTokenSchema);


