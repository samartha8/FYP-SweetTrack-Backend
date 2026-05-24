import mongoose from 'mongoose';

const diabetesPredictionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    inputData: {
        // Store all inputs used for this prediction for historical analysis
        age: Number,
        sex: Number,
        height: Number,
        weight: Number,
        bmi: Number,
        highBP: Number,
        highChol: Number,
        genHlth: Number,
        smoker: Number,
        physActivity: Number,
        heartDiseaseOrAttack: Number,
        hba1cEstimated: Number,
        bloodGlucoseEstimated: Number,
        pregnancies: Number,
        glucose: Number,
        // Legacy fields
        skinThickness: Number,
        insulin: Number,
        diabetesPedigreeFunction: Number,
        cholCheck: Number,
        stroke: Number,
        fruits: Number,
        veggies: Number,
        hvyAlcoholConsump: Number,
        mentHlth: Number,
        physHlth: Number,
        diffWalk: Number
    },
    prediction: {
        type: Number,
        required: true,
        enum: [0, 1] // 0 = Negative, 1 = Positive
    },
    probability: {
        type: Number,
        min: 0,
        max: 1
    },
    riskScore: {
        type: Number,
        min: 0,
        max: 100
    },
    riskLevel: {
        type: String,
        enum: ['No Risk', 'Low Risk', 'Medium Risk', 'High Risk'],
        required: true
    },
    insights: [{
        type: String // actionable advices
    }],
    mainReasons: [{
        type: String // AI factors like 'High BMI'
    }],
    mode: {
        type: String,
        enum: ['LIFESTYLE', 'CLINICAL'],
        default: 'LIFESTYLE'
    },
    confidenceScore: {
        type: Number,
        default: 70
    }
}, { timestamps: true });

export default mongoose.model('DiabetesPrediction', diabetesPredictionSchema);
