import express from 'express';
import { createMealLog, deleteMealLog, getMealLog, listMealLogs, mealImageUpload } from '../controllers/mealController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(listMealLogs)
  .post(mealImageUpload.single('image'), createMealLog);

router
  .route('/:id')
  .get(getMealLog)
  .delete(deleteMealLog);

export default router;

