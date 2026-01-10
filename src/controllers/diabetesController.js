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
            timestamp: prediction.createdAt
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

        // Path to python script
        const pythonScriptPath = path.join(__dirname, '../../ml_models/predict.py');

        // Spawn python process
        const pythonProcess = spawn('python', [pythonScriptPath]);

        let dataString = '';
        let errorString = '';

        // Send data to python script via stdin
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
                const result = JSON.parse(dataString);

                if (!result.success) {
                    throw new Error(result.error || 'Unknown error from prediction script');
                }

                // --- POST-PROCESSING ---

                // 1. Determine Risk Level from ML
                const mlProbability = result.probability || 0;
                let riskLevel = 'Low';
                if (mlProbability >= 0.6) riskLevel = 'High';
                else if (mlProbability >= 0.2) riskLevel = 'Moderate';

                // 2. Clinical Overrides (Safety Net)
                // The Pima model might miss high-risk cases due to missing features (like HbA1c) or population bias.
                // We apply clinical guidelines to ensure safety.
                const glucose = inputData.glucose || inputData.bloodGlucoseEstimated || 0;
                const hba1c = inputData.hba1cEstimated || 0;
                const bmi = parseFloat(inputData.bmi || 0);
                const isHighBP = inputData.highBP == '1' || inputData.highBP === 1 || inputData.bloodPressure > 130;

                let clinicalOverride = false;

                // Rule 1: Diabetes Range (High Risk)
                if (hba1c >= 6.5 || glucose >= 200) {
                    riskLevel = 'High';
                    clinicalOverride = true;
                }
                // Rule 2: Prediabetes Range (Moderate Risk minimum)
                else if (hba1c >= 5.7 || glucose >= 140) {
                    if (riskLevel === 'Low') riskLevel = 'Moderate';
                    clinicalOverride = true;
                }

                // 3. Generate Insights
                const insights = [];

                if (clinicalOverride) {
                    insights.push('Risk level elevated based on clinical guidelines (HbA1c/Glucose).');
                } else if (riskLevel === 'High') {
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

                if (insights.length === 0 && riskLevel === 'Low') {
                    insights.push('Great job! Your metrics indicate a healthy profile.');
                }

                // Adjust Risk Score for display if overridden (ensure it matches level)
                let finalScore = result.riskScore;
                if (riskLevel === 'High' && finalScore < 60) finalScore = 85;
                if (riskLevel === 'Moderate' && finalScore < 20) finalScore = 45;

                // 3. Save to History (if user is authenticated)
                if (req.user) {
                    try {
                        const predictionRecord = new DiabetesPrediction({
                            user: req.user._id,
                            inputData: inputData, // Save raw input for debug/retraining
                            prediction: result.prediction,
                            probability: result.probability,
                            riskScore: result.riskScore,
                            riskLevel: riskLevel,
                            insights: insights
                        });
                        await predictionRecord.save();
                    } catch (dbErr) {
                        console.error('Failed to save prediction history:', dbErr);
                        // Don't fail the request, just log
                    }
                }

                res.json({
                    success: true,
                    prediction: result.prediction,
                    probability: result.probability,
                    riskScore: result.riskScore,
                    riskLevel: riskLevel,
                    insights: insights,
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
