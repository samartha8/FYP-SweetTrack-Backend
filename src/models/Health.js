import mongoose from 'mongoose';

const healthSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    unique: true
  },
  // Personal Information
  age: {
    type: Number,
    min: 1,
    max: 120
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other', '']
  },
  height: {
    type: Number, // in cm
    min: 80,
    max: 250
  },
  weight: {
    type: Number, // in kg
    min: 25,
    max: 400
  },
  bmi: {
    type: Number,
    min: 10,
    max: 100
  },
  // Medical Measurements
  bloodGlucose: {
    type: Number, // mg/dL
    min: 40,
    max: 600
  },
  hba1c: {
    type: Number, // %
    min: 0,
    max: 20
  },
  bloodPressure: {
    systolic: {
      type: Number,
      min: 80,
      max: 250
    },
    diastolic: {
      type: Number,
      min: 40,
      max: 150
    }
  },
  cholesterol: {
    type: String // Can be number or "highchol" text
  },
  // Lifestyle
  smoking: {
    type: String,
    enum: ['Never', 'Former', 'Current', '']
  },
  physicalActivityMinutes: {
    type: Number, // minutes per week
    min: 0,
    max: 10000
  },
  dailySteps: {
    type: Number, // steps per day
    min: 0,
    max: 100000
  },
  // Medical History
  hypertension: {
    type: String,
    enum: ['Yes', 'No', '']
  },
  heartDiseaseHistory: {
    type: String,
    enum: ['Yes', 'No', '']
  }
}, { timestamps: true });

export default mongoose.model('Health', healthSchema);
