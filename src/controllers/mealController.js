import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import MealLog from '../models/MealLog.js';

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
      fs.unlink(log.storagePath, () => {});
    }

    res.status(200).json({ success: true, message: 'Meal log deleted' });
  } catch (error) {
    console.error('Delete meal log error:', error);
    res.status(500).json({ success: false, message: 'Error deleting meal log' });
  }
};

