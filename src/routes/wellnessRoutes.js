import express from 'express';
import { updateDailyMetrics, getDailyMetrics } from '../controllers/wellnessController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/metrics', getDailyMetrics);
router.put('/metrics', updateDailyMetrics);

export default router;
