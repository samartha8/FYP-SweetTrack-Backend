import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import MealLog from '../models/MealLog.js';
import DiabetesPrediction from '../models/DiabetesPrediction.js';
import { analyzeMealImage, calculateDiabeticSuitability } from '../services/aiService.js';
import { analyzeTextLocally } from '../services/textNutritionService.js';
import { generateDailyAudit } from '../services/metabolicAuditService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRoot = path.join(__dirname, '..', '..', 'uploads', 'meal-images');

// Ensure upload directory exists
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || '');
    cb(null, `meal-${uniqueSuffix}${ext || '.jpg'}`);
  },
});

export const mealImageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const buildImageUrl = (req, filename) => {
  if (!filename) return null;
  const host = req.get('host');
  const protocol = req.protocol;
  return `${protocol}://${host}/uploads/meal-images/${filename}`;
};

// Analyze uploaded meal image
export const analyzeMeal = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }

    const imagePath = req.file.path;
    const imageUrl = buildImageUrl(req, req.file.filename);

    // 🔬 Fetch User's Latest Diabetes Risk Context
    let userRisk = null;
    if (req.user) {
      const latestPrediction = await DiabetesPrediction.findOne({ user: req.user._id }).sort({ createdAt: -1 });
      if (latestPrediction) {
        userRisk = {
          riskLevel: latestPrediction.riskLevel,
          riskScore: latestPrediction.riskScore
        };
      }
    }

    const result = await analyzeMealImage(imagePath, userRisk);

    res.json({
      success: true,
      imageUrl,
      filename: req.file.filename,
      ...result
    });

  } catch (error) {
    console.error('Analyze meal error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze meal'
    });
  }
};

// 🔬 Analyze text-based meal description (NLP)
export const analyzeTextLog = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: 'Text description is required' });
    }

    const result = analyzeTextLocally(text);

    if (!result || result.error) {
      let msg = 'Could not identify any familiar foods in your description.';
      let suggestions = [];
      if (result && result.suggestions && result.suggestions.length > 0) {
          msg += ` Did you mean: ${result.suggestions.join(', ')}?`;
          suggestions = result.suggestions;
      } else {
          msg += ' Try being more specific (e.g., "boiled egg", "apple ligol").';
      }
      return res.status(200).json({ 
          success: false, 
          needsClarification: true, 
          suggestions: suggestions,
          message: msg 
      });
    }

    // Fetch User's Latest Diabetes Risk for suitability logic
    let userRisk = null;
    if (req.user) {
      const latestPrediction = await DiabetesPrediction.findOne({ user: req.user._id }).sort({ createdAt: -1 });
      if (latestPrediction) {
        userRisk = {
          riskLevel: latestPrediction.riskLevel,
          riskScore: latestPrediction.riskScore
        };
      }
    }

    // Add Diabetic Suitability to the text result
    const suitability = calculateDiabeticSuitability(result.nutritionalInfo, userRisk, result.foodItems);
    
    res.json({
      success: true,
      ...result,
      suitability
    });

  } catch (error) {
    console.error('Analyze text error:', error);
    res.status(500).json({ success: false, message: 'Failed to process text description' });
  }
};

// 📊 Generate Daily Metabolic Recap (End-of-day report)
export const getDailyRecap = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all meals for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const meals = await MealLog.find({
      user: userId,
      loggedAt: { $gte: today }
    });

    // Fetch User Risk
    let userRisk = null;
    const latestPrediction = await DiabetesPrediction.findOne({ user: userId }).sort({ createdAt: -1 });
    if (latestPrediction) {
      userRisk = {
        riskLevel: latestPrediction.riskLevel,
        riskScore: latestPrediction.riskScore
      };
    }

    const audit = generateDailyAudit(meals, userRisk);

    res.json({
      success: true,
      ...audit
    });

  } catch (error) {
    console.error('Daily recap error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate daily report' });
  }
};

