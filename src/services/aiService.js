import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import fs from 'fs';

dotenv.config();

// Initialize AI clients
let groq = null;
if (process.env.GROQ_API_KEY?.trim()) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY.trim() });
}

let gemini = null;
if (process.env.GOOGLE_API_KEY?.trim()) {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY.trim());
  gemini = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

console.log('🤖 AI Clients Status:', { 
  groq: !!groq ? 'READY' : 'MISSING KEY', 
  gemini: !!gemini ? 'READY' : 'MISSING KEY' 
});


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================================
// 📊 LOCAL ML ENGINE CONFIGURATION
// ========================================

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
                console.log('✅ SweetTrack Daemon is Ready');
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

// ========================================
// 🔬 METABOLIC SUITABILITY LOGIC
// ========================================

/**
 * Calculates if a meal is safe/caution based on user risk level and nutritional density.
 */
export const calculateDiabeticSuitability = (nutrition, userRisk = null, foodItems = []) => {
  const risk = userRisk?.riskLevel || 'Unknown';
  const sugar = nutrition.sugar || 0;
  const carbs = nutrition.carbs || 0;
  const protein = nutrition.protein || 0;
  const fiber = nutrition.fiber || 0;
  const cals = nutrition.calories || 1; // avoid div by zero

  let rating = 'suitabilityRecommended';
  let color = '#34C759';
  let score = 85;
  let reason = 'This meal appears balanced for your profile.';

  const isDiabetic = risk.toLowerCase().includes('diabetic') || risk.toLowerCase().includes('high');

  if (isDiabetic) {
    if (sugar > 15 || (sugar / cals) > 0.15) {
      rating = 'suitabilityHazard';
      color = '#FF3B30';
      score = Math.max(10, 40 - sugar * 2);
      reason = 'High sugar content detected. This may cause a significant glucose spike.';
    } else if (carbs > 60) {
      rating = 'suitabilityWarning';
      color = '#FF9500';
      score = Math.max(30, 65 - carbs/2);
      reason = 'High carbohydrate load. Consider reducing portion size or adding fiber/protein.';
    }
  } else {
    // General health guidelines for non-diabetic
    if (sugar > 25) {
      rating = 'suitabilityWarning';
      color = '#FF9500';
      score = 55;
      reason = 'High sugar content for a single meal. Maintain moderation.';
    }
  }

  return { rating, color, score, reason };
};

// ========================================
// 📸 CORE ANALYSIS EXPORTS
// ========================================

/**
 * 📸 Analyze Meal Image (Local ML Inference)
 * Sends image to persistent Python process and aggregates nutritional data.
 */
export const analyzeMealImage = async (imagePath, userRisk = null) => {
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
            // 🛡️ Confidence Threshold to prevent false positives
            const CONFIDENCE_THRESHOLD = 0.45;
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
                aggregatedNutrition.carbs += nutrition.carbs_g || 0;
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
                        carbs: nutrition.carbs_g || 0,
                        fiber: nutrition.fiber_g || 0,
                        sugar: nutrition.sugar_g || 0,
                        sodium: nutrition.sodium_mg || 0
                    } : null
                });
            }
        }

        // Final list for UI
        for (const item of labelMap.values()) {
            foundItems.push({
                ...item,
                name: item.label
            });
        }

        if (foundItems.length === 0) {
            const primary = detections && detections.length > 0 ? detections[0] : null;
            return {
                isNotFood: true,
                confidence: primary ? primary.confidence : 0,
                detectedAs: primary ? (primary.label || primary.class) : 'Non-Food Item',
                message: "AI is unsure if this contains food."
            };
        }

        const nutritionalInfo = {
            calories: Math.round(aggregatedNutrition.calories),
            protein: parseFloat((aggregatedNutrition.protein).toFixed(1)),
            fat: parseFloat((aggregatedNutrition.fat).toFixed(1)),
            carbs: parseFloat((aggregatedNutrition.carbs).toFixed(1)),
            fiber: parseFloat((aggregatedNutrition.fiber).toFixed(1)),
            sugar: parseFloat((aggregatedNutrition.sugar).toFixed(1)),
            sodium: parseFloat((aggregatedNutrition.sodium).toFixed(1))
        };

        // 🔬 Add Metabolic Suitability Analysis
        const suitability = calculateDiabeticSuitability(nutritionalInfo, userRisk, foundItems);

        return {
            foodItems: foundItems,
            nutritionalInfo,
            servingSize: `${foundItems.length} Segment(s) Detected`,
            healthTips: generateHealthTips(foundItems[0].name, aggregatedNutrition),
            suitability
        };

    } catch (error) {
        console.error('Inference Engine Error:', error.message);
        throw error;
    }
};

