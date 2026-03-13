import express from 'express';
import { createMealLog, deleteMealLog, getMealLog, listMealLogs, mealImageUpload, analyzeMeal, getFoodClasses, getNutritionForClass } from '../controllers/mealController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(listMealLogs)
  .post(mealImageUpload.single('image'), createMealLog);

router.post('/analyze', mealImageUpload.single('image'), analyzeMeal);

router.get('/food-classes', getFoodClasses);
router.get('/nutrition-lookup', getNutritionForClass);

router
  .route('/:id')
  .get(getMealLog)
  .delete(deleteMealLog);

export default router;
