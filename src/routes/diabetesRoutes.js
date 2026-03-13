import express from 'express';
import { predictDiabetes, getLatestPrediction, getPredictionHistory } from '../controllers/diabetesController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
console.log('✅ Loading Diabetes Routes - /history should be registered');

router.get('/latest', protect, getLatestPrediction);
router.get('/history', protect, getPredictionHistory);
router.post('/predict', protect, predictDiabetes);

export default router;
