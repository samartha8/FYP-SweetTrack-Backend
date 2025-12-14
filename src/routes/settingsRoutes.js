import express from 'express';
import { getSettings, updateSettings, resetSettings } from '../controllers/settingsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

router.route('/')
  .get(getSettings)
  .put(updateSettings);

router.post('/reset', resetSettings);

export default router;

