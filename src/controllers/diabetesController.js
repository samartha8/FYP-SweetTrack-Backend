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
        // Explicitly extract only the fields we expect from req.body
        // This prevents "phantom fields" (like Income, Education) from being processed or logged
        const {
            age, sex, height, weight, bmi, highBP, highChol, genHlth, 
            smoker, physActivity, heartDiseaseOrAttack, hba1cEstimated, 
            bloodGlucoseEstimated, pregnancies
        } = req.body;

        const inputData = {
            age, sex, height, weight, bmi, highBP, highChol, genHlth,
            smoker, physActivity, heartDiseaseOrAttack, hba1cEstimated,
            bloodGlucoseEstimated, pregnancies
        };

        console.log("📥 [DiabetesController] CLEAN Input Data (Filtered):", JSON.stringify(inputData, null, 2));

        // 1. Dynamic Estimation & Pre-processing
        const bmiVal = parseFloat(bmi || 25);
        const ageVal = parseFloat(age || 5);
        const genHlthVal = parseFloat(genHlth || 3);
        const parseFloatSafe = (val) => (val == '1' || val === 1) ? 1 : 0;
        const highCholVal = parseFloatSafe(highChol);
        const highBPVal = parseFloatSafe(highBP);

        // Calculate live estimates ONLY if not provided by the user
        // Coefficients adjusted to be more conservative
        const calculatedHba1c = 4.5 + (bmiVal - 25) * 0.02 + (ageVal - 7) * 0.1 + (genHlthVal - 1) * 0.3 + highCholVal * 0.5 + highBPVal * 0.4;
        const calculatedGlucose = 85 + (bmiVal - 25) * 0.8 + (ageVal - 7) * 2.0 + (genHlthVal - 1) * 5 + highCholVal * 10 + highBPVal * 8;

        const hba1c = parseFloat(hba1cEstimated || calculatedHba1c);
        const glucose = parseFloat(bloodGlucoseEstimated || calculatedGlucose);

        // Patch the input data for Python
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

                const mlProbability = result.probability || 0;
                const mlPrediction = result.prediction || 0;
                let riskScore = 0;
                let riskLevel = 'Low Risk';

                // 1. Initial ML-based Level Determination
                if (mlPrediction === 1 || mlProbability >= 0.7) {
                    riskLevel = 'High Risk';
                } else if (mlProbability > 0.35) {
                    riskLevel = 'Medium Risk';
                }

                // 2. Clinical Overrides
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
                    if (prob > 0.9) return prob * 100;
                    if (!override) return prob * 100;
                    if (level === 'High Risk') {
                        if (prob > 0.67) return prob * 100;
                        return 67 + (prob * 33);
                    } else if (level === 'Medium Risk') {
                        return 34 + (prob * 32);
                    } else {
                        return prob * 33;
                    }
                };

                riskScore = Math.round(scaleScore(mlProbability, riskLevel, clinicalOverride));

                // 4. Generate Insights
                const insights = [];
                if (clinicalOverride) {
                    insights.push('Risk level elevated based on clinical guidelines (HbA1c/Glucose).');
                } else if (riskLevel === 'High Risk') {
                    insights.push('Your calculated risk is High based on ML factors. Please consult a healthcare provider.');
                }

                if (glucose > 140) insights.push(`Glucose level (${glucose.toFixed(1)}) appears elevated.`);
                if (hba1c > 5.7) insights.push(`HbA1c level (${hba1c.toFixed(1)}%) is above normal.`);
                if (bmiVal > 30) {
                    insights.push('BMI indicates obesity. Weight management reduces risk.');
                } else if (bmiVal > 25) {
                    insights.push('BMI indicates overweight.');
                }
                if (highBPVal === 1) insights.push('High blood pressure is a contributing risk factor.');

                const finalInsights = insights.length > 0 ? insights : ['Your metrics indicate a healthy profile.'];

                // 5. Save to History
                if (req.user) {
                    try {
                        const predictionRecord = new DiabetesPrediction({
                            user: req.user._id,
                            inputData: inputData,
                            prediction: result.prediction,
                            probability: result.probability,
                            riskScore: riskScore,
                            riskLevel: riskLevel,
                            insights: finalInsights
                        });
                        await predictionRecord.save();
                        console.log('✅ Prediction saved to history:', predictionRecord._id);
                    } catch (dbErr) {
                        console.error('Failed to save prediction history:', dbErr);
                    }
                }

                res.json({
                    success: true,
                    prediction: result.prediction,
                    probability: result.probability,
                    riskScore: riskScore,
                    riskLevel: riskLevel,
                    insights: finalInsights,
                    inputData: inputData,
                    message: result.prediction === 1 ?
                        'Prediction indicates potential risk.' :
                        'Prediction indicates low risk.'
                });

            } catch (err) {
                console.error('Error parsing Python output:', err);
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
