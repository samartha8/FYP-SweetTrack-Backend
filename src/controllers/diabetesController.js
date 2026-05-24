import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import DiabetesPrediction from '../models/DiabetesPrediction.js';
import Health from '../models/Health.js';

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
            timestamp: prediction.createdAt,
            mode: prediction.mode || 'LIFESTYLE',
            confidenceScore: prediction.confidenceScore || 70
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
            bloodGlucoseEstimated, pregnancies, hba1cSource, glucoseSource
        } = req.body;

        const inputData = {
            age, sex, height, weight, bmi, highBP, highChol, genHlth,
            smoker, physActivity, heartDiseaseOrAttack, hba1cEstimated,
            bloodGlucoseEstimated, pregnancies
        };

        console.log("📥 [DiabetesController] CLEAN Input Data (Filtered):", JSON.stringify(inputData, null, 2));

        // 1. Pre-processing & Sanitization
        const safeParse = (val, fallback = 0) => {
            const parsed = parseFloat(val);
            return isNaN(parsed) ? fallback : parsed;
        };

        const bmiVal = safeParse(bmi, 25);
        const ageVal = safeParse(age, 5);
        const parseFloatSafe = (val) => (val == '1' || val === 1) ? 1 : 0;
        const highBPVal = parseFloatSafe(highBP);

        // Explicitly check for clinical data (Medical markers only)
        const hba1c = hba1cEstimated ? safeParse(hba1cEstimated, null) : null;
        const glucose = bloodGlucoseEstimated ? safeParse(bloodGlucoseEstimated, null) : null;
        const bpValForConfidence = highBP ? parseInt(highBP) : 0;
        
        const hasClinicalData = (hba1c !== null || glucose !== null || bmiVal > 0 || bpValForConfidence > 0);

        // Patch the input data for Python
        inputData.hba1cEstimated = hba1c || 0;
        inputData.bloodGlucoseEstimated = glucose || 0;
        inputData.glucose = glucose || 0;
        inputData.hasClinicalData = hasClinicalData ? 1 : 0;

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

                // --- POST-PROCESSING & CLINICAL CALIBRATION ---
                // Calculation is now purely based on physiological values.
                // Data Source only affects the Confidence Bar.

                let mlProbability = result.probability || 0;
                const mlPrediction = result.prediction || 0;
                let riskScore = 0;
                let riskLevel = 'Low Risk';

                // 1. Initial ML-based Level Determination
                if (mlProbability >= 0.7) {
                    riskLevel = 'High Risk';
                } else if (mlProbability > 0.35) {
                    riskLevel = 'Medium Risk';
                }

                // 2. Clinical Overrides (Ensure high RECALL for actually sick users)
                let clinicalOverride = false;

                if (hasClinicalData) {
                    // Rule 1: Diabetes Range (Strict High Risk)
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
                }

                console.log(`🧪 [DiabetesController] Clinical Analysis Trace:`, {
                    hba1c,
                    glucose,
                    hasClinicalData,
                    initialRiskLevel: result.riskLevel,
                    mlProbability
                });

                // 3. Proportional Scaling Logic
                const scaleScore = (prob, level, override) => {
                    console.log(`⚖️ [DiabetesController] Scaling Score: prob=${prob}, level=${level}, override=${override}`);
                    if (prob > 0.95) return prob * 100;
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
                console.log(`🎯 [DiabetesController] FINAL CALCULATED SCORE: ${riskScore}% (Override: ${clinicalOverride})`);

                // 4. Calculate ACCUMULATIVE Clinical Confidence Score (Evidence-Based)
                // Fetch the persistent Health record to get the REAL sources (Data Integrity)
                const persistentHealth = await Health.findOne({ user: req.user._id });
                
                // Rule: Start at 0%. ONLY 'report' sources provide percentage points.
                let finalConfidence = 0;
                
                // Use sources from the DATABASE record to ensure manual edits reset confidence
                const h1Source = persistentHealth?.hba1cSource || hba1cSource;
                const gSource = persistentHealth?.glucoseSource || glucoseSource;
                const bSource = persistentHealth?.bpSource || req.body.bpSource;
                const bmSource = persistentHealth?.bmiSource || req.body.bmiSource;
                const dSource = persistentHealth?.demographicsSource || req.body.demographicsSource;

                // 1. TOP PRIORITY: HbA1c (Long-term metabolic proof)
                if (h1Source === 'report') finalConfidence += 30;
                
                // 2. HIGH PRIORITY: Blood Glucose (Immediate metabolic proof)
                if (gSource === 'report') finalConfidence += 25;
                
                // 3. MEDIUM PRIORITY: Blood Pressure & BMI (Physiological indicators)
                if (bSource === 'report') finalConfidence += 15;
                if (bmSource === 'report') finalConfidence += 15;
                
                // 4. BASELINE: Demographics (Age, Sex, Height, Weight verified via report)
                if (dSource === 'report') finalConfidence += 15;
                
                // Manual entries contribute 0% - the user must scan to earn confidence.
                // This ensures the 100% bar represents a "Complete & Verified Clinical Profile".
                finalConfidence = Math.min(finalConfidence, 100);

                // 5. Generate Insights
                const insights = [];
                
                // Explain Clinical Confidence Source
                if (finalConfidence === 0) {
                    insights.push('💡 Your current risk is a "Lifestyle Estimate" (0% Clinical Confidence). Upload a lab report for a verified Clinical Audit.');
                } else if (finalConfidence < 100) {
                    insights.push(`📊 Your analysis is ${finalConfidence}% verified by scanned reports. Add more lab markers for a complete clinical audit.`);
                } else {
                    insights.push('✅ Clinical Audit Complete: Your analysis is 100% verified by official medical evidence.');
                }

                const finalInsights = insights.length > 0 ? insights : ['Your metrics indicate a healthy profile.'];

                if (req.user) {
                    try {
                        const predictionRecord = new DiabetesPrediction({
                            user: req.user._id,
                            inputData: inputData,
                            prediction: result.prediction,
                            probability: result.probability,
                            riskScore: riskScore,
                            riskLevel: riskLevel,
                            insights: finalInsights,
                            mainReasons: result.main_reasons || [],
                            mode: hasClinicalData ? 'CLINICAL' : (result.mode || 'LIFESTYLE'),
                            confidenceScore: finalConfidence
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
                    mainReasons: result.main_reasons || [],
                    inputData: inputData,
                    mode: hasClinicalData ? 'CLINICAL' : (result.mode || 'LIFESTYLE'),
                    confidenceScore: finalConfidence,
                    message: result.prediction === 1 ?
                        'STATUS: POSITIVE - Potential Metabolic Risk Detected.' :
                        'STATUS: NEGATIVE - Low Metabolic Risk Detected.'
                });

            } catch (err) {
                console.error('Error parsing Python output:', err);
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        message: 'Failed to process prediction result',
                        error: err.message
                    });
                }
            }
        });

    } catch (error) {
        console.error('Diabetes prediction error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Server error during prediction',
                error: error.message
            });
        }
    }
};
