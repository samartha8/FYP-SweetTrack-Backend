import express from 'express';
import { getHealthData, saveHealthData } from '../controllers/healthController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/').get(protect, getHealthData).post(protect, saveHealthData);

export default router;
