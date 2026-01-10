import express from 'express';
import { predictDiabetes, getLatestPrediction } from '../controllers/diabetesController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/latest', protect, getLatestPrediction);
router.post('/predict', protect, predictDiabetes);

export default router;
