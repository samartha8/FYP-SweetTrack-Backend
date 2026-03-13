import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import DiabetesPrediction from '../models/DiabetesPrediction.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const getLatestPrediction = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        const prediction = await DiabetesPrediction.findOne({ user: req.user._id })
            .sort({ createdAt: -1 });

        if (!prediction) {
            return res.json({
                success: true,
                hasHistory: false,
                riskLevel: 'Low',
                riskScore: 0
            });
        }

        res.json({
            success: true,
            hasHistory: true,
            prediction: prediction.prediction,
            probability: prediction.probability,
            riskScore: prediction.riskScore,
            riskLevel: prediction.riskLevel,
            insights: prediction.insights,
            inputData: prediction.inputData,
            timestamp: prediction.createdAt
        });

    } catch (error) {
        console.error('Error fetching prediction history:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const getPredictionHistory = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        const predictions = await DiabetesPrediction.find({ user: req.user._id })
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: predictions.length,
            data: predictions
        });

    } catch (error) {
        console.error('Error fetching prediction history:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const predictDiabetes = async (req, res) => {
    try {
        // Pass everything to the flexible Python script
        const inputData = req.body;
        console.log("📥 [DiabetesController] Input Data:", JSON.stringify(inputData, null, 2));

        // 1. Dynamic Estimation & Pre-processing
        const bmi = parseFloat(inputData.bmi || 25);
        const age = parseFloat(inputData.age || 5);
        const genHlth = parseFloat(inputData.genHlth || 3);
        const parseFloatSafe = (val) => (val == '1' || val === 1) ? 1 : 0;
        const highChol = parseFloatSafe(inputData.highChol);
        const highBP = parseFloatSafe(inputData.highBP);

        // Calculate live estimates based on current profile metrics
        const hba1c = 4.5 + (bmi - 25) * 0.03 + (age - 7) * 0.15 + genHlth * 0.4 + highChol * 0.8 + highBP * 0.6;
        const glucose = 85 + (bmi - 25) * 1.2 + (age - 7) * 3.0 + genHlth * 8 + highChol * 15 + highBP * 12;

        // Patch the input data so Python uses the NEW estimates
        inputData.hba1cEstimated = hba1c;
        inputData.bloodGlucoseEstimated = glucose;
        inputData.glucose = glucose;

        // Path to python script
        const pythonScriptPath = path.join(__dirname, '../../ml_models/predict.py');

        // Spawn python process
        const pythonProcess = spawn('python', [pythonScriptPath]);

        let dataString = '';
        let errorString = '';

        // Send UPDATED data to python script via stdin
        pythonProcess.stdin.write(JSON.stringify(inputData));
        pythonProcess.stdin.end();

        // Collect data from stdout
        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        // Collect error from stderr
        pythonProcess.stderr.on('data', (data) => {
            errorString += data.toString();
        });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error(`Python script exited with code ${code}`);
                console.error(`Python error (stderr): ${errorString}`);
                // Try to parse partial data even if code != 0, sometimes warnings trigger this
            }
            console.log("Python stdout:", dataString);
            console.log("Python stderr:", errorString);

            try {
                console.log("🐍 [DiabetesController] Raw Python Output:", `"${dataString}"`);
                if (!dataString) {
                    throw new Error(`Python script returned no output. Stderr: ${errorString}`);
                }
                const result = JSON.parse(dataString);

                if (!result.success) {
                    throw new Error(result.error || 'Unknown error from prediction script');
                }

                // --- POST-PROCESSING ---

                // 1. Determine Risk Level from ML Probability
                // STRICT MAPPING:
                // No Risk: 0-33% (Score 0-33)
                // Medium Risk: 34-66% (Score 34-66)
                // High Risk: 67-100% (Score 67-100)

                const mlProbability = result.probability || 0;
                let riskScore = 0;
                let riskLevel = 'Low Risk'; // Changed from 'No Risk' to 'Low Risk'

                // 1. Initial ML-based Level Determination
                if (mlProbability >= 0.67) {
                    riskLevel = 'High Risk';
                } else if (mlProbability > 0.33) {
                    riskLevel = 'Medium Risk';
                }

                // 2. Clinical Overrides (Already Calculated Above)
                const isHighBP = highBP === 1 || inputData.bloodPressure > 130;

                let clinicalOverride = false;

                // Rule 1: Diabetes Range (High Risk)
                if (hba1c >= 6.5 || glucose >= 200) {
                    riskLevel = 'High Risk';
                    clinicalOverride = true;
                }
                // Rule 2: Prediabetes Range (Medium Risk)
                else if (hba1c >= 5.7 || glucose >= 140) {
                    if (riskLevel === 'Low Risk') {
                        riskLevel = 'Medium Risk';
                    }
                    clinicalOverride = true;
                }

                // 3. Proportional Scaling Logic
                const scaleScore = (prob, level, override) => {
                    // If ML Model is already very confident (e.g. > 90%), trust it
                    if (prob > 0.9) {
                        return prob * 100;
                    }

                    // If no override and logic matches bucket, return raw probability %
                    if (!override) {
                        return prob * 100;
                    }

                    // If Override (e.g. Low ML prob but High Clinical Risk), map to severity range
                    if (level === 'High Risk') {
                        // Blend ML probability with clinical floor of 67
                        // formula: 67 + (prob * 33) -> This pushes 0.93 to 97.7!
                        // FIX: If prob is high, just return prob * 100
                        if (prob > 0.67) return prob * 100;
                        return 67 + (prob * 33);
                    } else if (level === 'Medium Risk') {
                        return 34 + (prob * 32); // Map 0-1 to 34-66
                    } else {
                        return prob * 33; // Fallback
                    }
                };

                riskScore = Math.round(scaleScore(mlProbability, riskLevel, clinicalOverride));

                // 3. Generate Insights
                const insights = [];

                if (clinicalOverride) {
                    insights.push('Risk level elevated based on clinical guidelines (HbA1c/Glucose).');
                } else if (riskLevel === 'High Risk') {
                    insights.push('Your calculated risk is High based on ML factors. Please consult a healthcare provider.');
                }

                if (glucose > 140) {
                    insights.push(`Glucose level (${glucose.toFixed(1)}) appears elevated.`);
                }
                if (hba1c > 5.7) {
                    insights.push(`HbA1c level (${hba1c.toFixed(1)}%) is above normal.`);
                }
                if (bmi > 30) {
                    insights.push('BMI indicates obesity. Weight management reduces risk.');
                } else if (bmi > 25) {
                    insights.push('BMI indicates overweight.');
                }
                if (isHighBP) {
                    insights.push('High blood pressure is a contributing risk factor.');
                }

                if (insights.length === 0 && riskLevel === 'No Risk') {
                    insights.push('Great job! Your metrics indicate a healthy profile.');
                }

                const finalScore = riskScore;
                const finalInsights = insights.length > 0 ? insights : ['Your metrics indicate a healthy profile.'];

                // 3. Save to History (if user is authenticated)
                if (req.user) {
                    try {
                        const predictionRecord = new DiabetesPrediction({
                            user: req.user._id,
                            inputData: inputData, // Save raw input for debug/retraining
                            prediction: result.prediction,
                            probability: result.probability,
                            riskScore: finalScore,
                            riskLevel: riskLevel,
                            insights: finalInsights
                        });
                        await predictionRecord.save();
                        console.log('✅ Prediction saved to history:', predictionRecord._id);
                    } catch (dbErr) {
                        console.error('Failed to save prediction history:', dbErr);
                        // Don't fail the request, just log
                    }
                }

                res.json({
                    success: true,
                    prediction: result.prediction,
                    probability: result.probability,
                    riskScore: finalScore,
                    riskLevel: riskLevel,
                    insights: finalInsights,
                    inputData: inputData,
                    message: result.prediction === 1 ?
                        'Prediction indicates potential risk.' :
                        'Prediction indicates low risk.'
                });

            } catch (err) {
                console.error('Error parsing Python output:', err);
                console.error('Raw output:', dataString);
                res.status(500).json({
                    success: false,
                    message: 'Failed to process prediction result',
                    error: err.message
                });
            }
        });

    } catch (error) {
        console.error('Diabetes prediction error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during prediction',
            error: error.message
        });
    }
};
