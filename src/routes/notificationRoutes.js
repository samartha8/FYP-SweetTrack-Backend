import express from 'express';
import { checkGoalProgress, getGoals, registerPushToken, upsertGoals, updateWaterIntake } from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/goals', getGoals);
router.put('/goals', upsertGoals);
router.get('/progress', checkGoalProgress);
router.put('/water', updateWaterIntake);
router.post('/push-token', registerPushToken);

export default router;

