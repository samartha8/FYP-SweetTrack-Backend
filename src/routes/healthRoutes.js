import express from 'express';
import { getHealthData, saveHealthData, scanMedicalReport } from '../controllers/healthController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/').get(protect, getHealthData).post(protect, saveHealthData);
router.post('/scan', protect, scanMedicalReport);

export default router;
