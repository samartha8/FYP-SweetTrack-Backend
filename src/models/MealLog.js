import mongoose from 'mongoose';

const mealLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  mealType: {
    type: String,
    enum: ['breakfast', 'lunch', 'dinner', 'snack'],
    required: true,
  },
  imageUrl: {
    type: String,
  },
  storagePath: {
    type: String,
  },
  foodItems: [{
    name: { type: String, required: true },
    confidence: { type: Number, default: 0 },
  }],
  nutritionalInfo: {
    calories: { type: Number, default: 0 },
    carbs: { type: Number, default: 0 },
    protein: { type: Number, default: 0 },
    fat: { type: Number, default: 0 },
    sugar: { type: Number },
    fiber: { type: Number },
    sodium: { type: Number },
  },
  servingSize: {
    type: String,
  },
  loggedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  notes: {
    type: String,
  },
  aiReady: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

export default mongoose.model('MealLog', mealLogSchema);

