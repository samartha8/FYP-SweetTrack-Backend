import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import MealLog from '../models/MealLog.js';
import { analyzeMealImage } from '../services/aiService.js';

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
    const result = await analyzeMealImage(imagePath);

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

    const mealLog = await MealLog.create(payload);

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
    const CLASSES_PATH = path.join(process.cwd(), 'ml_models/class_names.json');
    const rawClasses = fs.readFileSync(CLASSES_PATH, 'utf8');
    const classes = JSON.parse(rawClasses);

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
};// Get nutrition for a specific class (manual correction)
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

    res.status(200).json({
      success: true,
      name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      nutrition: {
        calories: nutrition.calories || 0,
        carbs_g: nutrition.carbohydrates_g || 0,
        protein_g: nutrition.protein_g || 0,
        fat_g: nutrition.fat_g || 0,
        fiber_g: nutrition.fiber_g || 0,
        sugar_g: nutrition.sugar_g || 0,
        sodium_mg: nutrition.sodium_mg || 0
      }
    });
  } catch (error) {
    console.error('Get nutrition error:', error);
    res.status(500).json({ success: false, message: 'Error fetching nutrition' });
  }
};


