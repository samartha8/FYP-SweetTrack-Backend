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
    max: 13 // Age category 1-13
  },
  sex: {
    type: Number,
    enum: [0, 1] // 0=Female, 1=Male
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
    min: 12,
    max: 98
  },
  // Medical Measurements
  highBP: {
    type: Number,
    enum: [0, 1] // 0=No, 1=Yes
  },
  highChol: {
    type: Number,
    enum: [0, 1] // 0=No, 1=Yes
  },
  genHlth: {
    type: Number,
    min: 1,
    max: 5 // 1=Excellent, 2=Very Good, 3=Good, 4=Fair, 5=Poor
  },
  // Lifestyle
  smoker: {
    type: Number,
    enum: [0, 1] // 0=No, 1=Yes
  },
  physActivity: {
    type: Number,
    enum: [0, 1] // 0=No, 1=Yes
  },
  // Medical History
  heartDiseaseOrAttack: {
    type: Number,
    enum: [0, 1] // 0=No, 1=Yes
  },
  // Engineered Features
  hba1cEstimated: {
    type: Number, // %
    min: 3.5,
    max: 15.0
  },
  bloodGlucoseEstimated: {
    type: Number, // mg/dL
    min: 70,
    max: 300
  }
}, { timestamps: true });

export default mongoose.model('Health', healthSchema);
