import express from 'express';
import { createMealLog, deleteMealLog, getMealLog, listMealLogs, mealImageUpload, analyzeMeal, getFoodClasses, getNutritionForClass } from '../controllers/mealController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(listMealLogs)
  .post((req, res, next) => {
    // ⚡ If the content is JSON, skip Multer entirely for 3-5x faster saves
    if (req.headers['content-type']?.includes('application/json')) {
      return createMealLog(req, res, next);
    }
    // Otherwise, use Multer for binary image uploads
    return mealImageUpload.single('image')(req, res, next);
  }, createMealLog);

router.post('/analyze', mealImageUpload.single('image'), analyzeMeal);

router.get('/food-classes', getFoodClasses);
router.get('/nutrition-lookup', getNutritionForClass);

router
  .route('/:id')
  .get(getMealLog)
  .delete(deleteMealLog);

export default router;
