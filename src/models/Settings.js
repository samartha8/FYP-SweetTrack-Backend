import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    unique: true 
  },
  language: {
    type: String,
    enum: ['en', 'ne', 'hi'],
    default: 'en'
  },
  highContrast: {
    type: Boolean,
    default: false
  },
  fontSize: {
    type: String,
    enum: ['small', 'medium', 'large'],
    default: 'medium'
  },
  notifications: {
    enabled: {
      type: Boolean,
      default: true
    },
    dailyReminders: {
      type: Boolean,
      default: true
    },
    goalAlerts: {
      type: Boolean,
      default: true
    },
    healthTips: {
      type: Boolean,
      default: true
    }
  },
  accessibility: {
    screenReader: {
      type: Boolean,
      default: false
    },
    hapticFeedback: {
      type: Boolean,
      default: true
    },
    voiceInput: {
      type: Boolean,
      default: false
    }
  }
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);

