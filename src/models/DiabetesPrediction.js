import mongoose from 'mongoose';

const diabetesPredictionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    inputData: {
        // Store all inputs used for this prediction for historical analysis
        pregnancies: Number,
        glucose: Number,
        bloodPressure: Number,
        skinThickness: Number,
        insulin: Number,
        bmi: Number,
        diabetesPedigreeFunction: Number,
        age: Number,
        // Add BRFSS fields if applicable, to keep a record of what was actually sent
        highBP: Number,
        highChol: Number,
        cholCheck: Number,
        smoker: Number,
        stroke: Number,
        heartDiseaseorAttack: Number,
        physActivity: Number,
        fruits: Number,
        veggies: Number,
        hvyAlcoholConsump: Number,
        genHlth: Number,
        mentHlth: Number,
        physHlth: Number,
        diffWalk: Number,
        sex: Number
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
        enum: ['Low', 'Moderate', 'High', 'Very High'],
        default: 'Low'
    },
    insights: [{
        type: String // actionable advices
    }]
}, { timestamps: true });

export default mongoose.model('DiabetesPrediction', diabetesPredictionSchema);
