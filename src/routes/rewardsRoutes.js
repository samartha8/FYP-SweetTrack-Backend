import express from 'express';
import { awardPoints, syncRewardsAndStreak, redeemReward } from '../controllers/rewardsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Protect all rewards routes
router.use(protect);

router.post('/sync', syncRewardsAndStreak);
router.post('/award', awardPoints);
router.post('/redeem', redeemReward);

export default router;