/**
 * 🤖 Unified Chat Response (Multimodal)
 * Primary: Groq (Llama 3 for text, Llama 4 Scout for Vision)
 * Fallback: Gemini
 */
export const generateChatResponse = async (message, imageBuffer = null, mimeType = 'image/jpeg', history = [], systemPrompt = '') => {
  try {
    // 1. TRY GROQ (Primary)
    if (groq) {
      try {
        const isVision = !!imageBuffer;
        const model = isVision ? 'llama-3.2-11b-vision-preview' : 'llama-3.3-70b-versatile';
        
        console.log(`🚀 [AI-Service] Using Groq (${model})`);

        const messages = [{ role: 'system', content: systemPrompt }];
        
        // Add History
        history.forEach(msg => {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        });

        // Add Current Message
        if (isVision) {
          const base64Image = imageBuffer.toString('base64');
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: message || "Analyze this health-related image." },
              { 
                type: 'image_url', 
                image_url: { url: `data:${mimeType};base64,${base64Image}` } 
              }
            ]
          });
        } else {
          messages.push({ role: 'user', content: message });
        }

        const completion = await groq.chat.completions.create({
          model,
          messages,
          temperature: 0.5,
          max_tokens: 500,
        });

        const reply = completion.choices?.[0]?.message?.content;
        if (reply) return reply;
      } catch (groqErr) {
        console.error('❌ Groq Chat Error:', groqErr.message);
        // Fallthrough to Gemini
      }
    }

    // 2. TRY GEMINI (Fallback)
    if (gemini) {
      try {
        console.log('🔄 [AI-Service] Falling back to Gemini');
        const parts = [systemPrompt, ...history.map(m => `${m.role}: ${m.content}`), message];
        
        if (imageBuffer) {
          parts.push({
            inlineData: {
              data: imageBuffer.toString('base64'),
              mimeType
            }
          });
        }

        const result = await gemini.generateContent(parts);
        return result.response.text();
      } catch (gemErr) {
        console.error('❌ Gemini Fallback Error:', gemErr.message);
      }
    }

    throw new Error('All AI providers failed');
  } catch (error) {
    console.error('❌ AI Service Error Details:', error);
    return 'I am having trouble connecting to my brain right now. Please try again later.';
  }
};

/**
 * 🤖 Multimodal Fallback (Legacy Wrapper)
 */
export const generateMultimodalResponse = async (params) => {
  return generateChatResponse(params.prompt, params.imageBuffer, params.mimeType, params.history, params.systemPrompt);
};


// Helper to generate simple health tips
const generateHealthTips = (foodName, nutrition) => {
    const tips = [];
    if (!nutrition) return ["Enjoy your meal!"];

    const isHighCal = nutrition.calories > 400;
    const isHighProtein = nutrition.protein > 15;
    const isHighSugar = nutrition.sugar > 15;
    const isHighFiber = nutrition.fiber > 4;

    if (isHighCal) tips.push("Calorie dense - portion control recommended.");
    if (isHighProtein) tips.push("Excellent protein source for muscle recovery.");
    if (isHighFiber) tips.push("High fiber - great for digestion and satiety.");
    if (isHighSugar) tips.push("High sugar - watch your glucose levels.");

    if (tips.length === 0) tips.push("A balanced and healthy choice.");
    return tips.slice(0, 2);
};
