import mongoose from 'mongoose';

const healthSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  age: Number,
  gender: String,
  height: Number,
  weight: Number,
  bmi: Number,
  bloodGlucose: Number,
  hba1c: Number,
  bloodPressure: {
    systolic: Number,
    diastolic: Number
  },
  cholesterol: String,
  smoking: String,
  physicalActivityMinutes: Number,
  dailySteps: Number,
  hypertension: String,
  heartDiseaseHistory: String
}, { timestamps: true });

export default mongoose.model('Health', healthSchema);