// Create a meal log entry
export const createMealLog = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      mealType,
      foodItems = [],
      nutritionalInfo = {},
      servingSize,
      notes,
      loggedAt,
      imageUrl: bodyImageUrl, // Accept pre-existing URL from body
    } = req.body;

    if (!mealType) {
      return res.status(400).json({ success: false, message: 'mealType is required' });
    }

    const payload = {
      user: userId,
      mealType,
      foodItems: Array.isArray(foodItems) ? foodItems : JSON.parse(foodItems || '[]'),
      nutritionalInfo: typeof nutritionalInfo === 'string' ? JSON.parse(nutritionalInfo) : nutritionalInfo,
      servingSize,
      notes,
      loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
      imageUrl: bodyImageUrl, // Fallback to provided URL
    };

    if (req.file) {
      payload.imageUrl = buildImageUrl(req, req.file.filename);
      payload.storagePath = req.file.path;
    }

    if (process.env.NODE_ENV === 'development') console.time('💾 [Backend] MealLog.create');
    const mealLog = await MealLog.create(payload);
    if (process.env.NODE_ENV === 'development') console.timeEnd('💾 [Backend] MealLog.create');

    res.status(201).json({ success: true, mealLog });
  } catch (error) {
    console.error('Create meal log error:', error);
    res.status(500).json({ success: false, message: 'Error creating meal log' });
  }
};

// List meal logs for current user
export const listMealLogs = async (req, res) => {
  try {
    const userId = req.user.id;
    const logs = await MealLog.find({ user: userId }).sort({ loggedAt: -1 });
    res.status(200).json({ success: true, mealLogs: logs });
  } catch (error) {
    console.error('List meal logs error:', error);
    res.status(500).json({ success: false, message: 'Error fetching meal logs' });
  }
};

// Get single meal log
export const getMealLog = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid meal log ID' });
    }

    const log = await MealLog.findOne({ _id: id, user: userId });
    if (!log) {
      return res.status(404).json({ success: false, message: 'Meal log not found' });
    }

    res.status(200).json({ success: true, mealLog: log });
  } catch (error) {
    console.error('Get meal log error:', error);
    res.status(500).json({ success: false, message: 'Error fetching meal log' });
  }
};

// Delete meal log
export const deleteMealLog = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid meal log ID' });
    }

    const log = await MealLog.findOneAndDelete({ _id: id, user: userId });
    if (!log) {
      return res.status(404).json({ success: false, message: 'Meal log not found' });
    }

    // Best-effort remove file
    if (log.storagePath) {
      fs.unlink(log.storagePath, () => { });
    }

    res.status(200).json({ success: true, message: 'Meal log deleted' });
  } catch (error) {
    console.error('Delete meal log error:', error);
    res.status(500).json({ success: false, message: 'Error deleting meal log' });
  }
};

// Get available food classes for manual correction
export const getFoodClasses = async (req, res) => {
  try {
    const NUTRITION_PATH = path.join(process.cwd(), 'ml_models/nutrition_lookup.json');
    const rawData = fs.readFileSync(NUTRITION_PATH, 'utf8');
    const nutritionDb = JSON.parse(rawData);
    const classes = Object.keys(nutritionDb);

    // Sort and format for the frontend search
    const formatted = classes.map(c => ({
      id: c,
      name: c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    })).sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({ success: true, classes: formatted });
  } catch (error) {
    console.error('Get food classes error:', error);
    res.status(500).json({ success: false, message: 'Error fetching food classes' });
  }
};

// Get nutrition for a specific class (manual correction)
export const getNutritionForClass = async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Food name is required' });
    }

    const NUTRITION_PATH = path.join(process.cwd(), 'ml_models/nutrition_lookup.json');
    const rawData = fs.readFileSync(NUTRITION_PATH, 'utf8');
    const nutritionDb = JSON.parse(rawData);

    const nutrition = nutritionDb[name];
    if (!nutrition) {
      return res.status(404).json({ success: false, message: 'Nutrition data not found' });
    }

    // 🔬 Fetch User's Latest Diabetes Risk Context for manual addition
    let userRisk = null;
    if (req.user) {
      const DiabetesPrediction = (await import('../models/DiabetesPrediction.js')).default;
      const latestPrediction = await DiabetesPrediction.findOne({ user: req.user._id }).sort({ createdAt: -1 });
      if (latestPrediction) {
        userRisk = {
          riskLevel: latestPrediction.riskLevel,
          riskScore: latestPrediction.riskScore
        };
      }
    }

    const compiledNutrition = {
      calories: nutrition.calories || 0,
      carbs: nutrition.carbs_g || 0,
      protein: nutrition.protein_g || 0,
      fat: nutrition.fat_g || 0,
      fiber: nutrition.fiber_g || 0,
      sugar: nutrition.sugar_g || 0,
      sodium: nutrition.sodium_mg || 0
    };

    const suitability = calculateDiabeticSuitability(compiledNutrition, userRisk, [{ name: name }]);

    res.status(200).json({
      success: true,
      name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      nutrition: compiledNutrition,
      suitability: suitability
    });
  } catch (error) {
    console.error('Get nutrition error:', error);
    res.status(500).json({ success: false, message: 'Error fetching nutrition' });
  }
};


