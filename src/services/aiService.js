import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the 166-food nutrition lookup table
const NUTRITION_PATH = path.join(__dirname, '../../ml_models/nutrition_lookup.json');
let nutritionDb = {};
try {
    const rawData = fs.readFileSync(NUTRITION_PATH, 'utf8');
    nutritionDb = JSON.parse(rawData);
    console.log(`✅ Loaded nutrition database with ${Object.keys(nutritionDb).length} foods.`);
} catch (err) {
    console.error('❌ Failed to load nutrition_lookup.json:', err.message);
}

/**
 * Manages a persistent Python process to avoid the overhead of 
 * starting TensorFlow and loading the model for every request.
 */
class InferenceEngine {
    constructor() {
        this.process = null;
        this.rl = null;
        this.queue = [];
        this.isBusy = false;
        this.isReady = false; // Track if model is fully loaded
        this.scriptPath = path.join(__dirname, '../../ml_models/predict_food.py');
        this.init();
    }

    init() {
        if (this.process) return;

        console.log('🚀 Starting persistent Python inference engine (Proactive Boot)...');
        this.process = spawn('python', [this.scriptPath, '--daemon']);
        this.isReady = false;

        this.rl = readline.createInterface({
            input: this.process.stdout,
            terminal: false
        });

        this.process.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg.includes('DEBUG: Daemon READY')) {
                console.log('✅ ML Engine is READY for requests.');
                this.isReady = true;
            }
            if (msg.includes('DEBUG:')) {
                console.log(`[ML-Daemon] ${msg}`);
            } else if (msg.length > 0) {
                console.warn(`[ML-Warning] ${msg}`);
            }
        });

        this.process.on('close', (code) => {
            console.error(`❌ ML Engine exited with code ${code}.`);
            this.process = null;
            this.rl = null;
            this.isBusy = false;
            this.isReady = false;

            // Reject pending request if it crashed during processing
            if (this.queue.length > 0) {
                const { reject } = this.queue.shift();
                reject(new Error('Inference engine crashed.'));
            }

            // Restart after a delay
            setTimeout(() => this.init(), 2000);
        });

        this.process.on('error', (err) => {
            console.error('Failed to start ML Engine:', err);
        });
    }

    async analyze(imagePath) {
        if (!this.isReady) {
            // If user requests during the 20-30s boot time, give them a specific error
            throw new Error('AI Engine is still warming up. Please wait about 20 seconds and try again.');
        }

        return new Promise((resolve, reject) => {
            this.queue.push({ imagePath, resolve, reject });
            this.processQueue();
        });
    }

    processQueue() {
        if (this.isBusy || this.queue.length === 0 || !this.process) return;

        this.isBusy = true;
        const { imagePath, resolve, reject } = this.queue.shift();

        const onLine = (line) => {
            this.rl.removeListener('line', onLine);
            this.isBusy = false;
            try {
                const results = JSON.parse(line);
                if (results.error) {
                    reject(new Error(results.error));
                } else {
                    resolve(results);
                }
            } catch (err) {
                reject(new Error('Failed to parse inference results: ' + line));
            }
            // Process next in queue
            this.processQueue();
        };

        this.rl.on('line', onLine);
        this.process.stdin.write(imagePath + '\n');
    }
}

// Singleton instance - initialized immediately on boot
const engineInstance = new InferenceEngine();

export const analyzeMealImage = async (imagePath) => {
    try {
        const detections = await engineInstance.analyze(imagePath);

        if (!detections || detections.length === 0) {
            throw new Error('No food detected');
        }

        // Aggregate nutritional info for ALL segments
        const aggregatedNutrition = {
            calories: 0,
            protein: 0,
            fat: 0,
            carbs: 0,
            fiber: 0,
            sugar: 0,
            sodium: 0
        };

        const foundItems = [];

        const labelMap = new Map();

        for (const p of detections) {
            // --- NON-FOOD DETECTION PER SEGMENT ---
            const CONFIDENCE_THRESHOLD = 0.20;
            if (p.confidence < CONFIDENCE_THRESHOLD) {
                console.warn(`[ML-Rejection] Segment rejected. Confidence ${p.confidence.toFixed(2)} below threshold.`);
                continue;
            }

            const foodName = p.class;
            const nutrition = nutritionDb[foodName];

            if (nutrition) {
                aggregatedNutrition.calories += nutrition.calories || 0;
                aggregatedNutrition.protein += nutrition.protein_g || 0;
                aggregatedNutrition.fat += nutrition.fat_g || 0;
                aggregatedNutrition.carbs += nutrition.carbohydrates_g || 0;
                aggregatedNutrition.fiber += nutrition.fiber_g || 0;
                aggregatedNutrition.sugar += nutrition.sugar_g || 0;
                aggregatedNutrition.sodium += nutrition.sodium_mg || 0;
            }

            // Grouping logic for UI display
            const label = p.label;
            if (labelMap.has(label)) {
                const existing = labelMap.get(label);
                existing.confidence = Math.max(existing.confidence, p.confidence);
                existing.count = (existing.count || 1) + 1;
            } else {
                labelMap.set(label, {
                    class: p.class,
                    label: label,
                    confidence: p.confidence,
                    count: 1,
                    box: p.box,
                    perItemNutrition: nutrition ? {
                        calories: nutrition.calories || 0,
                        protein: nutrition.protein_g || 0,
                        fat: nutrition.fat_g || 0,
                        carbs: nutrition.carbohydrates_g || 0,
                        fiber: nutrition.fiber_g || 0,
                        sugar: nutrition.sugar_g || 0,
                        sodium: nutrition.sodium_mg || 0
                    } : null
                });
            }
        }

        // Final list for UI: e.g. "Samosa" (quantity is passed separately)
        for (const item of labelMap.values()) {
            foundItems.push({
                ...item,
                name: item.label // Frontend expects 'name'
            });
        }

        if (foundItems.length === 0) {
            // If all segments were rejected, return uncertainty
            const primary = detections && detections.length > 0 ? detections[0] : null;

            // If the primary detection was an error message from python, handle it
            if (primary && primary.error) {
                throw new Error(primary.error);
            }

            return {
                isNotFood: true,
                confidence: primary ? primary.confidence : 0,
                detectedAs: primary ? primary.label : 'Unknown'
            };
        }

        const result = {
            foodItems: foundItems,
            nutritionalInfo: {
                calories: Math.round(aggregatedNutrition.calories),
                protein: parseFloat((aggregatedNutrition.protein).toFixed(1)),
                fat: parseFloat((aggregatedNutrition.fat).toFixed(1)),
                carbs: parseFloat((aggregatedNutrition.carbs).toFixed(1)),
                fiber: parseFloat((aggregatedNutrition.fiber).toFixed(1)),
                sugar: parseFloat((aggregatedNutrition.sugar).toFixed(1)),
                sodium: parseFloat((aggregatedNutrition.sodium).toFixed(1))
            },
            servingSize: `${foundItems.length} Segment(s) Detected`,
            healthTips: generateHealthTips(foundItems[0].name, aggregatedNutrition)
        };

        return result;

    } catch (error) {
        console.error('Inference Engine Error:', error.message);
        throw error;
    }
};

// Helper to generate simple health tips (unused for now but kept for future)
const generateHealthTips = (foodName, nutrition) => {
    const tips = [];
    if (!nutrition) return ["Enjoy your meal!"];

    const isHighCal = nutrition.calories > 400;
    const isHighProtein = nutrition.protein_g > 15;
    const isHighSugar = nutrition.sugar_g > 15;
    const isHighFiber = nutrition.fiber_g > 4;

    if (isHighCal) tips.push("Calorie dense - portion control recommended.");
    if (isHighProtein) tips.push("Excellent protein source for muscle recovery.");
    if (isHighFiber) tips.push("High fiber - great for digestion and satiety.");
    if (isHighSugar) tips.push("High sugar - watch your glucose levels.");

    // Add food-specific tips if needed
    if (foodName.includes('apple') || foodName.includes('banana')) {
        tips.push("Natural fruit sugars provide quick energy.");
    }

    if (tips.length === 0) tips.push("A balanced and healthy choice.");
    return tips.slice(0, 2); // Keep it concise
};
